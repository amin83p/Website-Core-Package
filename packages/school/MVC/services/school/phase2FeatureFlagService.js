const { requireCoreModule } = require('./schoolCoreContracts');
const settingService = requireCoreModule('MVC/services/settingService');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function readAppFlag(name, fallback = false) {
  return parseBoolean(settingService.getValue('app', name), fallback);
}

function fromEnv(name, fallback) {
  return parseBoolean(process.env[name], fallback);
}

function normalizeId(value) {
  return String(value || '').trim();
}

function parseCsvSet(value) {
  if (Array.isArray(value)) {
    return new Set(value.map((row) => normalizeId(row)).filter(Boolean));
  }
  const token = String(value || '').trim();
  if (!token) return new Set();
  return new Set(
    token
      .split(',')
      .map((row) => normalizeId(row))
      .filter(Boolean)
  );
}

function readScopedIdSet(envName, appSettingName) {
  const envValue = process.env[envName];
  if (envValue !== undefined) return parseCsvSet(envValue);
  return parseCsvSet(settingService.getValue('app', appSettingName));
}

function getPhase2Flags() {
  const schoolCanonicalEnrollmentRead = fromEnv(
    'SCHOOL_CANONICAL_ENROLLMENT_READ',
    readAppFlag('schoolCanonicalEnrollmentRead', true)
  );
  const schoolCanonicalEnrollmentWrite = fromEnv(
    'SCHOOL_CANONICAL_ENROLLMENT_WRITE',
    readAppFlag('schoolCanonicalEnrollmentWrite', true)
  );
  const schoolIntentionalConflictMode = fromEnv(
    'SCHOOL_INTENTIONAL_CONFLICT_MODE',
    readAppFlag('schoolIntentionalConflictMode', false)
  );
  const schoolReadModelsEnabled = fromEnv(
    'SCHOOL_READ_MODELS_ENABLED',
    readAppFlag('schoolReadModelsEnabled', false)
  );
  const enableRollingClassWorkflow = fromEnv(
    'SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW',
    readAppFlag('enableRollingClassWorkflow', true)
  );
  const rollingWorkflowPilotOrgIds = readScopedIdSet(
    'SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS',
    'rollingWorkflowPilotOrgIds'
  );
  const rollingWorkflowPilotProgramIds = readScopedIdSet(
    'SCHOOL_ROLLING_WORKFLOW_PILOT_PROGRAM_IDS',
    'rollingWorkflowPilotProgramIds'
  );

  return {
    schoolCanonicalEnrollmentRead,
    schoolCanonicalEnrollmentWrite,
    schoolIntentionalConflictMode,
    schoolReadModelsEnabled,
    enableRollingClassWorkflow,
    rollingWorkflowPilotOrgIds,
    rollingWorkflowPilotProgramIds
  };
}

function isRollingClassWorkflowEnabledForClass({
  classRow = null,
  orgId = '',
  programId = ''
} = {}) {
  const {
    enableRollingClassWorkflow,
    rollingWorkflowPilotOrgIds,
    rollingWorkflowPilotProgramIds
  } = getPhase2Flags();

  if (!enableRollingClassWorkflow) return false;

  const orgScope = rollingWorkflowPilotOrgIds instanceof Set ? rollingWorkflowPilotOrgIds : new Set();
  const programScope = rollingWorkflowPilotProgramIds instanceof Set ? rollingWorkflowPilotProgramIds : new Set();
  if (!orgScope.size && !programScope.size) return true;

  const classOrgId = normalizeId(orgId) || normalizeId(classRow?.orgId);
  if (orgScope.size && (!classOrgId || !orgScope.has(classOrgId))) return false;

  if (!programScope.size) return true;

  const explicitProgramId = normalizeId(programId);
  if (explicitProgramId && programScope.has(explicitProgramId)) return true;

  const classProgramIds = new Set(
    (Array.isArray(classRow?.allowedProgramTerms) ? classRow.allowedProgramTerms : [])
      .map((row) => normalizeId(row?.programId))
      .filter(Boolean)
  );
  if (!classProgramIds.size) return false;

  for (const id of classProgramIds) {
    if (programScope.has(id)) return true;
  }
  return false;
}

module.exports = {
  getPhase2Flags,
  isRollingClassWorkflowEnabledForClass
};
