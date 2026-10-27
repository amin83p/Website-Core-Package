const REPORT_PERIOD_BASE_DEFINITIONS = Object.freeze([
  Object.freeze({ value: 'none', label: 'None' }),
  Object.freeze({ value: 'days', label: 'Days' }),
  Object.freeze({ value: 'weeks', label: 'Weeks' }),
  Object.freeze({ value: 'months', label: 'Months' }),
  Object.freeze({ value: 'year', label: 'Year' }),
  Object.freeze({ value: 'enrollment', label: 'Enrollment' })
]);

const REPORT_PERIOD_BASES = Object.freeze(REPORT_PERIOD_BASE_DEFINITIONS.map((row) => row.value));
const REPORT_PERIOD_BASE_SET = new Set(REPORT_PERIOD_BASES);
const OFFSET_BASES = new Set(['days', 'weeks', 'months']);
const MAX_REPORT_PERIOD_OFFSET = 999;

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  return token;
}

function normalizeReportPeriodBase(value, { defaultValue = 'none' } = {}) {
  const normalized = String(value || '').trim().toLowerCase() || defaultValue;
  if (!REPORT_PERIOD_BASE_SET.has(normalized)) {
    throw new Error(`Invalid report period base: ${normalized || '(empty)'}.`);
  }
  return normalized;
}

function normalizeReportPeriodOffset(base, value) {
  const token = String(base || '').trim().toLowerCase();
  if (!OFFSET_BASES.has(token)) return null;
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Report period offset must be a positive number for Days, Weeks, or Months.');
  }
  return Math.min(MAX_REPORT_PERIOD_OFFSET, n);
}

function resolveReportPeriodFields(template = {}, { strict = false } = {}) {
  const existingBase = template?.reportPeriodBase;
  const base = existingBase === undefined || existingBase === null || existingBase === ''
    ? 'none'
    : normalizeReportPeriodBase(existingBase);
  let offset = null;
  if (OFFSET_BASES.has(base)) {
    if (strict && (template?.reportPeriodOffset === undefined || template?.reportPeriodOffset === null || template?.reportPeriodOffset === '')) {
      throw new Error('Report period offset is required when base is Days, Weeks, or Months.');
    }
    offset = normalizeReportPeriodOffset(base, template?.reportPeriodOffset ?? 1);
  }
  return { reportPeriodBase: base, reportPeriodOffset: offset };
}

function parseReportPeriodFieldsFromBody(body = {}, existingTemplate = null) {
  const present = String(body.reportPeriodBasePresent || '').trim();
  if (!present) {
    return resolveReportPeriodFields(existingTemplate || {}, { strict: false });
  }
  const draft = {
    reportPeriodBase: body.reportPeriodBase,
    reportPeriodOffset: body.reportPeriodOffset
  };
  return resolveReportPeriodFields(draft, { strict: true });
}

function isStudentScopedReportScope(scope) {
  const token = String(scope || '').trim().toLowerCase();
  return token === 'each_student' || token === 'selected_students';
}

function parseSessionAnchorDate(sessionDate) {
  const iso = normalizeDateOnly(sessionDate);
  if (!iso) return null;
  return new Date(`${iso}T12:00:00.000Z`);
}

function formatDateOnlyFromUtcDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function subtractCalendarUnits(sessionDate, base, offset) {
  const anchor = parseSessionAnchorDate(sessionDate);
  if (!anchor) return '';
  const units = Number(offset) || 1;
  if (base === 'days') anchor.setUTCDate(anchor.getUTCDate() - units);
  else if (base === 'weeks') anchor.setUTCDate(anchor.getUTCDate() - (units * 7));
  else if (base === 'months') anchor.setUTCMonth(anchor.getUTCMonth() - units);
  else return '';
  return formatDateOnlyFromUtcDate(anchor);
}

function computeSuggestedReportStartDateSync({
  reportPeriodBase = 'none',
  reportPeriodOffset = null,
  sessionDate = ''
} = {}) {
  const session = normalizeDateOnly(sessionDate);
  if (!session) return '';
  const base = normalizeReportPeriodBase(reportPeriodBase, { defaultValue: 'none' });
  if (base === 'none') return session;
  if (base === 'year') return `${session.slice(0, 4)}-01-01`;
  if (OFFSET_BASES.has(base)) {
    const offset = normalizeReportPeriodOffset(base, reportPeriodOffset ?? 1);
    return subtractCalendarUnits(session, base, offset);
  }
  return session;
}

function formatReportPeriodBaseSummary(template = {}) {
  const { reportPeriodBase: base, reportPeriodOffset: offset } = resolveReportPeriodFields(template);
  if (base === 'none') return 'None';
  if (base === 'year') return 'Year (calendar year start)';
  if (base === 'enrollment') return 'Enrollment (per student)';
  if (OFFSET_BASES.has(base)) {
    const label = REPORT_PERIOD_BASE_DEFINITIONS.find((row) => row.value === base)?.label || base;
    return `${offset} ${label.toLowerCase()} before session`;
  }
  return base;
}

function buildSuggestionHint(template = {}) {
  const { reportPeriodBase: base, reportPeriodOffset: offset } = resolveReportPeriodFields(template);
  if (base === 'none') return 'Suggested start matches the session date.';
  if (base === 'year') return 'Suggested start is the first day of the session calendar year.';
  if (base === 'enrollment') {
    return 'Enrollment base applies when exactly one student is selected (Each Student / Specific Students).';
  }
  if (OFFSET_BASES.has(base)) {
    const unit = base === 'days' ? 'day' : base.slice(0, -1);
    const plural = offset === 1 ? unit : `${unit}s`;
    return `Suggested start is ${offset} ${plural} before the session date.`;
  }
  return '';
}

function withResolvedReportPeriod(template) {
  if (!template || typeof template !== 'object') return template;
  const resolved = resolveReportPeriodFields(template);
  return {
    ...template,
    reportPeriodBase: resolved.reportPeriodBase,
    reportPeriodOffset: resolved.reportPeriodOffset
  };
}

module.exports = {
  REPORT_PERIOD_BASE_DEFINITIONS,
  REPORT_PERIOD_BASES,
  OFFSET_BASES,
  MAX_REPORT_PERIOD_OFFSET,
  normalizeDateOnly,
  normalizeReportPeriodBase,
  normalizeReportPeriodOffset,
  resolveReportPeriodFields,
  parseReportPeriodFieldsFromBody,
  isStudentScopedReportScope,
  computeSuggestedReportStartDateSync,
  formatReportPeriodBaseSummary,
  buildSuggestionHint,
  withResolvedReportPeriod
};
