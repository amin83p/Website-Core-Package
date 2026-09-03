const accessService = require('./security/index');
const adminAuthorityService = require('./adminAuthorityService');
const chatContactScopeService = require('./chatContactScopeService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const CHAT_OPERATION_GROUPS = Object.freeze({
  READ_CONVERSATION: Object.freeze([OPERATIONS.READ, OPERATIONS.READ_ALL]),
  WRITE_CONVERSATION: Object.freeze([OPERATIONS.UPDATE]),
  DELETE_CONVERSATION: Object.freeze([OPERATIONS.DELETE, OPERATIONS.DELETE_ALL]),
  READ_ALL_CONVERSATIONS: Object.freeze([OPERATIONS.READ_ALL]),
  GLOBAL_MANAGE: Object.freeze([OPERATIONS.DELETE_ALL]),
  DOWNLOAD_ATTACHMENT: Object.freeze([OPERATIONS.DOWNLOAD_FILE])
});

const EMPTY_CHAT_ACCESS = Object.freeze({
  canRead: false,
  canReadAll: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canDeleteAll: false,
  canDownloadFile: false,
  canUse: false
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
    if (evaluation?.allowed) {
      return {
        allowed: true,
        operationId,
        evaluation,
        limits: evaluation.limits || {},
        scopeId: evaluation.scopeId || null
      };
    }
    lastEvaluation = evaluation;
  }

  return {
    allowed: false,
    operationId: operations[0],
    evaluation: lastEvaluation,
    reason: lastEvaluation?.reason || 'Insufficient chat permissions.'
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
    download
  ] = await Promise.all([
    evaluateOperation(user, OPERATIONS.READ, ipAddress),
    evaluateOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.CREATE, ipAddress),
    evaluateOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateOperation(user, OPERATIONS.DELETE, ipAddress),
    evaluateOperation(user, OPERATIONS.DELETE_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.DOWNLOAD_FILE, ipAddress)
  ]);

  const canRead = Boolean(read?.allowed || readAll?.allowed);
  const canReadAll = Boolean(readAll?.allowed);
  const canCreate = Boolean(create?.allowed);
  const canUpdate = Boolean(update?.allowed);
  const canDelete = Boolean(del?.allowed);
  const canDeleteAll = Boolean(deleteAll?.allowed);
  const canDownloadFile = Boolean(download?.allowed);

  return {
    canRead,
    canReadAll,
    canCreate,
    canUpdate,
    canDelete,
    canDeleteAll,
    deleteScopeId: del?.scopeId || deleteAll?.scopeId || null,
    canDownloadFile,
    canUse: Boolean(canRead || canCreate || canUpdate || canDelete || canDeleteAll || canDownloadFile)
  };
}

function conversationHasParticipant(conversation, userId) {
  const normalizedUserId = toPublicId(userId);
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  if (!normalizedUserId || !participants.length) return false;
  return participants.some((participant) => idsEqual(participant?.userId || participant, normalizedUserId));
}

async function isGlobalChatAdmin(user, ipAddress) {
  if (!user) return false;
  if (await adminAuthorityService.isAdminForRequestAsync(user, SECTIONS.CHATS, OPERATIONS.DELETE_ALL, { section: { id: SECTIONS.CHATS } })) return true;
  const deleteAll = await evaluateOperation(user, OPERATIONS.DELETE_ALL, ipAddress);
  return Boolean(deleteAll?.allowed);
}

async function canReadAllConversations(user, ipAddress) {
  const result = await canUseChatOperation(user, CHAT_OPERATION_GROUPS.READ_ALL_CONVERSATIONS, ipAddress);
  if (result.allowed) {
    return {
      ...result,
      globalRead: true
    };
  }
  return {
    ...result,
    reason: result.reason || 'Global conversation list access requires READ_ALL chat access.'
  };
}

async function canAccessConversation({
  user,
  conversation,
  operationIds = CHAT_OPERATION_GROUPS.READ_CONVERSATION,
  ipAddress,
  allowGlobalAdmin = false
} = {}) {
  const operationResult = await canUseChatOperation(user, operationIds, ipAddress);
  if (!operationResult.allowed) return operationResult;

  if (conversationHasParticipant(conversation, user?.id)) {
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
    const globalRead = await canReadAllConversations(user, ipAddress);
    if (!globalRead.allowed) {
      return {
        allowed: false,
        operationId: operationResult.operationId,
        reason: 'Conversation is outside your chat access scope.'
      };
    }
    return {
      ...globalRead,
      participant: false,
      globalAdmin: true,
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
    operationIds: CHAT_OPERATION_GROUPS.READ_CONVERSATION,
    ipAddress,
    allowGlobalAdmin: true
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
  const ownDelete = await canUseChatOperation(user, OPERATIONS.DELETE, ipAddress);
  if (ownDelete.allowed) {
    const scopeMode = chatContactScopeService.normalizeChatScopeMode(ownDelete.scopeId) || 'owner';
    if (scopeMode === 'owner' || scopeMode === 'user') {
      return {
        allowed: false,
        reason: 'Your Delete scope allows deleting only your own messages, not the whole conversation.'
      };
    }
    if (scopeMode === 'global') {
      return { ...ownDelete, participant: isParticipant, globalAdmin: true, scopeMode };
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

  const globalDelete = await canUseChatOperation(user, OPERATIONS.DELETE_ALL, ipAddress);
  if (globalDelete.allowed && await isGlobalChatAdmin(user, ipAddress)) {
    return {
      ...globalDelete,
      participant: false,
      globalAdmin: true
    };
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

module.exports = {
  CHAT_OPERATION_GROUPS,
  EMPTY_CHAT_ACCESS,
  buildChatAccess,
  canUseChatOperation,
  canReadAllConversations,
  canAccessConversation,
  canDownloadConversationAttachment,
  canDeleteMessages,
  canDeleteConversation,
  conversationHasParticipant,
  isGlobalChatAdmin
};
