const sectionModel = require('../models/sectionModel');
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

function buildSectionScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const categories = Array.isArray(scope?.categories)
    ? scope.categories.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  const sectionIds = toIdArray(scope?.sectionIds || []);
  const excludedSectionIds = toIdArray(scope?.excludedSectionIds || []);
  const clauses = [];
  if (categories.length) clauses.push({ category: { $in: categories } });
  if (sectionIds.length) clauses.push({ id: { $in: sectionIds } });
  if (!clauses.length) return { id: '__NO_MATCH__' };
  const includeFilter = clauses.length === 1 ? clauses[0] : { $or: clauses };
  if (!excludedSectionIds.length) return includeFilter;
  return {
    $and: [
      includeFilter,
      { id: { $nin: excludedSectionIds } }
    ]
  };
}

async function listMongoSections(options = {}) {
  const collection = getMongoCollection('sections');
  const query = options?.query || {};
  const scopeFilter = buildSectionScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'description', 'category', 'displayText'],
    dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const sectionRepository = {
  VALID_CATEGORIES: Array.isArray(sectionModel?.VALID_CATEGORIES) ? [...sectionModel.VALID_CATEGORIES] : [],

  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return sectionModel.querySections({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoSections(options)
    }, 'core.sections.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await sectionModel.querySections({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('sections');
        const scopeFilter = buildSectionScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'description', 'category', 'displayText'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.sections.count');
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
      json: async () => sectionModel.getSectionById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('sections').findOne(resolveMongoIdFilter(id)))
    }, 'core.sections.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sectionModel.addSection(data),
      mongo: async () => {
        const collection = getMongoCollection('sections');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.sections.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sectionModel.updateSection(id, data),
      mongo: async () => {
        const collection = getMongoCollection('sections');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Section not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.sections.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sectionModel.deleteSection(id),
      mongo: async () => getMongoCollection('sections').deleteOne(resolveMongoIdFilter(id))
    }, 'core.sections.remove');
  },

  async getCategories(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof sectionModel.getCategories === 'function') return sectionModel.getCategories();
        return [...this.VALID_CATEGORIES];
      },
      mongo: async () => {
        const rows = await getMongoCollection('sections').distinct('category');
        const values = Array.isArray(rows) ? rows.map((x) => String(x || '').trim()).filter(Boolean) : [];
        return values.length ? values : [...this.VALID_CATEGORIES];
      }
    }, 'core.sections.getCategories');
  },

  async getByName(name, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof sectionModel.getSectionByName === 'function') return sectionModel.getSectionByName(name);
        const rows = await this.list({
          query: {
            name__eq: String(name || '').trim(),
            limit: 1
          }
        });
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
      },
      mongo: async () => {
        const n = String(name || '').trim();
        if (!n) return null;
        const row = await getMongoCollection('sections').findOne({
          name: { $regex: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.sections.getByName');
  },

  async getAllSections() {
    return await this.list();
  },

  async getSectionById(id) {
    return await this.getById(id);
  },

  async getSectionByName(name) {
    return await this.getByName(name);
  },

  async addSection(data) {
    return await this.create(data);
  },

  async updateSection(id, data) {
    return await this.update(id, data);
  },

  async deleteSection(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('sectionRepository', sectionRepository);

module.exports = sectionRepository;
