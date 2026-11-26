'use strict';

const crypto = require('crypto');
const schoolRepositories = require('../../repositories/school');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

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

function redactForDisplay(row) {
  if (!row) return null;
  const wordTypes = Array.isArray(row.wordTypes) && row.wordTypes.length
    ? row.wordTypes
    : (row.wordType ? [row.wordType] : []);
  return {
    id: row.id,
    word: row.word,
    wordTypes,
    wordType: wordTypes[0] || row.wordType || '',
    wordTypeLabel: wordOfDayModel.primaryWordTypeLabel(wordTypes),
    pronunciation: row.pronunciation,
    difficulty: row.difficulty,
    difficultyLabel: wordOfDayModel.DIFFICULTY_LABELS[row.difficulty] || row.difficulty,
    meaning: row.meaning,
    examples: Array.isArray(row.examples) ? row.examples : [],
    photo: row.photo || {},
    audio: row.audio || {},
    videoUrl: row.videoUrl || '',
    displayCount: Number(row?.display?.displayCount || 0),
    authorName: row.authorName || '',
    status: row.status
  };
}

async function listApprovedForOrg(orgId) {
  const rows = await schoolRepositories.wordOfDay.list({
    orgId: String(orgId || '').trim(),
    status: 'approved'
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
    return { dateKey: targetDate, entry: null };
  }
  const approved = await listApprovedForOrg(targetOrgId);
  let picked = pickDailyEntry(approved, targetOrgId, targetDate);
  if (!picked) return { dateKey: targetDate, entry: null };
  if (recordAnalytics) {
    picked = await recordDisplayForDate(picked, targetOrgId, targetDate);
  }
  return { dateKey: targetDate, entry: redactForDisplay(picked) };
}

async function getEntryById(id) {
  const row = await schoolRepositories.wordOfDay.getById(id, {});
  if (!row || String(row.status || '').toLowerCase() !== 'approved') return null;
  return redactForDisplay(row);
}

module.exports = {
  hashSeed,
  pickDailyEntry,
  redactForDisplay,
  resolveDailyDisplay,
  getEntryById,
  listApprovedForOrg
};