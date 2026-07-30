const REPORT_SCOPE_DEFINITIONS = Object.freeze([
  Object.freeze({ value: 'class', label: 'Whole Class' }),
  Object.freeze({ value: 'each_student', label: 'Each Student' }),
  Object.freeze({ value: 'selected_students', label: 'Specific Students' })
]);

const REPORT_SCOPES = Object.freeze(REPORT_SCOPE_DEFINITIONS.map((row) => row.value));
const REPORT_SCOPE_SET = new Set(REPORT_SCOPES);

function normalizeReportScope(value, { defaultValue = 'class' } = {}) {
  const normalized = String(value || '').trim().toLowerCase() || defaultValue;
  if (!REPORT_SCOPE_SET.has(normalized)) throw new Error('Invalid report scope.');
  return normalized;
}

function normalizeAllowedReportScopes(value) {
  if (value === undefined || value === null) return [...REPORT_SCOPES];

  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = rawValues
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const invalid = [...new Set(normalized.filter((scope) => !REPORT_SCOPE_SET.has(scope)))];
  if (invalid.length) {
    throw new Error(`Invalid template report scope${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}.`);
  }

  const selected = new Set(normalized);
  const ordered = REPORT_SCOPES.filter((scope) => selected.has(scope));
  if (!ordered.length) throw new Error('Select at least one approved report scope for this template.');
  return ordered;
}

function resolveAllowedReportScopes(template) {
  return normalizeAllowedReportScopes(template?.allowedReportScopes);
}

function getReportScopeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return REPORT_SCOPE_DEFINITIONS.find((row) => row.value === normalized)?.label || normalized;
}

function withResolvedAllowedReportScopes(template) {
  if (!template || typeof template !== 'object') return template;
  return {
    ...template,
    allowedReportScopes: resolveAllowedReportScopes(template)
  };
}

module.exports = {
  REPORT_SCOPE_DEFINITIONS,
  REPORT_SCOPES,
  normalizeReportScope,
  normalizeAllowedReportScopes,
  resolveAllowedReportScopes,
  getReportScopeLabel,
  withResolvedAllowedReportScopes
};
