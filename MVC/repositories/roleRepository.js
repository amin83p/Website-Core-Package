const roleModel = require('../models/roleModel');
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
const roleRegistryService = require('../services/person/roleRegistryService');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildCanViewAllFilter(scope = {}) {
  return scope?.canViewAll === false ? { id: '__NO_MATCH__' } : {};
}

function buildNonDeprecatedRoleFilter() {
  return { key: { $nin: ['student', 'teacher', 'staff', 'pte_studnet'] } };
}

function isDeprecatedRole(row = {}) {
  return roleRegistryService.isDeprecatedRoleKey(row?.key);
}

function normalizeMongoRoleInput(raw = {}, existing = null) {
  const key = roleRegistryService.normalizeRoleToken(raw.key || existing?.key || '');
  const aliases = roleRegistryService
    .dedupe(raw.aliases || existing?.aliases || [])
    .filter((alias) => alias !== key);

  return {
    ...(existing || {}),
    ...(raw || {}),
    key,
    label: String(raw.label || existing?.label || '').trim(),
    description: String(raw.description || existing?.description || '').trim(),
    domain: roleRegistryService.normalizeRoleToken(raw.domain || existing?.domain || ''),
    packageName: String(raw.packageName || existing?.packageName || '').trim().toUpperCase(),
    aliases,
    active: raw.active !== undefined ? Boolean(raw.active) : (existing?.active !== false),
    system: raw.system !== undefined ? Boolean(raw.system) : (existing?.system === true)
  };
}

async function assertMongoRoleUniqueness(collection, role = {}, currentMongoId = null) {
  const docs = await collection
    .find(currentMongoId ? { _id: { $ne: currentMongoId } } : {})
    .project({ key: 1, aliases: 1 })
    .toArray();

  const targetTokens = new Set(
    roleRegistryService
      .dedupe([role.key, ...(Array.isArray(role.aliases) ? role.aliases : [])])
      .filter(Boolean)
  );

  for (const doc of docs) {
    const ownerKey = roleRegistryService.normalizeRoleToken(doc?.key || '');
    if (!ownerKey) continue;
    const ownerTokens = new Set(
      roleRegistryService
        .dedupe([ownerKey, ...(Array.isArray(doc?.aliases) ? doc.aliases : [])])
        .filter(Boolean)
    );
    if (ownerTokens.has(role.key) && ownerKey !== role.key) {
      throw new Error(`Role key "${role.key}" already exists.`);
    }
    const clashes = [];
    targetTokens.forEach((token) => {
      if (ownerTokens.has(token) && token !== ownerKey) clashes.push(token);
    });
    if (clashes.length) {
      throw new Error(`Role aliases conflict with existing roles: ${clashes.join(', ')}.`);
    }
  }
}

async function listMongoRoles(options = {}) {
  const collection = getMongoCollection('roles');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'key', 'label', 'description', 'domain', 'packageName', 'aliases'],
    dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const visibleFilter = combineMongoFilters(filter, buildNonDeprecatedRoleFilter());
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(visibleFilter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter((row) => row && !isDeprecatedRole(row));
}

const roleRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => roleModel.queryRoles({
        query: options?.query || {},
        scope: options?.scope || {},
        projection: options?.projection || null,
        pagination: options?.pagination || null,
        sort: options?.sort || null
      }),
      mongo: async () => listMongoRoles(options)
    }, 'core.roles.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await roleModel.queryRoles({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('roles');
        const scopeFilter = buildCanViewAllFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'key', 'label', 'description', 'domain', 'packageName', 'aliases'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter, buildNonDeprecatedRoleFilter());
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.roles.count');
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
      json: async () => roleModel.getRoleById(id),
      mongo: async () => {
        const row = normalizeMongoDocument(await getMongoCollection('roles').findOne(resolveMongoIdFilter(id)));
        return row && !isDeprecatedRole(row) ? row : null;
      }
    }, 'core.roles.getById');
  },

  async getByKey(key, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => roleModel.getRoleByKey(key),
      mongo: async () => {
        const token = roleRegistryService.normalizeRoleToken(key);
        if (!token) return null;
        if (roleRegistryService.isDeprecatedRoleKey(token)) return null;
        const row = await getMongoCollection('roles').findOne({
          key: { $regex: new RegExp(`^${escapeRegex(token)}$`, 'i') }
        });
        const normalized = normalizeMongoDocument(row);
        return normalized && !isDeprecatedRole(normalized) ? normalized : null;
      }
    }, 'core.roles.getByKey');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => roleModel.addRole(data),
      mongo: async () => {
        const collection = getMongoCollection('roles');
        const payload = normalizeMongoRoleInput(data || {});
        const validation = roleModel.validateRoleData(payload, { mode: 'create' });
        if (!validation.isValid) throw new Error(validation.errors.join('\r\n'));

        await assertMongoRoleUniqueness(collection, payload);
        payload.id = await generateUniqueStringId(collection, payload.id);
        payload.audit = {
          ...(payload.audit || {}),
          createUser: String(payload?.audit?.createUser || 'SYSTEM'),
          createDateTime: String(payload?.audit?.createDateTime || new Date().toISOString()),
          lastUpdateUser: String(payload?.audit?.lastUpdateUser || payload?.audit?.createUser || 'SYSTEM'),
          lastUpdateDateTime: String(payload?.audit?.lastUpdateDateTime || new Date().toISOString())
        };
        await collection.insertOne(payload);
        roleRegistryService.clearRoleRegistryCache();
        return normalizeMongoDocument(payload);
      }
    }, 'core.roles.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => roleModel.updateRole(id, data),
      mongo: async () => {
        const collection = getMongoCollection('roles');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Role not found.');
        if (existing.system === true) throw new Error('System roles are read-only and cannot be modified.');

        const mergedRaw = deepMerge(existing, data || {});
        const merged = normalizeMongoRoleInput(mergedRaw, {
          ...existing,
          id: toPublicId(existing?.id || existing?._id),
          system: false
        });
        merged.id = toPublicId(existing?.id || existing?._id);
        merged.system = false;

        const validation = roleModel.validateRoleData(merged, { mode: 'update' });
        if (!validation.isValid) throw new Error(validation.errors.join('\r\n'));

        await assertMongoRoleUniqueness(collection, merged, existing._id);

        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        roleRegistryService.clearRoleRegistryCache();
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.roles.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => roleModel.deleteRole(id),
      mongo: async () => {
        const collection = getMongoCollection('roles');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Role not found.');
        if (existing.system === true) throw new Error('System roles cannot be deleted.');
        await collection.deleteOne({ _id: existing._id });
        roleRegistryService.clearRoleRegistryCache();
      }
    }, 'core.roles.remove');
  },

  async getAllRoles(options = {}) {
    return this.list(options);
  }
};

assertQueryableCrudRepository('roleRepository', roleRepository);

module.exports = roleRepository;
