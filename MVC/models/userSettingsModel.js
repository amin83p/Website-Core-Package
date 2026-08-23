const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/userSettings.json');

async function ensureFile() {
  try {
    await fs.access(dataPath);
  } catch (_) {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function buildSettingsKeySummary(settings = {}) {
  return Object.keys(isPlainObject(settings) ? settings : {})
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

function decorateRecord(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    settingsKeys: buildSettingsKeySummary(row.settings)
  };
}

async function getAllSettings() {
  try {
    await ensureFile();
    const data = await fs.readFile(dataPath, 'utf8');
    const rows = JSON.parse(data || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('Error reading userSettings.json:', error);
    throw new Error('Failed to retrieve user settings');
  }
}

function applyUserSettingsScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const userId = toPublicId(scope?.userId) || null;
  if (!userId) return [];

  return list.filter((row) => idsEqual(row?.userId || row?.id, userId));
}

function buildUserSettingsQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'usersettings',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      userId: toPublicId(incomingScope?.userId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['userId', 'id'],
      dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function querySettings(options = {}) {
  const plan = buildUserSettingsQueryPlan(options);
  const executor = getEntityQueryExecutor('usersettings');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result.map(decorateRecord);
    if (result && Array.isArray(result.items)) return result.items.map(decorateRecord);
  }

  const allSettings = await getAllSettings();
  const scopedSettings = applyUserSettingsScope(allSettings, plan.scope).map(decorateRecord);
  return applyGenericFilter(scopedSettings, plan.query, plan.fallback);
}

async function getUserSettings(userId) {
  const normalizedUserId = toPublicId(userId);
  if (!normalizedUserId) return null;
  const settings = await getAllSettings();
  return settings.find((row) => idsEqual(row?.userId || row?.id, normalizedUserId)) || null;
}

function normalizeActor(actor) {
  if (actor && typeof actor === 'object') {
    return toPublicId(actor.id || actor.userId || actor.username || actor.email) || 'system';
  }
  return toPublicId(actor) || 'system';
}

function buildRecord(input = {}, existing = null) {
  const userId = toPublicId(input.userId || input.id);
  if (!userId) throw new Error('User ID is required for user settings.');

  const now = new Date().toISOString();
  const auditUser = normalizeActor(input.auditUser || input.actor || input.audit?.lastUpdateUser);
  const existingAudit = isPlainObject(existing?.audit) ? existing.audit : {};
  const incomingAudit = isPlainObject(input.audit) ? input.audit : {};

  const record = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    id: userId,
    userId,
    settings: clonePlainObject(input.settings),
    audit: {
      createUser: String(existingAudit.createUser || incomingAudit.createUser || auditUser),
      createDateTime: String(existingAudit.createDateTime || incomingAudit.createDateTime || now),
      lastUpdateUser: auditUser,
      lastUpdateDateTime: now
    }
  };

  const validity = validateData(record);
  if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));
  return record;
}

function validateData(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['Record must be a valid object.'] };
  }

  if (!toPublicId(record.userId || record.id)) errors.push('User ID is required.');
  if (!isPlainObject(record.settings)) errors.push('Settings must be an object.');

  const audit = record.audit || {};
  if (!audit.createUser || typeof audit.createUser !== 'string') errors.push('Creator User ID is missing.');
  if (!audit.lastUpdateUser || typeof audit.lastUpdateUser !== 'string') errors.push('Last Update User ID is missing.');

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

async function addSetting(data = {}) {
  return await queueWrite(async () => {
    const storedSettings = await getAllSettings();
    const userId = toPublicId(data.userId || data.id);
    if (!userId) throw new Error('User ID is required for user settings.');

    const existing = storedSettings.find((row) => idsEqual(row?.userId || row?.id, userId));
    if (existing) throw new Error(`Settings already exist for user "${userId}".`);

    const record = buildRecord({ ...data, userId }, null);
    storedSettings.push(record);
    await fs.writeFile(dataPath, JSON.stringify(storedSettings, null, 2));
    return record;
  });
}

async function updateSetting(data = {}) {
  return await queueWrite(async () => {
    const storedSettings = await getAllSettings();
    const userId = toPublicId(data.userId || data.id);
    if (!userId) throw new Error('User ID is required for user settings.');

    const index = storedSettings.findIndex((row) => idsEqual(row?.userId || row?.id, userId));
    const current = index >= 0 ? storedSettings[index] : null;
    const record = buildRecord({ ...data, userId }, current);

    if (index >= 0) storedSettings[index] = record;
    else storedSettings.push(record);

    await fs.writeFile(dataPath, JSON.stringify(storedSettings, null, 2));
    return record;
  });
}

async function deleteSetting(userId) {
  return await queueWrite(async () => {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) throw new Error('User ID is required for user settings delete.');

    const storedSettings = await getAllSettings();
    const filtered = storedSettings.filter((row) => !idsEqual(row?.userId || row?.id, normalizedUserId));
    if (filtered.length === storedSettings.length) throw new Error('Settings not found in the database.');

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { acknowledged: true, deletedCount: storedSettings.length - filtered.length };
  });
}

async function deleteAllSettings() {
  return await queueWrite(async () => {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
    return { acknowledged: true };
  });
}

module.exports = {
  dataPath,
  getAllSettings,
  querySettings,
  getUserSettings,
  addSetting,
  updateSetting,
  deleteSetting,
  deleteAllSettings,
  applyUserSettingsScope,
  buildSettingsKeySummary,
  validateData
};
