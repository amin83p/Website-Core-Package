const { applyGenericFilter } = require('../utils/queryEngine');
const quotaBalanceSnapshotModel = require('../models/quotaBalanceSnapshotModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'userId',
  'section',
  'operation'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'dateTime',
  'lastReconciledAt',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;
  const orgId = toPublicId(scope?.orgId || '');
  const userId = toPublicId(scope?.userId || '');
  return list.filter((row) => {
    if (orgId && !idsEqual(row?.orgId, orgId)) return false;
    if (userId && !idsEqual(row?.userId, userId)) return false;
    return true;
  });
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const clauses = [];
  const orgId = toPublicId(scope?.orgId || '');
  const userId = toPublicId(scope?.userId || '');
  if (orgId) clauses.push({ orgId });
  if (userId) clauses.push({ userId });
  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

async function generateMongoSnapshotId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQS${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `AQS${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('quotaBalanceSnapshots');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { dateTime: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

function buildKeyFilter({ orgId = '', userId = '', section = '', operation = '' } = {}) {
  return {
    orgId: toPublicId(orgId) || '',
    userId: toPublicId(userId) || '',
    section: String(section || '').trim(),
    operation: String(operation || '').trim()
  };
}

function validateKeyFilter(key = {}) {
  return Boolean(key?.orgId && key?.userId && key?.section && key?.operation);
}

const quotaBalanceSnapshotRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await quotaBalanceSnapshotModel.getAllSnapshots();
        const scopedRows = applyJsonScope(allRows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'core.quotaBalanceSnapshots.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) ? rows.length : 0;
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
      json: async () => quotaBalanceSnapshotModel.getSnapshotById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('quotaBalanceSnapshots').findOne(resolveMongoIdFilter(id)))
    }, 'core.quotaBalanceSnapshots.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.addSnapshot(data),
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoSnapshotId(collection, payload.id, payload.dateTime);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.quotaBalanceSnapshots.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.updateSnapshot(id, data),
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Quota balance snapshot not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.quotaBalanceSnapshots.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.deleteSnapshot(id),
      mongo: async () => getMongoCollection('quotaBalanceSnapshots').deleteOne(resolveMongoIdFilter(id))
    }, 'core.quotaBalanceSnapshots.remove');
  },

  async getByKey(keyFilter = {}, options = {}) {
    const key = buildKeyFilter(keyFilter);
    if (!validateKeyFilter(key)) return null;
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.getSnapshotByKey(key.orgId, key.userId, key.section, key.operation),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('quotaBalanceSnapshots').findOne(key))
    }, 'core.quotaBalanceSnapshots.getByKey');
  },

  async upsertByKey(data = {}, options = {}) {
    const key = buildKeyFilter(data);
    if (!validateKeyFilter(key)) {
      throw new Error('orgId, userId, section, and operation are required for snapshot upsert.');
    }
    return runByRepositoryBackend(options, {
      json: async () => {
        const existing = await quotaBalanceSnapshotModel.getSnapshotByKey(key.orgId, key.userId, key.section, key.operation);
        if (existing?.id) {
          return quotaBalanceSnapshotModel.updateSnapshot(existing.id, { ...existing, ...data, id: existing.id });
        }
        return quotaBalanceSnapshotModel.addSnapshot(data);
      },
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const existing = await collection.findOne(key);
        if (existing?._id) {
          const merged = deepMerge(existing, data || {});
          merged.id = toPublicId(existing?.id || existing?._id);
          const { _id, ...toSet } = merged;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        }
        const payload = { ...(data || {}) };
        payload.id = await generateMongoSnapshotId(collection, payload.id, payload.dateTime);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.quotaBalanceSnapshots.upsertByKey');
  },

  async updateWithVersion(id, expectedVersion, patch = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.updateSnapshotWithVersion(id, expectedVersion, patch),
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const idToken = toPublicId(id);
        const versionToken = Number.parseInt(String(expectedVersion), 10);
        if (!idToken || !Number.isFinite(versionToken)) return null;
        const updatePayload = deepMerge({}, patch || {});
        delete updatePayload.id;
        delete updatePayload._id;
        delete updatePayload.version;
        const nowIso = new Date().toISOString();
        updatePayload.audit = {
          ...(isPlainObject(updatePayload.audit) ? updatePayload.audit : {}),
          lastUpdateDateTime: nowIso
        };
        const updateResult = await collection.findOneAndUpdate(
          { id: idToken, version: versionToken },
          {
            $set: updatePayload,
            $inc: { version: 1 }
          },
          { returnDocument: 'after' }
        );
        return normalizeMongoDocument(updateResult?.value || updateResult || null);
      }
    }, 'core.quotaBalanceSnapshots.updateWithVersion');
  },

  async clearByOrg(orgId, options = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear quota balance snapshots.');
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.clearByOrg(targetOrgId),
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const before = await collection.countDocuments({ orgId: targetOrgId });
        if (!before) return { removed: 0, remaining: await collection.countDocuments({}) };
        await collection.deleteMany({ orgId: targetOrgId });
        return {
          removed: before,
          remaining: await collection.countDocuments({})
        };
      }
    }, 'core.quotaBalanceSnapshots.clearByOrg');
  },

  async clearAll(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaBalanceSnapshotModel.clearAllSnapshots(),
      mongo: async () => {
        const collection = getMongoCollection('quotaBalanceSnapshots');
        const before = await collection.countDocuments({});
        await collection.deleteMany({});
        return { removed: before, remaining: 0 };
      }
    }, 'core.quotaBalanceSnapshots.clearAll');
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

assertQueryableCrudRepository('quotaBalanceSnapshotRepository', quotaBalanceSnapshotRepository);

module.exports = quotaBalanceSnapshotRepository;
