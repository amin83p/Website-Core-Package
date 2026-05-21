const organizationModel = require('../models/organizationModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toIdArray, toPublicId } = require('../utils/idAdapter');
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

function buildOrganizationScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const allowed = toIdArray(scope?.orgIds || []);
  if (!allowed.length) return { id: '__NO_MATCH__' };
  return { id: { $in: allowed } };
}

function buildOrganizationCollectionFilter(options = {}) {
  const query = options?.query || {};
  const scopeFilter = buildOrganizationScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'ownerId', 'status', 'address.city', 'address.country', 'identity.legalName', 'identity.displayName'],
    dateFields: ['startedAt', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  return combineMongoFilters(scopeFilter, queryFilter);
}

async function listMongoOrganizations(options = {}) {
  const collection = getMongoCollection('organizations');
  const query = options?.query || {};
  const filter = buildOrganizationCollectionFilter(options);
  const projection = options?.projection && typeof options.projection === 'object'
    ? options.projection
    : undefined;
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

const organizationRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return organizationModel.queryOrganizations({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoOrganizations(options)
    }, 'core.organizations.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await organizationModel.queryOrganizations({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('organizations');
        const filter = buildOrganizationCollectionFilter({
          ...(options || {}),
          query
        });
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.organizations.count');
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
      json: async () => organizationModel.getOrganizationById(id),
      mongo: async () => {
        const collection = getMongoCollection('organizations');
        const row = await collection.findOne(resolveMongoIdFilter(id));
        return normalizeMongoDocument(row);
      }
    }, 'core.organizations.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => organizationModel.addOrganization(data),
      mongo: async () => {
        const collection = getMongoCollection('organizations');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);

        const displayName = String(payload?.identity?.displayName || '').trim();
        if (displayName) {
          const duplicate = await collection.findOne({
            'identity.displayName': { $regex: new RegExp(`^${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });
          if (duplicate) throw new Error('Organization display name already exists.');
        }

        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.organizations.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => organizationModel.updateOrganization(id, data),
      mongo: async () => {
        const collection = getMongoCollection('organizations');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Organization not found');

        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);

        const nextDisplayName = String(merged?.identity?.displayName || '').trim();
        if (nextDisplayName) {
          const duplicate = await collection.findOne({
            _id: { $ne: existing._id },
            'identity.displayName': { $regex: new RegExp(`^${nextDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          });
          if (duplicate) throw new Error('Organization display name already exists.');
        }

        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        const updated = await collection.findOne({ _id: existing._id });
        return normalizeMongoDocument(updated);
      }
    }, 'core.organizations.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => organizationModel.deleteOrganization(id),
      mongo: async () => {
        const collection = getMongoCollection('organizations');
        await collection.deleteOne(resolveMongoIdFilter(id));
      }
    }, 'core.organizations.remove');
  },

  hasActiveContract(org) {
    return organizationModel.hasActiveContract(org);
  }
};

assertQueryableCrudRepository('organizationRepository', organizationRepository);

module.exports = organizationRepository;
