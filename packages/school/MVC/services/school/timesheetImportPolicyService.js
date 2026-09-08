'use strict';

const IMPORT_TARGET_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'manager_approved',
  'processed'
]);

const DEFAULT_POLICY = Object.freeze({
  importActivityId: '',
  allowImportInTimesheetManagement: false,
  allowImportInMyTimesheets: false,
  importTargetStatus: 'draft'
});

function cleanBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'off') return false;
  return fallback;
}

function cleanId(value) {
  return String(value ?? '').trim();
}

function normalizeImportTargetStatus(value, fallback = 'draft') {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  return IMPORT_TARGET_STATUSES.includes(token) ? token : fallback;
}

function normalizePolicyFromStored(input = {}) {
  return {
    importActivityId: cleanId(input.importActivityId),
    allowImportInTimesheetManagement: cleanBoolean(input.allowImportInTimesheetManagement, false),
    allowImportInMyTimesheets: cleanBoolean(input.allowImportInMyTimesheets, false),
    importTargetStatus: normalizeImportTargetStatus(input.importTargetStatus, 'draft')
  };
}

function normalizePolicyFromForm(input = {}) {
  return {
    importActivityId: cleanId(input.importActivityId),
    allowImportInTimesheetManagement: cleanBoolean(input.allowImportInTimesheetManagement, false),
    allowImportInMyTimesheets: cleanBoolean(input.allowImportInMyTimesheets, false),
    importTargetStatus: normalizeImportTargetStatus(input.importTargetStatus, 'draft')
  };
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function resolveImportTargetStatusForScope(policy = {}, scope = '') {
  const token = String(scope || '').trim().toLowerCase();
  if (token === 'my_timesheets' || token === 'mytimesheets') {
    return 'draft';
  }
  return normalizeImportTargetStatus(policy?.importTargetStatus, 'draft');
}

function validatePolicyInput(input = {}) {
  const rawStatus = String(input?.importTargetStatus ?? '').trim().toLowerCase();
  if (rawStatus && !IMPORT_TARGET_STATUSES.includes(rawStatus)) {
    const error = new Error('Invalid imported timesheet status.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizePolicyFromForm(input);
  const requiresActivity = normalized.allowImportInTimesheetManagement || normalized.allowImportInMyTimesheets;
  if (requiresActivity && !normalized.importActivityId) {
    const error = new Error('Select a legacy import activity before enabling timesheet import.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function isImportAllowedForScope(policy = {}, scope = '') {
  const resolved = resolvePolicy(policy);
  const token = String(scope || '').trim().toLowerCase();
  if (token === 'management' || token === 'timesheet_management') {
    return resolved.allowImportInTimesheetManagement === true;
  }
  if (token === 'my_timesheets' || token === 'mytimesheets') {
    return resolved.allowImportInMyTimesheets === true;
  }
  return false;
}

module.exports = {
  IMPORT_TARGET_STATUSES,
  DEFAULT_POLICY,
  normalizeImportTargetStatus,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  resolveImportTargetStatusForScope,
  validatePolicyInput,
  isImportAllowedForScope
};
