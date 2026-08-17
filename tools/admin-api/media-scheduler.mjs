const MIB = 1024 * 1024;
const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

export const MEDIA_QUEUE_STATUS = Object.freeze({
  WAITING: 'waiting',
  VALIDATING: 'validating',
  READY: 'ready',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  REUSED: 'reused',
  ERROR: 'error',
  CANCELLED: 'cancelled'
});

export const MEDIA_QUEUE_STATUS_LABELS = Object.freeze({
  [MEDIA_QUEUE_STATUS.WAITING]: 'Ожидает',
  [MEDIA_QUEUE_STATUS.VALIDATING]: 'Проверяется',
  [MEDIA_QUEUE_STATUS.READY]: 'Готово к загрузке',
  [MEDIA_QUEUE_STATUS.UPLOADING]: 'Загружается',
  [MEDIA_QUEUE_STATUS.UPLOADED]: 'Загружено',
  [MEDIA_QUEUE_STATUS.REUSED]: 'Уже было загружено',
  [MEDIA_QUEUE_STATUS.ERROR]: 'Ошибка',
  [MEDIA_QUEUE_STATUS.CANCELLED]: 'Отменено'
});

export const DEFAULT_SCHEDULER_POLICY = Object.freeze({
  concurrency: 2,
  windowMaxItems: 10,
  windowMaxBytes: 48 * MIB,
  maxQueueItems: 1000
});

export class MediaSchedulerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'MediaSchedulerError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
  }
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new MediaSchedulerError('SCHEDULER_POLICY_INVALID', `Некорректное значение ${name}.`);
  }
  return parsed;
}

function schedulerPolicy(options = {}) {
  const policy = {
    concurrency: positiveInteger(options.concurrency ?? DEFAULT_SCHEDULER_POLICY.concurrency, 'concurrency', 2),
    windowMaxItems: positiveInteger(options.windowMaxItems ?? DEFAULT_SCHEDULER_POLICY.windowMaxItems, 'windowMaxItems', 10),
    windowMaxBytes: positiveInteger(options.windowMaxBytes ?? DEFAULT_SCHEDULER_POLICY.windowMaxBytes, 'windowMaxBytes'),
    maxQueueItems: positiveInteger(options.maxQueueItems ?? DEFAULT_SCHEDULER_POLICY.maxQueueItems, 'maxQueueItems', 10_000)
  };
  return Object.freeze(policy);
}

function normalizeItems(items, policy) {
  if (!Array.isArray(items)) {
    throw new MediaSchedulerError('MEDIA_QUEUE_INVALID', 'Очередь должна быть массивом файлов.');
  }
  if (items.length > policy.maxQueueItems) {
    throw new MediaSchedulerError('MEDIA_QUEUE_LIMIT', 'Очередь превышает безопасный лимит элементов.', {
      details: { count: items.length, maxQueueItems: policy.maxQueueItems }
    });
  }
  const seen = new Set();
  return items.map((item, queueIndex) => {
    const clientId = String(item?.clientId ?? '');
    if (!CLIENT_ID_RE.test(clientId)) {
      throw new MediaSchedulerError('MEDIA_CLIENT_ID_INVALID', 'Каждому файлу нужен безопасный stable clientId.');
    }
    if (seen.has(clientId)) {
      throw new MediaSchedulerError('MEDIA_CLIENT_ID_DUPLICATE', 'clientId в очереди должен быть уникальным.', {
        details: { clientId }
      });
    }
    seen.add(clientId);
    const bytes = positiveInteger(item?.bytes, `bytes:${clientId}`);
    if (bytes > policy.windowMaxBytes) {
      throw new MediaSchedulerError('MEDIA_ITEM_EXCEEDS_WINDOW', 'Один файл превышает безопасный scheduler window.', {
        details: { clientId, bytes, windowMaxBytes: policy.windowMaxBytes }
      });
    }
    const originalIndex = item?.originalIndex === undefined ? queueIndex : Number(item.originalIndex);
    if (!Number.isSafeInteger(originalIndex) || originalIndex < 0) {
      throw new MediaSchedulerError('MEDIA_ORIGINAL_INDEX_INVALID', 'Некорректный originalIndex.', {
        details: { clientId }
      });
    }
    return Object.freeze({ item, clientId, bytes, originalIndex, queueIndex });
  });
}

export function planMediaWindows(items, options = {}) {
  const policy = schedulerPolicy(options);
  const normalized = normalizeItems(items, policy);
  const windows = [];
  let current = [];
  let currentBytes = 0;
  for (const entry of normalized) {
    if (current.length > 0
      && (current.length >= policy.windowMaxItems || currentBytes + entry.bytes > policy.windowMaxBytes)) {
      windows.push(Object.freeze(current));
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entry.bytes;
  }
  if (current.length) windows.push(Object.freeze(current));
  return Object.freeze(windows);
}

function safeError(error) {
  return Object.freeze({
    code: String(error?.code ?? 'MEDIA_UPLOAD_FAILED'),
    name: String(error?.name ?? 'Error'),
    message: String(error?.message ?? 'Не удалось загрузить файл.')
  });
}

function publicRecord(record) {
  return Object.freeze({
    clientId: record.clientId,
    originalIndex: record.originalIndex,
    queueIndex: record.queueIndex,
    bytes: record.bytes,
    status: record.status,
    statusLabel: MEDIA_QUEUE_STATUS_LABELS[record.status],
    attempt: record.attempt,
    cancelRequested: record.cancelRequested,
    outcome: record.outcome,
    requiresStatusCheck: record.requiresStatusCheck,
    result: record.result,
    error: record.error,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt
  });
}

function queueSignature(normalized) {
  return normalized.map((entry) => `${entry.clientId}:${entry.bytes}:${entry.originalIndex}`).join('|');
}

function abortLike(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export function createMediaScheduler(options = {}) {
  if (typeof options.worker !== 'function') {
    throw new MediaSchedulerError('MEDIA_WORKER_REQUIRED', 'Scheduler требует worker для одного файла на один request.');
  }
  const policy = schedulerPolicy(options);
  const worker = options.worker;
  const now = options.now ?? Date.now;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
  let records = [];
  let signature = null;
  let activePromise = null;
  let initialized = false;

  const snapshot = () => Object.freeze(records.map(publicRecord));

  function emit(record) {
    if (!onUpdate) return;
    try {
      onUpdate(publicRecord(record), snapshot());
    } catch {
      // UI progress listeners cannot break the upload engine.
    }
  }

  function initialize(items) {
    const normalized = normalizeItems(items, policy);
    const nextSignature = queueSignature(normalized);
    if (initialized) {
      if (nextSignature !== signature) {
        throw new MediaSchedulerError('MEDIA_QUEUE_ALREADY_INITIALIZED', 'Scheduler уже связан с другой очередью.');
      }
      return;
    }
    signature = nextSignature;
    records = normalized.map((entry) => ({
      ...entry,
      status: MEDIA_QUEUE_STATUS.READY,
      attempt: 0,
      cancelRequested: false,
      controller: null,
      result: null,
      error: null,
      outcome: null,
      requiresStatusCheck: false,
      startedAt: null,
      finishedAt: null
    }));
    initialized = true;
  }

  async function runRecord(record) {
    if (record.status === MEDIA_QUEUE_STATUS.CANCELLED) return;
    const controller = new AbortController();
    record.controller = controller;
    record.cancelRequested = false;
    record.status = MEDIA_QUEUE_STATUS.UPLOADING;
    record.attempt += 1;
    record.error = null;
    record.result = null;
    record.outcome = null;
    record.requiresStatusCheck = false;
    record.startedAt = now();
    record.finishedAt = null;
    emit(record);
    try {
      const result = await worker(record.item, {
        signal: controller.signal,
        clientId: record.clientId,
        originalIndex: record.originalIndex,
        queueIndex: record.queueIndex,
        attempt: record.attempt
      });
      record.result = result === undefined ? null : result;
      record.status = result?.reused === true ? MEDIA_QUEUE_STATUS.REUSED : MEDIA_QUEUE_STATUS.UPLOADED;
      record.outcome = 'confirmed';
      record.requiresStatusCheck = false;
      record.cancelRequested = false;
    } catch (error) {
      if (record.cancelRequested && abortLike(error, controller.signal)) {
        record.status = MEDIA_QUEUE_STATUS.CANCELLED;
        record.outcome = 'unknown';
        record.requiresStatusCheck = true;
        record.error = null;
      } else {
        record.status = MEDIA_QUEUE_STATUS.ERROR;
        record.outcome = 'failed';
        record.requiresStatusCheck = false;
        record.error = safeError(error);
      }
    } finally {
      record.controller = null;
      record.finishedAt = now();
      emit(record);
    }
  }

  async function runWindow(windowRecords) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(policy.concurrency, windowRecords.length) }, async () => {
      while (cursor < windowRecords.length) {
        const index = cursor;
        cursor += 1;
        await runRecord(windowRecords[index]);
      }
    });
    await Promise.all(runners);
  }

  async function runSelected(selected) {
    const itemToRecord = new Map(selected.map((record) => [record.item, record]));
    const windows = planMediaWindows(selected.map((record) => record.item), policy);
    for (const window of windows) {
      const windowRecords = window.map((entry) => itemToRecord.get(entry.item));
      await runWindow(windowRecords);
    }
    return snapshot();
  }

  function activate(selected) {
    const run = runSelected(selected);
    const tracked = run.finally(() => {
      if (activePromise === tracked) activePromise = null;
    });
    activePromise = tracked;
    return activePromise;
  }

  function start(items) {
    if (activePromise) return activePromise;
    initialize(items);
    const ready = records.filter((record) => record.status === MEDIA_QUEUE_STATUS.READY);
    if (!ready.length) return Promise.resolve(snapshot());
    return activate(ready);
  }

  function cancel(clientId) {
    if (!initialized) return snapshot();
    const targets = clientId === undefined
      ? records
      : records.filter((record) => record.clientId === String(clientId));
    if (clientId !== undefined && targets.length === 0) {
      throw new MediaSchedulerError('MEDIA_ITEM_NOT_FOUND', 'Элемент очереди не найден.');
    }
    for (const record of targets) {
      if (record.status === MEDIA_QUEUE_STATUS.READY || record.status === MEDIA_QUEUE_STATUS.WAITING) {
        record.status = MEDIA_QUEUE_STATUS.CANCELLED;
        record.cancelRequested = true;
        record.outcome = 'not-started';
        record.requiresStatusCheck = false;
        record.finishedAt = now();
        emit(record);
      } else if (record.status === MEDIA_QUEUE_STATUS.UPLOADING) {
        record.cancelRequested = true;
        record.status = MEDIA_QUEUE_STATUS.CANCELLED;
        record.outcome = 'unknown';
        record.requiresStatusCheck = true;
        record.controller?.abort(new MediaSchedulerError('MEDIA_UPLOAD_CANCELLED', 'Загрузка отменена пользователем.'));
        emit(record);
      }
    }
    return snapshot();
  }

  function retryFailed() {
    if (!initialized) return Promise.resolve(snapshot());
    if (activePromise) {
      throw new MediaSchedulerError('MEDIA_SCHEDULER_BUSY', 'Дождитесь завершения текущего scheduler run.');
    }
    const failed = records.filter((record) => record.status === MEDIA_QUEUE_STATUS.ERROR);
    for (const record of failed) {
      record.status = MEDIA_QUEUE_STATUS.READY;
      record.error = null;
      record.outcome = null;
      record.cancelRequested = false;
      record.requiresStatusCheck = false;
      emit(record);
    }
    return failed.length ? activate(failed) : Promise.resolve(snapshot());
  }

  return Object.freeze({
    policy,
    start,
    cancel,
    retryFailed,
    snapshot,
    isRunning: () => activePromise !== null
  });
}
