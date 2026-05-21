const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');

const DATA_PATH = path.join(__dirname, '../../data/publicPageContentSettings.json');
const SINGLETON_ID = 'public-page-content';

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, JSON.stringify({
    id: SINGLETON_ID,
    pages: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audit: {
      createUser: 'system',
      createDateTime: new Date().toISOString(),
      lastUpdateUser: 'system',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, null, 2));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, max = 4000) {
  const token = String(value ?? '').replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function cleanIsoDateTime(value, fallback = '') {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function sanitizeAudit(rawAudit = {}, existingAudit = {}, auditUser = null) {
  const nowIso = new Date().toISOString();
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const userId = cleanString(auditUser?.id || auditUser?.userId || source.lastUpdateUser || 'system', 160) || 'system';
  const createUser = cleanString(existing.createUser || source.createUser || userId, 160) || userId;
  const createDateTime = cleanIsoDateTime(existing.createDateTime || source.createDateTime, nowIso);

  return {
    createUser,
    createDateTime,
    lastUpdateUser: userId,
    lastUpdateDateTime: nowIso
  };
}

function normalizePublicPageContentRecord(record = {}, existing = null, auditUser = null) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();
  const pages = isPlainObject(input.pages)
    ? input.pages
    : (isPlainObject(input.content) ? input.content : (isPlainObject(base.pages) ? base.pages : {}));

  return {
    ...base,
    ...input,
    id: SINGLETON_ID,
    pages,
    isActive: input.isActive !== false,
    createdAt: cleanIsoDateTime(base.createdAt || input.createdAt, nowIso),
    updatedAt: nowIso,
    audit: sanitizeAudit(input.audit || {}, base.audit || {}, auditUser)
  };
}

function sanitizeSettingForRead(record = {}) {
  return isPlainObject(record) ? { ...record, id: SINGLETON_ID } : null;
}

async function getSettings() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return sanitizeSettingForRead(parsed) || { id: SINGLETON_ID, pages: {}, isActive: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fresh = normalizePublicPageContentRecord({}, null, null);
      await updateSettings(fresh, null);
      return fresh;
    }
    throw new Error('Failed to retrieve public page content settings.');
  }
}

async function updateSettings(record = {}, auditUser = null) {
  return queueWrite(async () => {
    const current = await getSettings().catch(() => ({ id: SINGLETON_ID, pages: {}, isActive: true }));
    const normalized = normalizePublicPageContentRecord(record, current, auditUser);
    await fs.writeFile(DATA_PATH, JSON.stringify(normalized, null, 2));
    return sanitizeSettingForRead(normalized);
  });
}

module.exports = {
  DATA_PATH,
  SINGLETON_ID,
  normalizePublicPageContentRecord,
  sanitizeSettingForRead,
  getSettings,
  updateSettings
};
