const logRepository = require('../repositories/logRepository');
const chatContactScopeService = require('./chatContactScopeService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { toPublicId } = require('../utils/idAdapter');

function clean(value) {
  return String(value || '').trim();
}

function buildActor(user = {}) {
  return {
    userId: toPublicId(user?.id),
    username: clean(user?.username),
    displayName: clean(user?.identity?.displayName || user?.displayName || user?.name),
    orgId: clean(user?.activeOrgId)
  };
}

async function recordReviewEvent({
  user,
  ipAddress = '',
  operationId = OPERATIONS.READ_ALL,
  action = '',
  conversationId = '',
  attachmentName = '',
  scopeId = null,
  globalRead = false,
  outcome = 'success',
  details = {}
} = {}) {
  if (!user) return null;
  const actor = buildActor(user);
  const scopeMode = chatContactScopeService.normalizeChatScopeMode(scopeId) || '';
  const payload = {
    sectionId: SECTIONS.CHATS,
    operationId: clean(operationId) || OPERATIONS.READ_ALL,
    user: {
      id: actor.userId,
      username: actor.username,
      displayName: actor.displayName,
      activeOrgId: actor.orgId
    },
    status: clean(outcome) || 'success',
    details: {
      category: 'chat_review_audit',
      action: clean(action),
      conversationId: clean(conversationId),
      attachmentName: clean(attachmentName),
      scopeId: clean(scopeId),
      scopeMode,
      globalRead: globalRead === true,
      ipAddress: clean(ipAddress),
      immutable: true,
      ...details
    }
  };

  try {
    return await logRepository.create(payload);
  } catch (error) {
    console.error('[ChatReviewAudit] Failed to record review event:', error?.message || error);
    return null;
  }
}

async function auditConversationListReview(user, ipAddress, scopeId, meta = {}) {
  return recordReviewEvent({
    user,
    ipAddress,
    operationId: OPERATIONS.READ,
    action: 'conversation_management_list',
    scopeId,
    globalRead: meta.globalRead === true,
    outcome: meta.outcome || 'success',
    details: meta.details || {}
  });
}

async function auditConversationHistoryReview(user, ipAddress, conversationId, scopeId, meta = {}) {
  return recordReviewEvent({
    user,
    ipAddress,
    operationId: OPERATIONS.READ_ALL,
    action: 'conversation_history_review',
    conversationId,
    scopeId,
    globalRead: meta.globalRead === true,
    outcome: meta.outcome || 'success',
    details: meta.details || {}
  });
}

async function auditAttachmentReview(user, ipAddress, conversationId, attachmentName, scopeId, meta = {}) {
  return recordReviewEvent({
    user,
    ipAddress,
    operationId: OPERATIONS.DOWNLOAD_FILE,
    action: 'conversation_attachment_review',
    conversationId,
    attachmentName,
    scopeId,
    globalRead: meta.globalRead === true,
    outcome: meta.outcome || 'success',
    details: meta.details || {}
  });
}

module.exports = {
  recordReviewEvent,
  auditConversationListReview,
  auditConversationHistoryReview,
  auditAttachmentReview
};
