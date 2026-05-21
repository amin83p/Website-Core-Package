const websitePolicyModel = require('../models/websitePolicyModel');
const { assertWebsitePolicyRepository } = require('./contracts/websitePolicyRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument, deepMerge } = require('./backend/mongoRepositoryUtils');

const WEBSITE_POLICY_SINGLETON_ID = 'website-policy';

const websitePolicyRepository = {
  async getPolicy(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => websitePolicyModel.getPolicy(),
      mongo: async () => {
        const collection = getMongoCollection('websitePolicy');
        const row = await collection.findOne({ id: WEBSITE_POLICY_SINGLETON_ID });
        if (row) return normalizeMongoDocument(row);
        const defaults = await websitePolicyModel.getPolicy();
        const payload = { ...(defaults || {}), id: WEBSITE_POLICY_SINGLETON_ID };
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.websitePolicy.getPolicy');
  },

  async updatePolicy(updates, user, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => websitePolicyModel.updatePolicy(updates, user),
      mongo: async () => {
        const collection = getMongoCollection('websitePolicy');
        const current = await this.getPolicy(options);
        const merged = deepMerge(current || {}, updates || {});
        merged.id = WEBSITE_POLICY_SINGLETON_ID;
        merged.audit = {
          ...(current?.audit || {}),
          ...(updates?.audit || {}),
          lastUpdateUser: user || updates?.audit?.lastUpdateUser || 'system',
          lastUpdateDateTime: new Date().toISOString()
        };
        await collection.updateOne(
          { id: WEBSITE_POLICY_SINGLETON_ID },
          { $set: merged },
          { upsert: true }
        );
        return this.getPolicy(options);
      }
    }, 'core.websitePolicy.updatePolicy');
  }
};

assertWebsitePolicyRepository('websitePolicyRepository', websitePolicyRepository);

module.exports = websitePolicyRepository;
