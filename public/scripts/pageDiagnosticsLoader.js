(function initPageDiagnosticsLoader(global) {
  'use strict';

  const config = global.__PAGE_DIAGNOSTICS__;
  if (!config || config.enabled !== true) return;

  let bundlePromise = null;

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
      return;
    }
    callback();
  }

  function resolveScriptUrl(key, fallback) {
    const fromConfig = config.scriptUrls && config.scriptUrls[key];
    return String(fromConfig || fallback || '').trim();
  }

  function loadScript(src) {
    const normalizedSrc = String(src || '').trim();
    if (!normalizedSrc) return Promise.reject(new Error('Script URL is required.'));

    const existing = document.querySelector(`script[data-page-diagnostics-src="${normalizedSrc}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return Promise.resolve();
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${normalizedSrc}`)), { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = normalizedSrc;
      script.dataset.pageDiagnosticsSrc = normalizedSrc;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${normalizedSrc}`));
      document.body.appendChild(script);
    });
  }

  function loadDiagnosticsBundle() {
    if (global.__PAGE_DIAGNOSTICS_BUNDLE_LOADED__) return Promise.resolve();
    if (bundlePromise) return bundlePromise;

    const healthUrl = resolveScriptUrl('health', '/scripts/pageDiagnosticsHealth.js');
    const mainUrl = resolveScriptUrl('main', '/scripts/pageDiagnostics.js');

    bundlePromise = loadScript(healthUrl)
      .then(() => loadScript(mainUrl))
      .then(() => {
        global.__PAGE_DIAGNOSTICS_BUNDLE_LOADED__ = true;
      });

    return bundlePromise;
  }

  async function pingPresence() {
    const endpoint = String(config.presencePingEndpoint || '/debug/client-diagnostics/page-presence/ping').trim();
    if (!endpoint || typeof global.fetch !== 'function') return;

    const path = String(config.currentPath || global.location.pathname || '/').split(/[?#]/)[0] || '/';
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-ajax-request': 'true'
    };
    if (config.csrfToken) headers['x-csrf-token'] = String(config.csrfToken);

    try {
      await global.fetch(endpoint, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ path })
      });
    } catch (_) {
      // Non-fatal: presence can still load from the modal.
    }
  }

  async function openDiagnostics() {
    await loadDiagnosticsBundle();
    await pingPresence();
    if (global.PageDiagnostics && typeof global.PageDiagnostics.open === 'function') {
      global.PageDiagnostics.open();
      return;
    }
    const modal = document.getElementById('pageDiagnosticsModal');
    if (modal && global.bootstrap?.Modal) {
      global.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  function wireDiagnosticsButton(button) {
    if (!button || button.dataset.pageDiagnosticsWired === '1') return;
    button.dataset.pageDiagnosticsWired = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      button.disabled = true;
      openDiagnostics()
        .catch(() => {})
        .finally(() => {
          button.disabled = false;
        });
    });
  }

  onReady(() => {
    const button = document.getElementById('pageDiagnosticsSideControl');
    if (button) wireDiagnosticsButton(button);
  });
})(window);
