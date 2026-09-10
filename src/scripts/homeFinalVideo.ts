/** A poster-first background video. User intent survives responsive changes. */
export const initializeHomeFinalVideo = (root: HTMLElement) => {
  const hero = root.querySelector<HTMLElement>('[data-hf-hero]');
  const video = root.querySelector<HTMLVideoElement>('[data-hf-hero-video]');
  const toggles = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-hf-video-toggle]'));
  if (!hero || !video) return;

  const mobile = matchMedia('(max-width: 760px)');
  const narrow = matchMedia('(max-width: 359px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & {
    connection?: EventTarget & { saveData?: boolean; effectiveType?: string };
  }).connection;
  let intent: 'auto' | 'play' | 'pause' = 'auto';
  let released = false;
  let source = '';
  let generation = 0;
  let loadTimer = 0;
  let status: 'idle' | 'loading' | 'playing' | 'error' = 'idle';
  let resumeOnVisible = false;
  let baselineFallback = false;
  let inViewport = hero.getBoundingClientRect().bottom > 0 && hero.getBoundingClientRect().top < innerHeight;

  const preferredSource = () => (mobile.matches || baselineFallback ? video.dataset.hfMobileSrc : video.dataset.hfDesktopSrc) || '';
  const autoplayAllowed = () => !reduced.matches && !connection?.saveData
    && !['slow-2g', '2g'].includes(connection?.effectiveType || '') && !narrow.matches;
  const shouldPlay = () => intent === 'play' || (intent === 'auto' && autoplayAllowed());
  const clearLoadTimer = () => { window.clearTimeout(loadTimer); loadTimer = 0; };
  const render = () => {
    const playing = status === 'playing';
    hero.classList.toggle('is-video-playing', playing);
    hero.dataset.hfVideoState = status;
    toggles.forEach((toggle) => {
      const label = toggle.querySelector<HTMLElement>('[data-hf-video-toggle-label]');
      toggle.hidden = !preferredSource();
      toggle.disabled = false;
      toggle.removeAttribute('aria-hidden');
      toggle.setAttribute('aria-pressed', String(playing));
      toggle.setAttribute('aria-busy', String(status === 'loading'));
      if (label) label.textContent = playing ? 'Пауза видео' : status === 'loading' ? 'Отменить загрузку'
        : status === 'error' ? 'Повторить видео' : 'Включить видео';
      toggle.setAttribute('aria-label', playing ? 'Приостановить фоновое видео'
        : status === 'loading' ? 'Отменить загрузку фонового видео'
        : status === 'error' ? 'Видео недоступно. Повторить загрузку' : 'Включить фоновое видео');
      toggle.title = status === 'error' ? 'Не удалось воспроизвести видео. Показана фотография производства.' : '';
    });
  };
  const unload = () => {
    generation += 1;
    clearLoadTimer();
    source = '';
    video.pause();
    video.removeAttribute('src');
    video.load();
    status = 'idle';
    render();
  };
  const fail = () => {
    unload();
    status = 'error';
    render();
  };
  const play = () => {
    const nextSource = preferredSource();
    if (!nextSource || document.hidden || !inViewport) return;
    // H.264 MP4 is the existing portable source. A missing decoder keeps the
    // poster and the retry action; autoplay rejection is handled separately.
    if (!video.canPlayType('video/mp4')) { fail(); return; }
    if (source !== nextSource) {
      unload();
      source = nextSource;
      video.defaultMuted = true;
      video.muted = true;
      video.src = source;
      video.load();
    }
    const currentGeneration = ++generation;
    status = 'loading';
    render();
    clearLoadTimer();
    loadTimer = window.setTimeout(() => {
      if (generation === currentGeneration && status === 'loading') fail();
    }, 12000);
    // Keep play() in the click's user activation when requested explicitly.
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch((error: DOMException) => {
      if (generation !== currentGeneration) return;
      clearLoadTimer();
      if (error.name === 'NotAllowedError') {
        status = 'idle';
        render();
      } else if (error.name !== 'AbortError') fail();
    });
  };
  const reconcile = () => {
    if (source && source !== preferredSource()) unload();
    if (!inViewport || document.hidden) {
      if (status === 'loading') unload();
      else video.pause();
      return;
    }
    if (released && shouldPlay() && status !== 'playing' && status !== 'loading') play();
    else if (!shouldPlay()) unload();
    else render();
  };
  video.addEventListener('playing', () => {
    if (!source) return;
    clearLoadTimer();
    status = 'playing';
    render();
  });
  video.addEventListener('pause', () => {
    if (status === 'playing') { status = 'idle'; render(); }
  });
  video.addEventListener('error', () => {
    if (!source) return;
    const decoderFailure = video.error?.code === 3 || video.error?.code === 4;
    if (decoderFailure && !mobile.matches && !baselineFallback && video.dataset.hfMobileSrc) {
      // Existing mobile H.264 Baseline also serves machines that cannot decode
      // the desktop High-profile file. Try it once, then keep the poster on failure.
      unload();
      baselineFallback = true;
      if (shouldPlay()) play();
    } else fail();
  });
  toggles.forEach((toggle) => toggle.addEventListener('click', () => {
    released = true;
    if (status === 'playing' || status === 'loading') {
      intent = 'pause';
      if (status === 'loading') unload();
      else { video.pause(); status = 'idle'; render(); }
    } else { intent = 'play'; play(); }
  }));
  const release = () => {
    if (released) return;
    released = true;
    reconcile();
  };
  const motionRoot = root.closest<HTMLElement>('[data-v2-motion-root]');
  const entryBlocking = ['armed', 'logo', 'waiting'].includes(motionRoot?.dataset.v2MotionState || '');
  const arrivalBlocking = document.documentElement.dataset.v2PageBootstrap === 'arrival'
    && !['done', 'fail-open'].includes(document.documentElement.dataset.v2PageState || '');
  render();
  if (!entryBlocking && !arrivalBlocking) release();
  for (const event of ['v2:page-revealing', 'v2:page-done', 'v2:page-fail-open', 'v2:entrance-fail-open']) {
    document.addEventListener(event, release, { once: true });
  }
  motionRoot?.addEventListener('v2:entry-opening', release, { once: true });
  motionRoot?.addEventListener('v2:entry-done', release, { once: true });
  // Feature-gated legacy listener keeps older Safari/embedded browsers usable.
  for (const query of [mobile, narrow, reduced]) {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', reconcile);
    else query.addListener(reconcile);
  }
  connection?.addEventListener?.('change', reconcile);
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      reconcile();
    }, { threshold: 0 });
    visibility.observe(hero);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeOnVisible = status === 'playing' || status === 'loading';
      if (status === 'loading') unload();
      else video.pause();
    } else if (resumeOnVisible) { resumeOnVisible = false; reconcile(); }
  });
  window.addEventListener('pagehide', () => { clearLoadTimer(); video.pause(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) reconcile(); });
};
