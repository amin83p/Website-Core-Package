'use strict';

const wordOfDayDisplayScheduleModel = require('../../models/school/wordOfDayDisplayScheduleModel');
const schoolRepositories = require('../../repositories/school');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_RANGE_DAYS = 366;

function parseDateKey(value) {
  const dk = String(value || '').trim();
  if (!wordOfDayDisplayScheduleModel.isDateKey(dk)) return null;
  return dk;
}

function enumerateDateKeys(fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) {
    const error = new Error('from and to must be valid dates (YYYY-MM-DD).');
    error.statusCode = 400;
    throw error;
  }
  if (from > to) {
    const error = new Error('from must be on or before to.');
    error.statusCode = 400;
    throw error;
  }
  const keys = [];
  const start = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  let cursor = start;
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
    if (keys.length > MAX_RANGE_DAYS) {
      const error = new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
      error.statusCode = 400;
      throw error;
    }
  }
  return keys;
}

async function getApprovedEntryForOrg(orgId, entryId) {
  const activeOrgId = toPublicId(String(orgId || '').trim());
  const id = String(entryId || '').trim();
  if (!activeOrgId || !id) return null;
  const row = await schoolRepositories.wordOfDay.getById(id, { orgId: activeOrgId });
  if (!row) return null;
  const rowOrg = toPublicId(String(row.orgId || '').trim());
  if (rowOrg && rowOrg !== activeOrgId) return null;
  if (String(row.status || '').toLowerCase() !== 'approved') return null;
  return row;
}

async function assertAssignableEntry(orgId, entryId) {
  const row = await getApprovedEntryForOrg(orgId, entryId);
  if (!row) {
    const error = new Error('Only approved words from your organization can be scheduled.');
    error.statusCode = 400;
    throw error;
  }
  return row;
}

function summarizeRow(row) {
  if (!row) return null;
  return {
    entryId: row.id,
    word: row.word,
    authorName: String(row.authorName || '').trim(),
    authorUserId: String(row.authorUserId || row.audit?.createdBy || '').trim(),
    status: String(row.status || '').toLowerCase()
  };
}

async function assignScheduledDate({ orgId, dateKey, entryId, auditUserId }) {
  await assertAssignableEntry(orgId, entryId);
  return wordOfDayDisplayScheduleModel.assignDate(orgId, dateKey, entryId, auditUserId);
}

async function clearScheduledDate({ orgId, dateKey, auditUserId }) {
  return wordOfDayDisplayScheduleModel.clearDate(orgId, dateKey, auditUserId);
}

async function listScheduleRange({ orgId, from, to }) {
  const dateKeys = enumerateDateKeys(from, to);
  const { byDate } = await wordOfDayDisplayScheduleModel.getScheduleForOrg(orgId);
  const entryCache = new Map();

  async function resolveSlot(dateKey) {
    const slot = byDate[dateKey];
    if (!slot || typeof slot !== 'object') {
      return {
        dateKey,
        mode: 'automatic',
        entryId: null,
        word: null,
        authorName: null,
        invalid: false
      };
    }
    const entryId = String(slot.entryId || '').trim();
    if (!entryId) {
      return {
        dateKey,
        mode: 'automatic',
        entryId: null,
        word: null,
        authorName: null,
        invalid: true,
        invalidReason: 'missing_entry_id'
      };
    }
    let row = entryCache.get(entryId);
    if (row === undefined) {
      row = await schoolRepositories.wordOfDay.getById(entryId, { orgId: String(orgId || '').trim() });
      entryCache.set(entryId, row || null);
    }
    if (!row || String(row.status || '').toLowerCase() !== 'approved') {
      return {
        dateKey,
        mode: 'scheduled',
        entryId,
        word: row?.word || null,
        authorName: row?.authorName || null,
        invalid: true,
        invalidReason: 'not_approved_or_missing'
      };
    }
    return {
      dateKey,
      mode: 'scheduled',
      entryId,
      word: row.word,
      authorName: String(row.authorName || '').trim() || null,
      invalid: false
    };
  }

  const days = [];
  for (const dateKey of dateKeys) {
    days.push(await resolveSlot(dateKey));
  }
  return { from: dateKeys[0], to: dateKeys[dateKeys.length - 1], days };
}

async function listApprovedWords(orgId) {
  const activeOrgId = toPublicId(String(orgId || '').trim());
  const rows = await schoolRepositories.wordOfDay.list({
    query: { status__eq: 'approved' },
    scope: activeOrgId
      ? {
        denyAll: false,
        canViewAll: false,
        activeOrgId,
        scopeMode: SCOPE_MODES.ORG_WIDE
      }
      : { denyAll: true }
  });
  const list = Array.isArray(rows) ? rows : (rows?.items || []);
  return list.filter((row) => String(row?.status || '').toLowerCase() === 'approved');
}

async function searchApprovedForPicker({ orgId, q = '', limit = 20 }) {
  const text = String(q || '').trim().toLowerCase();
  const cap = Math.min(50, Math.max(1, Number(limit) || 20));
  let filtered = await listApprovedWords(orgId);
  if (text) {
    filtered = filtered.filter((row) => {
      const word = String(row?.word || '').toLowerCase();
      const meaning = String(row?.meaning || '').toLowerCase();
      const author = String(row?.authorName || '').toLowerCase();
      return word.includes(text) || meaning.includes(text) || author.includes(text);
    });
  }
  filtered.sort((a, b) => String(a?.word || '').localeCompare(String(b?.word || '')));
  return filtered.slice(0, cap).map((row) => summarizeRow(row)).filter(Boolean);
}

async function resolveScheduledEntryId(orgId, dateKey) {
  const entryId = await wordOfDayDisplayScheduleModel.getScheduledEntryId(orgId, dateKey);
  if (!entryId) return null;
  const row = await getApprovedEntryForOrg(orgId, entryId);
  return row || null;
}

module.exports = {
  assignScheduledDate,
  clearScheduledDate,
  listScheduleRange,
  searchApprovedForPicker,
  resolveScheduledEntryId,
  enumerateDateKeys
};