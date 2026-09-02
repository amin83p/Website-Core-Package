const chatRepository = require('../repositories/chatRepository');
const dataService = require('./dataService');
const chatAccessService = require('./chatAccessService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
const DEFAULT_USER_ORG = 'General';

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeLimit(value, fallback = DEFAULT_SEARCH_LIMIT) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_SEARCH_LIMIT);
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeIdList(value) {
  const rows = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  rows.forEach((entry) => {
    const id = toPublicId(entry);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function isActiveUser(user = {}) {
  const active = user?.active;
  const status = String(user?.status || '').trim().toLowerCase();
  if (active === false) return false;
  if (status === 'inactive' || status === 'disabled' || status === 'deleted') return false;
  return true;
}

function resolveDisplayName(user = {}) {
  return normalizeText(user?.identity?.displayName)
    || normalizeText(user?.displayName)
    || normalizeText(user?.name)
    || normalizeText(user?.username)
    || normalizeText(user?.email)
    || normalizeText(user?.id)
    || 'Unknown User';
}

function resolveAvatar(user = {}) {
  return normalizeText(user?.avatarUrl) || normalizeText(user?.avatar) || null;
}

function matchesRecipientQuery(projection = {}, user = {}, query = '') {
  const token = normalizeText(query).toLowerCase();
  if (!token) return true;
  const searchText = [
    projection.id,
    projection.name,
    projection.email,
    projection.org,
    user?.username,
    user?.email,
    user?.personId
  ].join(' ').toLowerCase();
  return searchText.includes(token);
}

function projectRecipient(user = {}) {
  return {
    id: toPublicId(user?.id),
    name: resolveDisplayName(user),
    avatar: resolveAvatar(user),
    email: normalizeText(user?.email),
    org: normalizeText(user?.activeOrgName) || DEFAULT_USER_ORG,
    roleLabels: [],
    packages: []
  };
}

function normalizeAttachmentRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const type = String(row?.type || '').trim().toLowerCase() === 'image' ? 'image' : 'file';
      const fileUrl = normalizeText(row?.fileUrl);
      if (!fileUrl) return null;
      const content = normalizeText(row?.content) || (type === 'image' ? 'Image' : 'File');
      return { type, fileUrl, content };
    })
    .filter(Boolean);
}

async function assertGlobalChatAdmin(user, ipAddress) {
  const allowed = await chatAccessService.isGlobalChatAdmin(user, ipAddress);
  if (!allowed) {
    throw createHttpError('Global conversation management requires full chat administration access.', 403);
  }
}

async function getAdminVisibleUsers() {
  const rows = await dataService.getAccessibleUsers({ isSuperAdmin: true });
  return Array.isArray(rows) ? rows : [];
}

async function searchBroadcastRecipients({
  requestingUser,
  ipAddress,
  query = '',
  limit = DEFAULT_SEARCH_LIMIT
} = {}) {
  await assertGlobalChatAdmin(requestingUser, ipAddress);
  const users = await getAdminVisibleUsers();
  const normalizedLimit = normalizeLimit(limit);
  const recipients = [];
  users.forEach((user) => {
    const userId = toPublicId(user?.id);
    if (!userId || idsEqual(userId, requestingUser?.id) || !isActiveUser(user)) return;
    const projection = projectRecipient(user);
    if (!projection.id || !matchesRecipientQuery(projection, user, query)) return;
    recipients.push(projection);
  });

  return recipients
    .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' }))
    .slice(0, normalizedLimit);
}

async function broadcastDirectMessage({
  senderUser,
  ipAddress,
  recipientIds = [],
  content = '',
  attachments = []
} = {}) {
  await assertGlobalChatAdmin(senderUser, ipAddress);
  const senderId = toPublicId(senderUser?.id);
  if (!senderId) throw createHttpError('A valid sender account is required.', 400);

  const targets = normalizeIdList(recipientIds).filter((id) => !idsEqual(id, senderId));
  if (!targets.length) throw createHttpError('Select at least one recipient.', 400);

  const text = normalizeText(content);
  const normalizedAttachments = normalizeAttachmentRows(attachments);
  if (!text && normalizedAttachments.length === 0) {
    throw createHttpError('Enter a message or attach at least one file.', 400);
  }

  const users = await getAdminVisibleUsers();
  const userById = new Map(
    users
      .map((user) => [toPublicId(user?.id), user])
      .filter(([id]) => Boolean(id))
  );

  const deliveries = [];
  const skipped = [];
  const failed = [];

  for (const recipientId of targets) {
    const targetUser = userById.get(recipientId);
    if (!targetUser) {
      skipped.push({ recipientId, reason: 'Recipient not found.' });
      continue;
    }
    if (!isActiveUser(targetUser)) {
      skipped.push({ recipientId, reason: 'Recipient is inactive.' });
      continue;
    }

    try {
      const conversation = await chatRepository.create({ userIds: [senderId, recipientId] });
      const storedMessages = [];
      if (text) {
        // eslint-disable-next-line no-await-in-loop
        const textMessage = await chatRepository.addMessage(conversation.id, senderId, text, 'text', null);
        storedMessages.push(textMessage);
      }
      for (const attachment of normalizedAttachments) {
        // eslint-disable-next-line no-await-in-loop
        const fileMessage = await chatRepository.addMessage(
          conversation.id,
          senderId,
          attachment.content,
          attachment.type,
          attachment.fileUrl
        );
        storedMessages.push(fileMessage);
      }

      deliveries.push({
        recipient: projectRecipient(targetUser),
        recipientId,
        conversationId: conversation.id,
        messageCount: storedMessages.length,
        messages: storedMessages
      });
    } catch (error) {
      failed.push({
        recipientId,
        reason: error?.message || 'Broadcast delivery failed.'
      });
    }
  }

  return {
    attemptedCount: targets.length,
    sentCount: deliveries.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    deliveries,
    skipped,
    failed
  };
}

module.exports = {
  searchBroadcastRecipients,
  broadcastDirectMessage
};
