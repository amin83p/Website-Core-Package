const newsletterModel = require('../models/newsletterSubscriptionModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildNewsletterScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  return scope?.isAuthenticated ? {} : { id: '__NO_MATCH__' };
}

async function listMongoSubscriptions(options = {}) {
  const collection = getMongoCollection('newsletterSubscriptions');
  const query = options?.query || {};
  const scopeFilter = buildNewsletterScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'email', 'status', 'groupId'],
    dateFields: ['createdAt', 'updatedAt', 'subscribedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const newsletterRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return newsletterModel.querySubscriptions({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoSubscriptions(options)
    }, 'core.newsletter.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await newsletterModel.querySubscriptions({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('newsletterSubscriptions');
        const scopeFilter = buildNewsletterScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'email', 'status', 'groupId'],
          dateFields: ['createdAt', 'updatedAt', 'subscribedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.newsletter.count');
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.getSubscriptionById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('newsletterSubscriptions').findOne(resolveMongoIdFilter(id)))
    }, 'core.newsletter.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.adminCreateSubscription(data),
      mongo: async () => {
        const collection = getMongoCollection('newsletterSubscriptions');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.newsletter.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.updateSubscription(id, data),
      mongo: async () => {
        const collection = getMongoCollection('newsletterSubscriptions');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Newsletter subscription not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.newsletter.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.deleteSubscription(id),
      mongo: async () => getMongoCollection('newsletterSubscriptions').deleteOne(resolveMongoIdFilter(id))
    }, 'core.newsletter.remove');
  },

  async getByEmail(email, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.getSubscriptionByEmail(email),
      mongo: async () => {
        const value = String(email || '').trim();
        if (!value) return null;
        const row = await getMongoCollection('newsletterSubscriptions').findOne({
          email: { $regex: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.newsletter.getByEmail');
  },

  async subscribeEmail(email, meta = {}, groupId = null, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.subscribeEmail(email, meta, groupId),
      mongo: async () => {
        const collection = getMongoCollection('newsletterSubscriptions');
        const existing = await this.getByEmail(email, options);
        if (existing) {
          return this.update(existing.id, {
            status: 'subscribed',
            groupId: groupId || existing.groupId || null,
            meta: { ...(existing.meta || {}), ...(meta || {}) },
            subscribedAt: new Date().toISOString()
          }, options);
        }
        return this.create({
          email,
          status: 'subscribed',
          groupId: groupId || null,
          meta: meta || {},
          subscribedAt: new Date().toISOString()
        }, options);
      }
    }, 'core.newsletter.subscribeEmail');
  },

  async unsubscribeEmail(email, manageCode, meta = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.unsubscribeEmail(email, manageCode, meta),
      mongo: async () => {
        const existing = await this.getByEmail(email, options);
        if (!existing) return null;
        return this.update(existing.id, {
          status: 'unsubscribed',
          manageCode: manageCode || existing.manageCode || null,
          unsubscribedAt: new Date().toISOString(),
          meta: { ...(existing.meta || {}), ...(meta || {}) }
        }, options);
      }
    }, 'core.newsletter.unsubscribeEmail');
  },

  async unsubscribeByEmail(email, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.unsubscribeByEmail(email, options),
      mongo: async () => this.unsubscribeEmail(email, null, {}, options)
    }, 'core.newsletter.unsubscribeByEmail');
  },

  async adminCreateSubscription(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsletterModel.adminCreateSubscription(data),
      mongo: async () => this.create(data, options)
    }, 'core.newsletter.adminCreateSubscription');
  },

  // Compatibility aliases used in dataService
  async getAllSubscriptions() {
    return await this.list();
  },

  async getNewsletterSubscriberById(id) {
    return await this.getById(id);
  },

  async addNewsletterSubscriber(data) {
    return await this.create(data);
  },

  async updateNewsletterSubscriber(id, data) {
    return await this.update(id, data);
  },

  async deleteNewsletterSubscriber(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('newsletterRepository', newsletterRepository);

module.exports = newsletterRepository;
