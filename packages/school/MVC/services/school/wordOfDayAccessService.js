'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const wordOfDayOperationPolicyService = require('./wordOfDayOperationPolicyService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const accessService = requireCoreModule('MVC/services/security/index');

const UPDATE_STATUSES_BY_TIER = Object.freeze({
  owner: new Set(['saved', 'reopened']),
  department: new Set(['saved', 'reopened', 'submitted']),
  division: new Set(['saved', 'reopened', 'submitted']),
  organization: new Set(['saved', 'reopened', 'submitted']),
  admin: null
});

const SUBMIT_VIA_SAVE_STATUSES_BY_TIER = Object.freeze({
  owner: new Set(['saved', 'reopened']),
  department: new Set(['saved', 'reopened', 'submitted']),
  division: new Set(['saved', 'reopened', 'submitted']),
  organization: new Set(['saved', 'reopened', 'submitted']),
  admin: null
});

const DELETE_STATUSES_BY_TIER = Object.freeze({
  owner: new Set(['saved', 'reopened']),
  department: new Set(['saved', 'reopened']),
  division: new Set(['saved', 'reopened']),
  organization: new Set(['saved', 'reopened', 'submitted']),
  admin: null
});

const RESOLVE_TRANSITIONS_BY_TIER = Object.freeze({
  owner: Object.freeze({ submitted: ['reopened'] }),
  department: Object.freeze({ submitted: ['reopened'] }),
  division: Object.freeze({ submitted: ['reopened'] }),
  organization: Object.freeze({
    submitted: ['approved', 'rejected', 'reopened'],
    approved: ['on_hold', 'archived', 'reopened'],
    rejected: ['reopened'],
    on_hold: ['approved', 'archived', 'reopened']
  }),
  admin: null
});

async function evaluateWordOfDayOperation(user, operationId, ipAddress) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required.' };
  }
  try {
    return await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_WORD_OF_DAY,
      operationId,
      ipAddress
    });
  } catch (error) {
    return {
      allowed: false,
      reason: error?.message || 'Word of Day access evaluation failed.'
    };
  }
}

async function buildWordOfDayAccess(user, ipAddress) {
  if (!user) {
    return {
      ...wordOfDayOperationPolicyService.EMPTY_ACCESS_FLAGS,
      evaluations: {},
      adminFlags: {}
    };
  }

  const opIds = [
    OPERATIONS.READ,
    OPERATIONS.READ_ALL,
    OPERATIONS.CREATE,
    OPERATIONS.UPDATE,
    OPERATIONS.RESOLVE,
    OPERATIONS.DELETE,
    OPERATIONS.CONFIGURE
  ];
  const evals = await Promise.all(
    opIds.map((operationId) => evaluateWordOfDayOperation(user, operationId, ipAddress))
  );
  const [read, readAll, create, update, resolveEval, del, configure] = evals;

  const policies = await Promise.all([
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ, evaluation: read }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ_ALL, evaluation: readAll }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CREATE, evaluation: create }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPDATE, evaluation: update }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.RESOLVE, evaluation: resolveEval }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE, evaluation: del }),
    wordOfDayOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CONFIGURE, evaluation: configure })
  ]);

  const adminFlags = {
    read: policies[0].adminBypass === true,
    readAll: policies[1].adminBypass === true,
    create: policies[2].adminBypass === true,
    update: policies[3].adminBypass === true,
    resolve: policies[4].adminBypass === true,
    delete: policies[5].adminBypass === true,
    configure: policies[6].adminBypass === true
  };

  const evaluations = {
    read: { ...read, allowed: policies[0].allowed, scopeId: policies[0].scopeId || read.scopeId },
    readAll: { ...readAll, allowed: policies[1].allowed, scopeId: policies[1].scopeId || readAll.scopeId },
    create: { ...create, allowed: policies[2].allowed, scopeId: policies[2].scopeId || create.scopeId },
    update: { ...update, allowed: policies[3].allowed, scopeId: policies[3].scopeId || update.scopeId },
    resolve: { ...resolveEval, allowed: policies[4].allowed, scopeId: policies[4].scopeId || resolveEval.scopeId },
    del: { ...del, allowed: policies[5].allowed, scopeId: policies[5].scopeId || del.scopeId },
    configure: { ...configure, allowed: policies[6].allowed, scopeId: policies[6].scopeId || configure.scopeId }
  };

  const flags = wordOfDayOperationPolicyService.deriveAccessFlags(evaluations, adminFlags);
  return { ...flags, evaluations, adminFlags };
}

function entryYear(row) {
  const ts = String(row?.audit?.createDateTime || '').trim();
  return ts.length >= 4 ? ts.slice(0, 4) : '';
}

function isOwnerRow(row, actorId) {
  const actor = toPublicId(actorId);
  return idsEqual(row?.authorUserId, actor) || idsEqual(row?.audit?.createdBy, actor);
}

function effectiveTier(access, operationKey) {
  const flagKey = operationKey === 'del' ? 'delete' : operationKey;
  if (access?.adminFlags?.[flagKey]) return 'admin';
  const scopeKeyByOp = {
    read: 'readScopeId',
    readAll: 'readAllScopeId',
    create: 'createScopeId',
    update: 'updateScopeId',
    resolve: 'resolveScopeId',
    del: 'deleteScopeId',
    delete: 'deleteScopeId',
    configure: 'configureScopeId'
  };
  const scopeId = access?.[scopeKeyByOp[operationKey]]
    || access?.evaluations?.[operationKey]?.scopeId;
  return wordOfDayOperationPolicyService.normalizeScopeMode(scopeId) || '';
}

function rowVisibleInList(row, access, actorId, currentYear, view = 'active') {
  if (!access?.canViewEntries && !access?.adminFlags?.readAll) return false;
  if (access?.adminFlags?.readAll) {
    const status = String(row?.status || '').toLowerCase();
    if (view === 'archived') return status === 'archived';
    return view !== 'archived' ? status !== 'archived' : false;
  }
  const tier = effectiveTier(access, 'readAll');
  const status = String(row?.status || '').toLowerCase();
  if (view === 'archived') {
    return tier === 'organization' || tier === 'admin' ? status === 'archived' : false;
  }
  if (status === 'archived') return false;
  if (tier === 'organization' || tier === 'admin') return true;
  if (tier === 'department' || tier === 'division') return entryYear(row) === String(currentYear);
  if (tier === 'owner') return isOwnerRow(row, actorId);
  return false;
}

function assertRowVisible(row, access, actorId, currentYear) {
  const view = String(row?.status || '').toLowerCase() === 'archived' ? 'archived' : 'active';
  if (!rowVisibleInList(row, access, actorId, currentYear, view)) {
    const error = new Error('Word of Day entry was not found.');
    error.statusCode = 404;
    throw error;
  }
}

function statusAllowedForTier(status, tier, map) {
  if (tier === 'admin') return true;
  const allowed = map[tier];
  if (!allowed) return false;
  return allowed.has(String(status || '').toLowerCase());
}

function canUpdateEntry(row, access, actorId, currentYear) {
  if (!access?.canUpdateWords && !access?.adminFlags?.update) return false;
  if (!rowVisibleInList(row, access, actorId, currentYear, String(row?.status || '').toLowerCase() === 'archived' ? 'archived' : 'active')) return false;
  if (access?.adminFlags?.update) return true;
  const tier = effectiveTier(access, 'update');
  const status = String(row?.status || '').toLowerCase();
  if (tier === 'owner' && !isOwnerRow(row, actorId)) return false;
  if ((tier === 'department' || tier === 'division') && entryYear(row) !== String(currentYear)) return false;
  return statusAllowedForTier(status, tier, UPDATE_STATUSES_BY_TIER);
}

function canSubmitEntryViaSave(row, access, actorId, currentYear) {
  if (!canUpdateEntry(row, access, actorId, currentYear)) return false;
  const status = String(row?.status || '').toLowerCase();
  if (status === 'archived') return false;
  if (access?.adminFlags?.update) return true;
  const tier = effectiveTier(access, 'update');
  if (tier === 'admin') return true;
  if (tier === 'owner' && !isOwnerRow(row, actorId)) return false;
  if ((tier === 'department' || tier === 'division') && entryYear(row) !== String(currentYear)) return false;
  return statusAllowedForTier(status, tier, SUBMIT_VIA_SAVE_STATUSES_BY_TIER);
}

function canDeleteEntry(row, access, actorId, currentYear) {
  if (!access?.canDeleteWords && !access?.adminFlags?.delete) return false;
  if (!rowVisibleInList(row, access, actorId, currentYear, 'active') && String(row?.status || '').toLowerCase() !== 'archived') return false;
  if (access?.adminFlags?.delete) return true;
  const tier = effectiveTier(access, 'delete');
  const status = String(row?.status || '').toLowerCase();
  if (tier === 'owner' && !isOwnerRow(row, actorId)) return false;
  if ((tier === 'department' || tier === 'division') && entryYear(row) !== String(currentYear)) return false;
  return statusAllowedForTier(status, tier, DELETE_STATUSES_BY_TIER);
}

function canResolveTransition(row, targetStatus, access, actorId, currentYear) {
  if (!access?.canResolveWords && !access?.adminFlags?.resolve) return false;
  if (!row) return false;
  const from = String(row?.status || '').toLowerCase();
  const to = String(targetStatus || '').toLowerCase();
  if (!from || !to || from === to) return false;
  if (!rowVisibleInList(row, access, actorId, currentYear, from === 'archived' ? 'archived' : 'active')) return false;
  if (access?.adminFlags?.resolve) return true;
  const tier = effectiveTier(access, 'resolve');
  if (tier === 'owner' && !isOwnerRow(row, actorId)) return false;
  if ((tier === 'department' || tier === 'division') && entryYear(row) !== String(currentYear)) return false;
  const table = RESOLVE_TRANSITIONS_BY_TIER[tier];
  if (!table) return false;
  const allowedTargets = table[from];
  return Array.isArray(allowedTargets) && allowedTargets.includes(to);
}

function hasDisplayHistory(row) {
  return Number(row?.display?.displayCount || 0) > 0;
}

function assertDisplayRiskAcknowledged(row, targetStatus, options = {}) {
  if (!hasDisplayHistory(row)) return;
  const to = String(targetStatus || '').toLowerCase();
  const risky = ['reopened', 'submitted', 'archived'].includes(to);
  if (!risky && options.forDelete !== true) return;
  if (options.confirmDisplayRisk === true) return;
  const error = new Error('This word has been displayed. Confirm to continue.');
  error.statusCode = 409;
  error.code = 'WORD_OF_DAY_DISPLAY_WARNING';
  throw error;
}

async function userCanConfigureWordOfDay(user, ipAddress) {
  const access = await buildWordOfDayAccess(user, ipAddress);
  return Boolean(access.canConfigureDisplay);
}

async function getWordOfDayAccessForRequest(req) {
  if (req._wordOfDayAccess) return req._wordOfDayAccess;
  const access = await buildWordOfDayAccess(req.user, req.ip);
  req._wordOfDayAccess = access;
  return access;
}

module.exports = {
  evaluateWordOfDayOperation,
  buildWordOfDayAccess,
  getWordOfDayAccessForRequest,
  userCanConfigureWordOfDay,
  rowVisibleInList,
  assertRowVisible,
  canUpdateEntry,
  canSubmitEntryViaSave,
  canDeleteEntry,
  canResolveTransition,
  hasDisplayHistory,
  assertDisplayRiskAcknowledged,
  entryYear,
  isOwnerRow,
  UPDATE_STATUSES_BY_TIER,
  DELETE_STATUSES_BY_TIER,
  RESOLVE_TRANSITIONS_BY_TIER
};