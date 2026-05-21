const helpArticleModel = require('../models/helpArticleModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const paginate = require('../utils/paginationHelper');
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

function buildHelpScopeFilter(scope = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.canViewAll === false) return { $or: [{ active: { $exists: false } }, { active: true }] };
  return {};
}

function parsePageLimit(query = {}, fallbackLimit = 20) {
  const rawPage = Number.parseInt(query?.page, 10);
  const rawLimit = Number.parseInt(query?.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : fallbackLimit;
  return { page, limit };
}

async function listMongoHelpArticles(options = {}) {
  const collection = getMongoCollection('helpArticles');
  const query = options?.query || {};
  const scopeFilter = buildHelpScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'title', 'slug', 'category', 'sectionId', 'operationId'],
    dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const helpArticleRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return helpArticleModel.queryHelpArticles({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoHelpArticles(options)
    }, 'core.help.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await helpArticleModel.queryHelpArticles({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('helpArticles');
        const scopeFilter = buildHelpScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'title', 'slug', 'category', 'sectionId', 'operationId'],
          dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.help.count');
  },

  async listPaged(options = {}) {
    const query = options?.query || {};
    const { page, limit } = parsePageLimit(query, 20);

    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await helpArticleModel.queryHelpArticles({
          query: stripPaginationFromQuery(query),
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        const paged = paginate(Array.isArray(rows) ? rows : [], page, limit);
        return {
          rows: Array.isArray(paged?.data) ? paged.data : [],
          totalRows: Number(paged?.pagination?.totalItems || 0),
          pagination: paged?.pagination || null
        };
      },
      mongo: async () => {
        const pageQuery = {
          ...stripPaginationFromQuery(query),
          page,
          limit
        };
        const [totalRows, rows] = await Promise.all([
          this.count({ ...options, query }),
          this.list({ ...options, query: pageQuery })
        ]);
        const totalPages = Math.max(1, Math.ceil(totalRows / limit));
        const safePage = Math.min(Math.max(page, 1), totalPages);
        const startItem = totalRows > 0 ? ((safePage - 1) * limit) + 1 : 0;
        const endItem = totalRows > 0 ? Math.min((safePage - 1) * limit + (Array.isArray(rows) ? rows.length : 0), totalRows) : 0;
        return {
          rows: Array.isArray(rows) ? rows : [],
          totalRows,
          pagination: {
            currentPage: safePage,
            totalPages,
            totalItems: totalRows,
            limit,
            startItem,
            endItem
          }
        };
      }
    }, 'core.help.listPaged');
  },

  async listCategories(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await helpArticleModel.queryHelpArticles({
          query: {},
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.category || '').trim()).filter(Boolean)))
          .sort((a, b) => a.localeCompare(b));
      },
      mongo: async () => {
        const collection = getMongoCollection('helpArticles');
        const scopeFilter = buildHelpScopeFilter(options?.scope || {});
        const rows = await collection.distinct('category', scopeFilter);
        return Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => String(row || '').trim()).filter(Boolean)))
          .sort((a, b) => a.localeCompare(b));
      }
    }, 'core.help.listCategories');
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
      json: async () => helpArticleModel.getArticleById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('helpArticles').findOne(resolveMongoIdFilter(id)))
    }, 'core.help.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => helpArticleModel.addArticle(data),
      mongo: async () => {
        const collection = getMongoCollection('helpArticles');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.help.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => helpArticleModel.updateArticle(id, data),
      mongo: async () => {
        const collection = getMongoCollection('helpArticles');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Help article not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.help.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => helpArticleModel.deleteArticle(id),
      mongo: async () => getMongoCollection('helpArticles').deleteOne(resolveMongoIdFilter(id))
    }, 'core.help.remove');
  },

  async getBySlug(slug, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => helpArticleModel.getArticleBySlug(slug),
      mongo: async () => {
        const value = String(slug || '').trim();
        if (!value) return null;
        const row = await getMongoCollection('helpArticles').findOne({
          slug: { $regex: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.help.getBySlug');
  }
};

assertQueryableCrudRepository('helpArticleRepository', helpArticleRepository);

module.exports = helpArticleRepository;
