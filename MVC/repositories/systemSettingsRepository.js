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
    ),
    integrationVariables: Array.isArray(incomingApp.integrationVariables)
      ? incomingApp.integrationVariables
      : (Array.isArray(baseApp.integrationVariables) ? baseApp.integrationVariables : [])
  };
}

function mergeWithDefaults(settings) {
  const parsed = settings && typeof settings === 'object' ? settings : {};
  return {
    newsletter: { ...(settingsModel.DEFAULTS.newsletter || {}), ...(parsed.newsletter || {}) },
    organization: { ...(settingsModel.DEFAULTS.organization || {}), ...(parsed.organization || {}) },
    access: { ...(settingsModel.DEFAULTS.access || {}), ...(parsed.access || {}) },
    app: mergeAppSettings(settingsModel.DEFAULTS.app || {}, parsed.app || {}),
    audit: parsed.audit || {},
    logArchive: parsed.logArchive && typeof parsed.logArchive === 'object' ? parsed.logArchive : {}
  };
}

function resolveAuditUserId(auditUser) {
  if (!auditUser) return 'system';
  if (typeof auditUser === 'object') return String(auditUser.id || auditUser.username || 'system');
  return String(auditUser || 'system');
}

function hasLogArchiveState(logArchive = {}) {
  const row = logArchive && typeof logArchive === 'object' ? logArchive : {};
  const counts = row.lastExportCounts && typeof row.lastExportCounts === 'object' ? row.lastExportCounts : {};
  return Boolean(
    row.lastExportEndDate ||
    row.lastExportAt ||
    row.lastExportId ||
    Object.keys(counts).length
  );
}

async function maybeMigrateLogArchiveFromFile(collection, merged) {
  const mongoLogArchive = merged.logArchive && typeof merged.logArchive === 'object' ? merged.logArchive : {};
  if (hasLogArchiveState(mongoLogArchive)) {
    return merged;
  }
  const legacy = settingsModel.readLogArchiveFromFileOnly();
  if (!hasLogArchiveState(legacy)) {
    return merged;
  }
  const next = mergeWithDefaults(deepMerge(merged, { logArchive: legacy }));
  await collection.updateOne(
    { id: SYSTEM_SETTINGS_SINGLETON_ID },
    { $set: { logArchive: next.logArchive } },
    { upsert: true }
  );
  return next;
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
          const merged = mergeWithDefaults(deepMerge(baseline, row));
          return maybeMigrateLogArchiveFromFile(collection, merged);
        }

        const payload = { ...baseline, id: SYSTEM_SETTINGS_SINGLETON_ID };
        const legacy = settingsModel.readLogArchiveFromFileOnly();
        if (hasLogArchiveState(legacy)) {
          payload.logArchive = { ...(payload.logArchive || {}), ...legacy };
        }
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
        const stripMongoOnlySettings = settingsModel.stripMongoOnlySettings || ((s) => s);
        await settingsModel.updateSettings(stripMongoOnlySettings(merged), auditUser);
        return mergeWithDefaults(merged);
      }
    }, 'core.systemSettings.updateSettings');
  }
};

module.exports = systemSettingsRepository;
