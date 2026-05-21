const userModel = require('../models/userModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, toIdArray, idsEqual } = require('../utils/idAdapter');
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

function buildUserScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const allowed = toIdArray(scope?.userIds || []);
  if (!allowed.length) return { id: '__NO_MATCH__' };
  return { id: { $in: allowed } };
}

function buildUserCollectionFilter(options = {}) {
  const query = options?.query || {};
  const scopeFilter = buildUserScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'username', 'email', 'personId', 'role'],
    dateFields: ['createdAt', 'lastLogin', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  return combineMongoFilters(scopeFilter, queryFilter);
}

async function listMongoUsers(options = {}) {
  const collection = getMongoCollection('users');
  const query = options?.query || {};
  const filter = buildUserCollectionFilter(options);
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

async function getMongoUserById(id) {
  const collection = getMongoCollection('users');
  const row = await collection.findOne(resolveMongoIdFilter(id));
  return normalizeMongoDocument(row);
}

async function getVirtualSuperAdminById(id) {
  const candidate = await userModel.getUserById(id);
  return candidate?.isVirtualSuperAdmin ? candidate : null;
}

async function getVirtualSuperAdminByUsername(username) {
  const candidate = await userModel.getUserByUsername(username);
  return candidate?.isVirtualSuperAdmin ? candidate : null;
}

const userRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return userModel.queryUsers({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoUsers(options)
    }, 'core.users.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await userModel.queryUsers({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('users');
        const filter = buildUserCollectionFilter({
          ...(options || {}),
          query
        });
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.users.count');
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
      json: async () => userModel.getUserById(id),
      mongo: async () => (await getVirtualSuperAdminById(id)) || getMongoUserById(id)
    }, 'core.users.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.addUser(data),
      mongo: async () => {
        const collection = getMongoCollection('users');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.users.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.updateUser(id, data),
      mongo: async () => {
        const virtual = await getVirtualSuperAdminById(id);
        if (virtual?.isVirtualSuperAdmin) {
          // Keep parity with JSON behavior for virtual root accounts in mongo mode.
          return userModel.updateUser(id, data);
        }

        const collection = getMongoCollection('users');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('User not found');

        if (existing?.isVirtualSuperAdmin) {
          throw new Error('This Root Administrator cannot be updated in Mongo mode.');
        }

        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne(
          { _id: existing._id },
          { $set: toSet }
        );

        const updated = await collection.findOne({ _id: existing._id });
        return normalizeMongoDocument(updated);
      }
    }, 'core.users.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.deleteUser(id),
      mongo: async () => {
        const virtual = await getVirtualSuperAdminById(id);
        if (virtual) throw new Error('This Root Administrator cannot be deleted.');
        const collection = getMongoCollection('users');
        await collection.deleteOne(resolveMongoIdFilter(id));
      }
    }, 'core.users.remove');
  },

  async getByPersonId(personId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.getUsersByPersonId(personId),
      mongo: async () => {
        const collection = getMongoCollection('users');
        const row = await collection.findOne({ personId: toPublicId(personId) });
        return normalizeMongoDocument(row);
      }
    }, 'core.users.getByPersonId');
  },

  async findByPersonId(personId) {
    return await this.list({
      query: { personId__eq: personId },
      scope: { canViewAll: true }
    });
  },

  async existsByPersonId(personId) {
    return await this.exists({
      query: { personId__eq: personId },
      scope: { canViewAll: true }
    });
  },

  async unlinkPerson(userId, personId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.unlinkPerson(userId, personId),
      mongo: async () => {
        const collection = getMongoCollection('users');
        const row = await collection.findOne(resolveMongoIdFilter(userId));
        if (!row) throw new Error('User not found');
        if (!idsEqual(row?.personId, personId)) throw new Error('User not linked to this person');
        await collection.updateOne({ _id: row._id }, { $set: { personId: null } });
        const updated = await collection.findOne({ _id: row._id });
        return normalizeMongoDocument(updated);
      }
    }, 'core.users.unlinkPerson');
  },

  async getByUsername(username, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userModel.getUserByUsername(username),
      mongo: async () => {
        const virtual = await getVirtualSuperAdminByUsername(username);
        if (virtual) return virtual;

        const q = String(username || '').trim();
        if (!q) return null;
        const regex = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const collection = getMongoCollection('users');
        const row = await collection.findOne({
          $or: [{ username: { $regex: regex } }, { email: { $regex: regex } }]
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.users.getByUsername');
  }
};

assertQueryableCrudRepository('userRepository', userRepository);

module.exports = userRepository;
