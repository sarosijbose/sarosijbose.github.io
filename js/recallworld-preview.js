(() => {
  'use strict';
  const stage = document.querySelector('#recallworld-comparison');
  if (!stage) return;
  const videos = [...stage.querySelectorAll('video')];
  const handle = stage.querySelector('.quad-handle');
  const message = stage.parentElement.querySelector('.quad-status');
  let dividerX = 50;
  let dividerY = 50;
  let drag = null;
  let visible = false;
  let loaded = false;
  let loading = false;
  let aligning = false;
  let duration = 0;
  let pointerFrame = 0;
  let latestPointer = null;

  function position(nextX, nextY) {
    dividerX = Math.max(0, Math.min(100, nextX));
    dividerY = Math.max(0, Math.min(100, nextY));
    stage.style.setProperty('--split-x', dividerX + '%');
    stage.style.setProperty('--split-y', dividerY + '%');
    stage.dataset.splitX = String(dividerX);
    stage.dataset.splitY = String(dividerY);
    handle.setAttribute('aria-label', `Comparison divider: ${Math.round(dividerX)}% across, ${Math.round(dividerY)}% down. Use arrow keys to move.`);
  }

  function pointer(event) {
    const bounds = stage.getBoundingClientRect();
    position((event.clientX - bounds.left) / bounds.width * 100,
      (event.clientY - bounds.top) / bounds.height * 100);
  }

  function clearPointer() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    latestPointer = null;
  }

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (event.pointerType !== 'mouse' && !event.target.closest('.quad-handle')) return;
    event.preventDefault();
    drag = event.pointerId;
    stage.setPointerCapture(drag);
    stage.classList.add('is-dragging');
    pointer(event);
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerId !== drag && !(event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches)) return;
    latestPointer = {clientX: event.clientX, clientY: event.clientY};
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (latestPointer) pointer(latestPointer);
    });
  });
  stage.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' && drag === null) {
      clearPointer();
      position(50, 50);
    }
  });
  function release(event) {
    if (event.pointerId !== drag) return;
    clearPointer();
    drag = null;
    stage.classList.remove('is-dragging');
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  handle.addEventListener('keydown', event => {
    clearPointer();
    const delta = event.shiftKey ? 10 : 3;
    const offsets = {ArrowLeft: [-delta, 0], ArrowRight: [delta, 0],
      ArrowUp: [0, -delta], ArrowDown: [0, delta]};
    if (event.key === 'Home') {
      event.preventDefault();
      position(50, 50);
    } else if (offsets[event.key]) {
      event.preventDefault();
      position(dividerX + offsets[event.key][0], dividerY + offsets[event.key][1]);
    }
  });
  position(50, 50);

  function pause() { videos.forEach(video => video.pause()); }
  // Plays continuously like a GIF: the only reasons to stop are being offscreen
  // or in a hidden tab, both of which are pure resource savings.
  function canPlay() { return visible && !document.hidden; }

  function ready(video) {
    if (video.readyState >= 3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Video load timeout')), 20000);
      function finish(error) {
        clearTimeout(timer);
        video.removeEventListener('canplay', success);
        video.removeEventListener('error', failure);
        error ? reject(error) : resolve();
      }
      function success() { finish(); }
      function failure() { finish(new Error('Video load failure')); }
      video.addEventListener('canplay', success);
      video.addEventListener('error', failure);
    });
  }

  function seek(video, time) {
    if (Math.abs(video.currentTime - time) < .001 && !video.seeking) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Video seek timeout')), 10000);
      function finish(error) {
        clearTimeout(timer);
        video.removeEventListener('seeked', success);
        video.removeEventListener('error', failure);
        error ? reject(error) : resolve();
      }
      function success() { finish(); }
      function failure() { finish(new Error('Video seek failure')); }
      video.addEventListener('seeked', success);
      video.addEventListener('error', failure);
      video.currentTime = time;
    });
  }

  async function align(time) {
    if (!loaded || aligning) return;
    aligning = true;
    stage.dataset.playback = 'seeking';
    pause();
    try {
      await Promise.all(videos.map(video => seek(video, time)));
      if (canPlay()) {
        await Promise.all(videos.map(video => video.play()));
        if (!canPlay()) pause();
      }
      stage.dataset.playback = canPlay() ? 'playing' : 'paused';
    } catch (error) {
      pause();
      stage.dataset.playback = 'paused';
    } finally {
      aligning = false;
    }
  }

  async function initialize() {
    if (loading || loaded) return;
    loading = true;
    stage.dataset.playback = 'loading';
    videos.forEach(video => {
      video.src = video.dataset.src;
      video.preload = 'auto';
      video.load();
    });
    try {
      await Promise.all(videos.map(ready));
      duration = Math.min(...videos.map(video => video.duration));
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');
      loaded = true;
      stage.dataset.duration = String(duration);
      message.hidden = true;
      await align(0);
    } catch (error) {
      pause();
      message.hidden = false;
      stage.dataset.playback = 'error';
    } finally {
      loading = false;
    }
  }

  videos.forEach(video => {
    video.muted = true;
    video.loop = false;
    video.addEventListener('ended', () => align(0));
  });
  setInterval(() => {
    if (!loaded || aligning || !canPlay() || videos[0].paused) return;
    const master = videos[0].currentTime;
    if (master >= duration - .1) align(0);
    else if (videos.some(video => Math.abs(video.currentTime - master) > .09)) align(master);
  }, 100);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!canPlay()) pause();
    else if (loaded) align(videos[0].currentTime);
    else initialize();
  }, {threshold: .05}).observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (!canPlay()) pause();
    else if (loaded) align(videos[0].currentTime);
    else initialize();
  });
})();
