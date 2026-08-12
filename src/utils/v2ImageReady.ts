type ImageReadinessState = 'pending' | 'ready' | 'fallback';

interface ImageWatcher {
  getState: () => ImageReadinessState;
  settled: Promise<void>;
  useTimeoutFallback: () => void;
}

const readiness = new WeakMap<HTMLElement, Promise<void>>();
const fallbackCopy = 'Изображение не удалось загрузить';

const revealImages = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLImageElement>('img'))
  .filter((image) => !image.hasAttribute('data-v2-image-readiness-ignore')
    && !image.closest('dialog, .v2-product-gallery__thumbs')
    && !image.parentElement?.closest('[hidden]'));

const isFallbackElement = (element: HTMLElement) => element.hasAttribute('data-v2-image-fallback')
  || element.classList.contains('v2-media-empty')
  || Array.from(element.classList).some((className) => className.endsWith('__fallback') || className.endsWith('-fallback'));

const getFallbackElement = (host: HTMLElement) => {
  const existing = Array.from(host.children)
    .find((child): child is HTMLElement => child instanceof HTMLElement && isFallbackElement(child));

  if (existing) {
    existing.dataset.v2ImageFallback = '';
    if (!existing.textContent?.trim()) {
      const message = document.createElement('p');
      message.textContent = fallbackCopy;
      existing.append(message);
    }
    return existing;
  }

  const fallback = document.createElement('div');
  const message = document.createElement('p');
  fallback.className = 'v2-media-empty v2-image-fallback';
  fallback.dataset.v2ImageFallback = '';
  message.textContent = fallbackCopy;
  fallback.append(message);
  host.append(fallback);
  return fallback;
};

const setFallbackAccessibility = (fallback: HTMLElement, visible: boolean) => {
  fallback.setAttribute('aria-hidden', String(!visible));
  fallback.setAttribute('role', 'status');
  fallback.setAttribute('aria-live', 'polite');
  fallback.setAttribute('aria-atomic', 'true');
};

const setImageFallback = (image: HTMLImageElement) => {
  const host = image.closest<HTMLElement>('[data-v2-media]') || image.parentElement;
  image.hidden = true;
  image.dataset.v2ImageState = 'fallback';
  if (!host) return;

  const fallback = getFallbackElement(host);
  host.classList.add('is-broken', 'v2-image-fallback-host');
  host.dataset.v2MediaState = 'fallback';
  setFallbackAccessibility(fallback, true);
};

const setImageReady = (image: HTMLImageElement) => {
  const host = image.closest<HTMLElement>('[data-v2-media]') || image.parentElement;
  image.hidden = false;
  image.dataset.v2ImageState = 'ready';
  if (!host) return;

  const hasUnavailableImage = Array.from(host.querySelectorAll<HTMLImageElement>('img[data-v2-image-state="fallback"]'))
    .some((candidate) => candidate !== image);
  if (hasUnavailableImage) return;

  host.classList.remove('is-broken');
  host.dataset.v2MediaState = 'ready';
  Array.from(host.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && isFallbackElement(child))
    .forEach((fallback) => setFallbackAccessibility(fallback, false));
};

const watchImage = (image: HTMLImageElement, onStateChange: () => void): ImageWatcher => {
  let state: ImageReadinessState = 'pending';
  let settled = false;
  let loadVersion = 0;
  let resolveSettled = () => {};
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  image.dataset.v2ImageState = 'pending';
  const initialHost = image.closest<HTMLElement>('[data-v2-media]') || image.parentElement;
  if (initialHost && !initialHost.dataset.v2MediaState) initialHost.dataset.v2MediaState = 'pending';

  const setState = (nextState: Exclude<ImageReadinessState, 'pending'>) => {
    state = nextState;
    if (nextState === 'ready') setImageReady(image);
    else setImageFallback(image);
    if (!settled) {
      settled = true;
      resolveSettled();
    }
    onStateChange();
  };

  const cleanup = () => {
    image.removeEventListener('load', handleLoad);
    image.removeEventListener('error', handleError);
  };

  const handleLoad = async () => {
    const version = ++loadVersion;
    const source = image.currentSrc || image.src;
    if (image.naturalWidth === 0) {
      setState('fallback');
      return;
    }

    if (typeof image.decode === 'function') {
      try {
        await image.decode();
      } catch {
        // A loaded frame with real dimensions remains a reliable fail-open state.
      }
    }

    if (version !== loadVersion) return;
    const currentSource = image.currentSrc || image.src;
    if (image.naturalWidth > 0 && currentSource === source) {
      setState('ready');
      cleanup();
    } else {
      setState('fallback');
    }
  };

  const handleError = () => {
    loadVersion += 1;
    setState('fallback');
    // Keep the load listener: a source that arrives after the timeout/error can recover.
    image.removeEventListener('error', handleError);
  };

  image.addEventListener('load', handleLoad);
  image.addEventListener('error', handleError);

  if (image.complete) {
    if (image.naturalWidth > 0) void handleLoad();
    else handleError();
  }

  return {
    getState: () => state,
    settled: settledPromise,
    useTimeoutFallback: () => {
      if (state === 'pending') setState('fallback');
    }
  };
};

const setRevealState = (element: HTMLElement, state: ImageReadinessState) => {
  element.classList.remove('v2-image-awaiting', 'v2-image-ready', 'v2-image-fallback');
  if (state === 'pending') element.classList.add('v2-image-awaiting');
  else if (state === 'ready') element.classList.add('v2-image-ready');
  else element.classList.add('v2-image-fallback');
  element.dataset.v2ImageReady = state;
};

export const waitForRevealMedia = (element: HTMLElement, timeoutMs = 6000) => {
  const existing = readiness.get(element);
  if (existing) return existing;

  const images = revealImages(element);
  if (images.length === 0) return Promise.resolve();

  setRevealState(element, 'pending');

  const watchers: ImageWatcher[] = [];
  let watchersReady = false;
  const syncRevealState = () => {
    if (!watchersReady) return;
    const states = watchers.map((watcher) => watcher.getState());
    if (states.every((state) => state === 'ready')) setRevealState(element, 'ready');
    else if (states.some((state) => state === 'fallback')) setRevealState(element, 'fallback');
    else setRevealState(element, 'pending');
  };

  images.forEach((image) => watchers.push(watchImage(image, syncRevealState)));
  watchersReady = true;
  syncRevealState();
  const finiteTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 6000;

  const ready = new Promise<void>((resolve) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.clearTimeout(timeoutId);
      syncRevealState();
      resolve();
    };
    const timeoutId = window.setTimeout(() => {
      watchers.forEach((watcher) => watcher.useTimeoutFallback());
      release();
    }, finiteTimeoutMs);

    void Promise.all(watchers.map((watcher) => watcher.settled)).then(release);
  });

  readiness.set(element, ready);
  return ready;
};
