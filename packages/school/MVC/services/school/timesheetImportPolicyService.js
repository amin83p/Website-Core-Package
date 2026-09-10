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
  importTargetStatus: 'draft',
  classNameActivityMappings: []
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

function normalizeClassNameKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseClassNameActivityMappingsInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function normalizeClassNameActivityMappings(input = [], { enforceUnique = false } = {}) {
  const rows = parseClassNameActivityMappingsInput(input);
  const normalized = [];
  const seenKeys = new Set();

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const className = String(row.className ?? '').trim();
    const activityId = cleanId(row.activityId);
    if (!className || !activityId) return;

    const classNameKey = normalizeClassNameKey(className);
    if (!classNameKey) return;
    if (enforceUnique && seenKeys.has(classNameKey)) {
      const error = new Error(`Duplicate class name mapping for "${className}".`);
      error.statusCode = 400;
      throw error;
    }
    seenKeys.add(classNameKey);
    normalized.push({ className, activityId });
  });

  return normalized;
}

function buildClassNameActivityLookup(mappings = []) {
  const lookup = new Map();
  normalizeClassNameActivityMappings(mappings).forEach((row) => {
    lookup.set(normalizeClassNameKey(row.className), row.activityId);
  });
  return lookup;
}

function normalizePolicyFromStored(input = {}) {
  return {
    importActivityId: cleanId(input.importActivityId),
    allowImportInTimesheetManagement: cleanBoolean(input.allowImportInTimesheetManagement, false),
    allowImportInMyTimesheets: cleanBoolean(input.allowImportInMyTimesheets, false),
    importTargetStatus: normalizeImportTargetStatus(input.importTargetStatus, 'draft'),
    classNameActivityMappings: normalizeClassNameActivityMappings(input.classNameActivityMappings)
  };
}

function normalizePolicyFromForm(input = {}) {
  return {
    importActivityId: cleanId(input.importActivityId),
    allowImportInTimesheetManagement: cleanBoolean(input.allowImportInTimesheetManagement, false),
    allowImportInMyTimesheets: cleanBoolean(input.allowImportInMyTimesheets, false),
    importTargetStatus: normalizeImportTargetStatus(input.importTargetStatus, 'draft'),
    classNameActivityMappings: normalizeClassNameActivityMappings(
      input.classNameActivityMappings,
      { enforceUnique: true }
    )
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

function resolveImportActivityIdForClassName(className = '', policy = {}) {
  const mapping = resolveImportClassActivityMapping(className, policy);
  return mapping.resolvedActivityId;
}

function resolveImportClassActivityMapping(className = '', policy = {}) {
  const resolved = resolvePolicy(policy);
  const defaultActivityId = cleanId(resolved.importActivityId);
  const classNameKey = normalizeClassNameKey(className);
  const lookup = buildClassNameActivityLookup(resolved.classNameActivityMappings);
  const explicitActivityId = classNameKey ? cleanId(lookup.get(classNameKey)) : '';
  const hasExplicitMapping = Boolean(explicitActivityId);
  const resolvedActivityId = hasExplicitMapping ? explicitActivityId : defaultActivityId;

  let mappingStatus = 'unmapped';
  let mappingNote = 'No class mapping in Settings and no default import activity; row will be skipped on import.';

  if (hasExplicitMapping) {
    mappingStatus = 'explicit';
    mappingNote = '';
  } else if (defaultActivityId) {
    mappingStatus = 'default';
    mappingNote = 'No class mapping in Settings; uses default import activity.';
  }

  return {
    hasExplicitMapping,
    resolvedActivityId,
    defaultActivityId,
    mappingStatus,
    mappingNote
  };
}

function annotateImportCompileRows(rows = [], policy = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const importClassMapping = resolveImportClassActivityMapping(row.className, policy);
    return { ...row, importClassMapping };
  });
}

function summarizeImportClassMappingIssues(rows = []) {
  const defaultFallbackClasses = new Set();
  const unmappedClasses = new Set();
  let defaultFallbackRowCount = 0;
  let unmappedRowCount = 0;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mapping = row?.importClassMapping;
    if (!mapping || mapping.mappingStatus === 'explicit') return;
    const classLabel = String(row?.className || '').trim() || '(blank class)';
    if (mapping.mappingStatus === 'default') {
      defaultFallbackClasses.add(classLabel);
      defaultFallbackRowCount += 1;
    } else if (mapping.mappingStatus === 'unmapped') {
      unmappedClasses.add(classLabel);
      unmappedRowCount += 1;
    }
  });

  return {
    defaultFallbackClassCount: defaultFallbackClasses.size,
    defaultFallbackRowCount,
    defaultFallbackClasses: [...defaultFallbackClasses],
    unmappedClassCount: unmappedClasses.size,
    unmappedRowCount,
    unmappedClasses: [...unmappedClasses]
  };
}

function partitionCompiledRowsByImportActivity(compiledRows = [], policy = {}) {
  const resolved = resolvePolicy(policy);
  const defaultActivityId = cleanId(resolved.importActivityId);
  const lookup = buildClassNameActivityLookup(resolved.classNameActivityMappings);
  const buckets = new Map();

  (Array.isArray(compiledRows) ? compiledRows : []).forEach((row) => {
    const classNameKey = normalizeClassNameKey(row?.className);
    const activityId = cleanId(lookup.get(classNameKey)) || defaultActivityId;
    if (!activityId) return;
    const bucket = buckets.get(activityId) || [];
    bucket.push(row);
    buckets.set(activityId, bucket);
  });

  return buckets;
}

function listDistinctImportActivityIds(policy = {}) {
  const resolved = resolvePolicy(policy);
  const ids = new Set();
  const defaultActivityId = cleanId(resolved.importActivityId);
  if (defaultActivityId) ids.add(defaultActivityId);
  normalizeClassNameActivityMappings(resolved.classNameActivityMappings).forEach((row) => {
    if (row.activityId) ids.add(row.activityId);
  });
  return [...ids];
}

module.exports = {
  IMPORT_TARGET_STATUSES,
  DEFAULT_POLICY,
  normalizeClassNameKey,
  normalizeClassNameActivityMappings,
  normalizeImportTargetStatus,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  resolveImportTargetStatusForScope,
  validatePolicyInput,
  isImportAllowedForScope,
  resolveImportActivityIdForClassName,
  resolveImportClassActivityMapping,
  annotateImportCompileRows,
  summarizeImportClassMappingIssues,
  partitionCompiledRowsByImportActivity,
  listDistinctImportActivityIds
};
