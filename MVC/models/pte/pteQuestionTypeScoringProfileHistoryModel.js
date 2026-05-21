const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../data/pteQuestionTypeScoringProfileHistory.json');
const VALID_TEST_TYPES = new Set(['core', 'academic']);

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

function cleanInteger(value, fallback = 0, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return Math.max(min, Number(fallback || 0));
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < min) {
    throw new Error(`Integer value must be at least ${min}.`);
  }
  return numeric;
}

function normalizeTestType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (VALID_TEST_TYPES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toLowerCase();
  return VALID_TEST_TYPES.has(fallbackToken) ? fallbackToken : '';
}

function sanitizeCreator(rawCreator = {}, fallback = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const source = isPlainObject(fallback) ? fallback : {};
  const type = cleanString(input.type || source.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system'
    ? 'system'
    : 'user';
  const userId = cleanId(input.userId || source.userId, { max: 120, allowEmpty: true }) || '';
  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId || source.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  return {
    type: 'user',
    displayName: cleanString(input.displayName || source.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username || source.username, { max: 120, allowEmpty: true }) || '',
    email: cleanString(input.email || source.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId || source.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const nowIso = new Date().toISOString();
  const actor = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(source.createUser || existing.createUser, { max: 120, allowEmpty: true }) || actor,
    createDateTime: cleanIso(source.createDateTime || existing.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser || existing.lastUpdateUser, { max: 120, allowEmpty: true }) || actor,
    lastUpdateDateTime: cleanIso(source.lastUpdateDateTime || existing.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeHistoryRecord(raw = {}, existing = null) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};

  const orgId = cleanId(input.orgId || prev.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  const profileId = cleanId(input.profileId || prev.profileId, { max: 120, allowEmpty: false });
  if (!profileId) throw new Error('profileId is required.');
  const questionType = cleanString(input.questionType || prev.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  if (!questionType) throw new Error('questionType is required.');
  const testType = normalizeTestType(input.testType || prev.testType, prev.testType || '');
  if (!testType) throw new Error('testType is required.');

  const fromVersion = cleanInteger(input.fromVersion, cleanInteger(prev.fromVersion, 1, { min: 1 }), { min: 1 });
  const toVersion = cleanInteger(input.toVersion, cleanInteger(prev.toVersion, 1, { min: 1 }), { min: 1 });
  const previousScoringConfig = isPlainObject(input.previousScoringConfig)
    ? input.previousScoringConfig
    : (isPlainObject(prev.previousScoringConfig) ? prev.previousScoringConfig : {});
  const nextScoringConfig = isPlainObject(input.nextScoringConfig)
    ? input.nextScoringConfig
    : (isPlainObject(prev.nextScoringConfig) ? prev.nextScoringConfig : {});
  const changeNote = cleanString(input.changeNote || prev.changeNote, { max: 1000, allowEmpty: true }) || '';
  const metadata = isPlainObject(input.metadata) ? input.metadata : (isPlainObject(prev.metadata) ? prev.metadata : {});

  const creator = sanitizeCreator(input.creator || prev.creator, {
    type: 'system',
    orgId
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev.audit || null });
  const nowIso = new Date().toISOString();

  return {
    ...prev,
    id: cleanId(input.id || prev.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    profileId,
    testType,
    questionType,
    fromVersion,
    toVersion,
    previousScoringConfig,
    nextScoringConfig,
    changeNote,
    metadata,
    creator,
    audit,
    createdAt: cleanIso(prev.createdAt || input.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(rows = []) {
  const existingIds = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = buildDateToken();
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTESH${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PTESH${Date.now()}`;
}

async function getAllHistory() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE scoring profile history.');
  }
}

async function addHistory(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllHistory();
    const normalized = sanitizeHistoryRecord(payload, null);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`PTE scoring profile history id '${normalized.id}' already exists.`);
    }
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

module.exports = {
  sanitizeHistoryRecord,
  getAllHistory,
  addHistory
};
