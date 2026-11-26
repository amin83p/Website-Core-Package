'use strict';

const crypto = require('crypto');
const schoolRepositories = require('../../repositories/school');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const { enrichEntryMedia } = require('./wordOfDayService');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function hashSeed(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function mulberry32(seedInt) {
  let t = seedInt >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededIndex(seed, length) {
  if (!length) return -1;
  const slice = hashSeed(seed).slice(0, 8);
  const intSeed = Number.parseInt(slice, 16) || 1;
  const rand = mulberry32(intSeed);
  return Math.floor(rand() * length);
}

function pickDailyEntry(approvedRows, orgId, dateKey) {
  if (!approvedRows.length) return null;
  const sorted = [...approvedRows].sort((a, b) => {
    const ac = Number(a?.display?.displayCount || 0);
    const bc = Number(b?.display?.displayCount || 0);
    if (ac !== bc) return ac - bc;
    return String(a?.audit?.createDateTime || '').localeCompare(String(b?.audit?.createDateTime || ''));
  });
  const minCount = Number(sorted[0]?.display?.displayCount || 0);
  const pool = sorted.filter((row) => Number(row?.display?.displayCount || 0) === minCount);
  const idx = seededIndex(`${orgId}|${dateKey}`, pool.length);
  return idx >= 0 ? pool[idx] : pool[0];
}

function authorFirstName(authorName = '') {
  const token = String(authorName || '').trim().split(/\s+/).filter(Boolean)[0];
  return token || '';
}

function redactForDisplay(row) {
  if (!row) return null;
  const wordTypes = Array.isArray(row.wordTypes) && row.wordTypes.length
    ? row.wordTypes
    : (row.wordType ? [row.wordType] : []);
  const typeLabels = wordTypes.map((key) => wordOfDayModel.WORD_TYPE_LABELS[key] || key).filter(Boolean);
  const authorName = String(row.authorName || '').trim();
  return {
    id: row.id,
    word: row.word,
    wordTypes,
    wordType: wordTypes[0] || row.wordType || '',
    wordTypeLabel: wordOfDayModel.primaryWordTypeLabel(wordTypes),
    wordTypeLabels: typeLabels,
    pronunciation: row.pronunciation,
    difficulty: row.difficulty,
    difficultyLabel: wordOfDayModel.DIFFICULTY_LABELS[row.difficulty] || row.difficulty,
    authorName,
    authorFirstName: authorFirstName(authorName),
    status: row.status
  };
}

function redactForPublicDetail(row) {
  if (!row || String(row.status || '').toLowerCase() !== 'approved') return null;
  const base = redactForDisplay(row);
  if (!base) return null;
  const enriched = enrichEntryMedia(row);
  const examples = Array.isArray(enriched.examples)
    ? enriched.examples.map((ex) => String(ex || '').trim()).filter(Boolean)
    : [];
  return {
    ...base,
    meaning: String(row.meaning || '').trim(),
    examples,
    photo: enriched.photo && enriched.photo.url ? enriched.photo : {},
    audio: enriched.audio && enriched.audio.url ? enriched.audio : {},
    videoUrl: String(row.videoUrl || '').trim()
  };
}

async function listApprovedForOrg(orgId) {
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

async function recordDisplayForDate(row, orgId, dateKey) {
  if (!row?.id) return row;
  const display = row.display && typeof row.display === 'object' ? { ...row.display } : {};
  if (display.lastDisplayedOnDate === dateKey) return row;
  const now = new Date().toISOString();
  const nextDisplay = {
    displayCount: Number(display.displayCount || 0) + 1,
    displayDates: [...(Array.isArray(display.displayDates) ? display.displayDates : []), now],
    lastDisplayedAt: now,
    lastDisplayedOnDate: dateKey
  };
  return schoolRepositories.wordOfDay.update(row.id, { display: nextDisplay }, { orgId: String(orgId || '').trim() });
}

async function resolveDailyDisplay({ orgId, dateKey, recordAnalytics = true }) {
  const targetOrgId = String(orgId || '').trim();
  const targetDate = String(dateKey || '').trim();
  if (!targetOrgId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { orgId: targetOrgId, dateKey: targetDate, entry: null };
  }
  const approved = await listApprovedForOrg(targetOrgId);
  let picked = pickDailyEntry(approved, targetOrgId, targetDate);
  if (!picked) return { orgId: targetOrgId, dateKey: targetDate, entry: null };
  if (recordAnalytics) {
    picked = await recordDisplayForDate(picked, targetOrgId, targetDate);
  }
  return { orgId: targetOrgId, dateKey: targetDate, entry: redactForDisplay(picked) };
}

async function resolveDailyPublicDetail({ orgId, dateKey, recordAnalytics = true }) {
  const targetOrgId = String(orgId || '').trim();
  const targetDate = String(dateKey || '').trim();
  if (!targetOrgId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { orgId: targetOrgId, dateKey: targetDate, entry: null };
  }
  const approved = await listApprovedForOrg(targetOrgId);
  let picked = pickDailyEntry(approved, targetOrgId, targetDate);
  if (!picked) return { orgId: targetOrgId, dateKey: targetDate, entry: null };
  if (recordAnalytics) {
    picked = await recordDisplayForDate(picked, targetOrgId, targetDate);
  }
  return { orgId: targetOrgId, dateKey: targetDate, entry: redactForPublicDetail(picked) };
}

async function getApprovedEntryRowById(id) {
  const row = await schoolRepositories.wordOfDay.getById(id, {});
  if (!row || String(row.status || '').toLowerCase() !== 'approved') return null;
  return row;
}

async function getEntryById(id) {
  const row = await getApprovedEntryRowById(id);
  if (!row) return null;
  return redactForDisplay(row);
}

module.exports = {
  hashSeed,
  pickDailyEntry,
  redactForDisplay,
  redactForPublicDetail,
  resolveDailyDisplay,
  resolveDailyPublicDetail,
  getEntryById,
  getApprovedEntryRowById,
  listApprovedForOrg
};