const accessService = require('./security/index');
const adminAuthorityService = require('./adminAuthorityService');
const chatContactScopeService = require('./chatContactScopeService');
const chatOperationPolicyService = require('./chatOperationPolicyService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const CHAT_OPERATION_GROUPS = Object.freeze({
  READ_CONVERSATION: Object.freeze([OPERATIONS.READ, OPERATIONS.READ_ALL]),
  READ_INBOX: Object.freeze([OPERATIONS.READ]),
  READ_MESSAGE_CONTENT: Object.freeze([OPERATIONS.READ_ALL]),
  WRITE_CONVERSATION: Object.freeze([OPERATIONS.UPDATE]),
  DELETE_CONVERSATION: Object.freeze([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL]),
  READ_ALL_CONVERSATIONS: Object.freeze([OPERATIONS.READ_ALL]),
  REVIEW_CONVERSATION_LIST: Object.freeze([OPERATIONS.READ]),
  GLOBAL_MANAGE: Object.freeze([OPERATIONS.DELETE_ALL]),
  BROADCAST: Object.freeze([OPERATIONS.BROADCAST]),
  DOWNLOAD_ATTACHMENT: Object.freeze([OPERATIONS.DOWNLOAD_FILE])
});

const EMPTY_CHAT_ACCESS = Object.freeze({
  canRead: false,
  canReadAll: false,
  canReadInbox: false,
  canReadMessageContent: false,
  canManageConversationList: false,
  canReviewConversationHistory: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canDeleteAll: false,
  canBroadcast: false,
  canDownloadFile: false,
  canUse: false,
  readScopeId: null,
  readAllScopeId: null,
  createScopeId: null,
  updateScopeId: null,
  deleteScopeId: null,
  downloadScopeId: null,
  updateLimits: Object.freeze({ maxMessages: null, maxFileSizeKB: null, scopeMode: 'owner' })
});

function normalizeOperations(operationIds) {
  const source = Array.isArray(operationIds) ? operationIds : [operationIds];
  return source.map((op) => String(op || '').trim()).filter(Boolean);
}

async function evaluateOperation(user, operationId, ipAddress) {
  if (!user) {
    return {
      allowed: false,
      reason: 'Authentication required.'
    };
  }

  try {
    return await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.CHATS,
      operationId,
      ipAddress
    });
  } catch (error) {
    return {
      allowed: false,
      reason: error?.message || 'Chat access evaluation failed.'
    };
  }
}

async function canUseChatOperation(user, operationIds, ipAddress) {
  const operations = normalizeOperations(operationIds);
  if (!operations.length) {
    return {
      allowed: false,
      operationId: '',
      reason: 'No chat operation configured.'
    };
  }

  let lastEvaluation = null;
  for (const operationId of operations) {
    // eslint-disable-next-line no-await-in-loop
    const evaluation = await evaluateOperation(user, operationId, ipAddress);
    // eslint-disable-next-line no-await-in-loop
    const policy = await chatOperationPolicyService.applyOperationPolicy({
      user,
      operationId,
      evaluation,
      ipAddress,
      orgId: user?.activeOrgId
    });
    if (policy.allowed) {
      return {
        allowed: true,
        operationId,
        evaluation: policy.evaluation || evaluation,
        limits: policy.limits || evaluation.limits || {},
        scopeId: policy.scopeId || evaluation.scopeId || null,
        adminBypass: policy.adminBypass === true
      };
    }
    lastEvaluation = policy;
  }

  return {
    allowed: false,
    operationId: operations[0],
    evaluation: lastEvaluation?.evaluation || lastEvaluation,
    reason: lastEvaluation?.reason || lastEvaluation?.evaluation?.reason || 'Insufficient chat permissions.'
  };
}

async function buildChatAccess(user, ipAddress) {
  if (!user) return { ...EMPTY_CHAT_ACCESS };

  const [
    read,
    readAll,
    create,
    update,
    del,
    deleteAll,
    broadcast,
    download
  ] = await Promise.all([
    evaluateOperation(user, OPERATIONS.READ, ipAddress),
    evaluateOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.CREATE, ipAddress),
    evaluateOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateOperation(user, OPERATIONS.DELETE, ipAddress),
    evaluateOperation(user, OPERATIONS.DELETE_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.BROADCAST, ipAddress),
    evaluateOperation(user, OPERATIONS.DOWNLOAD_FILE, ipAddress)
  ]);

  const [
    readPolicy,
    readAllPolicy,
    createPolicy,
    updatePolicy,
    deletePolicy,
    deleteAllPolicy,
    broadcastPolicy,
    downloadPolicy
  ] = await Promise.all([
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ, evaluation: read, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ_ALL, evaluation: readAll, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CREATE, evaluation: create, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPDATE, evaluation: update, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE, evaluation: del, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE_ALL, evaluation: deleteAll, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.BROADCAST, evaluation: broadcast, ipAddress }),
    chatOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DOWNLOAD_FILE, evaluation: download, ipAddress })
  ]);

  const adminFlags = {
    read: readPolicy.adminBypass === true,
    readAll: readAllPolicy.adminBypass === true,
    create: createPolicy.adminBypass === true,
    update: updatePolicy.adminBypass === true,
    delete: deletePolicy.adminBypass === true,
    deleteAll: deleteAllPolicy.adminBypass === true,
    broadcast: broadcastPolicy.adminBypass === true,
    download: downloadPolicy.adminBypass === true
  };

  return chatOperationPolicyService.deriveAccessFlags({
    read: { ...read, allowed: readPolicy.allowed, scopeId: readPolicy.scopeId || read.scopeId },
    readAll: { ...readAll, allowed: readAllPolicy.allowed, scopeId: readAllPolicy.scopeId || readAll.scopeId },
    create: { ...create, allowed: createPolicy.allowed, scopeId: createPolicy.scopeId || create.scopeId },
    update: {
      ...update,
      allowed: updatePolicy.allowed,
      scopeId: updatePolicy.scopeId || update.scopeId,
      limits: updatePolicy.limits || update.limits || {}
    },
    del: { ...del, allowed: deletePolicy.allowed, scopeId: deletePolicy.scopeId || del.scopeId },
    deleteAll: { ...deleteAll, allowed: deleteAllPolicy.allowed, scopeId: deleteAllPolicy.scopeId || deleteAll.scopeId },
    broadcast: { ...broadcast, allowed: broadcastPolicy.allowed, scopeId: broadcastPolicy.scopeId || broadcast.scopeId },
    download: { ...download, allowed: downloadPolicy.allowed, scopeId: downloadPolicy.scopeId || download.scopeId }
  }, adminFlags);
}

function conversationHasParticipant(conversation, userId) {
  const normalizedUserId = toPublicId(userId);
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  if (!normalizedUserId || !participants.length) return false;
  return participants.some((participant) => idsEqual(participant?.userId || participant, normalizedUserId));
}

async function isGlobalChatAdmin(user, ipAddress) {
  if (!user) return false;
  if (await chatOperationPolicyService.isChatAdminBypass(user, OPERATIONS.DELETE_ALL, user.activeOrgId)) return true;
  const deleteAll = await canUseChatOperation(user, OPERATIONS.DELETE_ALL, ipAddress);
  return Boolean(deleteAll?.allowed);
}

async function isChatBroadcastAdmin(user, ipAddress) {
  if (!user) return false;
  if (await chatOperationPolicyService.isChatAdminBypass(user, OPERATIONS.BROADCAST, user.activeOrgId)) return true;
  const broadcast = await canUseChatOperation(user, CHAT_OPERATION_GROUPS.BROADCAST, ipAddress);
  return Boolean(broadcast?.allowed);
}

async function canReadAllConversations(user, ipAddress) {
  const result = await canUseChatOperation(user, CHAT_OPERATION_GROUPS.READ_ALL_CONVERSATIONS, ipAddress);
  if (result.allowed) {
    return {
      ...result,
      globalRead: chatContactScopeService.normalizeChatScopeMode(result.scopeId) === 'global'
        || result.adminBypass === true
    };
  }
  return {
    ...result,
    reason: result.reason || 'Global conversation list access requires READ_ALL chat access.'
  };
}

async function canManageConversationReviewList(user, ipAddress) {
  const result = await canUseChatOperation(user, CHAT_OPERATION_GROUPS.REVIEW_CONVERSATION_LIST, ipAddress);
  if (!result.allowed) {
    return {
      ...result,
      reason: result.reason || 'Conversation management list access requires READ chat access.'
    };
  }
  const scopeMode = chatContactScopeService.normalizeChatScopeMode(result.scopeId);
  if (!['department', 'division', 'organization', 'admin', 'global'].includes(scopeMode) && result.adminBypass !== true) {
    return {
      allowed: false,
      operationId: result.operationId,
      reason: 'Conversation management list access requires READ at DEPARTMENT scope or broader.'
    };
  }
  return result;
}

async function canAccessConversation({
  user,
  conversation,
  operationIds = CHAT_OPERATION_GROUPS.READ_CONVERSATION,
  ipAddress,
  allowGlobalAdmin = false,
  requireMessageContent = false
} = {}) {
  const normalizedOps = normalizeOperations(operationIds);
  const wantsMessageContent = requireMessageContent || normalizedOps.includes(OPERATIONS.READ_ALL);

  const effectiveOps = wantsMessageContent
    ? CHAT_OPERATION_GROUPS.READ_MESSAGE_CONTENT
    : (normalizedOps.includes(OPERATIONS.READ)
      ? CHAT_OPERATION_GROUPS.READ_INBOX
      : normalizedOps);

  const operationResult = await canUseChatOperation(user, effectiveOps, ipAddress);
  if (!operationResult.allowed) return operationResult;

  const isParticipant = conversationHasParticipant(conversation, user?.id);

  if (isParticipant) {
    if (wantsMessageContent && operationResult.operationId !== OPERATIONS.READ_ALL && operationResult.adminBypass !== true) {
      return {
        allowed: false,
        operationId: operationResult.operationId,
        reason: 'Message content requires READ_ALL chat access.'
      };
    }
    if (operationResult.operationId === OPERATIONS.UPDATE) {
      const contactAccess = await chatContactScopeService.getConversationMessagingEligibility(
        user,
        conversation,
        { scopeId: operationResult.scopeId }
      );
      if (!contactAccess.canMessage) {
        return {
          allowed: false,
          operationId: operationResult.operationId,
          participant: true,
          globalAdmin: false,
          contactAccess,
          reason: contactAccess.reason || 'This conversation is read-only.'
        };
      }
    }
    return {
      ...operationResult,
      participant: true,
      globalAdmin: false,
      contactAccess: operationResult.operationId === OPERATIONS.UPDATE
        ? { canMessage: true, reason: '' }
        : null
    };
  }

  if (allowGlobalAdmin) {
    const readAllAccess = await canUseChatOperation(user, OPERATIONS.READ_ALL, ipAddress);
    if (!readAllAccess.allowed) {
      return {
        allowed: false,
        operationId: operationResult.operationId,
        reason: 'Conversation is outside your chat access scope.'
      };
    }
    const review = await chatOperationPolicyService.canReviewConversation(
      user,
      conversation,
      readAllAccess.scopeId,
      { adminBypass: readAllAccess.adminBypass === true }
    );
    if (!review.allowed && readAllAccess.adminBypass !== true) {
      return {
        allowed: false,
        operationId: readAllAccess.operationId,
        reason: review.reason || 'Conversation is outside your review scope.'
      };
    }
    return {
      ...readAllAccess,
      participant: false,
      globalAdmin: readAllAccess.adminBypass === true,
      globalRead: true
    };
  }

  return {
    allowed: false,
    operationId: operationResult.operationId,
    reason: 'Conversation is outside your chat access scope.'
  };
}

async function canDownloadConversationAttachment(user, conversation, ipAddress) {
  const downloadAccess = await canUseChatOperation(
    user,
    CHAT_OPERATION_GROUPS.DOWNLOAD_ATTACHMENT,
    ipAddress
  );
  if (!downloadAccess.allowed) return downloadAccess;

  const readAccess = await canAccessConversation({
    user,
    conversation,
    operationIds: CHAT_OPERATION_GROUPS.READ_MESSAGE_CONTENT,
    ipAddress,
    allowGlobalAdmin: true,
    requireMessageContent: true
  });
  if (!readAccess.allowed) {
    return {
      ...readAccess,
      operationId: OPERATIONS.DOWNLOAD_FILE,
      downloadAccess,
      reason: readAccess.reason || 'Conversation is outside your chat access scope.'
    };
  }

  return {
    ...downloadAccess,
    participant: readAccess.participant === true,
    globalAdmin: readAccess.globalAdmin === true,
    globalRead: readAccess.globalRead === true,
    readAccess
  };
}

async function canDeleteConversation(user, conversation, ipAddress) {
  if (!conversation) {
    return {
      allowed: false,
      reason: 'Conversation not found.'
    };
  }

  const isParticipant = conversationHasParticipant(conversation, user?.id);

  const globalDelete = await canUseChatOperation(user, OPERATIONS.DELETE_ALL, ipAddress);
  const globalAdmin = globalDelete.allowed ? await isGlobalChatAdmin(user, ipAddress) : false;
  if (globalDelete.allowed && globalAdmin) {
    return {
      ...globalDelete,
      participant: isParticipant,
      globalAdmin: true
    };
  }

  const ownDelete = await canUseChatOperation(user, OPERATIONS.DELETE, ipAddress);
  if (ownDelete.allowed) {
    const scopeMode = chatContactScopeService.normalizeChatScopeMode(ownDelete.scopeId) || 'owner';
    if ((scopeMode === 'owner' || scopeMode === 'user') && ownDelete.adminBypass !== true) {
      return {
        allowed: false,
        reason: 'Your Delete scope allows deleting only your own messages, not the whole conversation.'
      };
    }
    if (scopeMode === 'global' || ownDelete.adminBypass === true) {
      return { ...ownDelete, participant: isParticipant, globalAdmin: true, scopeMode: 'global' };
    }
    if (['department', 'division', 'organization', 'admin'].includes(scopeMode)) {
      const scoped = await chatContactScopeService.getConversationScopeEligibility(user, conversation, {
        scopeId: ownDelete.scopeId
      });
      if (scoped.allowed) {
        return { ...ownDelete, participant: isParticipant, globalAdmin: false, scopeMode };
      }
    }
  }

  return {
    allowed: false,
    reason: 'You do not have permission to delete this conversation.'
  };
}

async function canDeleteMessages(user, conversation, messages = [], ipAddress) {
  if (!conversation) return { allowed: false, reason: 'Conversation not found.' };
  const rows = (Array.isArray(messages) ? messages : []).filter(Boolean);
  if (!rows.length) return { allowed: false, reason: 'Select at least one message.' };

  const globalDelete = await canUseChatOperation(user, OPERATIONS.DELETE_ALL, ipAddress);
  if (globalDelete.allowed && await isGlobalChatAdmin(user, ipAddress)) {
    return { ...globalDelete, allowed: true, globalAdmin: true, scopeMode: 'global' };
  }

  const ownDelete = await canUseChatOperation(user, OPERATIONS.DELETE, ipAddress);
  if (!ownDelete.allowed) return ownDelete;
  if (ownDelete.adminBypass === true) {
    return { ...ownDelete, allowed: true, globalAdmin: true, scopeMode: 'global' };
  }
  const scopeMode = chatContactScopeService.normalizeChatScopeMode(ownDelete.scopeId) || 'owner';
  if (scopeMode === 'owner' || scopeMode === 'user') {
    const hasOtherSender = rows.some((message) => !idsEqual(message?.senderId, user?.id));
    if (hasOtherSender) {
      return { allowed: false, reason: 'Your Delete scope allows deleting only messages you sent.' };
    }
    return { ...ownDelete, allowed: true, globalAdmin: false, scopeMode };
  }

  if (['department', 'division', 'organization', 'admin'].includes(scopeMode)) {
    const scoped = await chatContactScopeService.getConversationScopeEligibility(user, conversation, {
      scopeId: ownDelete.scopeId
    });
    if (!scoped.allowed) return { allowed: false, reason: scoped.reason || 'Conversation is outside your Delete scope.' };
  }
  return { ...ownDelete, allowed: true, globalAdmin: false, scopeMode };
}

async function filterReviewConversations(user, conversations, scopeId, options = {}) {
  return chatOperationPolicyService.filterConversationsForReviewList(
    user,
    conversations,
    scopeId,
    options
  );
}

module.exports = {
  CHAT_OPERATION_GROUPS,
  EMPTY_CHAT_ACCESS,
  buildChatAccess,
  canUseChatOperation,
  canReadAllConversations,
  canManageConversationReviewList,
  canAccessConversation,
  canDownloadConversationAttachment,
  canDeleteMessages,
  canDeleteConversation,
  conversationHasParticipant,
  isGlobalChatAdmin,
  isChatBroadcastAdmin,
  filterReviewConversations
};
