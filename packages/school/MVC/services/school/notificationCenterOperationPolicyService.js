'use strict';

const schoolAdminAccessService = require('./schoolAdminAccessService');
const { SECTIONS } = require('../../../config/accessConstants');

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
const RUN_NOW_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const RULE_METADATA_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const CONFIGURE_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const DISPATCH_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const DELETE_OUTBOX_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const DELETE_RUNS_SCOPES = Object.freeze(['organization', 'admin', 'global']);

const EMPTY_ACCESS_FLAGS = Object.freeze({
  canOpen: false,
  canViewRuleMetadata: false,
  canViewRuns: false,
  canRunNow: false,
  canConfigure: false,
  canDispatch: false,
  canDeleteRuns: false,
  canDeleteOutbox: false,
  isAdminViewer: false,
  readScopeId: null,
  readAllScopeId: null,
  updateScopeId: null,
  configureScopeId: null,
  uploadScopeId: null,
  deleteScopeId: null
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

function buildNotificationCenterOrgContext(user) {
  return {
    orgId: user?.activeOrgId || null,
    section: { id: SECTIONS.SCHOOL_NOTIFICATION_CENTER, category: 'SCHOOL' }
  };
}

async function isNotificationCenterAdminBypass(user, operationId) {
  if (!user) return false;
  return schoolAdminAccessService.isAdminForRequestAsync(
    user,
    SECTIONS.SCHOOL_NOTIFICATION_CENTER,
    operationId,
    buildNotificationCenterOrgContext(user)
  );
}

async function applyOperationPolicy({
  user,
  operationId,
  evaluation = {},
  sectionId = SECTIONS.SCHOOL_NOTIFICATION_CENTER
} = {}) {
  const normalizedOperationId = String(operationId || '').trim();
  const evalSectionId = String(sectionId || SECTIONS.SCHOOL_NOTIFICATION_CENTER).trim();

  if (evalSectionId === SECTIONS.SCHOOL_NOTIFICATION_CENTER
    && await isNotificationCenterAdminBypass(user, normalizedOperationId)) {
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
      reason: evaluation?.reason || 'Insufficient notification centre permissions.',
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

function deriveAccessFlags(evaluations = {}, adminFlags = {}) {
  const read = evaluations.read || {};
  const readAll = evaluations.readAll || {};
  const update = evaluations.update || {};
  const configure = evaluations.configure || {};
  const upload = evaluations.upload || {};
  const del = evaluations.del || {};

  const readAllowed = Boolean(adminFlags.read || read.allowed);
  const readAllAllowed = Boolean(adminFlags.readAll || readAll.allowed);
  const updateAllowed = Boolean(adminFlags.update || update.allowed);
  const configureAllowed = Boolean(adminFlags.configure || configure.allowed);
  const uploadAllowed = Boolean(adminFlags.upload || upload.allowed);
  const deleteAllowed = Boolean(adminFlags.delete || del.allowed);

  const canOpen = Boolean(
    adminFlags.read
    || (readAllowed && scopeInList(read.scopeId, READ_SCOPES))
  );
  const canViewRuns = Boolean(
    adminFlags.readAll
    || (readAllAllowed && scopeInList(readAll.scopeId, READ_ALL_SCOPES))
  );
  const canViewRuleMetadata = Boolean(
    adminFlags.readAll
    || (readAllAllowed && scopeInList(readAll.scopeId, RULE_METADATA_SCOPES))
  );
  const canRunNow = Boolean(
    adminFlags.update
    || (updateAllowed && scopeInList(update.scopeId, RUN_NOW_SCOPES))
  );
  const canConfigure = Boolean(
    adminFlags.configure
    || (configureAllowed && scopeInList(configure.scopeId, CONFIGURE_SCOPES))
  );
  const canDispatch = Boolean(
    adminFlags.upload
    || (uploadAllowed && scopeInList(upload.scopeId, DISPATCH_SCOPES))
  );
  const canDeleteOutbox = Boolean(
    adminFlags.delete
    || (deleteAllowed && scopeInList(del.scopeId, DELETE_OUTBOX_SCOPES))
  );
  const canDeleteRuns = Boolean(
    adminFlags.delete
    || (deleteAllowed && scopeInList(del.scopeId, DELETE_RUNS_SCOPES))
  );
  const isAdminViewer = Boolean(adminFlags.readAll || adminFlags.read || adminFlags.configure);

  return {
    canOpen,
    canViewRuleMetadata,
    canViewRuns,
    canRunNow,
    canConfigure,
    canDispatch,
    canDeleteRuns,
    canDeleteOutbox,
    isAdminViewer,
    readScopeId: read.scopeId || null,
    readAllScopeId: readAll.scopeId || null,
    updateScopeId: update.scopeId || null,
    configureScopeId: configure.scopeId || null,
    uploadScopeId: upload.scopeId || null,
    deleteScopeId: del.scopeId || null
  };
}

module.exports = {
  EMPTY_ACCESS_FLAGS,
  applyOperationPolicy,
  deriveAccessFlags,
  normalizeScopeMode,
  isNotificationCenterAdminBypass,
  buildNotificationCenterOrgContext
};
