const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const schoolCatalogEntityIdService = require('../../services/school/schoolCatalogEntityIdService');
const { resolveJsonEntityCreateId } = require('../../services/school/schoolJsonEntityCreateIdService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/wordOfDay.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const WORD_OF_DAY_STATUSES = Object.freeze([
  'saved',
  'submitted',
  'approved',
  'rejected',
  'reopened',
  'on_hold',
  'archived'
]);

const WORD_TYPES = Object.freeze([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'prefix',
  'suffix',
  'phrase',
  'other'
]);

const WORD_TYPE_LABELS = Object.freeze({
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adjective',
  adverb: 'Adverb',
  prefix: 'Prefix',
  suffix: 'Suffix',
  phrase: 'Phrase',
  other: 'Other'
});

const DIFFICULTY_LEVELS = Object.freeze(['easy', 'medium', 'hard']);

const DIFFICULTY_LABELS = Object.freeze({
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard'
});

const EDITABLE_STATUSES = new Set(['saved', 'reopened']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 8000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!text && !allowEmpty) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 100, allowEmpty = true } = {}) {
  const text = cleanString(value, { max, allowEmpty });
  return text || '';
}

function normalizeStatus(value, fallback = 'saved') {
  const token = cleanString(value, { max: 40 }).toLowerCase();
  return WORD_OF_DAY_STATUSES.includes(token) ? token : fallback;
}

function normalizeWordType(value) {
  const token = cleanString(value, { max: 40 }).toLowerCase();
  return WORD_TYPES.includes(token) ? token : 'other';
}

function sanitizeWordTypes(raw, legacySingle = '') {
  let list = raw;
  if (typeof list === 'string') {
    const text = list.trim();
    if (!text) list = [];
    else {
      try {
        list = JSON.parse(text);
      } catch (_) {
        list = text.split(/[,;|]/g);
      }
    }
  }
  if (!Array.isArray(list) && legacySingle) {
    list = [legacySingle];
  }
  if (!Array.isArray(list)) list = [];
  const out = [];
  const seen = new Set();
  for (const row of list) {
    const token = normalizeWordType(row);
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  if (!out.length && legacySingle) {
    out.push(normalizeWordType(legacySingle));
  }
  return out.slice(0, WORD_TYPES.length);
}

function primaryWordTypeLabel(wordTypes = [], labels = WORD_TYPE_LABELS) {
  const list = Array.isArray(wordTypes) ? wordTypes : [];
  if (!list.length) return labels.other || 'Other';
  return list.map((key) => labels[key] || key).join(', ');
}

function normalizeWordKey(value) {
  return cleanString(value, { max: 200 }).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDifficulty(value) {
  const token = cleanString(value, { max: 20 }).toLowerCase();
  return DIFFICULTY_LEVELS.includes(token) ? token : 'medium';
}

function sanitizeExamples(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_) {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => cleanString(row, { max: 2000 }))
  .filter(Boolean)
  .slice(0, 50);
}

function sanitizeMediaRef(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    url: cleanString(src.url || src.href || src.path, { max: 2000, allowEmpty: true }),
    fileName: cleanString(src.fileName || src.name, { max: 260, allowEmpty: true }),
    mimeType: cleanString(src.mimeType || src.type, { max: 120, allowEmpty: true }),
    sizeBytes: Number.isFinite(Number(src.sizeBytes)) ? Math.max(0, Math.floor(Number(src.sizeBytes))) : 0
  };
}

function sanitizeVideoUrl(value) {
  const url = cleanString(value, { max: 2000, allowEmpty: true });
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) return '';
  return url;
}

function sanitizeWorkflow(raw = {}, existing = {}) {
  const merged = { ...(existing && typeof existing === 'object' ? existing : {}), ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    submittedAt: cleanString(merged.submittedAt, { max: 60, allowEmpty: true }),
    submittedBy: cleanId(merged.submittedBy, { allowEmpty: true }),
    submittedByName: cleanString(merged.submittedByName, { max: 160, allowEmpty: true }),
    approvedAt: cleanString(merged.approvedAt, { max: 60, allowEmpty: true }),
    approvedBy: cleanId(merged.approvedBy, { allowEmpty: true }),
    approvedByName: cleanString(merged.approvedByName, { max: 160, allowEmpty: true }),
    rejectedAt: cleanString(merged.rejectedAt, { max: 60, allowEmpty: true }),
    rejectedBy: cleanId(merged.rejectedBy, { allowEmpty: true }),
    rejectedByName: cleanString(merged.rejectedByName, { max: 160, allowEmpty: true }),
    reviewerNote: cleanString(merged.reviewerNote, { max: 2000, allowEmpty: true })
  };
}

function sanitizeDisplayStats(raw = {}, existing = {}) {
  const merged = { ...(existing && typeof existing === 'object' ? existing : {}), ...(raw && typeof raw === 'object' ? raw : {}) };
  const dates = Array.isArray(merged.displayDates)
    ? merged.displayDates.map((row) => cleanString(row, { max: 40 })).filter(Boolean)
    : [];
  return {
    displayCount: Number.isFinite(Number(merged.displayCount)) ? Math.max(0, Math.floor(Number(merged.displayCount))) : 0,
    displayDates: dates.slice(-500),
    lastDisplayedAt: cleanString(merged.lastDisplayedAt, { max: 60, allowEmpty: true }),
    lastDisplayedOnDate: cleanString(merged.lastDisplayedOnDate, { max: 20, allowEmpty: true })
  };
}

function sanitizeWordOfDayInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid Word of Day payload.');

  const wordTypes = sanitizeWordTypes(input.wordTypes, input.wordType);
  if (!wordTypes.length && !isUpdate) {
    wordTypes.push('noun');
  }

  const out = {
    orgId: cleanId(input.orgId, { allowEmpty: isUpdate }),
    word: cleanString(input.word, { max: 200, allowEmpty: isUpdate }),
    wordTypes,
    wordType: wordTypes[0] || normalizeWordType(input.wordType),
    pronunciation: cleanString(input.pronunciation, { max: 500, allowEmpty: true }),
    difficulty: normalizeDifficulty(input.difficulty),
    meaning: cleanString(input.meaning, { max: 8000, allowEmpty: true }),
    examples: sanitizeExamples(input.examples),
    photo: sanitizeMediaRef(input.photo),
    audio: sanitizeMediaRef(input.audio),
    videoUrl: sanitizeVideoUrl(input.videoUrl),
    status: normalizeStatus(input.status, 'saved'),
    authorUserId: cleanId(input.authorUserId, { allowEmpty: true }),
    authorName: cleanString(input.authorName, { max: 160, allowEmpty: true }),
    workflow: sanitizeWorkflow(input.workflow),
    display: sanitizeDisplayStats(input.display)
  };

  if (!isUpdate) {
    if (!out.orgId) throw new Error('Organization is required.');
    if (!out.word) throw new Error('Word is required.');
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { allowEmpty: false });
  }

  return out;
}

async function getAllWordOfDayEntries() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('Word of Day JSON parse error:', error.message);
      return [];
    }
    throw new Error('Failed to retrieve Word of Day entries.');
  }
}

async function saveAll(rows) {
  const payload = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
  await queueWrite(async () => fs.writeFile(dataPath, payload));
}

async function getWordOfDayById(id) {
  const all = await getAllWordOfDayEntries();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function getWordOfDayEntriesByOrg(orgId, filters = {}) {
  const all = await getAllWordOfDayEntries();
  const targetOrgId = String(orgId || '').trim();
  return all.filter((row) => {
    if (targetOrgId && !idsEqual(row?.orgId, targetOrgId)) return false;
    if (filters.status && String(row?.status || '') !== String(filters.status)) return false;
    if (filters.authorUserId && !idsEqual(row?.authorUserId, filters.authorUserId)) return false;
    return true;
  });
}

async function addWordOfDayEntry(input) {
  const all = await getAllWordOfDayEntries();
  const existingIds = new Set(all.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const sanitized = sanitizeWordOfDayInput(input, { isUpdate: false });
  const now = new Date().toISOString();
  const id = await resolveJsonEntityCreateId({
    requestedId: sanitized.id,
    existingIds,
    allocate: (opts) => schoolCatalogEntityIdService.allocateUniqueWordOfDayId(opts)
  });
  const row = {
    ...sanitized,
    id,
    audit: {
      createDateTime: now,
      lastUpdateDateTime: now,
      createdBy: cleanId(input?.audit?.createdBy || input?.createdBy, { allowEmpty: true }),
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { allowEmpty: true })
    }
  };
  all.push(row);
  await saveAll(all);
  return row;
}

async function updateWordOfDayEntry(id, input) {
  const all = await getAllWordOfDayEntries();
  const idx = all.findIndex((row) => idsEqual(row?.id, id));
  if (idx === -1) return null;
  const existing = all[idx];
  const sanitized = sanitizeWordOfDayInput({ ...existing, ...input }, { isUpdate: true });
  const merged = {
    ...existing,
    ...sanitized,
    id: existing.id,
    photo: input?.photo !== undefined ? sanitized.photo : existing.photo,
    audio: input?.audio !== undefined ? sanitized.audio : existing.audio,
    examples: input?.examples !== undefined ? sanitized.examples : existing.examples,
    workflow: input?.workflow !== undefined ? sanitized.workflow : existing.workflow,
    display: input?.display !== undefined ? sanitized.display : existing.display,
    publicFeedback: input?.publicFeedback !== undefined ? input.publicFeedback : existing.publicFeedback,
    audit: {
      ...(existing.audit || {}),
      ...(sanitized.audit && typeof sanitized.audit === 'object' ? sanitized.audit : {}),
      lastUpdateDateTime: new Date().toISOString(),
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { allowEmpty: true }) || existing.audit?.updatedBy || ''
    }
  };
  if (input?.status !== undefined) merged.status = normalizeStatus(input.status, existing.status || 'saved');
  all[idx] = merged;
  await saveAll(all);
  return merged;
}

async function deleteWordOfDayEntry(id) {
  const all = await getAllWordOfDayEntries();
  const before = all.length;
  const kept = all.filter((row) => !idsEqual(row?.id, id));
  if (kept.length === before) return false;
  await saveAll(kept);
  return true;
}

module.exports = {
  WORD_OF_DAY_STATUSES,
  WORD_TYPES,
  WORD_TYPE_LABELS,
  DIFFICULTY_LEVELS,
  DIFFICULTY_LABELS,
  EDITABLE_STATUSES,
  sanitizeWordOfDayInput,
  sanitizeWordTypes,
  normalizeDifficulty,
  primaryWordTypeLabel,
  normalizeWordKey,
  sanitizeExamples,
  getAllWordOfDayEntries,
  getWordOfDayById,
  getWordOfDayEntriesByOrg,
  addWordOfDayEntry,
  updateWordOfDayEntry,
  deleteWordOfDayEntry
};