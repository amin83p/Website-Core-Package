'use strict';

const dataService = require('./dataService');
const userSettingsService = require('./userSettingsService');
const {
  buildDashboardOrderTableId,
  extractModuleOrderFromSettings,
  extractNavigationPreferences,
  normalizeModuleKeyList
} = require('../utils/dashboardModuleOrder');
const { toPublicId } = require('../utils/idAdapter');

const SETTINGS_ROOT = 'sectionNavigation';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeUserId(userId) {
  return toPublicId(userId);
}

function emptyPreferences() {
  return {
    moduleOrder: null,
    hiddenModuleKeys: []
  };
}

function hasSavedPreferences(entry = {}) {
  const prefs = extractNavigationPreferences(entry);
  return Boolean(prefs.moduleOrder?.length || prefs.hiddenModuleKeys.length);
}

function readDashboardEntry(settings = {}, dashboardKey = '') {
  const root = isPlainObject(settings?.[SETTINGS_ROOT]) ? settings[SETTINGS_ROOT] : {};
  const entry = root[String(dashboardKey || '').trim()];
  return isPlainObject(entry) ? entry : {};
}

function buildNextSettings(currentSettings = {}, dashboardKey = '', dashboardPrefs = {}) {
  const next = clonePlainObject(currentSettings);
  if (!isPlainObject(next[SETTINGS_ROOT])) next[SETTINGS_ROOT] = {};
  const prefs = extractNavigationPreferences(dashboardPrefs);
  const hasOrder = Boolean(prefs.moduleOrder?.length);
  const hasHidden = Boolean(prefs.hiddenModuleKeys.length);
  if (!hasOrder && !hasHidden) {
    delete next[SETTINGS_ROOT][dashboardKey];
    if (!Object.keys(next[SETTINGS_ROOT]).length) delete next[SETTINGS_ROOT];
    return next;
  }
  next[SETTINGS_ROOT][dashboardKey] = {
    ...(hasOrder ? { moduleOrder: prefs.moduleOrder } : {}),
    ...(hasHidden ? { hiddenModuleKeys: prefs.hiddenModuleKeys } : {})
  };
  return next;
}

function createService(deps = {}) {
  const settingsService = deps.userSettingsService || userSettingsService;
  const data = deps.dataService || dataService;

  async function readLegacyTableSettings(userId, dashboardKey, reqUser = null) {
    const tableId = buildDashboardOrderTableId(dashboardKey);
    const record = await data.getDataById(
      'tableSettings',
      { userId, tableId },
      reqUser || { id: userId }
    );
    const moduleOrder = extractModuleOrderFromSettings(record?.settings);
    if (!moduleOrder?.length) return null;
    return {
      moduleOrder,
      hiddenModuleKeys: []
    };
  }

  async function deleteLegacyTableSettings(userId, dashboardKey, reqUser = null) {
    const tableId = buildDashboardOrderTableId(dashboardKey);
    const record = await data.getDataById(
      'tableSettings',
      { userId, tableId },
      reqUser || { id: userId }
    );
    if (!record) return false;
    await data.deleteData(
      'tableSettings',
      { userId, tableId },
      reqUser || { id: userId }
    );
    return true;
  }

  async function getPreferences(userId, dashboardKey, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return emptyPreferences();

    const settings = await settingsService.getSettings(normalizedUserId, options);
    const entry = readDashboardEntry(settings, dashboardKey);
    if (hasSavedPreferences(entry)) {
      return extractNavigationPreferences(entry);
    }

    const legacy = await readLegacyTableSettings(
      normalizedUserId,
      dashboardKey,
      options.reqUser || null
    );
    if (!legacy) return emptyPreferences();

    await savePreferences(
      normalizedUserId,
      dashboardKey,
      legacy,
      options.reqUser || normalizedUserId,
      options
    );
    await deleteLegacyTableSettings(
      normalizedUserId,
      dashboardKey,
      options.reqUser || null
    );
    return legacy;
  }

  async function savePreferences(userId, dashboardKey, payload = {}, actor = null, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) throw new Error('User ID is required for navigation preferences.');

    const currentSettings = await settingsService.getSettings(normalizedUserId, options);
    const currentEntry = readDashboardEntry(currentSettings, dashboardKey);
    const currentPrefs = extractNavigationPreferences(currentEntry);
    const incomingPrefs = extractNavigationPreferences(payload);

    const nextDashboardPrefs = {
      moduleOrder: incomingPrefs.moduleOrder?.length
        ? incomingPrefs.moduleOrder
        : (currentPrefs.moduleOrder || null),
      hiddenModuleKeys: Object.prototype.hasOwnProperty.call(payload, 'hiddenModuleKeys')
        ? incomingPrefs.hiddenModuleKeys
        : currentPrefs.hiddenModuleKeys
    };

    const nextSettings = buildNextSettings(currentSettings, dashboardKey, nextDashboardPrefs);
    await settingsService.setSettings(
      normalizedUserId,
      nextSettings,
      actor || normalizedUserId,
      options
    );
    return extractNavigationPreferences(nextDashboardPrefs);
  }

  async function resetPreferences(userId, dashboardKey, actor = null, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) throw new Error('User ID is required for navigation preferences.');

    const currentSettings = await settingsService.getSettings(normalizedUserId, options);
    const nextSettings = buildNextSettings(currentSettings, dashboardKey, {});
    await settingsService.setSettings(
      normalizedUserId,
      nextSettings,
      actor || normalizedUserId,
      options
    );
    await deleteLegacyTableSettings(
      normalizedUserId,
      dashboardKey,
      options.reqUser || null
    );
    return emptyPreferences();
  }

  return {
    SETTINGS_ROOT,
    getPreferences,
    savePreferences,
    resetPreferences,
    readLegacyTableSettings,
    deleteLegacyTableSettings,
    readDashboardEntry,
    buildNextSettings
  };
}

const service = createService();

module.exports = {
  ...service,
  createService,
  emptyPreferences,
  hasSavedPreferences
};
