(function (global) {
  'use strict';

  /**
   * setInterval that pauses while the browser tab is hidden and resumes when visible.
   * @param {function} callback
   * @param {number} intervalMs
   * @param {{ runImmediately?: boolean }} [options]
   */
  function createVisibilityInterval(callback, intervalMs, options = {}) {
    const runImmediately = options.runImmediately !== false;
    let timerId = null;
    let ms = Math.max(1, Number(intervalMs) || 1000);
    let started = false;

    function clearTimer() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function schedule() {
      clearTimer();
      if (typeof document !== 'undefined' && document.hidden) return;
      timerId = setInterval(callback, ms);
    }

    function runCallback() {
      try {
        callback();
      } catch (_) {
        // polling callbacks should handle their own errors
      }
    }

    function start() {
      started = true;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (runImmediately) runCallback();
      schedule();
    }

    function restart() {
      if (!started) {
        start();
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        clearTimer();
        return;
      }
      if (runImmediately) runCallback();
      schedule();
    }

    function onVisibilityChange() {
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (started) restart();
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return {
      start,
      stop() {
        started = false;
        clearTimer();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
      },
      setIntervalMs(newMs) {
        ms = Math.max(1, Number(newMs) || ms);
        if (started) restart();
      }
    };
  }

  global.createVisibilityInterval = createVisibilityInterval;
})(typeof window !== 'undefined' ? window : globalThis);
