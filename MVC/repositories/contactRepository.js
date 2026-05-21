const contactModel = require('../models/contactModel');
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

function buildAuthenticatedScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  return scope?.isAuthenticated ? {} : { id: '__NO_MATCH__' };
}

async function listMongoContacts(options = {}) {
  const collection = getMongoCollection('contacts');
  const query = options?.query || {};
  const scopeFilter = buildAuthenticatedScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'email', 'subject', 'status'],
    dateFields: ['createdAt', 'date', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const contactRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return contactModel.queryContactMessages({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoContacts(options)
    }, 'core.contacts.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await contactModel.queryContactMessages({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('contacts');
        const scopeFilter = buildAuthenticatedScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'email', 'subject', 'status'],
          dateFields: ['createdAt', 'date', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.contacts.count');
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
      json: async () => contactModel.getContactMessageById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('contacts').findOne(resolveMongoIdFilter(id)))
    }, 'core.contacts.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contactModel.addContactMessage(data),
      mongo: async () => {
        const collection = getMongoCollection('contacts');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.contacts.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contactModel.updateContactMessage(id, data, data?.auditUser || data?.audit?.lastUpdateUser || 'system'),
      mongo: async () => {
        const collection = getMongoCollection('contacts');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Contact message not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.contacts.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contactModel.deleteContactMessage(id),
      mongo: async () => getMongoCollection('contacts').deleteOne(resolveMongoIdFilter(id))
    }, 'core.contacts.remove');
  },

  async getAllContactMessages() {
    return await this.list();
  },

  async getContactMessageById(id) {
    return await this.getById(id);
  },

  async addContactMessage(data) {
    return await this.create(data);
  },

  async updateContactMessage(id, data, auditUser = 'system', options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contactModel.updateContactMessage(id, data, auditUser),
      mongo: async () => this.update(id, {
        ...(data || {}),
        audit: {
          ...(data?.audit || {}),
          lastUpdateUser: auditUser,
          lastUpdateDateTime: new Date().toISOString()
        }
      }, options)
    }, 'core.contacts.updateContactMessage');
  },

  async deleteContactMessage(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('contactRepository', contactRepository);

module.exports = contactRepository;
