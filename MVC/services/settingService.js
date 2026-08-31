// MVC/services/settingService.js
const systemSettingsRepository = require('../repositories/systemSettingsRepository');
const settingsModel = require('../models/systemSettingsModel');
const constants = require('../../config/constants'); // Fallback
const startupLogger = require('../utils/startupLogger');

let _cache = null;

const settingService = {
  /**
   * Must be called in app.js on server start
   */
  init: async () => {
    _cache = await systemSettingsRepository.getSettings();
    startupLogger.success('SETTINGS', 'CACHE', 'System settings loaded into memory.');
  },

  /**
   * Called by the Controller after a successful update to refresh memory
   */
  refresh: async () => {
    _cache = await systemSettingsRepository.getSettings();
    try {
      const { clearAllRequestCaches, rebuildAuthContextCache } = require('./cache/authContextCacheService');
      clearAllRequestCaches();
      rebuildAuthContextCache();
    } catch (_) {
      // ignore cache refresh errors
    }
    try {
      const { clearSchoolCountCache } = require('../../packages/school/MVC/services/school/schoolPaginationUtils');
      clearSchoolCountCache();
    } catch (_) {
      // ignore school cache refresh errors
    }
    startupLogger.info('SETTINGS', 'CACHE', 'System settings cache refreshed.');
  },

  /**
   * Get the full settings object (Sync)
   * Usage: const config = settingService.get();
   */
  get: () => {
    if (!_cache) {
      _cache = settingsModel.getSettingsSync();
    }
    return _cache;
  },

  /**
   * Helper to get a specific value safely
   * Usage: const days = settingService.getValue('organization', 'defaultTrialDays');
   */
  getValue: (section, key) => {
    const data = settingService.get();
    if (data && data[section]) {
      return data[section][key];
    }
    return null;
  }
};

module.exports = settingService;

