'use strict';

(function initLoginGreetingAudio(global) {
  const STORAGE_MUTED = 'loginGreetingMuted';
  const STORAGE_MUTED_LEGACY = 'festiveAudioMuted';
  const STORAGE_PENDING = 'loginGreetingPending';
  const STORAGE_PENDING_LEGACY = 'festiveAudioPendingReason';
  const STORAGE_LAST_ACTIVITY = 'loginGreetingLastActivityAt';
  const STORAGE_CACHED_URL = 'loginGreetingCachedAudioUrl';
  const CACHE_NAME = 'login-greeting-audio-v1';
  const IDB_NAME = 'loginGreetingAudioDb';
  const IDB_STORE = 'blobs';
  const DEFAULT_VOLUME = 0.35;
  const ACTIVITY_THROTTLE_MS = 60000;

  let activeAudio = null;
  let activeStopTimer = null;
  let lastActivityWriteAt = 0;
  let cachedObjectUrl = '';
  let cachedObjectSourceUrl = '';
  let cacheResolveInflight = null;

  function readConfig() {
    const cfg = global.__LOGIN_GREETING_AUDIO__;
    return cfg && typeof cfg === 'object' ? cfg : { active: false, enabled: false };
  }

  function prefersReducedMotion() {
    try {
      return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function isMuted() {
    try {
      if (global.localStorage.getItem(STORAGE_MUTED) === '1') return true;
      return global.localStorage.getItem(STORAGE_MUTED_LEGACY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setMuted(muted) {
    try {
      if (muted) {
        global.localStorage.setItem(STORAGE_MUTED, '1');
      } else {
        global.localStorage.removeItem(STORAGE_MUTED);
        global.localStorage.removeItem(STORAGE_MUTED_LEGACY);
      }
    } catch (_) {}
    syncMuteButton();
  }

  function revokeCachedObjectUrl() {
    if (cachedObjectUrl) {
      try {
        URL.revokeObjectURL(cachedObjectUrl);
      } catch (_) {}
      cachedObjectUrl = '';
      cachedObjectSourceUrl = '';
    }
  }

  function stopActiveAudio() {
    if (activeStopTimer) {
      global.clearTimeout(activeStopTimer);
      activeStopTimer = null;
    }
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch (_) {}
      activeAudio = null;
    }
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        resolve(null);
        return;
      }
      const request = global.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'url' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readIdbBlobRecord(url) {
    try {
      const db = await openIdb();
      if (!db) return null;
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(url);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function writeIdbBlobRecord(url, buffer, mime) {
    try {
      const db = await openIdb();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ url, mime, buffer, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  }

  async function clearIdbBlobStore() {
    try {
      const db = await openIdb();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  }

  async function purgeCacheIfUrlChanged(url) {
    try {
      const prev = String(global.localStorage.getItem(STORAGE_CACHED_URL) || '').trim();
      if (prev && prev !== url) {
        revokeCachedObjectUrl();
        if (global.caches && typeof global.caches.delete === 'function') {
          await global.caches.delete(CACHE_NAME);
        }
        await clearIdbBlobStore();
      }
      global.localStorage.setItem(STORAGE_CACHED_URL, url);
    } catch (_) {}
  }

  function normalizeArrayBuffer(raw) {
    if (!raw) return null;
    if (raw instanceof ArrayBuffer) return raw;
    if (ArrayBuffer.isView(raw)) {
      const view = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      return view.slice().buffer;
    }
    return null;
  }

  function blobRecordToObjectUrl(record) {
    const buffer = normalizeArrayBuffer(record && record.buffer);
    if (!buffer || buffer.byteLength < 64) return '';
    const mime = String(record.mime || 'audio/mpeg');
    const blob = new Blob([buffer], { type: mime.startsWith('audio/') ? mime : 'audio/mpeg' });
    return URL.createObjectURL(blob);
  }

  async function resolveCachedObjectUrlInner(url) {
    await purgeCacheIfUrlChanged(url);

    const idbRecord = await readIdbBlobRecord(url);
    const idbBuffer = idbRecord ? normalizeArrayBuffer(idbRecord.buffer) : null;
    if (idbBuffer && idbBuffer.byteLength > 64) {
      const objectUrl = blobRecordToObjectUrl({ buffer: idbBuffer, mime: idbRecord.mime });
      if (objectUrl) {
        cachedObjectUrl = objectUrl;
        cachedObjectSourceUrl = url;
        return objectUrl;
      }
    }

    if (!global.caches || typeof global.caches.open !== 'function' || typeof global.fetch !== 'function') {
      return '';
    }

    try {
      const cache = await global.caches.open(CACHE_NAME);
      const request = new Request(url, { credentials: 'same-origin' });
      let response = await cache.match(request);
      let fromCache = !!response;
      if (!response) {
        response = await global.fetch(request);
        if (response && response.ok) {
          await cache.put(request, response.clone());
        }
      }
      if (!response || !response.ok) {
        return '';
      }
      const blob = await response.blob();
      const blobType = String(blob.type || '').toLowerCase();
      const looksLikeHtml = blobType.includes('html');
      if (!blob.size || blob.size < 64 || looksLikeHtml) return '';
      const mime = blobType.startsWith('audio/') ? blobType : 'audio/mpeg';
      const buffer = await blob.arrayBuffer();
      await writeIdbBlobRecord(url, buffer, mime);
      cachedObjectUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
      cachedObjectSourceUrl = url;
      return cachedObjectUrl;
    } catch (_) {
      return '';
    }
  }

  async function resolveCachedObjectUrl(url) {
    if (!url) return '';
    if (cachedObjectUrl && cachedObjectSourceUrl === url) {
      return cachedObjectUrl;
    }
    if (cacheResolveInflight && cacheResolveInflight.url === url) {
      return cacheResolveInflight.promise;
    }
    const promise = resolveCachedObjectUrlInner(url);
    cacheResolveInflight = { url, promise };
    try {
      return await promise;
    } finally {
      if (cacheResolveInflight && cacheResolveInflight.promise === promise) {
        cacheResolveInflight = null;
      }
    }
  }

  function warmGreetingCache() {
    const cfg = readConfig();
    const url = String(cfg.audioUrl || '').trim();
    if (!cfg.enabled || !url) return;
    resolveCachedObjectUrl(url).catch(() => {});
  }

  function inactivityThresholdMs(cfg) {
    const configured = Number(cfg.inactivityMs);
    if (Number.isFinite(configured) && configured > 0) return configured;
    const hours = Number(cfg.inactivityHours);
    const h = Number.isFinite(hours) && hours > 0 ? hours : 3;
    return h * 60 * 60 * 1000;
  }

  function readLastActivityAt() {
    try {
      const raw = global.localStorage.getItem(STORAGE_LAST_ACTIVITY);
      const parsed = Number.parseInt(String(raw || ''), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  function touchLastActivityAt(force = false) {
    const now = Date.now();
    if (!force && now - lastActivityWriteAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityWriteAt = now;
    try {
      global.localStorage.setItem(STORAGE_LAST_ACTIVITY, String(now));
    } catch (_) {}
  }

  function consumePendingLogin() {
    try {
      let pending = String(global.sessionStorage.getItem(STORAGE_PENDING) || '').trim();
      if (!pending) {
        pending = String(global.sessionStorage.getItem(STORAGE_PENDING_LEGACY) || '').trim();
      }
      if (!pending) return '';
      global.sessionStorage.removeItem(STORAGE_PENDING);
      global.sessionStorage.removeItem(STORAGE_PENDING_LEGACY);
      return pending;
    } catch (_) {
      return '';
    }
  }

  function queuePendingLogin() {
    try {
      global.sessionStorage.setItem(STORAGE_PENDING, 'login');
    } catch (_) {}
  }

  function playGreeting() {
    const cfg = readConfig();
    if (!cfg.active && !cfg.enabled) return Promise.resolve(false);
    const url = String(cfg.audioUrl || '').trim();
    if (!url || !cfg.enabled) {
      return Promise.resolve(false);
    }
    if (prefersReducedMotion()) return Promise.resolve(false);
    if (isMuted()) return Promise.resolve(false);

    function runPlayback(playbackSrc, usedCacheBlob, allowDirectFallback) {
      stopActiveAudio();
      const audio = new Audio();
      audio.src = playbackSrc;
      audio.volume = DEFAULT_VOLUME;
      audio.preload = 'auto';
      activeAudio = audio;

      const maxSec = Math.max(3, Math.min(60, Number(cfg.audioMaxSeconds) || 12));
      activeStopTimer = global.setTimeout(() => stopActiveAudio(), maxSec * 1000);

      const tryPlay = () => audio.play()
        .then(() => true)
        .catch(() => {
          if (usedCacheBlob && allowDirectFallback && url) {
            return runPlayback(url, false, false);
          }
          return false;
        });

      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        audio.addEventListener('error', () => {
          if (usedCacheBlob && allowDirectFallback && url) {
            runPlayback(url, false, false).then(finish);
            return;
          }
          finish(false);
        }, { once: true });
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          tryPlay().then(finish);
        };
        audio.addEventListener('canplay', onCanPlay);
        global.setTimeout(() => {
          audio.removeEventListener('canplay', onCanPlay);
          tryPlay().then(finish);
        }, 8000);
      });
    }

    return resolveCachedObjectUrl(url).then((objectUrl) => {
      const playbackSrc = objectUrl || url;
      return runPlayback(playbackSrc, !!objectUrl, true);
    });
  }

  function syncMuteButton() {
    const btn = global.document.getElementById('loginGreetingMuteToggle');
    if (!btn) return;
    const muted = isMuted();
    btn.classList.toggle('login-greeting-muted', muted);
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = muted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
    }
    btn.title = muted ? 'Login greeting sound muted' : 'Mute login greeting sound';
    btn.setAttribute('aria-label', btn.title);
  }

  function bindMuteButton() {
    const btn = global.document.getElementById('loginGreetingMuteToggle');
    if (!btn || btn.dataset.loginGreetingBound === '1') return;
    btn.dataset.loginGreetingBound = '1';
    btn.addEventListener('click', () => {
      const next = !isMuted();
      setMuted(next);
      if (next) stopActiveAudio();
    });
    syncMuteButton();
  }

  function normalizeAppPath(value = '') {
    const raw = String(value || '').trim().split(/[?#]/, 1)[0] || '';
    const normalized = raw.replace(/\/+$/, '');
    return normalized || '/';
  }

  function isUserMainDashboardSurface(cfg = readConfig()) {
    if (global.document.getElementById('main-header')) return true;
    const current = normalizeAppPath(global.location?.pathname);
    const primary = normalizeAppPath(cfg.primaryDashboardHref);
    if (primary && primary !== '/dashboard') {
      if (current === primary || current.startsWith(`${primary}/`)) return true;
    }
    if (current === '/dashboard' || current.startsWith('/dashboard/')) return true;
    return false;
  }

  function bindActivityTracking() {
    const record = () => {
      if (global.document.visibilityState === 'hidden') return;
      touchLastActivityAt(false);
    };
    ['pointerdown', 'keydown', 'scroll'].forEach((eventName) => {
      global.document.addEventListener(eventName, record, { passive: true });
    });
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'visible') {
        touchLastActivityAt(false);
      }
    });
  }

  function maybePlayOnPageLoad() {
    const cfg = readConfig();
    if (!cfg.enabled) return Promise.resolve(false);
    if (!isUserMainDashboardSurface(cfg)) {
      return Promise.resolve(false);
    }

    const pending = consumePendingLogin();
    if (pending === 'login') {
      touchLastActivityAt(true);
      return playGreeting();
    }

    const lastAt = readLastActivityAt();
    const now = Date.now();
    const threshold = inactivityThresholdMs(cfg);
    if (lastAt > 0 && now - lastAt >= threshold) {
      touchLastActivityAt(true);
      return playGreeting();
    }

    if (lastAt === 0) {
      touchLastActivityAt(true);
    }
    return Promise.resolve(false);
  }

  function onDomReady() {
    const cfg = readConfig();
    if (!cfg.enabled) return;
    warmGreetingCache();
    bindMuteButton();
    bindActivityTracking();
    maybePlayOnPageLoad();
  }

  global.LoginGreetingAudio = {
    queuePendingLogin,
    playGreeting,
    stop: stopActiveAudio,
    setMuted,
    isMuted,
    touchLastActivityAt
  };
  global.queueLoginGreetingPending = queuePendingLogin;

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }
})(typeof window !== 'undefined' ? window : globalThis);