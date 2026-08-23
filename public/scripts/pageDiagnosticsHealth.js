(function initPageDiagnosticsHealth(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PageDiagnosticsHealth = api;
})(typeof window !== 'undefined' ? window : null, function createPageDiagnosticsHealth() {
  'use strict';

  const STATUS_ORDER = {
    gray: 0,
    green: 1,
    yellow: 2,
    red: 3
  };

  const STATUS_UI = {
    gray: {
      label: 'Collecting',
      icon: 'bi-hourglass-split',
      badgeClass: 'page-diagnostics-health--gray'
    },
    green: {
      label: 'Perfect',
      icon: 'bi-check-lg',
      badgeClass: 'page-diagnostics-health--green'
    },
    yellow: {
      label: 'Needs attention',
      icon: 'bi-exclamation-triangle-fill',
      badgeClass: 'page-diagnostics-health--yellow'
    },
    red: {
      label: 'Error',
      icon: 'bi-x-lg',
      badgeClass: 'page-diagnostics-health--red'
    }
  };

  const THRESHOLDS = {
    server: {
      loadMs: { green: 2500, yellow: 5000 },
      domContentLoadedMs: { green: 1500, yellow: 3000 },
      responseMs: { green: 800, yellow: 2000 },
      slowestResourceMs: { green: 1000, yellow: 2500 }
    },
    local: {
      loadMs: { green: 4000, yellow: 8000 },
      domContentLoadedMs: { green: 2500, yellow: 5000 },
      responseMs: { green: 1500, yellow: 3500 },
      slowestResourceMs: { green: 2000, yellow: 5000 }
    }
  };

  function normalizeRuntimeKind(runtime = {}) {
    const kind = String(runtime.kind || '').trim().toLowerCase();
    if (kind === 'local' || kind === 'railway' || kind === 'server') return kind;
    return runtime.isProduction === false ? 'local' : 'server';
  }

  function getRuntimeLabel(runtime = {}) {
    const kind = normalizeRuntimeKind(runtime);
    if (kind === 'local') return 'Local run';
    if (kind === 'railway') return 'Railway server';
    return 'Server';
  }

  function getThresholds(runtime = {}) {
    return normalizeRuntimeKind(runtime) === 'local' ? THRESHOLDS.local : THRESHOLDS.server;
  }

  function isPositiveNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function worstStatus(a, b) {
    return STATUS_ORDER[b] > STATUS_ORDER[a] ? b : a;
  }

  function scoreMetric(value, limits) {
    if (!isPositiveNumber(value)) return 'gray';
    const numeric = Number(value);
    if (numeric <= limits.green) return 'green';
    if (numeric <= limits.yellow) return 'yellow';
    return 'red';
  }

  function addReason(reasons, status, message) {
    reasons.push({ status, message });
  }

  function isPresenceRequest(entry, presenceEndpointPath) {
    const endpoint = String(presenceEndpointPath || '').trim();
    if (!endpoint) return false;
    return String(entry?.url || '').startsWith(endpoint);
  }

  function scoreRequests(entries = [], presenceEndpointPath = '') {
    let status = 'green';
    const reasons = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
      const code = Number(entry?.status || 0);
      const isPresence = isPresenceRequest(entry, presenceEndpointPath);
      const label = String(entry?.url || 'request');
      const failed = Boolean(entry?.error) || (!entry?.ok && !code);

      if (isPresence) {
        if (code >= 500) {
          status = worstStatus(status, 'red');
          addReason(reasons, 'red', `Page users endpoint returned ${code}.`);
        } else if (failed || code >= 400) {
          status = worstStatus(status, 'yellow');
          addReason(reasons, 'yellow', 'Page users endpoint needs attention.');
        }
        continue;
      }

      if (failed || code >= 500) {
        status = worstStatus(status, 'red');
        addReason(reasons, 'red', `${label} failed${code ? ` with ${code}` : ''}.`);
      } else if (code >= 400) {
        status = worstStatus(status, 'yellow');
        addReason(reasons, 'yellow', `${label} returned ${code}.`);
      }
    }

    return { status, reasons };
  }

  function scoreRequestDurations(entries = [], thresholds = THRESHOLDS.server) {
    let status = 'green';
    const reasons = [];
    const limits = thresholds.slowestResourceMs;

    for (const entry of Array.isArray(entries) ? entries : []) {
      const durationMs = Number(entry?.durationMs || 0);
      if (!isPositiveNumber(durationMs)) continue;
      const entryStatus = scoreMetric(durationMs, limits);
      if (entryStatus === 'red') {
        status = worstStatus(status, 'red');
        addReason(reasons, 'red', `${entry.url || 'Request'} took ${Math.round(durationMs)} ms.`);
      } else if (entryStatus === 'yellow') {
        status = worstStatus(status, 'yellow');
        addReason(reasons, 'yellow', `${entry.url || 'Request'} was slow at ${Math.round(durationMs)} ms.`);
      }
    }

    return { status, reasons };
  }

  function getSlowestResourceMs(resources = {}) {
    const slowest = Array.isArray(resources.slowest) ? resources.slowest : [];
    return slowest.reduce((max, entry) => Math.max(max, Number(entry?.durationMs || 0)), 0);
  }

  function evaluatePageHealth(input = {}) {
    const runtime = input.runtime || {};
    const thresholds = getThresholds(runtime);
    const navigation = input.navigation || {};
    const resources = input.resources || {};
    const consoleEntries = Array.isArray(input.consoleEntries) ? input.consoleEntries : [];
    const requestEntries = Array.isArray(input.requestEntries) ? input.requestEntries : [];
    const presenceEndpointPath = String(input.presenceEndpointPath || '').trim();
    const reasons = [];
    const metrics = {
      loadMs: Number(navigation.loadMs || 0),
      domContentLoadedMs: Number(navigation.domContentLoadedMs || 0),
      responseMs: Number(navigation.responseMs || 0),
      slowestResourceMs: getSlowestResourceMs(resources)
    };

    let status = Object.values(metrics).some(isPositiveNumber) ? 'green' : 'gray';

    [
      ['loadMs', 'Load time'],
      ['domContentLoadedMs', 'DOM ready'],
      ['responseMs', 'Initial response'],
      ['slowestResourceMs', 'Slowest resource']
    ].forEach(([key, label]) => {
      const metricStatus = scoreMetric(metrics[key], thresholds[key]);
      if (metricStatus === 'red') {
        status = worstStatus(status, 'red');
        addReason(reasons, 'red', `${label} is ${Math.round(metrics[key])} ms.`);
      } else if (metricStatus === 'yellow') {
        status = worstStatus(status, 'yellow');
        addReason(reasons, 'yellow', `${label} is ${Math.round(metrics[key])} ms.`);
      }
    });

    const errorCount = consoleEntries.filter((entry) => String(entry?.level || '').toLowerCase() === 'error').length;
    const warningCount = consoleEntries.filter((entry) => ['warn', 'warning'].includes(String(entry?.level || '').toLowerCase())).length;
    if (errorCount > 0) {
      status = worstStatus(status, 'red');
      addReason(reasons, 'red', `${errorCount} console error${errorCount === 1 ? '' : 's'} captured.`);
    } else if (warningCount > 0) {
      status = worstStatus(status, 'yellow');
      addReason(reasons, 'yellow', `${warningCount} console warning${warningCount === 1 ? '' : 's'} captured.`);
    }

    const requestStatus = scoreRequests(requestEntries, presenceEndpointPath);
    status = worstStatus(status, requestStatus.status);
    reasons.push(...requestStatus.reasons);

    const durationStatus = scoreRequestDurations(requestEntries, thresholds);
    status = worstStatus(status, durationStatus.status);
    reasons.push(...durationStatus.reasons);

    if (input.presenceError) {
      const presenceErrorStatus = Number(input.presenceErrorStatus || 0);
      if (presenceErrorStatus >= 500) {
        status = worstStatus(status, 'red');
        addReason(reasons, 'red', 'Page users endpoint returned a server error.');
      } else {
        status = worstStatus(status, 'yellow');
        addReason(reasons, 'yellow', 'Page users endpoint is unavailable.');
      }
    }

    const ui = STATUS_UI[status] || STATUS_UI.gray;
    return {
      status,
      label: ui.label,
      icon: ui.icon,
      badgeClass: ui.badgeClass,
      runtimeKind: normalizeRuntimeKind(runtime),
      runtimeLabel: getRuntimeLabel(runtime),
      thresholds,
      metrics,
      reasons
    };
  }

  return {
    THRESHOLDS,
    STATUS_UI,
    evaluatePageHealth,
    getRuntimeLabel,
    getThresholds,
    normalizeRuntimeKind
  };
});
