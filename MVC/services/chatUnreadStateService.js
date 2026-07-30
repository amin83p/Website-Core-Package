const { idsEqual, toPublicId } = require('../utils/idAdapter');

function normalizeUnreadCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function normalizeMessage(message = {}, fallbackTimestamp = null) {
  return {
    ...(message || {}),
    timestamp: message?.timestamp || message?.sentAt || fallbackTimestamp || null
  };
}

function normalizeConversation(conversation = {}) {
  const messages = Array.isArray(conversation?.messages)
    ? conversation.messages.map((message) => normalizeMessage(message))
    : conversation?.messages;
  const totalMessages = Number.isFinite(Number(conversation?.totalMessages))
    ? Math.max(0, Math.floor(Number(conversation.totalMessages)))
    : (Array.isArray(messages) ? messages.length : 0);

  return {
    ...(conversation || {}),
    participants: Array.isArray(conversation?.participants)
      ? conversation.participants.map((participant) => ({
          ...(participant || {}),
          userId: toPublicId(participant?.userId),
          unreadCount: normalizeUnreadCount(participant?.unreadCount)
        }))
      : [],
    messages,
    lastMessage: conversation?.lastMessage
      ? normalizeMessage(
          conversation.lastMessage,
          conversation?.lastMessageAt || conversation?.updatedAt || null
        )
      : null,
    totalMessages
  };
}

function buildLastMessage(message = {}) {
  const normalized = normalizeMessage(message);
  const type = String(normalized?.type || 'text');
  let content = String(normalized?.content || '');
  if (type === 'image') content = 'Image';
  if (type === 'file') content = 'File';

  return {
    content,
    senderId: toPublicId(normalized?.senderId),
    timestamp: normalized?.timestamp || null,
    status: String(normalized?.status || 'sent'),
    type
  };
}

function applyMessageToConversation(conversation, senderId, message, options = {}) {
  const normalizedConversation = normalizeConversation(conversation);
  const normalizedMessage = normalizeMessage(message);
  const senderKey = toPublicId(senderId);
  const timestamp = normalizedMessage?.timestamp || new Date().toISOString();
  const existingMessages = Array.isArray(normalizedConversation.messages)
    ? normalizedConversation.messages
    : [];

  return {
    ...normalizedConversation,
    participants: normalizedConversation.participants.map((participant) => {
      if (idsEqual(participant?.userId, senderKey)) {
        return {
          ...participant,
          lastRead: timestamp,
          unreadCount: 0
        };
      }
      return {
        ...participant,
        unreadCount: normalizeUnreadCount(participant?.unreadCount) + 1
      };
    }),
    messages: options?.embedMessage === true
      ? [...existingMessages, { ...normalizedMessage, timestamp }]
      : normalizedConversation.messages,
    lastMessage: buildLastMessage({ ...normalizedMessage, timestamp }),
    lastMessageAt: timestamp,
    totalMessages: normalizedConversation.totalMessages + 1,
    updatedAt: timestamp
  };
}

function markConversationRead(conversation, userId, timestamp = new Date().toISOString()) {
  const normalizedConversation = normalizeConversation(conversation);
  const userKey = toPublicId(userId);

  return {
    ...normalizedConversation,
    participants: normalizedConversation.participants.map((participant) => (
      idsEqual(participant?.userId, userKey)
        ? {
            ...participant,
            lastRead: timestamp,
            unreadCount: 0
          }
        : participant
    ))
  };
}

function buildUnreadSummary(conversations, userId) {
  const userKey = toPublicId(userId);
  const byConversation = {};
  let totalUnread = 0;

  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    const normalizedConversation = normalizeConversation(conversation);
    const participant = normalizedConversation.participants.find((row) => (
      idsEqual(row?.userId, userKey)
    ));
    const unreadCount = normalizeUnreadCount(participant?.unreadCount);
    const conversationId = toPublicId(normalizedConversation?.id);
    if (conversationId) byConversation[conversationId] = unreadCount;
    totalUnread += unreadCount;
  }

  return { totalUnread, byConversation };
}

module.exports = {
  normalizeUnreadCount,
  normalizeMessage,
  normalizeConversation,
  applyMessageToConversation,
  markConversationRead,
  buildUnreadSummary
};
