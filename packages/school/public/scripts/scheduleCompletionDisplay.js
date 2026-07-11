(function (global) {
  'use strict';

  const DEFAULT_COMPLETE = Object.freeze({
    bg: '#d1e7dd',
    text: '#0f5132',
    border: '#a3cfbb'
  });
  const DEFAULT_PENDING = Object.freeze({
    bg: '#fff3cd',
    text: '#664d03',
    border: '#ffc107'
  });

  function normalizeStatusCode(status) {
    return String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isLeaveEvent(event) {
    if (!event || typeof event !== 'object') return false;
    const candidates = [
      event.status,
      event.eventType,
      event.targetType,
      event.roleLabel,
      event.role
    ].map((value) => normalizeStatusCode(value));
    return candidates.some((value) => (
      value === 'leave_request'
      || value === 'approved_leave'
      || value === 'approved_leave_snapshot'
      || value === 'leave'
    ));
  }

  function toStatusMap(statusMetaMap) {
    if (statusMetaMap instanceof Map) return statusMetaMap;
    if (Array.isArray(statusMetaMap)) {
      return new Map(statusMetaMap.map((row) => [normalizeStatusCode(row?.code), row]).filter(([code]) => Boolean(code)));
    }
    return new Map();
  }

  function badgeStyleFromColors(colors) {
    const palette = colors || DEFAULT_PENDING;
    return `background:${palette.bg};color:${palette.text};border-color:${palette.border};`;
  }

  function rowStyleFromColors(colors, locked) {
    const palette = colors || DEFAULT_PENDING;
    const alpha = locked ? 0.14 : 0.2;
    return [
      `background-color:${palette.bg}`,
      `border-left:4px solid ${palette.border}`
    ].join(';');
  }

  function buildScanResult({ state, isComplete, scanLabel, colors, iconClass }) {
    const palette = colors || (isComplete ? DEFAULT_COMPLETE : DEFAULT_PENDING);
    return {
      state,
      isComplete: Boolean(isComplete),
      scanLabel: String(scanLabel || ''),
      badgeStyle: badgeStyleFromColors(palette),
      rowStyle: rowStyleFromColors(palette, false),
      borderColor: palette.border,
      iconClass: iconClass || (isComplete ? 'bi-check-circle-fill text-success' : 'bi-clock-history text-warning')
    };
  }

  function resolveScheduleCompletionScan(event, statusMetaMap) {
    const statusMap = toStatusMap(statusMetaMap);
    if (isLeaveEvent(event)) {
      return buildScanResult({
        state: 'leave',
        isComplete: false,
        scanLabel: 'Approved Leave',
        colors: { bg: '#fff3cd', text: '#664d03', border: '#ffc107' },
        iconClass: 'bi-airplane-fill text-warning'
      });
    }

    if (String(event?.eventType || '') === 'school_activity') {
      const scan = event?.completionScan && typeof event.completionScan === 'object' ? event.completionScan : null;
      const isComplete = scan?.isComplete === true;
      return buildScanResult({
        state: isComplete ? 'completed' : 'pending',
        isComplete,
        scanLabel: scan?.scanLabel || event?.statusLabel || (isComplete ? 'Completed' : 'Pending completion'),
        colors: isComplete ? DEFAULT_COMPLETE : DEFAULT_PENDING
      });
    }

    const code = normalizeStatusCode(event?.status);
    const meta = statusMap.get(code);
    const isComplete = meta?.isFinal === true;
    const colors = meta
      ? { bg: meta.colorBg || DEFAULT_PENDING.bg, text: meta.colorText || DEFAULT_PENDING.text, border: meta.colorBorder || DEFAULT_PENDING.border }
      : (isComplete ? DEFAULT_COMPLETE : DEFAULT_PENDING);
    const scanLabel = meta?.label
      || String(event?.statusLabel || '')
      || code.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    return buildScanResult({
      state: isComplete ? 'completed' : 'pending',
      isComplete,
      scanLabel,
      colors
    });
  }

  function buildScheduleRowClasses(scan, baseClasses) {
    const classes = String(baseClasses || '').trim();
    if (!scan) return classes;
    if (scan.state === 'leave') return `${classes} leave-event`.trim();
    if (scan.isComplete) return `${classes} event-row-complete`.trim();
    if (scan.state === 'pending') return `${classes} event-row-pending`.trim();
    return classes;
  }

  function buildScheduleBlockClasses(scan, baseClasses) {
    const classes = String(baseClasses || '').trim();
    if (!scan) return classes;
    if (scan.state === 'leave') return classes;
    if (scan.isComplete) return `${classes} event-block-complete`.trim();
    if (scan.state === 'pending') return `${classes} event-block-pending`.trim();
    return classes;
  }

  function buildScheduleScanIcon(scan) {
    if (!scan) return '';
    const iconClass = scan.iconClass || 'bi-circle text-muted';
    const title = escapeHtml(scan.scanLabel || '');
    return `<i class="bi ${iconClass} schedule-scan-icon" title="${title}" aria-hidden="true"></i>`;
  }

  function summarizeDayCompletion(events, statusMetaMap) {
    let complete = 0;
    let pending = 0;
    (Array.isArray(events) ? events : []).forEach((event) => {
      const scan = resolveScheduleCompletionScan(event, statusMetaMap);
      if (scan.state === 'leave') return;
      if (scan.isComplete) complete += 1;
      else pending += 1;
    });
    return { complete, pending, total: complete + pending };
  }

  function buildDayCompletionChip(summary) {
    if (!summary || summary.total <= 0) return '';
    const complete = Number(summary.complete || 0);
    const total = Number(summary.total || 0);
    return `<span class="badge day-completion-chip bg-success-subtle text-success-emphasis border border-success-subtle">${complete}/${total} complete</span>`;
  }

  function buildCalendarDayBadges(dayEvents, statusMetaMap, options) {
    const opts = options || {};
    const hasConflict = opts.hasConflict === true;
    const hasLeave = opts.hasLeave === true;
    const count = Array.isArray(dayEvents) ? dayEvents.length : 0;
    if (hasConflict) {
      return `<div class="cal-badge bg-danger">${count}</div>`;
    }
    if (hasLeave) {
      return `<div class="cal-badge bg-warning text-dark">${count}</div>`;
    }
    if (count <= 0) return '';
    const summary = summarizeDayCompletion(dayEvents, statusMetaMap);
    if (summary.total <= 0) return '';
    const parts = [];
    if (summary.complete > 0) {
      parts.push(`<div class="cal-badge cal-badge-complete bg-success">${summary.complete}</div>`);
    }
    if (summary.pending > 0) {
      parts.push(`<div class="cal-badge cal-badge-pending bg-warning text-dark">${summary.pending}</div>`);
    }
    return parts.join('');
  }

  function buildScheduleStatusBadge(scan, fallbackLabel, fallbackStyle) {
    if (scan?.scanLabel) {
      return `<span class="session-status-tag" style="${scan.badgeStyle}">${escapeHtml(scan.scanLabel)}</span>`;
    }
    return `<span class="session-status-tag" style="${fallbackStyle || ''}">${escapeHtml(fallbackLabel || '')}</span>`;
  }

  global.ScheduleCompletionDisplay = {
    resolveScheduleCompletionScan,
    buildScheduleRowClasses,
    buildScheduleBlockClasses,
    buildScheduleScanIcon,
    summarizeDayCompletion,
    buildDayCompletionChip,
    buildCalendarDayBadges,
    buildScheduleStatusBadge,
    isLeaveEvent
  };
}(typeof window !== 'undefined' ? window : global));
