const { applyGenericFilter } = require('../utils/queryEngine');
const quotaCreditLotModel = require('../models/quotaCreditLotModel');
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
  'operation',
  'creditEntryId',
  'status',
  'source.eventType',
  'source.eventId'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'dateTime',
  'creditDateTime',
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

async function generateMongoLotId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQLT${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `AQLT${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('quotaCreditLots');
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
  const filter = {};
  const orgToken = toPublicId(orgId);
  const userToken = toPublicId(userId);
  const sectionToken = String(section || '').trim();
  const operationToken = String(operation || '').trim();
  if (orgToken) filter.orgId = orgToken;
  if (userToken) filter.userId = userToken;
  if (sectionToken) filter.section = sectionToken;
  if (operationToken) filter.operation = operationToken;
  return filter;
}

const quotaCreditLotRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await quotaCreditLotModel.getAllLots();
        const scopedRows = applyJsonScope(allRows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'core.quotaCreditLots.list');
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
      json: async () => quotaCreditLotModel.getLotById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('quotaCreditLots').findOne(resolveMongoIdFilter(id)))
    }, 'core.quotaCreditLots.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (Array.isArray(data)) return quotaCreditLotModel.addLots(data);
        return quotaCreditLotModel.addLot(data);
      },
      mongo: async () => {
        const collection = getMongoCollection('quotaCreditLots');
        if (Array.isArray(data)) {
          const payloads = [];
          for (const rawItem of data) {
            const item = { ...(rawItem || {}) };
            // eslint-disable-next-line no-await-in-loop
            item.id = await generateMongoLotId(collection, item.id, item.dateTime);
            payloads.push(item);
          }
          if (payloads.length > 0) await collection.insertMany(payloads);
          return payloads.map((row) => normalizeMongoDocument(row)).filter(Boolean);
        }

        const payload = { ...(data || {}) };
        payload.id = await generateMongoLotId(collection, payload.id, payload.dateTime);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.quotaCreditLots.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaCreditLotModel.updateLot(id, data),
      mongo: async () => {
        const collection = getMongoCollection('quotaCreditLots');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Quota credit lot not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.quotaCreditLots.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaCreditLotModel.deleteLot(id),
      mongo: async () => getMongoCollection('quotaCreditLots').deleteOne(resolveMongoIdFilter(id))
    }, 'core.quotaCreditLots.remove');
  },

  async updateWithVersion(id, expectedVersion, patch = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaCreditLotModel.updateLotWithVersion(id, expectedVersion, patch),
      mongo: async () => {
        const collection = getMongoCollection('quotaCreditLots');
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
    }, 'core.quotaCreditLots.updateWithVersion');
  },

  async removeByKey(keyFilter = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await quotaCreditLotModel.getAllLots();
        const match = buildKeyFilter(keyFilter);
        const matchedIds = rows
          .filter((row) => {
            if (match.orgId && !idsEqual(row?.orgId, match.orgId)) return false;
            if (match.userId && !idsEqual(row?.userId, match.userId)) return false;
            if (match.section && String(row?.section || '') !== match.section) return false;
            if (match.operation && String(row?.operation || '') !== match.operation) return false;
            return true;
          })
          .map((row) => row.id)
          .filter(Boolean);
        let removed = 0;
        for (const id of matchedIds) {
          // eslint-disable-next-line no-await-in-loop
          const didRemove = await quotaCreditLotModel.deleteLot(id);
          if (didRemove) removed += 1;
        }
        return { removed };
      },
      mongo: async () => {
        const filter = buildKeyFilter(keyFilter);
        if (!Object.keys(filter).length) return { removed: 0 };
        const result = await getMongoCollection('quotaCreditLots').deleteMany(filter);
        return { removed: Number(result?.deletedCount || 0) };
      }
    }, 'core.quotaCreditLots.removeByKey');
  },

  async clearByOrg(orgId, options = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear quota credit lots.');
    return runByRepositoryBackend(options, {
      json: async () => quotaCreditLotModel.clearByOrg(targetOrgId),
      mongo: async () => {
        const collection = getMongoCollection('quotaCreditLots');
        const before = await collection.countDocuments({ orgId: targetOrgId });
        if (!before) return { removed: 0, remaining: await collection.countDocuments({}) };
        await collection.deleteMany({ orgId: targetOrgId });
        return {
          removed: before,
          remaining: await collection.countDocuments({})
        };
      }
    }, 'core.quotaCreditLots.clearByOrg');
  },

  async clearAll(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => quotaCreditLotModel.clearAllLots(),
      mongo: async () => {
        const collection = getMongoCollection('quotaCreditLots');
        const before = await collection.countDocuments({});
        await collection.deleteMany({});
        return { removed: before, remaining: 0 };
      }
    }, 'core.quotaCreditLots.clearAll');
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

assertQueryableCrudRepository('quotaCreditLotRepository', quotaCreditLotRepository);

module.exports = quotaCreditLotRepository;
