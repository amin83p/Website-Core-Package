'use strict';

(function initAttendanceMarkAppearance(global) {
  const MARK_CSS_CLASS = {
    present: 'status-present',
    late: 'status-late',
    absent: 'status-absent',
    acf: 'status-acf',
    not_applicable: 'status-na',
    excused_absence: 'status-absent',
    late_excused: 'status-late',
    early_leave_excused: 'status-late',
    unmarked: 'status-unmarked',
    notes: 'status-notes'
  };

  const LEGEND_ORDER = [
    'present',
    'late',
    'excused_absence',
    'absent',
    'acf',
    'not_applicable',
    'late_excused',
    'early_leave_excused',
    'unmarked',
    'notes'
  ];

  const RING_CLASS_BY_KEY = {
    excused_absence: 'attendance-timing-excuse-full',
    late_excused: 'attendance-timing-excuse-left',
    early_leave_excused: 'attendance-timing-excuse-right'
  };

  function getAppearance() {
    const raw = global.__attendanceMarkAppearance;
    if (!raw || typeof raw !== 'object') return { marks: [] };
    return raw;
  }

  function getMarks() {
    const marks = getAppearance().marks;
    return Array.isArray(marks) ? marks : [];
  }

  function getMark(key) {
    const normalized = String(key || '').trim().toLowerCase();
    const match = getMarks().find((row) => String(row?.key || '').trim().toLowerCase() === normalized);
    return match ? { ...match, cssClass: MARK_CSS_CLASS[normalized] || '' } : null;
  }

  function markCssClass(key) {
    return MARK_CSS_CLASS[String(key || '').trim().toLowerCase()] || '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildMarkIconHtml(key, options = {}) {
    const mark = getMark(key);
    const ringClass = String(options.ringClass || RING_CLASS_BY_KEY[key] || '').trim();
    const extraClass = String(options.extraClass || '').trim();
    const cssClass = markCssClass(key);
    const iconToken = String(mark?.icon || '').trim();
    if (!iconToken && !ringClass) {
      return '<i class="bi bi-dash status-unmarked"></i>';
    }
    const iconHtml = iconToken
      ? `<i class="bi bi-${escapeHtml(iconToken)} ${escapeHtml(cssClass)} ${escapeHtml(extraClass)}"></i>`
      : '';
    if (ringClass && iconHtml) {
      return `<span class="attendance-timing-excuse-icon ${escapeHtml(ringClass)}">${iconHtml}</span>`;
    }
    return iconHtml;
  }

  function buildTimingExcuseIcon(innerIconHtml, ringClass) {
    const ring = String(ringClass || '').trim();
    if (!ring) return innerIconHtml;
    return `<span class="attendance-timing-excuse-icon ${escapeHtml(ring)}">${innerIconHtml}</span>`;
  }

  function buildLegendEntries() {
    const byKey = new Map(getMarks().map((row) => [String(row.key || '').trim(), row]));
    return LEGEND_ORDER.map((key) => {
      const row = byKey.get(key);
      if (!row) return null;
      return {
        key,
        label: String(row.label || key).trim() || key,
        icon: String(row.icon || '').trim(),
        ringClass: RING_CLASS_BY_KEY[key] || ''
      };
    }).filter(Boolean);
  }

  function buildLegendItemHtml(entry) {
    const label = escapeHtml(entry.label || entry.key);
    const iconHtml = entry.ringClass
      ? buildMarkIconHtml(entry.key, { ringClass: entry.ringClass })
      : buildMarkIconHtml(entry.key);
    return `<span class="me-3 attendance-legend-item">${iconHtml} ${label}</span>`;
  }

  function buildAttendanceLegendText(options = {}) {
    const parts = buildLegendEntries().map((entry) => {
      const label = String(entry.label || entry.key).trim();
      if (entry.key === 'present') return `P ${label}`;
      if (entry.key === 'late') return `L ${label}`;
      if (entry.key === 'absent') return `A ${label}`;
      if (entry.key === 'acf') return `ACF ${label.replace(/^Absent Camera Off$/i, '') || 'ACF'}`.trim() || 'ACF';
      if (entry.key === 'not_applicable') return `— ${label}`;
      return label;
    });
    if (options.includeTimingNote) {
      parts.push("minutes as late'/early' (e.g. L 12', L /5', or L 12'/5')");
    }
    if (options.includeRollup) {
      parts.push('Rollup % = time-based credit');
    }
    if (options.includeNotes) {
      const notesMark = getMark('notes');
      parts.push(`${notesMark?.label || 'Notes exist'}`);
    }
    return `Legend: ${parts.join(' · ')}`;
  }

  function renderAttendanceLegend(container, options = {}) {
    const host = container && container.nodeType === 1
      ? container
      : (typeof container === 'string' ? document.getElementById(container) : null);
    if (!host) return;
    const items = buildLegendEntries().map((entry) => buildLegendItemHtml(entry));
    if (options.includeRollup) {
      items.push('<span class="me-3 attendance-legend-item"><i class="bi bi-percent text-secondary"></i> Rollup % = time-based credit</span>');
    }
  if (options.includeNotes) {
      const notesMark = getMark('notes');
      items.push(`<span class="me-3 attendance-legend-item">${buildMarkIconHtml('notes')} ${escapeHtml(notesMark?.label || 'Notes exist')}</span>`);
    }
    host.innerHTML = items.join('');
  }

  global.AttendanceMarkAppearance = {
    getMark,
    markCssClass,
    buildMarkIconHtml,
    buildTimingExcuseIcon,
    buildLegendEntries,
    buildLegendItemHtml,
    buildAttendanceLegendText,
    renderAttendanceLegend
  };
})(typeof window !== 'undefined' ? window : globalThis);
