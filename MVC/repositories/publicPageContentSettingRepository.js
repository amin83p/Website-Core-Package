const publicPageContentSettingModel = require('../models/publicPageContentSettingModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = require('./backend/mongoRepositoryUtils');
const actionStateChangeTrackerService = require('../services/actionStateChangeTrackerService');

const COLLECTION_NAME = 'publicPageContentSettings';
const SINGLETON_ID = publicPageContentSettingModel.SINGLETON_ID;

function sanitizeRow(row = {}) {
  return publicPageContentSettingModel.sanitizeSettingForRead(row);
}

const publicPageContentSettingRepository = {
  async getSettings(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sanitizeRow(await publicPageContentSettingModel.getSettings()),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne({ id: SINGLETON_ID });
        return sanitizeRow(normalizeMongoDocument(row)) || { id: SINGLETON_ID, pages: {}, isActive: true };
      }
    }, 'core.publicPageContentSettings.getSettings');
  },

  async updateSettings(data = {}, auditUser = null, options = {}) {
    let beforeSnapshot = null;
    try {
      beforeSnapshot = await this.getSettings(options);
    } catch (_) {
      beforeSnapshot = null;
    }

    const saved = await runByRepositoryBackend(options, {
      json: async () => sanitizeRow(await publicPageContentSettingModel.updateSettings(data, auditUser)),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = normalizeMongoDocument(await collection.findOne({ id: SINGLETON_ID }));
        const normalized = publicPageContentSettingModel.normalizePublicPageContentRecord(
          {
            ...(existing || {}),
            ...(data || {}),
            id: SINGLETON_ID
          },
          existing || null,
          auditUser
        );
        const { _id, ...toSet } = normalized;
        await collection.updateOne(
          { id: SINGLETON_ID },
          { $set: toSet },
          { upsert: true }
        );
        return sanitizeRow(normalizeMongoDocument(await collection.findOne({ id: SINGLETON_ID })));
      }
    }, 'core.publicPageContentSettings.updateSettings');

    if (beforeSnapshot && beforeSnapshot.pages) {
      await actionStateChangeTrackerService.trackUpdate({
        source: 'core',
        entityType: COLLECTION_NAME,
        entityId: SINGLETON_ID,
        before: beforeSnapshot,
        after: saved || {}
      });
    } else {
      await actionStateChangeTrackerService.trackCreate({
        source: 'core',
        entityType: COLLECTION_NAME,
        entityId: SINGLETON_ID
      });
    }

    return saved;
  }
};

module.exports = publicPageContentSettingRepository;
