const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/emailLedger.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
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
    const candidate = `EMLG${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `EMLG${Date.now()}`;
}

function safeJsonCopy(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
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
    lastUpdateUser: cleanString(source.lastUpdateUser || existing.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime || existing.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function normalizeEmailLedgerRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '';
  const orgId = toPublicId(input.orgId || base.orgId || '') || 'SYSTEM';
  const status = cleanString(input.status || base.status, { max: 40, allowEmpty: true }).toLowerCase() || 'accepted';
  const provider = cleanString(input.provider || base.provider, { max: 80, allowEmpty: true }) || 'resend';

  const creator = sanitizeCreator(input.creator || base.creator, {
    type: 'system',
    orgId
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: base.audit || null });

  const envelopeIn = isPlainObject(input.envelope) ? input.envelope : (isPlainObject(base.envelope) ? base.envelope : {});
  const contentIn = isPlainObject(input.content) ? input.content : (isPlainObject(base.content) ? base.content : {});
  const providerIn = isPlainObject(input.providerMeta) ? input.providerMeta : (isPlainObject(base.providerMeta) ? base.providerMeta : {});

  const toList = Array.isArray(envelopeIn.to)
    ? envelopeIn.to.map((item) => cleanString(item, { max: 320, allowEmpty: true })).filter(Boolean)
    : [];

  const normalized = {
    ...base,
    id,
    orgId,
    sectionId: normalizeKeyToken(input.sectionId || base.sectionId || ''),
    operationId: normalizeKeyToken(input.operationId || base.operationId || ''),
    eventKey: normalizeKeyToken(input.eventKey || base.eventKey || ''),
    status,
    provider,
    providerMessageId: cleanString(providerIn.messageId || input.providerMessageId || base.providerMessageId, { max: 240, allowEmpty: true }) || '',
    providerStatusCode: Number(providerIn.statusCode || input.providerStatusCode || base.providerStatusCode || 0) || 0,
    errorMessage: cleanString(input.errorMessage || base.errorMessage, { max: 5000, allowEmpty: true }) || '',
    envelope: {
      from: cleanString(envelopeIn.from, { max: 320, allowEmpty: true }) || '',
      to: toList,
      replyTo: cleanString(envelopeIn.replyTo, { max: 320, allowEmpty: true }) || ''
    },
    content: {
      subject: cleanString(contentIn.subject, { max: 260, allowEmpty: true }) || '',
      text: cleanString(contentIn.text, { max: 100000, allowEmpty: true }) || '',
      html: cleanString(contentIn.html, { max: 200000, allowEmpty: true }) || ''
    },
    meta: safeJsonCopy(input.meta !== undefined ? input.meta : base.meta, {}),
    providerMeta: {
      statusCode: Number(providerIn.statusCode || input.providerStatusCode || base.providerStatusCode || 0) || 0,
      messageId: cleanString(providerIn.messageId || input.providerMessageId || base.providerMessageId, { max: 240, allowEmpty: true }) || '',
      raw: safeJsonCopy(providerIn.raw !== undefined ? providerIn.raw : (base.providerMeta?.raw || {}), {})
    },
    creator,
    audit,
    dateTime: cleanIsoDateTime(input.dateTime || base.dateTime || nowIso, { allowEmpty: true }) || nowIso,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };

  if (strict) {
    if (!normalized.orgId) throw new Error('Organization is required.');
    if (!normalized.status) throw new Error('Status is required.');
    if (!normalized.provider) throw new Error('Provider is required.');
    const isFailed = String(normalized.status || '').toLowerCase() === 'failed';
    if (!isFailed) {
      if (!normalized.envelope.from) throw new Error('Email sender is required.');
      if (!Array.isArray(normalized.envelope.to) || normalized.envelope.to.length < 1) {
        throw new Error('Email recipient list is required.');
      }
      if (!normalized.content.subject) throw new Error('Email subject is required.');
      if (!normalized.content.text && !normalized.content.html) {
        throw new Error('Email body is required.');
      }
    }
  }

  return normalized;
}

function sanitizeLedgerForRead(record = {}) {
  if (!isPlainObject(record)) return {};
  return {
    ...record,
    sectionId: normalizeKeyToken(record.sectionId || ''),
    operationId: normalizeKeyToken(record.operationId || ''),
    eventKey: normalizeKeyToken(record.eventKey || '')
  };
}

async function readAllEntries() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve email ledger entries.');
  }
}

async function getEntryById(id) {
  const rows = await readAllEntries();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addEntry(payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllEntries();
    const normalized = normalizeEmailLedgerRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Email ledger id '${normalized.id}' already exists.`);
    }
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

module.exports = {
  normalizeEmailLedgerRecord,
  sanitizeLedgerForRead,
  getAllEntries: readAllEntries,
  getEntryById,
  addEntry,
  generateId
};
