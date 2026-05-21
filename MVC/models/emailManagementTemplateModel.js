const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/emailManagementTemplates.json');

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

function cleanString(value, { max = 8000, allowEmpty = true } = {}) {
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
    const candidate = `EMTPL${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `EMTPL${Date.now()}`;
}

function sanitizeCreator(rawCreator = {}, fallback = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const fallbackInput = isPlainObject(fallback) ? fallback : {};
  const type = cleanString(input.type || fallbackInput.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system'
    ? 'system'
    : 'user';
  const userId = cleanId(input.userId || fallbackInput.userId, { max: 120, allowEmpty: true }) || '';

  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }

  return {
    type: 'user',
    displayName: cleanString(input.displayName || fallbackInput.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username || fallbackInput.username, { max: 140, allowEmpty: true }) || '',
    email: cleanString(input.email || fallbackInput.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const nowIso = new Date().toISOString();
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorType = String(creator?.type || '').toLowerCase();
  const creatorUser = creatorType === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(source.createUser || existing.createUser, { max: 120, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIsoDateTime(source.createDateTime || existing.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
}

function normalizeTemplateRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const sectionId = normalizeKeyToken(input.sectionId || base.sectionId || '');
  const operationId = normalizeKeyToken(input.operationId || base.operationId || '');
  const recipientTemplate = cleanString(
    hasOwn(input, 'recipientTemplate') ? input.recipientTemplate : base.recipientTemplate,
    { max: 600, allowEmpty: true }
  );
  const senderTemplate = cleanString(
    hasOwn(input, 'senderTemplate') ? input.senderTemplate : base.senderTemplate,
    { max: 320, allowEmpty: true }
  );
  const subjectTemplate = cleanString(
    hasOwn(input, 'subjectTemplate') ? input.subjectTemplate : base.subjectTemplate,
    { max: 260, allowEmpty: true }
  );
  const bodyTemplate = cleanString(
    hasOwn(input, 'bodyTemplate') ? input.bodyTemplate : base.bodyTemplate,
    { max: 30000, allowEmpty: true }
  );
  const isActive = hasOwn(input, 'isActive')
    ? normalizeBoolean(input.isActive, true)
    : normalizeBoolean(base.isActive, true);

  const creator = sanitizeCreator(input.creator || base.creator, {
    type: 'user',
    orgId,
    displayName: cleanString(input?.audit?.createUser || base?.audit?.createUser, { max: 180, allowEmpty: true }) || ''
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: base.audit || null });

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!sectionId) throw new Error('Section is required.');
    if (!operationId) throw new Error('Operation is required.');
    if (!senderTemplate) throw new Error('Sender template is required.');
    if (!recipientTemplate) throw new Error('Recipient template is required.');
    if (!subjectTemplate) throw new Error('Subject template is required.');
    if (!bodyTemplate) throw new Error('Body template is required.');
  }

  return {
    ...base,
    id,
    orgId,
    sectionId,
    operationId,
    senderTemplate: senderTemplate || '',
    recipientTemplate: recipientTemplate || '',
    subjectTemplate: subjectTemplate || '',
    bodyTemplate: bodyTemplate || '',
    isActive,
    creator,
    audit,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function sanitizeTemplateForRead(record = {}) {
  const row = isPlainObject(record) ? { ...record } : {};
  row.sectionId = normalizeKeyToken(row.sectionId || '');
  row.operationId = normalizeKeyToken(row.operationId || '');
  return row;
}

function buildCompositeKey(row = {}) {
  return `${toPublicId(row?.orgId) || ''}::${normalizeKeyToken(row?.sectionId || '')}::${normalizeKeyToken(row?.operationId || '')}`;
}

function assertUniqueKey(rows = [], targetRow = {}, excludeId = '') {
  const targetKey = buildCompositeKey(targetRow);
  if (!targetKey || targetKey.startsWith('::')) return;
  const conflict = (Array.isArray(rows) ? rows : []).find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return buildCompositeKey(row) === targetKey;
  });
  if (conflict) {
    throw new Error('A template for this section/operation already exists in the selected organization.');
  }
}

async function readAllTemplates() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve Email Management templates.');
  }
}

async function getTemplateById(id) {
  const rows = await readAllTemplates();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addTemplate(payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllTemplates();
    const normalized = normalizeTemplateRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Template id '${normalized.id}' already exists.`);
    }
    assertUniqueKey(rows, normalized, '');
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function updateTemplate(id, payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllTemplates();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Email template not found.');

    const existing = rows[index];
    const normalized = normalizeTemplateRecord(
      {
        ...existing,
        ...(isPlainObject(payload) ? payload : {}),
        id: existing.id,
        orgId: cleanId(payload.orgId || existing.orgId, { max: 120, allowEmpty: false })
      },
      existing,
      true
    );
    assertUniqueKey(rows, normalized, existing.id);
    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteTemplate(id) {
  return queueWrite(async () => {
    const rows = await readAllTemplates();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  normalizeTemplateRecord,
  sanitizeTemplateForRead,
  getAllTemplates: readAllTemplates,
  getTemplateById,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  generateId
};
