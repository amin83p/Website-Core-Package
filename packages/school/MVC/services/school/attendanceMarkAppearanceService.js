'use strict';

const MARK_KEYS = Object.freeze([
  'present',
  'late',
  'absent',
  'acf',
  'not_applicable',
  'excused_absence',
  'late_excused',
  'early_leave_excused',
  'unmarked',
  'notes',
  'timing_excuse_ring'
]);

const COLOR_ONLY_MARK_KEYS = Object.freeze(['timing_excuse_ring']);

const CURATED_ICONS = Object.freeze([
  'check-circle',
  'check-circle-fill',
  'clock',
  'clock-fill',
  'clock-history',
  'x-circle',
  'x-circle-fill',
  'x-lg',
  'camera-video-off',
  'camera-video-off-fill',
  'dash',
  'dash-circle',
  'dash-circle-fill',
  'dash-lg',
  'chat-dots',
  'chat-dots-fill',
  'envelope-paper',
  'envelope-paper-fill',
  'shield-plus',
  'shield-check',
  'exclamation-circle',
  'exclamation-circle-fill',
  'question-circle',
  'question-circle-fill',
  'person-fill',
  'person-x',
  'calendar-x',
  'calendar-x-fill',
  'ban',
  'circle',
  'circle-fill'
]);

const DEFAULT_MARKS = Object.freeze([
  Object.freeze({ key: 'present', label: 'Present', icon: 'check-circle-fill', color: '#198754' }),
  Object.freeze({ key: 'late', label: 'Late / left early', icon: 'clock-fill', color: '#FFFF00' }),
  Object.freeze({ key: 'absent', label: 'Absent', icon: 'x-circle-fill', color: '#dc3545' }),
  Object.freeze({ key: 'acf', label: 'Absent Camera Off', icon: 'camera-video-off-fill', color: '#b02a37' }),
  Object.freeze({ key: 'not_applicable', label: 'N/A', icon: 'dash-circle-fill', color: '#adb5bd' }),
  Object.freeze({ key: 'excused_absence', label: 'Excused absence', icon: 'x-circle-fill', color: '#dc3545' }),
  Object.freeze({ key: 'late_excused', label: 'Late excused', icon: 'clock-fill', color: '#FFFF00' }),
  Object.freeze({ key: 'early_leave_excused', label: 'Early leave excused', icon: 'clock-fill', color: '#FFFF00' }),
  Object.freeze({ key: 'unmarked', label: 'Not marked', icon: 'dash', color: '#6c757d' }),
  Object.freeze({ key: 'notes', label: 'Notes exist', icon: 'chat-dots-fill', color: '#0d6efd' }),
  Object.freeze({ key: 'timing_excuse_ring', label: 'Timing excuse ring', icon: '', color: '#198754' })
]);

const DEFAULT_POLICY = Object.freeze({
  marks: DEFAULT_MARKS.map((row) => ({ ...row }))
});

const LEGEND_ORDER = Object.freeze([
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
]);

const MARK_CSS_CLASS = Object.freeze({
  present: 'status-present',
  late: 'status-late',
  absent: 'status-absent',
  acf: 'status-acf',
  not_applicable: 'status-na',
  excused_absence: 'status-absent',
  late_excused: 'status-late',
  early_leave_excused: 'status-late',
  unmarked: 'status-unmarked',
  notes: 'status-notes',
  timing_excuse_ring: ''
});

const curatedIconSet = new Set(CURATED_ICONS);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeHexColor(value, fallback = '#000000') {
  const token = cleanText(value);
  if (!token) return fallback;
  const withHash = token.startsWith('#') ? token : `#${token}`;
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }
  return fallback;
}

function normalizeIcon(value, fallback = '') {
  const token = cleanText(value).replace(/^bi-/, '').replace(/^bi\s+/, '');
  if (!token) return fallback;
  if (!/^[a-z0-9-]+$/.test(token)) return fallback;
  if (!curatedIconSet.has(token)) return fallback;
  return token;
}

function normalizeMarkKey(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '_');
}

function cloneMark(row, fallback = null) {
  const key = normalizeMarkKey(row?.key);
  if (!key || !MARK_KEYS.includes(key)) return null;
  const defaultRow = DEFAULT_MARKS.find((item) => item.key === key) || fallback;
  const iconAllowed = !COLOR_ONLY_MARK_KEYS.includes(key);
  const icon = iconAllowed
    ? normalizeIcon(row?.icon, defaultRow?.icon || '')
    : '';
  return {
    key,
    label: cleanText(row?.label) || defaultRow?.label || key,
    icon,
    color: normalizeHexColor(row?.color, defaultRow?.color || '#000000')
  };
}

function normalizeMarks(inputMarks) {
  const rows = Array.isArray(inputMarks) ? inputMarks : [];
  const byKey = new Map();
  rows.forEach((row) => {
    const normalized = cloneMark(row);
    if (normalized) byKey.set(normalized.key, normalized);
  });
  return MARK_KEYS.map((key) => {
    const fromInput = byKey.get(key);
    if (fromInput) return { ...fromInput };
    const defaultRow = DEFAULT_MARKS.find((row) => row.key === key);
    return defaultRow ? { ...defaultRow } : null;
  }).filter(Boolean);
}

function validatePolicyMarks(marks) {
  const inputRows = Array.isArray(marks) ? marks : [];
  const errors = [];
  const seen = new Set();

  inputRows.forEach((row) => {
    const key = normalizeMarkKey(row?.key);
    if (!key) {
      errors.push('Each mark row requires a key.');
      return;
    }
    if (!MARK_KEYS.includes(key)) {
      errors.push(`Unknown mark "${row?.key}".`);
      return;
    }
    if (seen.has(key)) errors.push(`Duplicate mark "${key}".`);
    seen.add(key);

    const label = cleanText(row?.label);
    if (!label) errors.push(`Mark "${key}" requires a label.`);

    const colorToken = cleanText(row?.color);
    const withHash = colorToken.startsWith('#') ? colorToken : `#${colorToken}`;
    if (!/^#[0-9A-Fa-f]{3}$/.test(withHash) && !/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
      errors.push(`Mark "${key}" must have a valid hex color.`);
    }

    if (!COLOR_ONLY_MARK_KEYS.includes(key)) {
      const iconToken = cleanText(row?.icon).replace(/^bi-/, '');
      if (!iconToken) errors.push(`Mark "${key}" requires an icon.`);
      else if (!/^[a-z0-9-]+$/.test(iconToken) || !curatedIconSet.has(iconToken)) {
        errors.push(`Mark "${key}" icon is not allowed.`);
      }
    }
  });

  MARK_KEYS.forEach((key) => {
    if (!seen.has(key)) errors.push(`Missing mark "${key}".`);
  });

  const normalized = errors.length ? [] : normalizeMarks(inputRows);
  return { valid: errors.length === 0, errors, marks: normalized };
}

function resolvePolicy(orgPolicy = {}) {
  const marks = normalizeMarks(orgPolicy?.marks);
  const validation = validatePolicyMarks(marks);
  if (!validation.valid) {
    return { marks: DEFAULT_MARKS.map((row) => ({ ...row })) };
  }
  return { marks: validation.marks.map((row) => ({ ...row })) };
}

function normalizePolicyFromStored(input = {}) {
  const marks = normalizeMarks(input?.marks);
  const validation = validatePolicyMarks(marks);
  if (!validation.valid) {
    return { marks: DEFAULT_MARKS.map((row) => ({ ...row })) };
  }
  return { marks: validation.marks.map((row) => ({ ...row })) };
}

function normalizePolicyFromForm(input = {}) {
  let marksInput = input.marks;
  if (typeof marksInput === 'string' && marksInput.trim()) {
    try {
      marksInput = JSON.parse(marksInput);
    } catch (_) {
      marksInput = [];
    }
  }
  const validation = validatePolicyMarks(normalizeMarks(marksInput));
  if (!validation.valid) {
    const err = new Error(validation.errors.join(' '));
    err.validationErrors = validation.errors;
    throw err;
  }
  return { marks: validation.marks.map((row) => ({ ...row })) };
}

function cssVarNameForKey(key) {
  return `--att-mark-${String(key || '').trim().replace(/_/g, '-')}`;
}

function buildCssVariableMap(policy = DEFAULT_POLICY) {
  const resolved = resolvePolicy(policy);
  const map = {};
  resolved.marks.forEach((row) => {
    map[cssVarNameForKey(row.key)] = row.color;
  });
  return map;
}

function getMark(policy = DEFAULT_POLICY, key = '') {
  const normalizedKey = normalizeMarkKey(key);
  const resolved = resolvePolicy(policy);
  const match = resolved.marks.find((row) => row.key === normalizedKey);
  if (!match) return null;
  return { ...match, cssClass: MARK_CSS_CLASS[normalizedKey] || '' };
}

function buildLegendEntries(policy = DEFAULT_POLICY) {
  const resolved = resolvePolicy(policy);
  const byKey = new Map(resolved.marks.map((row) => [row.key, row]));
  return LEGEND_ORDER.map((key) => {
    const row = byKey.get(key);
    if (!row) return null;
    return {
      key: row.key,
      label: row.label,
      icon: row.icon,
      color: row.color,
      cssClass: MARK_CSS_CLASS[row.key] || '',
      ringClass: key === 'excused_absence'
        ? 'attendance-timing-excuse-full'
        : (key === 'late_excused'
          ? 'attendance-timing-excuse-left'
          : (key === 'early_leave_excused' ? 'attendance-timing-excuse-right' : ''))
    };
  }).filter(Boolean);
}

module.exports = {
  MARK_KEYS,
  COLOR_ONLY_MARK_KEYS,
  CURATED_ICONS,
  DEFAULT_MARKS,
  DEFAULT_POLICY,
  LEGEND_ORDER,
  MARK_CSS_CLASS,
  normalizeHexColor,
  normalizeIcon,
  normalizeMarks,
  validatePolicyMarks,
  resolvePolicy,
  normalizePolicyFromForm,
  normalizePolicyFromStored,
  cssVarNameForKey,
  buildCssVariableMap,
  getMark,
  buildLegendEntries
};
