'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const chatRepository = requireCoreModule('MVC/repositories/chatRepository');
const socketService = requireCoreModule('MVC/services/socketService');
const { CHAT_SYSTEM_USER_ID: SYSTEM_CHAT_USER_ID } = requireCoreModule('MVC/services/chatSystemParticipantService');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanNote(value, max = 2000) {
  const text = String(value || '').replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function buildOpenWordHref(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return '/school/word-of-day';
  return `/school/word-of-day?openEntry=${encodeURIComponent(id)}`;
}

function buildRejectionChatHtml({ word = '', entryId = '', note = '' } = {}) {
  const safeWord = escapeHtml(String(word || 'Word of the Day entry').trim() || 'Word of the Day entry');
  const noteText = cleanNote(note);
  const noteBlock = noteText
    ? [
      '<br>',
      '<div style="border-left: 3px solid #dc3545; padding-left: 10px; color: #6c757d; font-style: italic;">',
      `"${escapeHtml(noteText)}"`,
      '</div>',
      '<br>'
    ].join('\n')
    : '<br>';
  const openHref = escapeHtml(buildOpenWordHref(entryId));
  return [
    '<i class="bi bi-journal-x text-danger"></i> <strong>System Message:</strong>',
    'Your <strong>Word of the Day</strong> submission was <strong>not approved</strong>.',
    '<br><br>',
    `Word: <strong>${safeWord}</strong>`,
    noteBlock,
    `<a href="${openHref}" target="_blank" rel="noopener" class="text-decoration-none fw-bold">`,
    '<i class="bi bi-box-arrow-up-right"></i> Open word',
    '</a>'
  ].join('\n');
}

async function notifyAuthorWordRejected(entry, { note = '' } = {}) {
  const authorUserId = toPublicId(entry?.authorUserId || entry?.audit?.createdBy || '');
  if (!authorUserId || idsEqual(authorUserId, SYSTEM_CHAT_USER_ID)) return;

  const reviewerNote = cleanNote(note || entry?.workflow?.reviewerNote || '');
  const html = buildRejectionChatHtml({
    word: entry?.word,
    entryId: entry?.id,
    note: reviewerNote
  });

  const conv = await chatRepository.create({
    userIds: [String(authorUserId), SYSTEM_CHAT_USER_ID]
  });
  const savedMsg = await chatRepository.addMessage(
    conv.id,
    SYSTEM_CHAT_USER_ID,
    html.trim(),
    'system',
    null
  );
  try {
    const io = socketService.getIo();
    io.to(conv.id).emit('new_message', {
      convId: conv.id,
      message: savedMsg
    });
  } catch (_) {
    // ignore offline socket failures
  }
}

module.exports = {
  SYSTEM_CHAT_USER_ID,
  buildOpenWordHref,
  buildRejectionChatHtml,
  notifyAuthorWordRejected
};