const userSettingsRepository = require('../repositories/userSettingsRepository');
const { toPublicId } = require('../utils/idAdapter');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(key) {
  if (Array.isArray(key)) return key.map((part) => String(part || '').trim()).filter(Boolean);
  return String(key || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getNestedValue(source = {}, key = '') {
  const parts = normalizePath(key);
  if (!parts.length) return undefined;
  let cursor = source;
  for (const part of parts) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setNestedValue(source = {}, key = '', value) {
  const parts = normalizePath(key);
  if (!parts.length) throw new Error('Setting key is required.');

  const next = clonePlainObject(source);
  let cursor = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  return next;
}

function normalizeActor(actor) {
  if (actor && typeof actor === 'object') {
    return toPublicId(actor.id || actor.userId || actor.username || actor.email) || 'system';
  }
  return toPublicId(actor) || 'system';
}

function createService(deps = {}) {
  const repository = deps.repository || userSettingsRepository;

  async function getRecord(userId, options = {}) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) return null;
    return await repository.getUserSettings(normalizedUserId, options);
  }

  async function getSettings(userId, options = {}) {
    const record = await getRecord(userId, options);
    return clonePlainObject(record?.settings);
  }

  async function getSetting(userId, key, defaultValue = undefined, options = {}) {
    const settings = await getSettings(userId, options);
    const value = getNestedValue(settings, key);
    return value === undefined ? defaultValue : value;
  }

  async function setSettings(userId, settings, actor = null, options = {}) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) throw new Error('User ID is required for user settings.');
    if (!isPlainObject(settings)) throw new Error('Settings must be a JSON object.');

    return await repository.updateSetting({
      userId: normalizedUserId,
      settings: clonePlainObject(settings),
      auditUser: normalizeActor(actor || normalizedUserId)
    }, options);
  }

  async function setSetting(userId, key, value, actor = null, options = {}) {
    const current = await getSettings(userId, options);
    const next = setNestedValue(current, key, value);
    return await setSettings(userId, next, actor, options);
  }

  return {
    getRecord,
    getSettings,
    getSetting,
    setSettings,
    setSetting
  };
}

const service = createService();

module.exports = {
  ...service,
  createService,
  getNestedValue,
  setNestedValue
};
