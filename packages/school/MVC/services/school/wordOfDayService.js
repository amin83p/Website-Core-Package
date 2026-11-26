'use strict';

const schoolRepositories = require('../../repositories/school');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const wordOfDayAccessService = require('./wordOfDayAccessService');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const MEDIA_LIMIT_BYTES = Object.freeze({
  photo: 2 * 1024 * 1024,
  audio: 3 * 1024 * 1024
});

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

async function getActorName(user) {
  return personDisplayNameService.resolveUserDisplayName(user, {
    fallback: getActorId(user) || 'System'
  });
}

function currentCalendarYear() {
  return String(new Date().getFullYear());
}

function canManageAll(access) {
  return Boolean(access?.isWordOfDayAdminViewer || access?.adminFlags?.resolve);
}

function assertCreateAllowed(access) {
  if (!access?.canCreateWords) {
    const error = new Error('You do not have permission to create Word of Day entries.');
    error.statusCode = 403;
    throw error;
  }
}

function assertUpdateAllowed(row, access, reqUser) {
  const year = currentCalendarYear();
  if (!wordOfDayAccessService.canUpdateEntry(row, access, getActorId(reqUser), year)) {
    const error = new Error('You cannot edit this entry in its current status.');
    error.statusCode = 403;
    throw error;
  }
}

async function listEntries(reqUser, query = {}, access = null) {
  const orgId = getActiveOrgId(reqUser);
  if (!access || !access.canViewEntries) return [];
  const rows = await schoolRepositories.wordOfDay.list({ orgId, ...query });
  const list = Array.isArray(rows) ? rows : (rows?.items || []);
  const view = String(query?.view || '').toLowerCase() === 'archived' ? 'archived' : 'active';
  const actorId = getActorId(reqUser);
  const year = currentCalendarYear();
  return list.filter((row) => wordOfDayAccessService.rowVisibleInList(row, access, actorId, year, view));
}

async function getEntry(reqUser, id, access = null) {
  const orgId = getActiveOrgId(reqUser);
  const row = await schoolRepositories.wordOfDay.getById(id, { orgId });
  if (!row) return null;
  if (!access) return row;
  wordOfDayAccessService.assertRowVisible(row, access, getActorId(reqUser), currentCalendarYear());
  return row;
}

function buildAuthorPayload(reqUser, authorName, body = {}, access = {}) {
  let authorUserId = getActorId(reqUser);
  let authorDisplay = authorName || authorUserId;
  const requestedAuthor = toPublicId(body?.authorUserId || body?.createdBy);
  if (requestedAuthor && access?.canCreateAsOtherUser && !idsEqual(requestedAuthor, authorUserId)) {
    authorUserId = requestedAuthor;
    authorDisplay = cleanString(body?.authorName, 160) || requestedAuthor;
  }
  return {
    authorUserId,
    authorName: authorDisplay
  };
}

function formatTypeLabels(row) {
  const types = Array.isArray(row?.wordTypes) && row.wordTypes.length
    ? row.wordTypes
    : (row?.wordType ? [row.wordType] : []);
  return wordOfDayModel.primaryWordTypeLabel(types);
}

function formatDuplicateSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    word: row.word,
    wordTypes: Array.isArray(row.wordTypes) ? row.wordTypes : [],
    typeLabels: formatTypeLabels(row),
    difficulty: row.difficulty,
    difficultyLabel: wordOfDayModel.DIFFICULTY_LABELS[row.difficulty] || row.difficulty,
    meaning: row.meaning || '',
    pronunciation: row.pronunciation || '',
    examples: Array.isArray(row.examples) ? row.examples.slice(0, 10) : [],
    status: row.status,
    authorName: row.authorName || row.authorUserId || '',
    createdBy: row.audit?.createdBy || row.authorUserId || '',
    createDateTime: row.audit?.createDateTime || '',
    detailUrl: row.id ? `/school/word-of-day/detail/${encodeURIComponent(row.id)}` : ''
  };
}

async function findDuplicateWord(orgId, word, excludeId = '') {
  const key = wordOfDayModel.normalizeWordKey(word);
  if (!key || !orgId) return null;
  const rows = await schoolRepositories.wordOfDay.list({ orgId: String(orgId).trim() });
  const list = Array.isArray(rows) ? rows : (rows?.items || []);
  return list.find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return wordOfDayModel.normalizeWordKey(row?.word) === key;
  }) || null;
}

function assertNoDuplicateWord(orgId, word, excludeId = '') {
  return findDuplicateWord(orgId, word, excludeId).then((duplicate) => {
    if (!duplicate) return null;
    const error = new Error('This word is already saved in your organization.');
    error.code = 'WORD_OF_DAY_DUPLICATE';
    error.statusCode = 409;
    error.duplicate = formatDuplicateSummary(duplicate);
    throw error;
  });
}

async function createEntry(reqUser, body, { saveAs = 'saved', access = null } = {}) {
  assertCreateAllowed(access);
  const orgId = getActiveOrgId(reqUser);
  if (!orgId) {
    const error = new Error('Select an active organization before creating a Word of Day entry.');
    error.statusCode = 400;
    throw error;
  }
  await assertNoDuplicateWord(orgId, body?.word);
  const authorName = await getActorName(reqUser);
  const status = saveAs === 'submitted' ? 'submitted' : 'saved';
  const now = new Date().toISOString();
  const workflow = status === 'submitted'
    ? {
      submittedAt: now,
      submittedBy: getActorId(reqUser),
      submittedByName: authorName
    }
    : {};
  const authorPayload = buildAuthorPayload(reqUser, authorName, body, access);
  const payload = wordOfDayModel.sanitizeWordOfDayInput({
    ...body,
    orgId,
    status,
    workflow,
    ...authorPayload,
    audit: {
      createdBy: authorPayload.authorUserId,
      updatedBy: getActorId(reqUser)
    }
  }, { isUpdate: false });
  return schoolRepositories.wordOfDay.create(payload, { orgId });
}

async function updateEntry(reqUser, id, body, { saveAs, access = null } = {}) {
  const existing = await getEntry(reqUser, id, access);
  if (!existing) {
    const error = new Error('Word of Day entry was not found.');
    error.statusCode = 404;
    throw error;
  }
  assertUpdateAllowed(existing, access, reqUser);

  if (body?.word !== undefined) {
    await assertNoDuplicateWord(getActiveOrgId(reqUser), body.word, existing.id);
  }

  const patch = wordOfDayModel.sanitizeWordOfDayInput({ ...existing, ...body }, { isUpdate: true });
  let nextStatus = existing.status;
  if (saveAs === 'submitted') {
    const from = String(existing.status || '').toLowerCase();
    if (!['saved', 'reopened'].includes(from)) {
      const error = new Error('Only saved or reopened entries can be submitted.');
      error.statusCode = 409;
      throw error;
    }
    nextStatus = 'submitted';
  } else if (saveAs === 'saved') {
    nextStatus = String(existing.status || 'saved').toLowerCase() === 'submitted' ? 'submitted' : 'saved';
  }

  const now = new Date().toISOString();
  const workflow = { ...(existing.workflow || {}) };
  if (saveAs === 'submitted') {
    Object.assign(workflow, {
      submittedAt: now,
      submittedBy: getActorId(reqUser),
      submittedByName: await getActorName(reqUser)
    });
  }
  const updated = await schoolRepositories.wordOfDay.update(id, {
    ...patch,
    status: nextStatus,
    workflow,
    audit: { updatedBy: getActorId(reqUser) }
  }, { orgId: getActiveOrgId(reqUser) });
  return updated;
}

async function transitionEntry(reqUser, id, targetStatus, access, options = {}) {
  const orgId = getActiveOrgId(reqUser);
  const existing = await schoolRepositories.wordOfDay.getById(id, { orgId });
  if (!existing) {
    const error = new Error('Word of Day entry was not found.');
    error.statusCode = 404;
    throw error;
  }
  const actorId = getActorId(reqUser);
  const year = currentCalendarYear();
  const to = String(targetStatus || '').toLowerCase();
  if (!wordOfDayAccessService.canResolveTransition(existing, to, access, actorId, year)) {
    const error = new Error('You cannot perform this status change on this entry.');
    error.statusCode = 403;
    throw error;
  }
  wordOfDayAccessService.assertDisplayRiskAcknowledged(existing, to, {
    confirmDisplayRisk: options.confirmDisplayRisk === true
  });
  const now = new Date().toISOString();
  const reviewerName = await getActorName(reqUser);
  const workflow = { ...(existing.workflow || {}), reviewerNote: cleanString(options.note, 2000) };
  if (to === 'approved') {
    Object.assign(workflow, {
      approvedAt: now,
      approvedBy: actorId,
      approvedByName: reviewerName
    });
  }
  if (to === 'rejected') {
    Object.assign(workflow, {
      rejectedAt: now,
      rejectedBy: actorId,
      rejectedByName: reviewerName
    });
  }
  if (to === 'submitted') {
    Object.assign(workflow, {
      submittedAt: now,
      submittedBy: actorId,
      submittedByName: reviewerName
    });
  }
  return schoolRepositories.wordOfDay.update(id, {
    status: to,
    workflow,
    audit: { updatedBy: actorId }
  }, { orgId });
}

async function submitEntry(reqUser, id, access, options = {}) {
  const existing = await getEntry(reqUser, id, access);
  const from = String(existing?.status || '').toLowerCase();
  if (['saved', 'reopened'].includes(from)) {
    return updateEntry(reqUser, id, {}, { saveAs: 'submitted', access });
  }
  return transitionEntry(reqUser, id, 'submitted', access, options);
}

async function approveEntry(reqUser, id, note, access, options = {}) {
  return transitionEntry(reqUser, id, 'approved', access, { ...options, note });
}

async function rejectEntry(reqUser, id, note, access, options = {}) {
  return transitionEntry(reqUser, id, 'rejected', access, { ...options, note });
}

async function reopenEntry(reqUser, id, note, access, options = {}) {
  return transitionEntry(reqUser, id, 'reopened', access, { ...options, note });
}

async function holdEntry(reqUser, id, note, access, options = {}) {
  return transitionEntry(reqUser, id, 'on_hold', access, { ...options, note });
}

async function archiveEntry(reqUser, id, note, access, options = {}) {
  return transitionEntry(reqUser, id, 'archived', access, { ...options, note });
}

async function deleteEntry(reqUser, id, access = null, options = {}) {
  const existing = await getEntry(reqUser, id, access);
  if (!existing) {
    const error = new Error('Word of Day entry was not found.');
    error.statusCode = 404;
    throw error;
  }
  const year = currentCalendarYear();
  if (!wordOfDayAccessService.canDeleteEntry(existing, access, getActorId(reqUser), year)) {
    const error = new Error('You cannot delete this entry.');
    error.statusCode = 403;
    throw error;
  }
  wordOfDayAccessService.assertDisplayRiskAcknowledged(existing, 'deleted', {
    forDelete: true,
    confirmDisplayRisk: options.confirmDisplayRisk === true
  });
  return schoolRepositories.wordOfDay.remove(id, { orgId: getActiveOrgId(reqUser) });
}

function yearFromAudit(row) {
  const ts = String(row?.audit?.createDateTime || '').trim();
  if (ts.length >= 4) return ts.slice(0, 4);
  return 'Unknown';
}

async function summarizeAuthorStats(reqUser, access = null) {
  const rows = await listEntries(reqUser, {}, access);
  const authorId = getActorId(reqUser);
  const mine = rows.filter((row) => wordOfDayAccessService.isOwnerRow(row, authorId));
  const byYear = {};
  for (const row of mine) {
    const year = yearFromAudit(row);
    if (!byYear[year]) {
      byYear[year] = { saved: 0, submitted: 0, approved: 0, rejected: 0, reopened: 0, on_hold: 0, archived: 0, total: 0 };
    }
    const status = String(row.status || 'saved').toLowerCase();
    if (byYear[year][status] !== undefined) byYear[year][status] += 1;
    byYear[year].total += 1;
  }
  return { authorUserId: authorId, byYear };
}

function buildEntryCapabilities(entry, access, reqUser) {
  const actorId = getActorId(reqUser);
  const year = currentCalendarYear();
  const status = String(entry?.status || '').toLowerCase();
  return {
    canEdit: wordOfDayAccessService.canUpdateEntry(entry, access, actorId, year),
    canSubmit: ['saved', 'reopened'].includes(status) && wordOfDayAccessService.canUpdateEntry(entry, access, actorId, year),
    canApprove: wordOfDayAccessService.canResolveTransition(entry, 'approved', access, actorId, year),
    canReject: wordOfDayAccessService.canResolveTransition(entry, 'rejected', access, actorId, year),
    canReopen: wordOfDayAccessService.canResolveTransition(entry, 'reopened', access, actorId, year),
    canHold: wordOfDayAccessService.canResolveTransition(entry, 'on_hold', access, actorId, year),
    canArchive: wordOfDayAccessService.canResolveTransition(entry, 'archived', access, actorId, year),
    canDelete: wordOfDayAccessService.canDeleteEntry(entry, access, actorId, year),
    hasDisplayHistory: wordOfDayAccessService.hasDisplayHistory(entry)
  };
}

function validateUploadedFile(file, kind) {
  if (!file) {
    const error = new Error('No file was uploaded.');
    error.statusCode = 400;
    throw error;
  }
  const limit = MEDIA_LIMIT_BYTES[kind];
  const size = Number(file.size || 0);
  if (limit && size > limit) {
    const error = new Error(`${kind === 'photo' ? 'Photo' : 'Audio'} must be ${kind === 'photo' ? '2' : '3'} MB or smaller.`);
    error.statusCode = 400;
    throw error;
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (kind === 'photo' && !mime.startsWith('image/')) {
    const error = new Error('Photo must be an image file.');
    error.statusCode = 400;
    throw error;
  }
  if (kind === 'audio' && !mime.startsWith('audio/')) {
    const error = new Error('Audio must be an audio file.');
    error.statusCode = 400;
    throw error;
  }
}

module.exports = {
  MEDIA_LIMIT_BYTES,
  canManageAll,
  formatTypeLabels,
  formatDuplicateSummary,
  findDuplicateWord,
  assertNoDuplicateWord,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  submitEntry,
  approveEntry,
  rejectEntry,
  reopenEntry,
  holdEntry,
  archiveEntry,
  deleteEntry,
  summarizeAuthorStats,
  buildEntryCapabilities,
  validateUploadedFile,
  getActiveOrgId
};