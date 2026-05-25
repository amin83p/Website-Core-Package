const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteTestVersions.json');
const STATUS_VALUES = new Set(['draft', 'published', 'archived']);
const VALID_SKILLS = Object.freeze(['speaking', 'writing', 'reading', 'listening']);

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

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Integer fields must be zero or positive integers.');
  }
  return numeric;
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
    warnings: cleanStringArray(input.warnings !== undefined ? input.warnings : existing.warnings || [], { maxItem: 500 }),
    validatedAt: cleanIso(input.validatedAt || existing.validatedAt, { allowEmpty: true }) || '',
    validatedBy: cleanId(input.validatedBy || existing.validatedBy, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeUsageMeta(rawUsage = {}, existingUsage = {}) {
  const input = isPlainObject(rawUsage) ? rawUsage : {};
  const existing = isPlainObject(existingUsage) ? existingUsage : {};
  return {
    assignmentsCount: cleanNonNegativeInteger(input.assignmentsCount, existing.assignmentsCount || 0),
    attemptsCount: cleanNonNegativeInteger(input.attemptsCount, existing.attemptsCount || 0)
  };
}

function normalizeQuestionRef(raw = {}, skill = '', index = 0) {
  const input = isPlainObject(raw) ? raw : {};
  const questionVersionId = cleanId(
    input.questionVersionId || input.id || '',
    { max: 120, allowEmpty: false }
  );
  if (!questionVersionId) throw new Error(`Question reference at row ${index + 1} is missing questionVersionId.`);

  return {
    questionVersionId,
    questionFamilyId: cleanId(input.questionFamilyId, { max: 140, allowEmpty: true }) || '',
    questionCode: cleanString(input.questionCode, { max: 120, allowEmpty: true }) || '',
    questionTitle: cleanString(input.questionTitle, { max: 260, allowEmpty: true }) || '',
    questionType: cleanString(input.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
    skill: cleanString(input.skill || skill, { max: 40, allowEmpty: true }).toLowerCase() || skill,
    statusAtSelection: cleanString(input.statusAtSelection, { max: 40, allowEmpty: true }).toLowerCase() || '',
    sequenceNo: cleanNonNegativeInteger(input.sequenceNo, index + 1) || (index + 1)
  };
}

function sanitizeSkillQuestionRefs(rawRows = [], skill = '') {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const seen = new Set();
  const out = [];
  list.forEach((raw, index) => {
    const row = normalizeQuestionRef(raw, skill, index);
    const key = cleanId(row.questionVersionId, { max: 120, allowEmpty: true }) || '';
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      ...row,
      skill,
      sequenceNo: out.length + 1
    });
  });
  return out;
}

function sanitizeAllocations(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const fallback = isPlainObject(existing) ? existing : {};
  const out = {};
  VALID_SKILLS.forEach((skill) => {
    const sourceRows = input[skill] !== undefined ? input[skill] : fallback[skill];
    out[skill] = sanitizeSkillQuestionRefs(sourceRows, skill);
  });
  return out;
}

function sanitizeTestVersion(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;

  const statusRaw = cleanString(input.status || existing?.status || 'draft', { max: 30, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusRaw) ? statusRaw : 'draft';

  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const title = cleanString(input.title || existing?.title, { max: 260, allowEmpty: true });
  if (!title) throw new Error('title is required.');

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });

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
    description: cleanString(input.description || existing?.description, { max: 5000, allowEmpty: true }) || '',
    instructions: cleanString(input.instructions || existing?.instructions, { max: 10000, allowEmpty: true }) || '',
    tags: cleanStringArray(input.tags !== undefined ? input.tags : existing?.tags || [], { maxItem: 100 }),
    allocations: sanitizeAllocations(input.allocations, existing?.allocations || {}),
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
    const candidate = `PTET${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PTET${Date.now()}`;
}

function generateFamilyId(rows = []) {
  const existingIds = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.familyId || '').trim())
    .filter(Boolean));
  const dateToken = buildDateToken();
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTETF${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PTETF${Date.now()}`;
}

async function getAllTestVersions() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE test versions.');
  }
}

async function getTestVersionById(id) {
  const rows = await getAllTestVersions();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addTestVersion(payload) {
  return queueWrite(async () => {
    const rows = await getAllTestVersions();
    const sanitized = sanitizeTestVersion(payload);
    sanitized.id = sanitized.id || generateId(rows);
    sanitized.familyId = sanitized.familyId || generateFamilyId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`Test version id '${sanitized.id}' already exists.`);
    }
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateTestVersion(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllTestVersions();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE test version not found.');
    const existing = rows[index];
    const merged = sanitizeTestVersion({ ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id }, { existing });
    rows[index] = { ...existing, ...merged, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteTestVersion(id) {
  return queueWrite(async () => {
    const rows = await getAllTestVersions();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  VALID_SKILLS,
  sanitizeTestVersion,
  getAllTestVersions,
  getTestVersionById,
  addTestVersion,
  updateTestVersion,
  deleteTestVersion,
  generateId,
  generateFamilyId
};
