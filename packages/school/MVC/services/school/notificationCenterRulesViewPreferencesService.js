'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const userSettingsService = requireCoreModule('MVC/services/userSettingsService');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const SETTING_KEY = 'school.notificationCenter.rulesViewMode';
const DEFAULT_RULES_VIEW_MODE = 'tile';
const ALLOWED = new Set(['tile', 'list']);

function normalizeUserId(userId) {
  return toPublicId(userId);
}

function normalizeRulesViewMode(value, fallback = DEFAULT_RULES_VIEW_MODE) {
  const mode = String(value || '').trim().toLowerCase();
  if (ALLOWED.has(mode)) return mode;
  return ALLOWED.has(fallback) ? fallback : DEFAULT_RULES_VIEW_MODE;
}

function createService(deps = {}) {
  const settingsService = deps.userSettingsService || userSettingsService;

  async function getRulesViewMode(userId, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return DEFAULT_RULES_VIEW_MODE;
    const stored = await settingsService.getSetting(
      normalizedUserId,
      SETTING_KEY,
      DEFAULT_RULES_VIEW_MODE,
      options
    );
    return normalizeRulesViewMode(stored, DEFAULT_RULES_VIEW_MODE);
  }

  async function saveRulesViewMode(userId, mode, actor = null, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('User ID is required for notification centre view preferences.');
    }
    const nextMode = normalizeRulesViewMode(mode, DEFAULT_RULES_VIEW_MODE);
    await settingsService.setSetting(
      normalizedUserId,
      SETTING_KEY,
      nextMode,
      actor || normalizedUserId,
      options
    );
    return nextMode;
  }

  return {
    SETTING_KEY,
    DEFAULT_RULES_VIEW_MODE,
    normalizeRulesViewMode,
    getRulesViewMode,
    saveRulesViewMode
  };
}

const service = createService();

module.exports = {
  ...service,
  createService
};
