(function initPageDiagnostics(global) {
  'use strict';

  const config = global.__PAGE_DIAGNOSTICS__;
  if (!config || config.enabled !== true) return;

  const MAX_CONSOLE_ENTRIES = 80;
  const MAX_REQUEST_ENTRIES = 80;
  const PRESENCE_LIMIT = 20;
  const healthApi = global.PageDiagnosticsHealth || {
    evaluatePageHealth: () => ({
      status: 'gray',
      label: 'Collecting',
      icon: 'bi-hourglass-split',
      badgeClass: 'page-diagnostics-health--gray',
      runtimeLabel: 'Server',
      metrics: {},
      reasons: []
    })
  };

  const state = {
    startedAt: new Date().toISOString(),
    consoleEntries: [],
    requestEntries: [],
    presence: null,
    presenceError: '',
    presenceErrorStatus: 0,
    presenceLoading: false,
    modalReady: false
  };

  const nativeConsole = {
    error: global.console && typeof global.console.error === 'function'
      ? global.console.error.bind(global.console)
      : null,
    warn: global.console && typeof global.console.warn === 'function'
      ? global.console.warn.bind(global.console)
      : null
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(value, maxLength) {
    const text = String(value ?? '');
    const limit = Math.max(20, Number(maxLength) || 400);
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
  }

  function safeIconClass(value, fallback = 'bi-hourglass-split') {
    const icon = String(value || fallback).replace(/[^a-z0-9 -]/gi, '').trim();
    return icon || fallback;
  }

  function stringifyArg(arg) {
    if (arg instanceof Error) return truncate(arg.stack || arg.message || String(arg), 1200);
    if (arg && typeof arg === 'object') {
      const seen = new WeakSet();
      try {
        return truncate(JSON.stringify(arg, (_key, value) => {
          if (value && typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
          }
          return value;
        }), 1200);
      } catch (_) {
        return truncate(String(arg), 600);
      }
    }
    return truncate(String(arg), 600);
  }

  function pushLimited(list, entry, maxEntries) {
    list.unshift(entry);
    if (list.length > maxEntries) list.length = maxEntries;
  }

  function updateButtonState() {
    const button = document.getElementById('pageDiagnosticsSideControl');
    if (!button) return;
    const health = evaluateCurrentHealth();
    const errorCount = state.consoleEntries.filter((entry) => entry.level === 'error').length;
    button.classList.remove(
      'page-diagnostics-side-control--alert',
      'page-diagnostics-side-control--gray',
      'page-diagnostics-side-control--green',
      'page-diagnostics-side-control--yellow',
      'page-diagnostics-side-control--red'
    );
    button.classList.add(`page-diagnostics-side-control--${health.status || 'gray'}`);
    button.title = errorCount > 0
      ? `Page diagnostics: ${health.label} (${errorCount} error${errorCount === 1 ? '' : 's'})`
      : `Page diagnostics: ${health.label}`;
    const badge = button.querySelector('[data-page-diagnostics-health]');
    if (badge) {
      const icon = safeIconClass(health.icon);
      badge.className = `page-diagnostics-side-control__badge page-diagnostics-health-badge ${health.badgeClass || 'page-diagnostics-health--gray'}`;
      badge.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    }
  }

  function pushConsoleEntry(level, args, source) {
    try {
      pushLimited(state.consoleEntries, {
        level,
        source: source || 'console',
        message: (Array.isArray(args) ? args : []).map(stringifyArg).join(' '),
        timestamp: new Date().toISOString()
      }, MAX_CONSOLE_ENTRIES);
      updateButtonState();
      if (state.modalReady) renderDiagnosticsModal();
    } catch (_) {}
  }

  function wrapConsoleMethod(level) {
    if (!global.console || typeof global.console[level] !== 'function') return;
    const original = global.console[level].bind(global.console);
    global.console[level] = function wrappedConsoleMethod(...args) {
      pushConsoleEntry(level, args, 'console');
      return original(...args);
    };
  }

  function installConsoleCapture() {
    wrapConsoleMethod('error');
    wrapConsoleMethod('warn');

    global.addEventListener('error', (event) => {
      pushConsoleEntry('error', [
        event.message || 'Unhandled error',
        event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '',
        event.error || ''
      ], 'window.onerror');
    });

    global.addEventListener('unhandledrejection', (event) => {
      pushConsoleEntry('error', [
        'Unhandled promise rejection',
        event.reason || ''
      ], 'unhandledrejection');
    });
  }

  function readRequestMethod(input, init) {
    return String(
      init?.method
      || input?.method
      || 'GET'
    ).toUpperCase();
  }

  function redactUrl(input) {
    const raw = String(input?.url || input || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, global.location.href);
      const queryKeys = Array.from(parsed.searchParams.keys()).filter(Boolean);
      const queryLabel = queryKeys.length
        ? `?${Array.from(new Set(queryKeys)).map((key) => `${encodeURIComponent(key)}=[redacted]`).join('&')}`
        : '';
      return `${parsed.origin === global.location.origin ? '' : parsed.origin}${parsed.pathname}${queryLabel}`;
    } catch (_) {
      return truncate(raw.split('#')[0].replace(/\?.*$/, '?[redacted]'), 500);
    }
  }

  function pushRequestEntry(entry) {
    pushLimited(state.requestEntries, entry, MAX_REQUEST_ENTRIES);
    updateButtonState();
    if (state.modalReady) renderDiagnosticsModal();
  }

  function installFetchCapture() {
    if (typeof global.fetch !== 'function') return;
    const originalFetch = global.fetch.bind(global);
    global.fetch = async function pageDiagnosticsFetch(input, init) {
      const started = global.performance && typeof global.performance.now === 'function'
        ? global.performance.now()
        : Date.now();
      const entry = {
        timestamp: new Date().toISOString(),
        method: readRequestMethod(input, init),
        url: redactUrl(input),
        status: 0,
        ok: false,
        durationMs: 0,
        error: ''
      };

      try {
        const response = await originalFetch(input, init);
        const ended = global.performance && typeof global.performance.now === 'function'
          ? global.performance.now()
          : Date.now();
        entry.status = response.status;
        entry.ok = response.ok;
        entry.durationMs = Math.round(ended - started);
        pushRequestEntry(entry);
        return response;
      } catch (error) {
        const ended = global.performance && typeof global.performance.now === 'function'
          ? global.performance.now()
          : Date.now();
        entry.durationMs = Math.round(ended - started);
        entry.error = truncate(error?.message || String(error), 400);
        pushRequestEntry(entry);
        throw error;
      }
    };
  }

  function getCurrentPath() {
    return String(config.currentPath || global.location.pathname || '/').split(/[?#]/)[0] || '/';
  }

  function formatTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function relativeTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '-';
    const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMins <= 0) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }

  function getNavigationTiming() {
    const nav = global.performance?.getEntriesByType?.('navigation')?.[0] || null;
    if (!nav) return {};
    return {
      type: nav.type || '',
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0),
      responseMs: Math.round((nav.responseEnd || 0) - (nav.requestStart || 0)),
      transferSize: Number(nav.transferSize || 0),
      encodedBodySize: Number(nav.encodedBodySize || 0)
    };
  }

  function getResourceSummary() {
    const entries = global.performance?.getEntriesByType?.('resource') || [];
    const summary = {
      count: entries.length,
      scripts: 0,
      styles: 0,
      images: 0,
      fetches: 0,
      slowest: []
    };

    entries.forEach((entry) => {
      const type = String(entry.initiatorType || '').toLowerCase();
      if (type === 'script') summary.scripts += 1;
      if (type === 'css' || type === 'link') summary.styles += 1;
      if (type === 'img' || type === 'image') summary.images += 1;
      if (type === 'fetch' || type === 'xmlhttprequest') summary.fetches += 1;
    });

    summary.slowest = Array.from(entries)
      .sort((a, b) => Number(b.duration || 0) - Number(a.duration || 0))
      .slice(0, 5)
      .map((entry) => ({
        name: redactUrl(entry.name || ''),
        type: entry.initiatorType || '',
        durationMs: Math.round(Number(entry.duration || 0))
      }));

    return summary;
  }

  function getPresenceEndpointPath() {
    const endpoint = String(config.endpoint || '').trim();
    if (!endpoint) return '';
    try {
      return new URL(endpoint, global.location.href).pathname;
    } catch (_) {
      return endpoint.split(/[?#]/)[0] || '';
    }
  }

  function getRuntimeConfig() {
    const runtime = config.runtime && typeof config.runtime === 'object' ? { ...config.runtime } : {};
    const hostname = String(global.location?.hostname || '').toLowerCase();
    if (!runtime.kind && ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      runtime.kind = 'local';
    }
    return runtime;
  }

  function evaluateCurrentHealth() {
    return healthApi.evaluatePageHealth({
      runtime: getRuntimeConfig(),
      navigation: getNavigationTiming(),
      resources: getResourceSummary(),
      consoleEntries: state.consoleEntries,
      requestEntries: state.requestEntries,
      presenceError: state.presenceError,
      presenceErrorStatus: state.presenceErrorStatus,
      presenceEndpointPath: getPresenceEndpointPath()
    });
  }

  function buildSnapshot() {
    return {
      capturedAt: new Date().toISOString(),
      page: {
        title: document.title || '',
        path: getCurrentPath(),
        url: `${global.location.origin}${global.location.pathname}`,
        requestId: config.requestId || '',
        buildVersion: config.buildVersion || '',
        runtime: getRuntimeConfig(),
        userAgent: global.navigator?.userAgent || ''
      },
      health: evaluateCurrentHealth(),
      navigation: getNavigationTiming(),
      resources: getResourceSummary(),
      console: state.consoleEntries,
      requests: state.requestEntries,
      presence: state.presence
    };
  }

  function renderHealthSummary(health) {
    const status = String(health.status || 'gray');
    const icon = safeIconClass(health.icon);
    const reasons = Array.isArray(health.reasons) ? health.reasons.slice(0, 5) : [];
    return `
      <div class="page-diagnostics-health-card page-diagnostics-health-card--${escapeHtml(status)} mb-3">
        <div class="d-flex align-items-start justify-content-between gap-3 flex-wrap">
          <div class="d-flex align-items-center gap-2">
            <span class="page-diagnostics-health-card__icon ${escapeHtml(health.badgeClass || 'page-diagnostics-health--gray')}">
              <i class="bi ${icon}" aria-hidden="true"></i>
            </span>
            <div>
              <div class="page-diagnostics-health-card__label">Page Health</div>
              <div class="page-diagnostics-health-card__value">${escapeHtml(health.label || 'Collecting')}</div>
            </div>
          </div>
          <div class="page-diagnostics-health-card__runtime">
            <span>Runtime</span>
            <strong>${escapeHtml(health.runtimeLabel || 'Server')}</strong>
          </div>
        </div>
        ${reasons.length ? `
          <div class="page-diagnostics-health-card__reasons">
            ${reasons.map((reason) => `
              <div class="page-diagnostics-health-card__reason page-diagnostics-health-card__reason--${escapeHtml(reason.status || 'gray')}">
                ${escapeHtml(reason.message || '')}
              </div>
            `).join('')}
          </div>
        ` : '<div class="page-diagnostics-health-card__ok">All key signals healthy.</div>'}
      </div>
    `;
  }

  function statTile(label, value) {
    return `
      <div class="col-6 col-md-3">
        <div class="page-diagnostics-stat">
          <div class="page-diagnostics-stat__label">${escapeHtml(label)}</div>
          <div class="page-diagnostics-stat__value">${escapeHtml(value)}</div>
        </div>
      </div>
    `;
  }

  function renderOverview() {
    const nav = getNavigationTiming();
    const resources = getResourceSummary();
    const health = evaluateCurrentHealth();
    return `
      ${renderHealthSummary(health)}
      <div class="row g-2 mb-3">
        ${statTile('Load', nav.loadMs ? `${nav.loadMs} ms` : '-')}
        ${statTile('DOM Ready', nav.domContentLoadedMs ? `${nav.domContentLoadedMs} ms` : '-')}
        ${statTile('Resources', resources.count)}
        ${statTile('Fetch Logs', state.requestEntries.length)}
      </div>
      <div class="page-diagnostics-kv">
        <div><span>Path</span><code>${escapeHtml(getCurrentPath())}</code></div>
        <div><span>Request ID</span><code>${escapeHtml(config.requestId || '-')}</code></div>
        <div><span>Build</span><code>${escapeHtml(config.buildVersion || '-')}</code></div>
        <div><span>Runtime</span><code>${escapeHtml(health.runtimeLabel || '-')}</code></div>
        <div><span>Captured</span><code>${escapeHtml(formatTime(state.startedAt))}</code></div>
      </div>
      <div class="mt-3">
        <div class="fw-semibold mb-2">Slowest Resources</div>
        ${resources.slowest.length ? `
          <div class="list-group list-group-flush border rounded">
            ${resources.slowest.map((row) => `
              <div class="list-group-item py-2">
                <div class="d-flex justify-content-between gap-2">
                  <code class="text-break">${escapeHtml(row.name || '-')}</code>
                  <span class="badge bg-light text-dark border">${escapeHtml(row.durationMs)} ms</span>
                </div>
                <div class="small text-muted">${escapeHtml(row.type || 'resource')}</div>
              </div>
            `).join('')}
          </div>
        ` : '<div class="text-muted small">No resource timing entries.</div>'}
      </div>
    `;
  }

  function renderConsole() {
    if (!state.consoleEntries.length) {
      return '<div class="text-muted small py-3">No captured warnings or errors.</div>';
    }
    return `
      <div class="list-group list-group-flush border rounded page-diagnostics-log-list">
        ${state.consoleEntries.map((entry) => `
          <div class="list-group-item py-2">
            <div class="d-flex justify-content-between gap-2">
              <span class="badge ${entry.level === 'error' ? 'bg-danger' : 'bg-warning text-dark'}">${escapeHtml(entry.level)}</span>
              <span class="small text-muted">${escapeHtml(formatTime(entry.timestamp))}</span>
            </div>
            <pre class="page-diagnostics-pre mb-0 mt-2">${escapeHtml(entry.message || '-')}</pre>
            <div class="small text-muted mt-1">${escapeHtml(entry.source || 'console')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderRequests() {
    if (!state.requestEntries.length) {
      return '<div class="text-muted small py-3">No captured fetch requests.</div>';
    }
    return `
      <div class="table-responsive border rounded">
        <table class="table table-sm align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>URL</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${state.requestEntries.map((entry) => `
              <tr>
                <td class="small text-muted">${escapeHtml(relativeTime(entry.timestamp))}</td>
                <td><code>${escapeHtml(entry.method || 'GET')}</code></td>
                <td><code class="text-break">${escapeHtml(entry.url || '-')}</code>${entry.error ? `<div class="small text-danger">${escapeHtml(entry.error)}</div>` : ''}</td>
                <td><span class="badge ${entry.ok ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-danger-subtle text-danger border border-danger-subtle'}">${escapeHtml(entry.status || 'ERR')}</span></td>
                <td>${escapeHtml(entry.durationMs || 0)} ms</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPresence() {
    if (state.presenceLoading) {
      return '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>';
    }
    if (state.presenceError) {
      const alertClass = Number(state.presenceErrorStatus || 0) >= 500 ? 'alert-danger' : 'alert-warning';
      return `<div class="alert ${alertClass}">${escapeHtml(state.presenceError)}</div>`;
    }
    const rows = Array.isArray(state.presence?.results) ? state.presence.results : [];
    const summary = state.presence?.summary || {};
    if (!rows.length) {
      return '<div class="text-muted small py-3">No active users on this page.</div>';
    }
    return `
      <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
        <div class="small text-muted">${escapeHtml(summary.activeUserCount || rows.length)} user${Number(summary.activeUserCount || rows.length) === 1 ? '' : 's'} on ${escapeHtml(summary.currentPath || getCurrentPath())}</div>
        <div class="small text-muted">${escapeHtml(summary.activeSessionCount || 0)} session${Number(summary.activeSessionCount || 0) === 1 ? '' : 's'}</div>
      </div>
      <div class="table-responsive border rounded">
        <table class="table table-sm align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>User</th>
              <th>Last Activity</th>
              <th class="text-center">Sessions</th>
              <th>Org</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>
                  <div class="fw-semibold">${escapeHtml(row.displayName || row.username || row.userId || '-')}</div>
                  <div class="small text-muted">${escapeHtml(row.email || row.username || '-')}</div>
                </td>
                <td>
                  <div>${escapeHtml(formatTime(row.lastActivityAt))}</div>
                  <div class="small text-muted">${escapeHtml(relativeTime(row.lastActivityAt))}</div>
                </td>
                <td class="text-center"><span class="badge bg-success-subtle text-success border border-success-subtle">${escapeHtml(row.sessionCount || 0)}</span></td>
                <td><span class="badge bg-light text-dark border">${escapeHtml(row.currentOrgId || '-')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function ensureModal() {
    let modal = document.getElementById('pageDiagnosticsModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pageDiagnosticsModal';
    modal.className = 'modal fade page-diagnostics-modal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content border-0 shadow-lg rounded-3">
          <div class="modal-header bg-light border-bottom">
            <h5 class="modal-title fw-bold text-dark mb-0">
              <i class="bi bi-speedometer2 me-2"></i>Page Diagnostics
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <ul class="nav nav-tabs" role="tablist">
              <li class="nav-item" role="presentation"><button class="nav-link active" id="pdOverviewTab" data-bs-toggle="tab" data-bs-target="#pdOverviewPane" type="button" role="tab">Overview</button></li>
              <li class="nav-item" role="presentation"><button class="nav-link" id="pdConsoleTab" data-bs-toggle="tab" data-bs-target="#pdConsolePane" type="button" role="tab">Console</button></li>
              <li class="nav-item" role="presentation"><button class="nav-link" id="pdRequestsTab" data-bs-toggle="tab" data-bs-target="#pdRequestsPane" type="button" role="tab">Requests</button></li>
              <li class="nav-item" role="presentation"><button class="nav-link" id="pdPresenceTab" data-bs-toggle="tab" data-bs-target="#pdPresencePane" type="button" role="tab">Page Users</button></li>
            </ul>
            <div class="tab-content pt-3">
              <div class="tab-pane fade show active" id="pdOverviewPane" role="tabpanel" aria-labelledby="pdOverviewTab"></div>
              <div class="tab-pane fade" id="pdConsolePane" role="tabpanel" aria-labelledby="pdConsoleTab"></div>
              <div class="tab-pane fade" id="pdRequestsPane" role="tabpanel" aria-labelledby="pdRequestsTab"></div>
              <div class="tab-pane fade" id="pdPresencePane" role="tabpanel" aria-labelledby="pdPresenceTab"></div>
            </div>
          </div>
          <div class="modal-footer bg-light border-top justify-content-between">
            <span class="small text-muted" id="pageDiagnosticsStatus"></span>
            <div class="d-flex gap-2 flex-wrap">
              <button type="button" class="btn btn-outline-secondary btn-sm" id="pageDiagnosticsClearBtn" data-no-wait="true">
                <i class="bi bi-trash3 me-1"></i>Clear
              </button>
              <button type="button" class="btn btn-outline-secondary btn-sm" id="pageDiagnosticsRefreshBtn" data-no-wait="true">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="pageDiagnosticsCopyBtn" data-no-wait="true">
                <i class="bi bi-clipboard me-1"></i>Copy Snapshot
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pageDiagnosticsClearBtn')?.addEventListener('click', () => {
      state.consoleEntries = [];
      state.requestEntries = [];
      updateButtonState();
      renderDiagnosticsModal();
      setStatus('Cleared.');
    });

    document.getElementById('pageDiagnosticsRefreshBtn')?.addEventListener('click', () => {
      renderDiagnosticsModal();
      loadPresence();
    });

    document.getElementById('pageDiagnosticsCopyBtn')?.addEventListener('click', async () => {
      try {
        if (!global.navigator?.clipboard || typeof global.navigator.clipboard.writeText !== 'function') {
          throw new Error('Clipboard unavailable.');
        }
        await global.navigator.clipboard.writeText(JSON.stringify(buildSnapshot(), null, 2));
        setStatus('Snapshot copied.');
      } catch (_) {
        setStatus('Copy failed.');
      }
    });

    return modal;
  }

  function setStatus(message) {
    const el = document.getElementById('pageDiagnosticsStatus');
    if (el) el.textContent = String(message || '');
  }

  function renderDiagnosticsModal() {
    const modal = document.getElementById('pageDiagnosticsModal');
    if (!modal) return;
    state.modalReady = true;
    const overview = document.getElementById('pdOverviewPane');
    const consolePane = document.getElementById('pdConsolePane');
    const requests = document.getElementById('pdRequestsPane');
    const presence = document.getElementById('pdPresencePane');
    if (overview) overview.innerHTML = renderOverview();
    if (consolePane) consolePane.innerHTML = renderConsole();
    if (requests) requests.innerHTML = renderRequests();
    if (presence) presence.innerHTML = renderPresence();
  }

  async function loadPresence() {
    const endpoint = String(config.endpoint || '').trim();
    if (!endpoint) return;
    state.presenceLoading = true;
    state.presenceError = '';
    state.presenceErrorStatus = 0;
    renderDiagnosticsModal();
    try {
      const url = `${endpoint}?path=${encodeURIComponent(getCurrentPath())}&preview=1&limit=${PRESENCE_LIMIT}`;
      const response = await global.fetch(url, {
        headers: {
          Accept: 'application/json',
          'x-ajax-request': 'true'
        },
        credentials: 'same-origin'
      });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'success') {
        const error = new Error(payload.message || 'Unable to load page users.');
        error.status = response.status;
        throw error;
      }
      state.presence = payload;
      state.presenceError = '';
      state.presenceErrorStatus = 0;
    } catch (error) {
      state.presenceError = error?.message || 'Unable to load page users.';
      state.presenceErrorStatus = Number(error?.status || 0);
    } finally {
      state.presenceLoading = false;
      renderDiagnosticsModal();
      updateButtonState();
    }
  }

  function renderButtonContent(button) {
    button.innerHTML = `
      <i class="bi bi-speedometer2" aria-hidden="true"></i>
      <span class="page-diagnostics-side-control__badge page-diagnostics-health-badge page-diagnostics-health--gray" data-page-diagnostics-health>
        <i class="bi bi-hourglass-split" aria-hidden="true"></i>
      </span>
    `;
  }

  function ensureButton() {
    const host = document.querySelector('.header-side-controls');
    if (!host) return null;
    let button = document.getElementById('pageDiagnosticsSideControl');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'pageDiagnosticsSideControl';
      button.className = 'header-settings-toggle header-side-control-btn page-diagnostics-side-control';
      button.setAttribute('data-no-wait', 'true');
      button.setAttribute('aria-label', 'Open page diagnostics');
      button.title = 'Page diagnostics';
      renderButtonContent(button);
      button.addEventListener('click', () => {
        const modal = ensureModal();
        renderDiagnosticsModal();
        loadPresence();
        global.bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
      });
    }

    const autosaveButton = document.getElementById('schoolAutosaveSideControl');
    if (autosaveButton && autosaveButton.parentElement === host) {
      if (autosaveButton.nextElementSibling !== button) autosaveButton.after(button);
    } else if (button.parentElement !== host) {
      host.appendChild(button);
    }

    updateButtonState();
    return button;
  }

  function installButtonObserver() {
    const host = document.querySelector('.header-side-controls');
    if (!host || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(() => {
      ensureButton();
    });
    observer.observe(host, { childList: true });
  }

  installConsoleCapture();
  installFetchCapture();

  document.addEventListener('DOMContentLoaded', () => {
    ensureButton();
    installButtonObserver();
    setTimeout(ensureButton, 0);
    setTimeout(ensureButton, 250);
  });

  global.addEventListener('load', () => {
    updateButtonState();
    if (state.modalReady) renderDiagnosticsModal();
  }, { once: true });
})(window);
