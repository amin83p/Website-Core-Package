const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../data/pteQuestionVersions.json');
const STATUS_VALUES = new Set(['draft', 'published', 'retired', 'archived']);
const TEST_TYPE_VALUES = new Set(['core', 'academic']);
const CORE_ONLY_TYPES = new Set(['speaking_respond_to_situation', 'writing_write_email']);
const ACADEMIC_ONLY_TYPES = new Set([
  'speaking_answer_short_question',
  'writing_summarize_written_text',
  'writing_short_answer',
  'writing_essay'
]);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 120, allowEmpty = true } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token && allowEmpty) return '';
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function cleanIso(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanStringArray(values = [], { maxItem = 200 } = {}) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const clean = cleanString(value, { max: maxItem, allowEmpty: true }) || '';
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function cleanPositiveNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Numeric fields must be zero or positive.');
  return Number(numeric.toFixed(6));
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Integer fields must be zero or positive integers.');
  }
  return numeric;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback === true;
  if (typeof value === 'boolean') return value;
  const token = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback === true;
}

function inferTestTypeByQuestionType(questionType = '') {
  const token = cleanString(questionType, { max: 120, allowEmpty: true }).toLowerCase();
  if (CORE_ONLY_TYPES.has(token)) return 'core';
  if (ACADEMIC_ONLY_TYPES.has(token)) return 'academic';
  return 'academic';
}

function normalizeTestType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (TEST_TYPE_VALUES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toLowerCase();
  return TEST_TYPE_VALUES.has(fallbackToken) ? fallbackToken : inferTestTypeByQuestionType('');
}

function normalizeScoringConfigMode(value, fallback = 'legacy_full') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (['global', 'override', 'legacy_full'].includes(token)) return token;
  return ['global', 'override', 'legacy_full'].includes(fallback) ? fallback : 'legacy_full';
}

function sanitizeMediaAssets(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const seen = new Set();
  list.forEach((raw, index) => {
    const row = isPlainObject(raw) ? raw : {};
    const id = cleanId(row.id, { max: 140, allowEmpty: true }) || `QMEDIA-${Date.now()}-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: cleanString(row.name, { max: 260, allowEmpty: true }) || '',
      originalName: cleanString(row.originalName, { max: 260, allowEmpty: true }) || '',
      filename: cleanString(row.filename, { max: 260, allowEmpty: true }) || '',
      path: cleanString(row.path, { max: 1200, allowEmpty: true }) || '',
      url: cleanString(row.url, { max: 1200, allowEmpty: true }) || '',
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }) || '',
      size: cleanPositiveNumber(row.size, 0),
      uploadDate: cleanIso(row.uploadDate, { allowEmpty: true }) || new Date().toISOString(),
      comment: cleanString(row.comment, { max: 1200, allowEmpty: true }) || ''
    });
  });
  return out;
}

function sanitizeCreator(rawCreator = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const type = cleanString(input.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system' ? 'system' : 'user';
  const userId = cleanId(input.userId, { max: 120, allowEmpty: true }) || '';
  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  return {
    type: 'user',
    displayName: cleanString(input.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username, { max: 120, allowEmpty: true }) || '',
    email: cleanString(input.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const input = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const nowIso = new Date().toISOString();
  const actor = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');
  return {
    createUser: cleanString(existing.createUser || input.createUser, { max: 120, allowEmpty: true }) || actor,
    createDateTime: cleanIso(existing.createDateTime || input.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(input.lastUpdateUser, { max: 120, allowEmpty: true }) || actor,
    lastUpdateDateTime: cleanIso(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizePublishingMeta(rawMeta = {}, existingMeta = {}) {
  const input = isPlainObject(rawMeta) ? rawMeta : {};
  const existing = isPlainObject(existingMeta) ? existingMeta : {};
  return {
    publishedBy: cleanId(input.publishedBy || existing.publishedBy, { max: 120, allowEmpty: true }) || '',
    publishedAt: cleanIso(input.publishedAt || existing.publishedAt, { allowEmpty: true }) || '',
    retiredBy: cleanId(input.retiredBy || existing.retiredBy, { max: 120, allowEmpty: true }) || '',
    retiredAt: cleanIso(input.retiredAt || existing.retiredAt, { allowEmpty: true }) || '',
    archivedBy: cleanId(input.archivedBy || existing.archivedBy, { max: 120, allowEmpty: true }) || '',
    archivedAt: cleanIso(input.archivedAt || existing.archivedAt, { allowEmpty: true }) || ''
  };
}

function sanitizeValidation(rawValidation = {}, existingValidation = {}) {
  const input = isPlainObject(rawValidation) ? rawValidation : {};
  const existing = isPlainObject(existingValidation) ? existingValidation : {};
  return {
    isValid: input.isValid === true,
    errors: cleanStringArray(input.errors !== undefined ? input.errors : existing.errors || [], { maxItem: 500 }),
    validatedAt: cleanIso(input.validatedAt || existing.validatedAt, { allowEmpty: true }) || '',
    validatedBy: cleanId(input.validatedBy || existing.validatedBy, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeUsageMeta(rawUsage = {}, existingUsage = {}) {
  const input = isPlainObject(rawUsage) ? rawUsage : {};
  const existing = isPlainObject(existingUsage) ? existingUsage : {};
  return {
    testsCount: cleanNonNegativeInteger(input.testsCount, existing.testsCount || 0),
    assignmentsCount: cleanNonNegativeInteger(input.assignmentsCount, existing.assignmentsCount || 0),
    attemptsCount: cleanNonNegativeInteger(input.attemptsCount, existing.attemptsCount || 0)
  };
}

function sanitizeQuestionVersion(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;

  const statusRaw = cleanString(input.status || existing?.status || 'draft', { max: 30, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusRaw) ? statusRaw : 'draft';

  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const skill = cleanString(input.skill || existing?.skill, { max: 40, allowEmpty: true }).toLowerCase();
  const questionType = cleanString(input.questionType || existing?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  const testType = normalizeTestType(
    input.testType || existing?.testType,
    inferTestTypeByQuestionType(questionType)
  );
  if (!skill) throw new Error('skill is required.');
  if (!questionType) throw new Error('questionType is required.');

  const title = cleanString(input.title || existing?.title, { max: 260, allowEmpty: true });
  if (!title) throw new Error('title is required.');

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });
  const payload = isPlainObject(input.payload) ? input.payload : (isPlainObject(existing?.payload) ? existing.payload : {});
  const scoringConfig = isPlainObject(input.scoringConfig) ? input.scoringConfig : (isPlainObject(existing?.scoringConfig) ? existing.scoringConfig : {});
  const scoringConfigMode = normalizeScoringConfigMode(
    input.scoringConfigMode,
    existing ? normalizeScoringConfigMode(existing.scoringConfigMode, 'legacy_full') : 'legacy_full'
  );
  const useQuestionScoringOverride = input.useQuestionScoringOverride === undefined
    ? (existing ? existing.useQuestionScoringOverride === true : scoringConfigMode === 'override')
    : cleanBoolean(
      input.useQuestionScoringOverride,
      existing ? existing.useQuestionScoringOverride === true : scoringConfigMode === 'override'
    );
  const responseContract = isPlainObject(input.responseContract)
    ? input.responseContract
    : (isPlainObject(existing?.responseContract) ? existing.responseContract : {});

  return {
    id: cleanId(input.id || existing?.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    familyId: cleanId(input.familyId || existing?.familyId, { max: 140, allowEmpty: true }) || '',
    parentVersionId: cleanId(input.parentVersionId || existing?.parentVersionId, { max: 120, allowEmpty: true }) || '',
    revisionNumber: cleanNonNegativeInteger(input.revisionNumber, existing?.revisionNumber || 1) || 1,
    isLatestRevision: input.isLatestRevision === undefined
      ? (existing ? existing.isLatestRevision !== false : true)
      : input.isLatestRevision === true,
    status,
    code: cleanString(input.code || existing?.code, { max: 120, allowEmpty: true }) || '',
    title,
    testType,
    skill,
    questionType,
    practiceEnabled: cleanBoolean(
      input.practiceEnabled,
      existing ? existing.practiceEnabled !== false : true
    ),
    difficulty: cleanString(input.difficulty || existing?.difficulty || 'medium', { max: 40, allowEmpty: true }) || 'medium',
    tags: cleanStringArray(input.tags !== undefined ? input.tags : existing?.tags || [], { maxItem: 100 }),
    instructions: cleanString(input.instructions || existing?.instructions, { max: 10000, allowEmpty: true }) || '',
    internalNotes: cleanString(input.internalNotes || existing?.internalNotes, { max: 10000, allowEmpty: true }) || '',
    payload,
    scoringConfig,
    scoringConfigMode,
    useQuestionScoringOverride,
    responseContract,
    mediaAssets: sanitizeMediaAssets(input.mediaAssets !== undefined ? input.mediaAssets : existing?.mediaAssets || []),
    validation: sanitizeValidation(input.validation || {}, existing?.validation || {}),
    usageMeta: sanitizeUsageMeta(input.usageMeta || {}, existing?.usageMeta || {}),
    publishingMeta: sanitizePublishingMeta(input.publishingMeta || {}, existing?.publishingMeta || {}),
    creator,
    audit
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(rows = []) {
  const existingIds = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean));
  const dateToken = buildDateToken();
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEQ${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PTEQ${Date.now()}`;
}

function generateFamilyId(rows = []) {
  const existingIds = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.familyId || '').trim())
    .filter(Boolean));
  const dateToken = buildDateToken();
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEQF${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PTEQF${Date.now()}`;
}

async function getAllQuestionVersions() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE question versions.');
  }
}

async function getQuestionVersionById(id) {
  const rows = await getAllQuestionVersions();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addQuestionVersion(payload) {
  return queueWrite(async () => {
    const rows = await getAllQuestionVersions();
    const sanitized = sanitizeQuestionVersion(payload);
    sanitized.id = sanitized.id || generateId(rows);
    sanitized.familyId = sanitized.familyId || generateFamilyId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`Question version id '${sanitized.id}' already exists.`);
    }
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateQuestionVersion(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllQuestionVersions();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE question version not found.');
    const existing = rows[index];
    const merged = sanitizeQuestionVersion({ ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id }, { existing });
    rows[index] = { ...existing, ...merged, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteQuestionVersion(id) {
  return queueWrite(async () => {
    const rows = await getAllQuestionVersions();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  sanitizeQuestionVersion,
  getAllQuestionVersions,
  getQuestionVersionById,
  addQuestionVersion,
  updateQuestionVersion,
  deleteQuestionVersion,
  generateId,
  generateFamilyId
};
