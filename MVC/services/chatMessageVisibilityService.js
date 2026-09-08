const chatContactScopeService = require('./chatContactScopeService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const TWO_SIDED_DELETE_SCOPES = Object.freeze(['organization', 'admin', 'global']);

function normalizeScopeMode(scopeMode = '') {
  return chatContactScopeService.normalizeChatScopeMode(scopeMode) || '';
}

function isTwoSidedDeletionScope(scopeMode = '') {
  return TWO_SIDED_DELETE_SCOPES.includes(normalizeScopeMode(scopeMode));
}

function normalizeHiddenForUserIds(message = {}) {
  const rows = Array.isArray(message?.hiddenForUserIds) ? message.hiddenForUserIds : [];
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

function isHiddenForViewer(message = {}, viewerUserId = '') {
  const viewerId = toPublicId(viewerUserId);
  if (!viewerId) return false;
  return normalizeHiddenForUserIds(message).some((userId) => idsEqual(userId, viewerId));
}

function isDeletedForViewer(message = {}, viewerUserId = '') {
  if (message?.deletedAt) return true;
  return isHiddenForViewer(message, viewerUserId);
}

function toTombstoneMessage(message = {}, viewerUserId = '') {
  return {
    ...(message || {}),
    content: 'Message deleted',
    fileUrl: null,
    deletedAt: message?.deletedAt || new Date().toISOString(),
    deletedByUserId: toPublicId(message?.deletedByUserId) || toPublicId(viewerUserId),
    hiddenForUserIds: normalizeHiddenForUserIds(message),
    viewerDeleted: true
  };
}

function applyVisibilityToMessage(message = {}, viewerUserId = '') {
  if (!message) return message;
  if (!isDeletedForViewer(message, viewerUserId)) return message;
  return toTombstoneMessage(message, viewerUserId);
}

function applyVisibilityToMessages(messages = [], viewerUserId = '') {
  return (Array.isArray(messages) ? messages : []).map((message) => (
    applyVisibilityToMessage(message, viewerUserId)
  ));
}

function isActiveMessageForViewer(message = {}, viewerUserId = '') {
  return !isDeletedForViewer(message, viewerUserId);
}

module.exports = {
  TWO_SIDED_DELETE_SCOPES,
  normalizeScopeMode,
  isTwoSidedDeletionScope,
  normalizeHiddenForUserIds,
  isHiddenForViewer,
  isDeletedForViewer,
  applyVisibilityToMessage,
  applyVisibilityToMessages,
  isActiveMessageForViewer
};
