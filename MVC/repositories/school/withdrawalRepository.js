const withdrawalModel = require('../../models/school/withdrawalModel');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { assertQueryableCrudRepository } = require('../contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('../backend/repositoryBackendSelector');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('../backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildScopeFilter(scope = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };

  const activeOrgId = toPublicId(scope?.activeOrgId) || '';
  if (!activeOrgId) return { id: '__NO_MATCH__' };
  return { orgId: activeOrgId };
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('schoolWithdrawals');
  const query = options?.query || {};
  const scopeFilter = buildScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'orgId', 'type', 'status', 'studentId', 'programId', 'termId', 'classId', 'reason'],
    dateFields: ['requestDate', 'effectiveDate', 'approvedDate', 'completedDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const withdrawalRepository = {
  WITHDRAWAL_TYPES: withdrawalModel.WITHDRAWAL_TYPES,
  WITHDRAWAL_STATUSES: withdrawalModel.WITHDRAWAL_STATUSES,
  WITHDRAWAL_REASONS: withdrawalModel.WITHDRAWAL_REASONS,
  WITHDRAWAL_REASON_LABELS: withdrawalModel.WITHDRAWAL_REASON_LABELS,
  INITIATOR_TYPES: withdrawalModel.INITIATOR_TYPES,

  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        const allRows = await withdrawalModel.getAllWithdrawals();
        const scopedRows = (allRows || []).filter((row) => {
          const scopeFilter = buildScopeFilter(scope);
          if (scopeFilter.id === '__NO_MATCH__') return false;
          if (!scopeFilter.orgId) return true;
          return toPublicId(row?.orgId) === toPublicId(scopeFilter.orgId);
        });
        return applyGenericFilter(scopedRows, query, {
          defaultSearchFields: ['id', 'orgId', 'type', 'status', 'studentId', 'programId', 'termId', 'classId', 'reason'],
          dateFields: ['requestDate', 'effectiveDate', 'approvedDate', 'completedDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'school.withdrawals.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    const rows = await this.list({ ...options, query });
    return Array.isArray(rows) ? rows.length : 0;
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({ ...options, query });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => withdrawalModel.getWithdrawalById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('schoolWithdrawals').findOne(resolveMongoIdFilter(id)))
    }, 'school.withdrawals.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => withdrawalModel.addWithdrawal(data),
      mongo: async () => {
        const collection = getMongoCollection('schoolWithdrawals');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'school.withdrawals.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => withdrawalModel.updateWithdrawal(id, data),
      mongo: async () => {
        const collection = getMongoCollection('schoolWithdrawals');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Withdrawal not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'school.withdrawals.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => withdrawalModel.deleteWithdrawal(id),
      mongo: async () => {
        const result = await getMongoCollection('schoolWithdrawals').deleteOne(resolveMongoIdFilter(id));
        return result.deletedCount > 0;
      }
    }, 'school.withdrawals.remove');
  },

  async getWithdrawalsByOrg(orgId, filters = {}, options = {}) {
    const query = {
      orgId__eq: toPublicId(orgId),
      ...(filters?.type ? { type__eq: filters.type } : {}),
      ...(filters?.status ? { status__eq: filters.status } : {}),
      ...(filters?.studentId ? { studentId__eq: toPublicId(filters.studentId) } : {})
    };
    return await this.list({ ...options, query, scope: { canViewAll: true } });
  },

  async getWithdrawalsByStudentId(studentId, orgId, options = {}) {
    return await this.list({
      ...options,
      query: {
        studentId__eq: toPublicId(studentId),
        orgId__eq: toPublicId(orgId)
      },
      scope: { canViewAll: true }
    });
  },

  async getWithdrawalById(id, options = {}) {
    return await this.getById(id, options);
  },

  async addWithdrawal(payload, options = {}) {
    return await this.create(payload, options);
  },

  async updateWithdrawal(id, payload, options = {}) {
    return await this.update(id, payload, options);
  },

  async deleteWithdrawal(id, options = {}) {
    return await this.remove(id, options);
  },

  async clearWithdrawalsByOrg(orgId, options = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear withdrawals.');
    return runByRepositoryBackend(options, {
      json: async () => withdrawalModel.clearWithdrawalsByOrg(targetOrgId),
      mongo: async () => {
        const collection = getMongoCollection('schoolWithdrawals');
        const existingCount = await collection.countDocuments({ orgId: targetOrgId });
        if (!existingCount) return { removed: 0, remaining: await collection.countDocuments({}) };
        const result = await collection.deleteMany({ orgId: targetOrgId });
        return {
          removed: Number(result?.deletedCount || 0),
          remaining: await collection.countDocuments({})
        };
      }
    }, 'school.withdrawals.clearByOrg');
  }
};

assertQueryableCrudRepository('withdrawalRepository', withdrawalRepository);

module.exports = withdrawalRepository;
