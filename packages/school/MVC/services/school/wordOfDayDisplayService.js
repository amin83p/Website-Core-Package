'use strict';

const crypto = require('crypto');
const schoolRepositories = require('../../repositories/school');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const wordOfDayPolicyService = require('./wordOfDayPolicyService');
const wordOfDayDisplayScheduleService = require('./wordOfDayDisplayScheduleService');
const wordOfDayDisplayScheduleModel = require('../../models/school/wordOfDayDisplayScheduleModel');
const wordOfDayPolicyModel = require('../../models/school/wordOfDayPolicyModel');
const { enrichEntryMedia } = require('./wordOfDayService');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_CARRY_FORWARD_DAYS = 366;

function hashSeed(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function shiftDateKey(dateKey, deltaDays) {
  const key = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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

function applyDisplayPolicy(entry, policy = null) {
  if (!entry || typeof entry !== 'object') return entry;
  const resolved = wordOfDayPolicyService.resolvePolicy(policy || {});
  const next = { ...entry };
  if (!resolved.showAuthorOnDisplay) {
    next.authorName = '';
    next.authorFirstName = '';
  }
  if (!resolved.showDifficultyOnDisplay) {
    next.difficulty = '';
    next.difficultyLabel = '';
  }
  return next;
}

function redactForDisplay(row, policy = null) {
  if (!row) return null;
  const wordTypes = Array.isArray(row.wordTypes) && row.wordTypes.length
    ? row.wordTypes
    : (row.wordType ? [row.wordType] : []);
  const typeLabels = wordTypes.map((key) => wordOfDayModel.WORD_TYPE_LABELS[key] || key).filter(Boolean);
  const authorName = String(row.authorName || '').trim();
  const base = {
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
  return applyDisplayPolicy(base, policy);
}

function redactForPublicDetail(row, policy = null) {
  if (!row || String(row.status || '').toLowerCase() !== 'approved') return null;
  const base = redactForDisplay(row, policy);
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

async function pickEntryForCalendarDate(orgId, dateKey) {
  const mode = await wordOfDayDisplayScheduleModel.getDateSlotMode(orgId, dateKey);
  if (mode === 'excluded') return null;
  const scheduled = await wordOfDayDisplayScheduleService.resolveScheduledEntryId(orgId, dateKey);
  if (scheduled) return scheduled;
  const approved = await listApprovedForOrg(orgId);
  return pickDailyEntry(approved, orgId, dateKey);
}

async function resolveEffectiveDisplay(orgId, requestedDateKey) {
  const targetOrgId = String(orgId || '').trim();
  const requested = String(requestedDateKey || '').trim();
  if (!targetOrgId || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return {
      orgId: targetOrgId,
      requestedDateKey: requested,
      effectiveDateKey: requested,
      carriedForward: false,
      entry: null
    };
  }

  let cursor = requested;
  for (let hops = 0; hops < MAX_CARRY_FORWARD_DAYS; hops += 1) {
    const mode = await wordOfDayDisplayScheduleModel.getDateSlotMode(targetOrgId, cursor);
    if (mode === 'excluded') {
      const prev = shiftDateKey(cursor, -1);
      if (!prev || prev >= cursor) break;
      cursor = prev;
      continue;
    }
    const picked = await pickEntryForCalendarDate(targetOrgId, cursor);
    if (picked) {
      return {
        orgId: targetOrgId,
        requestedDateKey: requested,
        effectiveDateKey: cursor,
        carriedForward: cursor !== requested,
        entry: picked
      };
    }
    const prev = shiftDateKey(cursor, -1);
    if (!prev || prev >= cursor) break;
    cursor = prev;
  }

  return {
    orgId: targetOrgId,
    requestedDateKey: requested,
    effectiveDateKey: requested,
    carriedForward: false,
    entry: null
  };
}

async function pickEntryForDate(orgId, dateKey) {
  const resolved = await resolveEffectiveDisplay(orgId, dateKey);
  return resolved.entry;
}

async function resolvePolicyForOrg(orgId, policy) {
  if (policy && typeof policy === 'object') {
    return wordOfDayPolicyService.resolvePolicy(policy);
  }
  return wordOfDayPolicyModel.getPolicyForOrg(orgId);
}

async function resolveDailyDisplay({ orgId, dateKey, recordAnalytics = true, policy = null }) {
  const targetOrgId = String(orgId || '').trim();
  const targetDate = String(dateKey || '').trim();
  if (!targetOrgId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return {
      orgId: targetOrgId,
      dateKey: targetDate,
      requestedDateKey: targetDate,
      effectiveDateKey: targetDate,
      carriedForward: false,
      entry: null
    };
  }
  const displayPolicy = await resolvePolicyForOrg(targetOrgId, policy);
  const resolved = await resolveEffectiveDisplay(targetOrgId, targetDate);
  let picked = resolved.entry;
  if (!picked) {
    return {
      orgId: targetOrgId,
      dateKey: targetDate,
      requestedDateKey: resolved.requestedDateKey,
      effectiveDateKey: resolved.effectiveDateKey,
      carriedForward: resolved.carriedForward,
      entry: null
    };
  }
  if (recordAnalytics) {
    picked = await recordDisplayForDate(picked, targetOrgId, resolved.effectiveDateKey);
  }
  return {
    orgId: targetOrgId,
    dateKey: targetDate,
    requestedDateKey: resolved.requestedDateKey,
    effectiveDateKey: resolved.effectiveDateKey,
    carriedForward: resolved.carriedForward,
    entry: redactForDisplay(picked, displayPolicy)
  };
}

async function resolveDailyPublicDetail({ orgId, dateKey, recordAnalytics = true, policy = null }) {
  const targetOrgId = String(orgId || '').trim();
  const targetDate = String(dateKey || '').trim();
  if (!targetOrgId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return {
      orgId: targetOrgId,
      dateKey: targetDate,
      requestedDateKey: targetDate,
      effectiveDateKey: targetDate,
      carriedForward: false,
      entry: null
    };
  }
  const displayPolicy = await resolvePolicyForOrg(targetOrgId, policy);
  const resolved = await resolveEffectiveDisplay(targetOrgId, targetDate);
  let picked = resolved.entry;
  if (!picked) {
    return {
      orgId: targetOrgId,
      dateKey: targetDate,
      requestedDateKey: resolved.requestedDateKey,
      effectiveDateKey: resolved.effectiveDateKey,
      carriedForward: resolved.carriedForward,
      entry: null
    };
  }
  if (recordAnalytics) {
    picked = await recordDisplayForDate(picked, targetOrgId, resolved.effectiveDateKey);
  }
  return {
    orgId: targetOrgId,
    dateKey: targetDate,
    requestedDateKey: resolved.requestedDateKey,
    effectiveDateKey: resolved.effectiveDateKey,
    carriedForward: resolved.carriedForward,
    entry: redactForPublicDetail(picked, displayPolicy)
  };
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
  shiftDateKey,
  pickDailyEntry,
  pickEntryForCalendarDate,
  pickEntryForDate,
  resolveEffectiveDisplay,
  applyDisplayPolicy,
  redactForDisplay,
  redactForPublicDetail,
  resolveDailyDisplay,
  resolveDailyPublicDetail,
  getEntryById,
  getApprovedEntryRowById,
  listApprovedForOrg
};