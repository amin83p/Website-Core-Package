const newsModel = require('../models/newsModel');
const newsVisibilityService = require('../services/newsVisibilityService');
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

function buildNewsScopeFilter(scope = {}) {
  return newsVisibilityService.buildMongoNewsScopeFilter(scope);
}

async function listMongoNews(options = {}) {
  const collection = getMongoCollection('news');
  const query = options?.query || {};
  const scopeFilter = buildNewsScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'title', 'slug', 'status', 'visibility', 'targetOrgId'],
    dateFields: ['publishedAt', 'createdAt', 'date', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const newsRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return newsModel.queryNews({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoNews(options)
    }, 'core.news.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await newsModel.queryNews({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('news');
        const scopeFilter = buildNewsScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'title', 'slug', 'status', 'visibility', 'targetOrgId'],
          dateFields: ['publishedAt', 'createdAt', 'date', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.news.count');
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
      json: async () => newsModel.getNewsById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('news').findOne(resolveMongoIdFilter(id)))
    }, 'core.news.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsModel.addNews(data),
      mongo: async () => {
        const collection = getMongoCollection('news');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.news.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsModel.updateNews(id, data),
      mongo: async () => {
        const collection = getMongoCollection('news');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('News item not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.news.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsModel.deleteNews(id),
      mongo: async () => getMongoCollection('news').deleteOne(resolveMongoIdFilter(id))
    }, 'core.news.remove');
  },

  async getBySlug(slug, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsModel.getNewsBySlug(slug),
      mongo: async () => {
        const value = String(slug || '').trim();
        if (!value) return null;
        const row = await getMongoCollection('news').findOne({
          slug: { $regex: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.news.getBySlug');
  },

  async logView(newsId, logData, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => newsModel.logView(newsId, logData),
      mongo: async () => {
        const collection = getMongoCollection('news');
        const row = await collection.findOne(resolveMongoIdFilter(newsId));
        if (!row) throw new Error('News item not found');
        const views = Array.isArray(row.views) ? row.views : [];
        views.push({
          ...(logData || {}),
          viewedAt: new Date().toISOString()
        });
        await collection.updateOne({ _id: row._id }, { $set: { views } });
        return true;
      }
    }, 'core.news.logView');
  },

  async getAllNews() {
    return await this.list();
  },

  async getNewsById(id) {
    return await this.getById(id);
  },

  async getNewsBySlug(slug) {
    return await this.getBySlug(slug);
  },

  async addNews(data) {
    return await this.create(data);
  },

  async updateNews(id, data) {
    return await this.update(id, data);
  },

  async deleteNews(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('newsRepository', newsRepository);

module.exports = newsRepository;
