const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../data/pteAiScoringSettings.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 160, allowEmpty = true } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token && allowEmpty) return '';
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(existingRows = []) {
  const existing = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = buildDateToken();
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEAISS${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTEAISS${Date.now()}`;
}

function sanitizeCreator(rawCreator = {}, fallback = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const fallbackInput = isPlainObject(fallback) ? fallback : {};
  const type = cleanString(input.type || fallbackInput.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system'
    ? 'system'
    : 'user';
  const userId = cleanId(input.userId || fallbackInput.userId, { max: 160, allowEmpty: true }) || '';

  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 160, allowEmpty: true }) || ''
    };
  }

  return {
    type: 'user',
    displayName: cleanString(input.displayName || fallbackInput.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username || fallbackInput.username, { max: 140, allowEmpty: true }) || '',
    email: cleanString(input.email || fallbackInput.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 160, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const nowIso = new Date().toISOString();
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorType = String(creator?.type || '').toLowerCase();
  const creatorUser = creatorType === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 160, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(source.createUser || existing.createUser, { max: 160, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIsoDateTime(source.createDateTime || existing.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser, { max: 160, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function normalizeQuestionType(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toLowerCase();
}

function normalizeScoringSettingRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 160, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || base.orgId, { max: 160, allowEmpty: false });
  const questionType = normalizeQuestionType(input.questionType || base.questionType);
  const providerRecordId = cleanId(input.providerRecordId || base.providerRecordId, { max: 160, allowEmpty: true }) || '';
  const isActive = hasOwn(input, 'isActive')
    ? normalizeBoolean(input.isActive, true)
    : normalizeBoolean(base.isActive, true);
  const notes = hasOwn(input, 'notes')
    ? (cleanString(input.notes, { max: 4000, allowEmpty: true }) || '')
    : (cleanString(base.notes, { max: 4000, allowEmpty: true }) || '');
  const creator = sanitizeCreator(input.creator || base.creator, {
    type: 'user',
    userId: input.userId || base.userId || '',
    orgId,
    displayName: input.userId || base.userId || ''
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: base.audit || null });

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!questionType) throw new Error('Question type is required.');
    if (!providerRecordId) throw new Error('API provider selection is required.');
  }

  return {
    ...base,
    id,
    orgId,
    questionType,
    providerRecordId,
    isActive,
    notes,
    creator,
    audit,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function sanitizeScoringSettingForRead(record = {}) {
  return isPlainObject(record) ? { ...record } : {};
}

async function getAllSettings() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE AI scoring settings.');
  }
}

async function getSettingById(id) {
  const rows = await getAllSettings();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function getSettingByOrgQuestionType(orgId, questionType) {
  const orgToken = toPublicId(orgId);
  const typeToken = normalizeQuestionType(questionType);
  if (!orgToken || !typeToken) return null;
  const rows = await getAllSettings();
  return rows.find((row) => idsEqual(row?.orgId, orgToken) && normalizeQuestionType(row?.questionType) === typeToken) || null;
}

async function upsertSettingForOrgQuestionType(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllSettings();
    const incomingOrgId = cleanId(payload.orgId, { max: 160, allowEmpty: false });
    const incomingQuestionType = normalizeQuestionType(payload.questionType);
    const index = rows.findIndex((row) => idsEqual(row?.orgId, incomingOrgId) && normalizeQuestionType(row?.questionType) === incomingQuestionType);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizeScoringSettingRecord(
      {
        ...(existing || {}),
        ...(isPlainObject(payload) ? payload : {}),
        id: existing?.id || payload.id || '',
        orgId: incomingOrgId,
        questionType: incomingQuestionType
      },
      existing,
      true
    );
    normalized.id = normalized.id || generateId(rows);

    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);

    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteSetting(id, scope = {}) {
  return queueWrite(async () => {
    const rows = await getAllSettings();
    const scopedOrgId = toPublicId(scope?.orgId || '');
    const filtered = rows.filter((row) => {
      if (!idsEqual(row?.id, id)) return true;
      if (scopedOrgId && !idsEqual(row?.orgId, scopedOrgId)) return true;
      return false;
    });
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  normalizeScoringSettingRecord,
  normalizeQuestionType,
  sanitizeScoringSettingForRead,
  getAllSettings,
  getSettingById,
  getSettingByOrgQuestionType,
  upsertSettingForOrgQuestionType,
  deleteSetting,
  generateId
};
