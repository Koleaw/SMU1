const finiteNumber = (value) => Number.isFinite(value) ? Number(value) : null;

export function evaluateTransitionFrameEvidence({
  offset,
  actualOffset,
  requestedOffsets,
  phase,
  pageState,
  toleranceMs = 50
}) {
  const requested = finiteNumber(offset);
  const actual = finiteNumber(actualOffset);
  const tolerance = finiteNumber(toleranceMs);
  const offsets = Array.isArray(requestedOffsets)
    ? requestedOffsets.map(finiteNumber).filter((value) => value !== null)
    : [];
  const expectedPageState = phase === 'cover' ? 'covering' : phase === 'reveal' ? 'revealing' : '';

  if (requested === 0) {
    const nextCheckpoint = offsets.filter((value) => value > 0).sort((left, right) => left - right)[0] ?? null;
    const timingOk = actual !== null && nextCheckpoint !== null && actual >= 0 && actual < nextCheckpoint;
    const semanticOk = Boolean(expectedPageState) && pageState === expectedPageState;
    return Object.freeze({
      ok: timingOk && semanticOk,
      mode: 'earliest-observable',
      offset: requested,
      actualOffset: actual,
      nextCheckpoint,
      expectedPageState,
      pageState: String(pageState || ''),
      timingOk,
      semanticOk,
      toleranceMs: tolerance
    });
  }

  const timingOk = requested !== null && actual !== null && tolerance !== null && tolerance >= 0
    && Math.abs(actual - requested) <= tolerance;
  return Object.freeze({
    ok: timingOk,
    mode: 'exact-offset',
    offset: requested,
    actualOffset: actual,
    nextCheckpoint: null,
    expectedPageState,
    pageState: String(pageState || ''),
    timingOk,
    semanticOk: true,
    toleranceMs: tolerance
  });
}

export function evaluateEntranceClsDelta({
  readyLayoutShift,
  startLayoutShift,
  finalLayoutShift,
  maximumDelta = 0.001
}) {
  const ready = finiteNumber(readyLayoutShift);
  const start = finiteNumber(startLayoutShift);
  const final = finiteNumber(finalLayoutShift);
  const limit = finiteNumber(maximumDelta);
  const baselineSource = start !== null ? 'entrance-start' : ready !== null ? 'entrance-ready' : 'unavailable';
  const baseline = start ?? ready;
  const delta = baseline !== null && final !== null ? final - baseline : null;
  const valid = baseline !== null && final !== null && limit !== null && limit >= 0 && delta >= 0;

  return Object.freeze({
    ok: valid && delta <= limit,
    baselineSource,
    baseline,
    ready,
    start,
    final,
    delta,
    maximumDelta: limit,
    initialCumulative: baseline,
    valid
  });
}
