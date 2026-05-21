const settingsModel = require('../models/systemSettingsModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument, deepMerge } = require('./backend/mongoRepositoryUtils');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

const SYSTEM_SETTINGS_SINGLETON_ID = 'system-settings';

function mergeAppSettings(base = {}, incoming = {}) {
  const defaultApp = settingsModel.DEFAULTS.app || {};
  const defaultBrand = defaultApp.brand || {};
  const defaultContact = defaultApp.contact || {};
  const defaultContactPage = defaultApp.contactPage || {};
  const stripRuntimeBackendSettings = settingsModel.stripRuntimeBackendSettings || ((app) => app || {});
  const baseApp = stripRuntimeBackendSettings(base && typeof base === 'object' ? base : {});
  const incomingApp = stripRuntimeBackendSettings(incoming && typeof incoming === 'object' ? incoming : {});
  return {
    ...defaultApp,
    ...baseApp,
    ...incomingApp,
    brand: {
      ...defaultBrand,
      ...(baseApp.brand || {}),
      ...(incomingApp.brand || {})
    },
    contact: {
      ...defaultContact,
      ...(baseApp.contact || {}),
      ...(incomingApp.contact || {})
    },
    contactPage: {
      ...defaultContactPage,
      ...(baseApp.contactPage || {}),
      ...(incomingApp.contactPage || {}),
      highlights: Array.isArray(incomingApp.contactPage?.highlights)
        ? incomingApp.contactPage.highlights
        : (Array.isArray(baseApp.contactPage?.highlights) ? baseApp.contactPage.highlights : defaultContactPage.highlights),
      processImages: Array.isArray(incomingApp.contactPage?.processImages)
        ? incomingApp.contactPage.processImages
        : (Array.isArray(baseApp.contactPage?.processImages) ? baseApp.contactPage.processImages : defaultContactPage.processImages)
    },
    uploadFolders: uploadFolderSettingsService.mergeUploadFolderSettings(
      defaultApp.uploadFolders,
      baseApp.uploadFolders,
      incomingApp.uploadFolders
    )
  };
}

function mergeWithDefaults(settings) {
  const parsed = settings && typeof settings === 'object' ? settings : {};
  return {
    newsletter: { ...(settingsModel.DEFAULTS.newsletter || {}), ...(parsed.newsletter || {}) },
    organization: { ...(settingsModel.DEFAULTS.organization || {}), ...(parsed.organization || {}) },
    access: { ...(settingsModel.DEFAULTS.access || {}), ...(parsed.access || {}) },
    app: mergeAppSettings(settingsModel.DEFAULTS.app || {}, parsed.app || {}),
    audit: parsed.audit || {}
  };
}

function resolveAuditUserId(auditUser) {
  if (!auditUser) return 'system';
  if (typeof auditUser === 'object') return String(auditUser.id || auditUser.username || 'system');
  return String(auditUser || 'system');
}

const systemSettingsRepository = {
  async getSettings(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => settingsModel.getSettings(),
      mongo: async () => {
        const baseline = mergeWithDefaults(await settingsModel.getSettings());
        const collection = getMongoCollection('systemSettings');
        const row = normalizeMongoDocument(
          await collection.findOne({ id: SYSTEM_SETTINGS_SINGLETON_ID })
        );
        if (row) {
          return mergeWithDefaults(deepMerge(baseline, row));
        }

        const payload = { ...baseline, id: SYSTEM_SETTINGS_SINGLETON_ID };
        await collection.insertOne(payload);
        return mergeWithDefaults(payload);
      }
    }, 'core.systemSettings.getSettings');
  },

  async updateSettings(newSettings = {}, auditUser, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => settingsModel.updateSettings(newSettings, auditUser),
      mongo: async () => {
        const collection = getMongoCollection('systemSettings');
        const current = await this.getSettings(options);
        const merged = mergeWithDefaults(
          deepMerge(current || {}, newSettings || {})
        );
        merged.id = SYSTEM_SETTINGS_SINGLETON_ID;
        merged.audit = {
          ...(current?.audit || {}),
          ...(newSettings?.audit || {}),
          lastUpdateUser: resolveAuditUserId(auditUser),
          lastUpdateDateTime: new Date().toISOString()
        };

        await collection.updateOne(
          { id: SYSTEM_SETTINGS_SINGLETON_ID },
          { $set: merged },
          { upsert: true }
        );

        // Keep bootstrap file in sync for non-runtime app settings.
        // Runtime backend selection is environment-only and stripped during merge.
        await settingsModel.updateSettings(merged, auditUser);
        return mergeWithDefaults(merged);
      }
    }, 'core.systemSettings.updateSettings');
  }
};

module.exports = systemSettingsRepository;
