const adminAuthorityService = require('./adminAuthorityService');
const chatContactScopeService = require('./chatContactScopeService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { idsEqual } = require('../utils/idAdapter');

const USER_DENIED_OPERATIONS = Object.freeze([
  OPERATIONS.READ,
  OPERATIONS.READ_ALL,
  OPERATIONS.CREATE,
  OPERATIONS.UPDATE,
  OPERATIONS.DELETE,
  OPERATIONS.DELETE_ALL,
  OPERATIONS.BROADCAST,
  OPERATIONS.DOWNLOAD_FILE
]);

const REVIEW_LIST_SCOPE_MODES = Object.freeze(['department', 'division', 'organization', 'admin', 'global']);
const INBOX_SCOPE_MODES = Object.freeze(['owner', 'department', 'division', 'organization', 'admin', 'global']);
const MESSAGE_CONTENT_SCOPE_MODES = Object.freeze(['owner', 'department', 'division', 'organization', 'admin', 'global']);

const DEFAULT_UPDATE_LIMITS = Object.freeze({
  owner: { maxMessages: 15, maxFileSizeKB: 50 },
  user: { maxMessages: 15, maxFileSizeKB: 50 },
  department: { maxMessages: 100, maxFileSizeKB: 1024 },
  division: { maxMessages: 100, maxFileSizeKB: 1024 },
  organization: { maxMessages: null, maxFileSizeKB: null },
  admin: { maxMessages: null, maxFileSizeKB: null },
  global: { maxMessages: null, maxFileSizeKB: null },
  '': { maxMessages: null, maxFileSizeKB: null }
});

function buildChatOrgContext(user, orgId) {
  return {
    orgId: orgId || user?.activeOrgId || null,
    section: { id: SECTIONS.CHATS, category: 'GENERAL' }
  };
}

async function isChatAdminBypass(user, operationId, orgId) {
  if (!user) return false;
  return adminAuthorityService.isAdminForRequestAsync(
    user,
    SECTIONS.CHATS,
    operationId,
    buildChatOrgContext(user, orgId)
  );
}

function isUserScopeDenied(operationId, scopeId) {
  const mode = chatContactScopeService.normalizeChatScopeMode(scopeId);
  if (mode !== 'user') return false;
  return USER_DENIED_OPERATIONS.includes(String(operationId || '').trim());
}

function normalizeScopeMode(scopeId) {
  return chatContactScopeService.normalizeChatScopeMode(scopeId) || '';
}

function parseProfileLimitNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getUpdateLimits(scopeId, profileLimits = {}) {
  const mode = normalizeScopeMode(scopeId) || 'owner';
  const defaults = DEFAULT_UPDATE_LIMITS[mode] || DEFAULT_UPDATE_LIMITS[''];
  const attempts = parseProfileLimitNumber(profileLimits?.maxAttempts);
  const volumeKb = parseProfileLimitNumber(profileLimits?.maxVolumeKB);
  const maxMessages = attempts === null ? defaults.maxMessages : Math.max(0, Math.floor(attempts));
  const maxFileSizeKB = volumeKb === null ? defaults.maxFileSizeKB : Math.max(0, Math.floor(volumeKb));
  return {
    maxMessages: maxMessages == null ? null : Math.max(0, Math.floor(maxMessages)),
    maxFileSizeKB: maxFileSizeKB == null ? null : Math.max(0, Math.floor(maxFileSizeKB)),
    scopeMode: mode || 'owner'
  };
}

async function applyOperationPolicy({
  user,
  operationId,
  evaluation = {},
  ipAddress,
  orgId
} = {}) {
  const normalizedOperationId = String(operationId || '').trim();

  if (await isChatAdminBypass(user, normalizedOperationId, orgId || user?.activeOrgId)) {
    return {
      allowed: true,
      operationId: normalizedOperationId,
      evaluation,
      limits: evaluation.limits || {},
      scopeId: evaluation.scopeId || null,
      adminBypass: true
    };
  }

  if (!evaluation?.allowed) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: evaluation?.reason || 'Insufficient chat permissions.'
    };
  }

  if (isUserScopeDenied(normalizedOperationId, evaluation.scopeId)) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: `${normalizedOperationId} access is not available at USER scope.`
    };
  }

  return {
    allowed: true,
    operationId: normalizedOperationId,
    evaluation,
    limits: evaluation.limits || {},
    scopeId: evaluation.scopeId || null,
    adminBypass: false
  };
}

function deriveAccessFlags(evaluations = {}, adminFlags = {}) {
  const read = evaluations.read || {};
  const readAll = evaluations.readAll || {};
  const create = evaluations.create || {};
  const update = evaluations.update || {};
  const del = evaluations.del || {};
  const deleteAll = evaluations.deleteAll || {};
  const broadcast = evaluations.broadcast || {};
  const download = evaluations.download || {};

  const canReadInbox = Boolean(
    adminFlags.read
    || (read.allowed && !isUserScopeDenied(OPERATIONS.READ, read.scopeId)
      && INBOX_SCOPE_MODES.includes(normalizeScopeMode(read.scopeId)))
  );
  const canReadMessageContent = Boolean(
    adminFlags.readAll
    || (readAll.allowed && !isUserScopeDenied(OPERATIONS.READ_ALL, readAll.scopeId)
      && MESSAGE_CONTENT_SCOPE_MODES.includes(normalizeScopeMode(readAll.scopeId)))
  );
  const canManageConversationList = Boolean(
    adminFlags.read
    || (read.allowed && !isUserScopeDenied(OPERATIONS.READ, read.scopeId)
      && REVIEW_LIST_SCOPE_MODES.includes(normalizeScopeMode(read.scopeId)))
  );
  const canReviewConversationHistory = Boolean(
    adminFlags.readAll
    || (readAll.allowed && !isUserScopeDenied(OPERATIONS.READ_ALL, readAll.scopeId)
      && REVIEW_LIST_SCOPE_MODES.includes(normalizeScopeMode(readAll.scopeId)))
  );

  const canCreate = Boolean(
    adminFlags.create
    || (create.allowed && !isUserScopeDenied(OPERATIONS.CREATE, create.scopeId)
      && normalizeScopeMode(create.scopeId) !== 'user')
  );
  const canUpdate = Boolean(
    adminFlags.update
    || (update.allowed && !isUserScopeDenied(OPERATIONS.UPDATE, update.scopeId)
      && normalizeScopeMode(update.scopeId) !== 'user')
  );
  const canDelete = Boolean(
    adminFlags.delete
    || (del.allowed && !isUserScopeDenied(OPERATIONS.DELETE, del.scopeId)
      && normalizeScopeMode(del.scopeId) !== 'user')
  );
  const canDeleteAll = Boolean(
    adminFlags.deleteAll
    || (deleteAll.allowed && !isUserScopeDenied(OPERATIONS.DELETE_ALL, deleteAll.scopeId)
      && normalizeScopeMode(deleteAll.scopeId) !== 'user')
  );
  const canBroadcast = Boolean(
    adminFlags.broadcast
    || (broadcast.allowed && !isUserScopeDenied(OPERATIONS.BROADCAST, broadcast.scopeId)
      && normalizeScopeMode(broadcast.scopeId) !== 'user')
  );
  const canDownloadFile = Boolean(
    adminFlags.download
    || (download.allowed && !isUserScopeDenied(OPERATIONS.DOWNLOAD_FILE, download.scopeId)
      && normalizeScopeMode(download.scopeId) !== 'user')
  );

  return {
    canReadInbox,
    canReadMessageContent,
    canManageConversationList,
    canReviewConversationHistory,
    canRead: canReadInbox,
    canReadAll: canReadMessageContent,
    canCreate,
    canUpdate,
    canDelete,
    canDeleteAll,
    canBroadcast,
    canDownloadFile,
    readScopeId: read.scopeId || null,
    readAllScopeId: readAll.scopeId || null,
    createScopeId: create.scopeId || null,
    updateScopeId: update.scopeId || null,
    deleteScopeId: del.scopeId || deleteAll.scopeId || null,
    downloadScopeId: download.scopeId || null,
    updateLimits: adminFlags.update
      ? { maxMessages: null, maxFileSizeKB: null, scopeMode: 'global' }
      : getUpdateLimits(update.scopeId, update.limits || {}),
    canUse: Boolean(
      canReadInbox || canReadMessageContent || canCreate || canUpdate
      || canDelete || canDeleteAll || canBroadcast || canDownloadFile || canManageConversationList
    )
  };
}

async function filterConversationsForReviewList(user, conversations = [], scopeId, options = {}) {
  const rows = Array.isArray(conversations) ? conversations.filter(Boolean) : [];
  if (!rows.length) return [];

  if (options.adminBypass === true) {
    return rows;
  }

  const mode = normalizeScopeMode(scopeId);
  if (mode === 'global') return rows;

  const filtered = [];
  for (const conversation of rows) {
    // eslint-disable-next-line no-await-in-loop
    const scoped = await chatContactScopeService.getConversationScopeEligibility(user, conversation, {
      scopeId
    });
    if (scoped.allowed) filtered.push(conversation);
  }
  return filtered;
}

async function canReviewConversation(user, conversation, scopeId, options = {}) {
  if (options.adminBypass === true) {
    return { allowed: true, scopeMode: 'global' };
  }
  const mode = normalizeScopeMode(scopeId);
  if (mode === 'global') {
    return { allowed: true, scopeMode: mode };
  }
  const scoped = await chatContactScopeService.getConversationScopeEligibility(user, conversation, {
    scopeId
  });
  return {
    allowed: Boolean(scoped.allowed),
    reason: scoped.reason || 'Conversation is outside your review scope.',
    scopeMode: mode
  };
}

async function assertUpdateWithinLimits({
  user,
  conversation,
  scopeId,
  limits = {},
  pendingCount = 1,
  fileSizeBytes = 0,
  countSentMessages,
  adminBypass = false
} = {}) {
  if (adminBypass === true) {
    return { allowed: true, limits: getUpdateLimits(scopeId, limits), adminBypass: true };
  }
  const updateLimits = getUpdateLimits(scopeId, limits);
  if (updateLimits.maxFileSizeKB != null && fileSizeBytes > 0) {
    const maxBytes = updateLimits.maxFileSizeKB * 1024;
    if (fileSizeBytes > maxBytes) {
      return {
        allowed: false,
        reason: `Attachment exceeds the ${updateLimits.maxFileSizeKB} KB limit for your Update scope.`
      };
    }
  }

  if (updateLimits.maxMessages == null || typeof countSentMessages !== 'function') {
    return { allowed: true, limits: updateLimits };
  }

  const sentCount = await countSentMessages(conversation?.id, user?.id);
  if (sentCount + pendingCount > updateLimits.maxMessages) {
    return {
      allowed: false,
      reason: `Message limit reached (${updateLimits.maxMessages} messages for your Update scope).`,
      limits: updateLimits,
      sentCount
    };
  }

  return { allowed: true, limits: updateLimits, sentCount };
}

module.exports = {
  USER_DENIED_OPERATIONS,
  buildChatOrgContext,
  isChatAdminBypass,
  isUserScopeDenied,
  getUpdateLimits,
  applyOperationPolicy,
  deriveAccessFlags,
  filterConversationsForReviewList,
  canReviewConversation,
  assertUpdateWithinLimits
};
