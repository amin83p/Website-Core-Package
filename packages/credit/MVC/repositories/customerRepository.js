const customerModel = require('../models/customerModel');
const {
  runByRepositoryBackend,
  getMongoCollection,
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('../services/credit/creditCoreContracts');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildCreditScopeFilter(scope = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };
  const activeOrgId = String(scope?.activeOrgId || '').trim();
  if (!activeOrgId) return { id: '__NO_MATCH__' };
  return { orgId: activeOrgId };
}

async function listMongoCustomers(options = {}) {
  const collection = getMongoCollection('creditCustomers');
  const query = options?.query || {};
  const scopeFilter = buildCreditScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'customerCode', 'personId', 'personName', 'personEmail', 'personPhone', 'status'],
    dateFields: ['createdAt', 'updatedAt']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { updatedAt: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const customerRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const allRows = await customerModel.getAllCustomers();
        const scopeFilter = buildCreditScopeFilter(options?.scope || {});
        const scopedRows = allRows.filter((row) => {
          if (scopeFilter.id === '__NO_MATCH__') return false;
          if (!scopeFilter.orgId) return true;
          return String(row?.orgId || '').trim() === scopeFilter.orgId;
        });

        const q = String(query?.q || '').trim().toLowerCase();
        const searched = !q
          ? scopedRows
          : scopedRows.filter((item) => {
            const text = [
              item?.id,
              item?.customerCode,
              item?.personId,
              item?.personName,
              item?.personEmail,
              item?.personPhone,
              item?.status
            ].map((v) => String(v || '').toLowerCase()).join(' ');
            return text.includes(q);
          });

        return searched.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      },
      mongo: async () => listMongoCustomers(options)
    }, 'credit.customers.list');
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
      json: async () => customerModel.getCustomerById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('creditCustomers').findOne(resolveMongoIdFilter(id)))
    }, 'credit.customers.getById');
  },

  async create(payload, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => customerModel.addCustomer(payload),
      mongo: async () => {
        const collection = getMongoCollection('creditCustomers');
        const data = { ...(payload || {}) };
        data.id = await generateUniqueStringId(collection, data.id);
        if (!data.createdAt) data.createdAt = new Date().toISOString();
        data.updatedAt = new Date().toISOString();
        await collection.insertOne(data);
        return normalizeMongoDocument(data);
      }
    }, 'credit.customers.create');
  },

  async update(id, payload, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => customerModel.updateCustomer(id, payload),
      mongo: async () => {
        const collection = getMongoCollection('creditCustomers');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Customer not found.');
        const merged = deepMerge(existing, payload || {});
        merged.id = String(existing?.id || existing?._id || '').trim();
        merged.updatedAt = new Date().toISOString();
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'credit.customers.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => customerModel.deleteCustomer(id),
      mongo: async () => {
        const result = await getMongoCollection('creditCustomers').deleteOne(resolveMongoIdFilter(id));
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'credit.customers.remove');
  }
};

module.exports = customerRepository;
