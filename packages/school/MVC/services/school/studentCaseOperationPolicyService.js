'use strict';

const schoolAdminAccessService = require('./schoolAdminAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const KNOWN_SCOPE_MODE_BY_ID = Object.freeze({
  SCP_ADMIN: 'admin',
  SCP_ORG: 'organization',
  SCP_DEPT: 'department',
  SCP_DIV: 'division',
  SCP_OWNER: 'owner',
  SCP_USER: 'user'
});

const KNOWN_SCOPE_MODE_BY_NAME = Object.freeze({
  ADMIN: 'admin',
  ORGANIZATION: 'organization',
  ORG: 'organization',
  DEPARTMENT: 'department',
  DEPT: 'department',
  DIVISION: 'division',
  DIV: 'division',
  OWNER: 'owner',
  USER: 'user',
  GLOBAL: 'global'
});

const READ_SCOPES = Object.freeze(['owner', 'department', 'division', 'organization', 'admin', 'global']);
const READ_ALL_SCOPES = Object.freeze(['owner', 'department', 'division', 'organization', 'admin', 'global']);
const MUTATION_SCOPES = Object.freeze(['owner', 'department', 'division', 'organization', 'admin', 'global']);

const EMPTY_ACCESS_FLAGS = Object.freeze({
  canOpenList: false,
  canViewCases: false,
  canCreateCases: false,
  canUpdateCases: false,
  canResolveCases: false,
  canDeleteCases: false,
  canConfigureRouting: false,
  canOverrideLockedCaseEdit: false,
  canOverrideLockedCaseDelete: false,
  isStudentCaseAdminViewer: false,
  readScopeId: null,
  readAllScopeId: null,
  createScopeId: null,
  updateScopeId: null,
  resolveScopeId: null,
  deleteScopeId: null,
  configureScopeId: null
});

function normalizeScopeMode(scopeId = '') {
  const token = String(scopeId || '').trim();
  if (!token) return '';
  const known = KNOWN_SCOPE_MODE_BY_ID[token] || KNOWN_SCOPE_MODE_BY_NAME[token.toUpperCase()];
  if (known) return known;
  const upper = token.toUpperCase();
  if (upper.includes('ADMIN')) return 'admin';
  if (upper.includes('ORG')) return 'organization';
  if (upper.includes('DEPT')) return 'department';
  if (upper.includes('DIV')) return 'division';
  if (upper.includes('OWNER')) return 'owner';
  if (upper.includes('USER')) return 'user';
  return '';
}

function scopeInList(scopeId, allowedModes = []) {
  const mode = normalizeScopeMode(scopeId);
  return Boolean(mode && allowedModes.includes(mode));
}

function isUserScope(scopeId) {
  return normalizeScopeMode(scopeId) === 'user';
}

function buildStudentCaseOrgContext(user) {
  return {
    orgId: user?.activeOrgId || null,
    section: { id: SECTIONS.SCHOOL_SESSION_STUDENT_CASES, category: 'SCHOOL' }
  };
}

async function isStudentCaseAdminBypass(user, operationId) {
  if (!user) return false;
  return schoolAdminAccessService.isAdminForRequestAsync(
    user,
    SECTIONS.SCHOOL_SESSION_STUDENT_CASES,
    operationId,
    buildStudentCaseOrgContext(user)
  );
}

async function applyOperationPolicy({
  user,
  operationId,
  evaluation = {},
  sectionId = SECTIONS.SCHOOL_SESSION_STUDENT_CASES
} = {}) {
  const normalizedOperationId = String(operationId || '').trim();
  const evalSectionId = String(sectionId || SECTIONS.SCHOOL_SESSION_STUDENT_CASES).trim();

  if (evalSectionId === SECTIONS.SCHOOL_SESSION_STUDENT_CASES
    && await isStudentCaseAdminBypass(user, normalizedOperationId)) {
    return {
      allowed: true,
      operationId: normalizedOperationId,
      evaluation,
      scopeId: evaluation.scopeId || null,
      adminBypass: true,
      sectionId: evalSectionId
    };
  }

  if (!evaluation?.allowed) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: evaluation?.reason || 'Insufficient student case permissions.',
      sectionId: evalSectionId
    };
  }

  if (isUserScope(evaluation.scopeId)) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: `${normalizedOperationId} access is not available at USER scope.`,
      sectionId: evalSectionId
    };
  }

  return {
    allowed: true,
    operationId: normalizedOperationId,
    evaluation,
    scopeId: evaluation.scopeId || null,
    adminBypass: false,
    sectionId: evalSectionId
  };
}

function canReadAtScope(scopeId) {
  return scopeInList(scopeId, READ_SCOPES);
}

function canReadAllAtScope(scopeId) {
  return scopeInList(scopeId, READ_ALL_SCOPES);
}

function canMutateAtScope(scopeId) {
  return scopeInList(scopeId, MUTATION_SCOPES);
}

function canConfigureAtScope(scopeId) {
  return normalizeScopeMode(scopeId) === 'admin';
}

function canOverrideLockedAtScope(scopeId) {
  return normalizeScopeMode(scopeId) === 'admin';
}

function deriveAccessFlags(evaluations = {}, adminFlags = {}) {
  const read = evaluations.read || {};
  const readAll = evaluations.readAll || {};
  const create = evaluations.create || {};
  const update = evaluations.update || {};
  const resolveEval = evaluations.resolve || {};
  const del = evaluations.del || {};
  const configure = evaluations.configure || {};

  const readAllowed = Boolean(adminFlags.read || read.allowed);
  const readAllAllowed = Boolean(adminFlags.readAll || readAll.allowed);
  const createAllowed = Boolean(adminFlags.create || create.allowed);
  const updateAllowed = Boolean(adminFlags.update || update.allowed);
  const resolveAllowed = Boolean(adminFlags.resolve || resolveEval.allowed);
  const deleteAllowed = Boolean(adminFlags.delete || del.allowed);
  const configureAllowed = Boolean(adminFlags.configure || configure.allowed);

  const canOpenList = Boolean(
    adminFlags.read
    || (readAllowed && canReadAtScope(read.scopeId))
  );
  const canViewCases = Boolean(
    adminFlags.readAll
    || (readAllAllowed && canReadAllAtScope(readAll.scopeId))
  );
  const canCreateCases = Boolean(
    adminFlags.create
    || (createAllowed && canMutateAtScope(create.scopeId))
  );
  const canUpdateCases = Boolean(
    adminFlags.update
    || (updateAllowed && canMutateAtScope(update.scopeId))
  );
  const canResolveCases = Boolean(
    adminFlags.resolve
    || (resolveAllowed && canMutateAtScope(resolveEval.scopeId))
  );
  const canDeleteCases = Boolean(
    adminFlags.delete
    || (deleteAllowed && canMutateAtScope(del.scopeId))
  );
  const canConfigureRouting = Boolean(
    adminFlags.configure
    || (configureAllowed && canConfigureAtScope(configure.scopeId))
  );
  const canOverrideLockedCaseEdit = Boolean(
    adminFlags.update
    || (updateAllowed && canOverrideLockedAtScope(update.scopeId))
  );
  const canOverrideLockedCaseDelete = Boolean(
    adminFlags.delete
    || (deleteAllowed && canOverrideLockedAtScope(del.scopeId))
  );
  const isStudentCaseAdminViewer = Boolean(
    adminFlags.readAll || adminFlags.update || adminFlags.read || adminFlags.configure
  );

  return {
    canOpenList,
    canViewCases,
    canCreateCases,
    canUpdateCases,
    canResolveCases,
    canDeleteCases,
    canConfigureRouting,
    canOverrideLockedCaseEdit,
    canOverrideLockedCaseDelete,
    isStudentCaseAdminViewer,
    readScopeId: read.scopeId || null,
    readAllScopeId: readAll.scopeId || null,
    createScopeId: create.scopeId || null,
    updateScopeId: update.scopeId || null,
    resolveScopeId: resolveEval.scopeId || null,
    deleteScopeId: del.scopeId || null,
    configureScopeId: configure.scopeId || null
  };
}

module.exports = {
  EMPTY_ACCESS_FLAGS,
  READ_SCOPES,
  READ_ALL_SCOPES,
  MUTATION_SCOPES,
  applyOperationPolicy,
  deriveAccessFlags,
  normalizeScopeMode,
  canReadAtScope,
  canReadAllAtScope,
  canMutateAtScope,
  canConfigureAtScope,
  canOverrideLockedAtScope,
  isStudentCaseAdminBypass,
  buildStudentCaseOrgContext
};
