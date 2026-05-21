const taskModel = require('../models/taskModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
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

function buildTaskScopeFilter(scope = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };
  const userId = toPublicId(scope?.userId);
  if (!userId) return { id: '__NO_MATCH__' };
  return { 'assignees.userId': userId };
}

function parsePageLimit(query = {}, fallbackLimit = 20) {
  const rawPage = Number.parseInt(query?.page, 10);
  const rawLimit = Number.parseInt(query?.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : fallbackLimit;
  return { page, limit };
}

async function listMongoTasks(options = {}) {
  const collection = getMongoCollection('tasks');
  const query = options?.query || {};
  const scopeFilter = buildTaskScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'title', 'status', 'assignees.userId', 'projectId'],
    dateFields: ['createdAt', 'dueDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const taskRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return taskModel.queryTasks({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoTasks(options)
    }, 'core.tasks.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await taskModel.queryTasks({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const scopeFilter = buildTaskScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'title', 'status', 'assignees.userId', 'projectId'],
          dateFields: ['createdAt', 'dueDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.tasks.count');
  },

  async listPaged(options = {}) {
    const query = options?.query || {};
    const { page, limit } = parsePageLimit(query, 20);

    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await taskModel.queryTasks({
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
    }, 'core.tasks.listPaged');
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
      json: async () => taskModel.getTaskById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('tasks').findOne(resolveMongoIdFilter(id)))
    }, 'core.tasks.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.createTask(data, options?.userId || 'system'),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.tasks.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.updateTaskFull(id, data, options?.userId || 'system'),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Task not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.tasks.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.deleteTask(id),
      mongo: async () => getMongoCollection('tasks').deleteOne(resolveMongoIdFilter(id))
    }, 'core.tasks.remove');
  },

  async getTaskSummaryById(taskId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.getTaskSummaryById(taskId),
      mongo: async () => {
        const row = await this.getById(taskId, options);
        if (!row) return null;
        const { id, title, status, assignees = [], dueDate, checkpoints = [], rubric = null } = row;
        return { id, title, status, assignees, dueDate, checkpoints, rubric };
      }
    }, 'core.tasks.getSummaryById');
  },

  async addDeliverable(taskId, deliverableData, userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.addDeliverable(taskId, deliverableData, userId),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const row = await collection.findOne(resolveMongoIdFilter(taskId));
        if (!row) throw new Error('Task not found');
        const deliverable = {
          ...(deliverableData || {}),
          id: (deliverableData && deliverableData.id) || `${Date.now()}${Math.floor(Math.random() * 1000)}`,
          userId: toPublicId(userId),
          createdAt: new Date().toISOString()
        };
        const deliverables = Array.isArray(row.deliverables) ? [...row.deliverables, deliverable] : [deliverable];
        await collection.updateOne({ _id: row._id }, { $set: { deliverables } });
        return deliverable;
      }
    }, 'core.tasks.addDeliverable');
  },

  async deleteDeliverable(taskId, fileUrl, checkpointId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.deleteDeliverable(taskId, fileUrl, checkpointId),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const row = await collection.findOne(resolveMongoIdFilter(taskId));
        if (!row) throw new Error('Task not found');
        const current = Array.isArray(row.deliverables) ? row.deliverables : [];
        const filtered = current.filter((item) => {
          if (fileUrl && String(item?.fileUrl || '') === String(fileUrl)) return false;
          if (checkpointId && idsEqual(item?.checkpointId, checkpointId)) return false;
          return true;
        });
        await collection.updateOne({ _id: row._id }, { $set: { deliverables: filtered } });
        return true;
      }
    }, 'core.tasks.deleteDeliverable');
  },

  async addComment(taskId, commentData, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.addComment(taskId, commentData),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const row = await collection.findOne(resolveMongoIdFilter(taskId));
        if (!row) throw new Error('Task not found');
        const comment = {
          ...(commentData || {}),
          id: (commentData && commentData.id) || `${Date.now()}${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date().toISOString()
        };
        const comments = Array.isArray(row.comments) ? [...row.comments, comment] : [comment];
        await collection.updateOne({ _id: row._id }, { $set: { comments } });
        return comment;
      }
    }, 'core.tasks.addComment');
  },

  async deleteComment(taskId, commentId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => taskModel.deleteComment(taskId, commentId),
      mongo: async () => {
        const collection = getMongoCollection('tasks');
        const row = await collection.findOne(resolveMongoIdFilter(taskId));
        if (!row) throw new Error('Task not found');
        const current = Array.isArray(row.comments) ? row.comments : [];
        const filtered = current.filter((item) => !idsEqual(item?.id, commentId));
        await collection.updateOne({ _id: row._id }, { $set: { comments: filtered } });
        return true;
      }
    }, 'core.tasks.deleteComment');
  }
};

assertQueryableCrudRepository('taskRepository', taskRepository);

module.exports = taskRepository;
