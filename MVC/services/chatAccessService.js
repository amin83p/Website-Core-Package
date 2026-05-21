const accessService = require('./security/index');
const adminAuthorityService = require('./adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

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

async function canAccessConversation({
  user,
  conversation,
  operationIds = [OPERATIONS.READ, OPERATIONS.READ_ALL],
  ipAddress,
  allowGlobalAdmin = false
} = {}) {
  const operationResult = await canUseChatOperation(user, operationIds, ipAddress);
  if (!operationResult.allowed) return operationResult;

  if (conversationHasParticipant(conversation, user?.id)) {
    return {
      ...operationResult,
      participant: true,
      globalAdmin: false
    };
  }

  if (allowGlobalAdmin && await isGlobalChatAdmin(user, ipAddress)) {
    return {
      ...operationResult,
      participant: false,
      globalAdmin: true
    };
  }

  return {
    allowed: false,
    operationId: operationResult.operationId,
    reason: 'Conversation is outside your chat access scope.'
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
  if (isParticipant) {
    const ownDelete = await canUseChatOperation(user, OPERATIONS.DELETE, ipAddress);
    if (ownDelete.allowed) {
      return {
        ...ownDelete,
        participant: true,
        globalAdmin: false
      };
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

module.exports = {
  EMPTY_CHAT_ACCESS,
  buildChatAccess,
  canUseChatOperation,
  canAccessConversation,
  canDeleteConversation,
  conversationHasParticipant,
  isGlobalChatAdmin
};
