const personModel = require('../models/personModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, toIdArray, idsEqual } = require('../utils/idAdapter');
const { projectPersonForRead } = require('../services/person/personTagProjectionService');
const path = require('path');
const roleRegistryService = require('../services/person/roleRegistryService');
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

function resolveSchoolRoleTagProvider() {
  const localProviderPath = path.join(__dirname, '../services/school/schoolRoleTagProvider');
  let cached;
  try {
    cached = require(localProviderPath);
  } catch (error) {
    cached = null;
  }
  const packageProviderPath = path.join(__dirname, '../../packages/school/MVC/services/school/schoolRoleTagProvider');
  try {
    cached = require(packageProviderPath);
  } catch (error) {
    if (!cached) {
      return { buildSchoolRoleIndex: async () => new Map() };
    }
  }
  return cached || { buildSchoolRoleIndex: async () => new Map() };
}
const schoolRoleTagProvider = resolveSchoolRoleTagProvider();
const { buildSchoolRoleIndex } = schoolRoleTagProvider;

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function normalizePersonEnrichmentOptions(options = {}) {
  const includeSchoolRoles = options?.enrichment?.includeSchoolRoles === true;
  return { includeSchoolRoles };
}

function normalizeTagToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function dedupeTags(values) {
  return Array.from(new Set((values || []).map(normalizeTagToken).filter(Boolean)));
}

function normalizeManualTagsLenient(tagsInput, roleRegistry = null) {
  const registry = roleRegistry || roleRegistryService.getRoleRegistrySnapshot();
  const systemKeySet = new Set(dedupeTags(registry.systemRoleKeys || []));
  const tags = Array.isArray(tagsInput) ? tagsInput : [];
  return dedupeTags(tags).filter((tag) => !systemKeySet.has(tag));
}

function normalizeManualTagsStrict(tagsInput, roleRegistry = null) {
  const registry = roleRegistry || roleRegistryService.getRoleRegistrySnapshot();
  const tags = dedupeTags(Array.isArray(tagsInput) ? tagsInput : []);
  const systemKeySet = new Set(dedupeTags(registry.systemRoleKeys || []));
  const systemAliasMap = registry.systemRoleAlias || {};
  const blocked = tags
    .map((token) => {
      if (systemKeySet.has(token)) return token;
      return systemAliasMap[token] || null;
    })
    .filter(Boolean);
  if (blocked.length) {
    throw new Error(`System tags cannot be set manually: ${dedupeTags(blocked).join(', ')}.`);
  }
  const allowedSet = new Set(dedupeTags(registry.manualTagPresets || []));
  const unknown = tags.filter((token) => !allowedSet.has(token));
  if (unknown.length) {
    throw new Error(`Unknown manual tag(s): ${unknown.join(', ')}.`);
  }
  return tags;
}

function normalizeOrganizationMembership(org, fallbackJoinedAt) {
  const rawRoles = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
  const normalizedRoles = rawRoles
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, idx, arr) => arr.indexOf(r) === idx);

  if (!normalizedRoles.length) normalizedRoles.push('member');

  return {
    ...(org || {}),
    orgId: toPublicId(org?.orgId),
    roles: normalizedRoles,
    role: normalizedRoles[0],
    memberStatus: String(org?.memberStatus || 'active').trim().toLowerCase() || 'active',
    joinedAt: org?.joinedAt || fallbackJoinedAt || new Date().toISOString()
  };
}

function normalizePersonForPersist(rawPerson, roleRegistry = null) {
  const input = normalizeMongoDocument(rawPerson) || {};
  const output = { ...input };
  const manualTags = normalizeManualTagsStrict(output.manualTags ?? output.tags ?? [], roleRegistry);
  output.manualTags = manualTags;
  output.tags = manualTags;
  delete output.systemTags;
  output.organizations = Array.isArray(output.organizations)
    ? output.organizations.map((org) => normalizeOrganizationMembership(org))
    : [];
  return output;
}

function normalizePersonForReadBase(rawPerson, roleRegistry = null) {
  const input = normalizeMongoDocument(rawPerson) || {};
  const output = { ...input };
  const manualTags = normalizeManualTagsLenient(output.manualTags ?? output.tags ?? [], roleRegistry);
  output.manualTags = manualTags;
  output.tags = manualTags;
  delete output.systemTags;
  output.organizations = Array.isArray(output.organizations)
    ? output.organizations.map((org) => normalizeOrganizationMembership(org))
    : [];
  return output;
}

async function hydratePersonForReadMongo(rawPerson, options = {}) {
  const enrichment = normalizePersonEnrichmentOptions(options);
  const roleRegistry = options?.roleRegistry || roleRegistryService.getRoleRegistrySnapshot();
  const base = normalizePersonForReadBase(rawPerson, roleRegistry);
  const personId = toPublicId(base?.id);
  let domainSystemTags = [];

  if (enrichment.includeSchoolRoles && personId) {
    const schoolRoleIndex = options?.schoolRoleIndex || await buildSchoolRoleIndex();
    domainSystemTags = Array.from((schoolRoleIndex && schoolRoleIndex.get(personId)) || []);
  }

  return projectPersonForRead(base, {
    systemRoleKeys: roleRegistry.systemRoleKeys || [],
    systemRoleAlias: roleRegistry.systemRoleAlias || {},
    domainSystemTags
  });
}

function buildPersonScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const allowed = toIdArray(scope?.personIds || []);
  if (!allowed.length) return { id: '__NO_MATCH__' };
  return { id: { $in: allowed } };
}

function buildPersonCollectionFilter(options = {}) {
  const query = options?.query || {};
  const scopeFilter = buildPersonScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name.first', 'name.last', 'contact.email', 'contact.emails.0.email'],
    dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'createdAt', 'date']
  });
  return combineMongoFilters(scopeFilter, queryFilter);
}

async function listMongoPersons(options = {}) {
  const collection = getMongoCollection('persons');
  const query = options?.query || {};
  const filter = buildPersonCollectionFilter(options);
  const projection = options?.projection && typeof options.projection === 'object'
    ? options.projection
    : undefined;
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
  const enrichment = normalizePersonEnrichmentOptions(options);
  const roleRegistry = options?.roleRegistry || await roleRegistryService.getRoleRegistry(options);

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  const schoolRoleIndex = enrichment.includeSchoolRoles ? await buildSchoolRoleIndex() : null;
  return Promise.all(rows.map((row) => hydratePersonForReadMongo(row, { enrichment, schoolRoleIndex, roleRegistry })));
}

function canonicalAudienceTag(value) {
  const normalized = normalizeTagToken(value);
  if (!normalized) return null;
  const registry = roleRegistryService.getRoleRegistrySnapshot();
  const aliasMap = registry.audienceAliasToCanonical || {};
  return aliasMap[normalized] || normalized;
}

function collectAudienceRolesFromOrganizations(person) {
  const orgList = Array.isArray(person?.organizations) ? person.organizations : [];
  const roles = [];
  orgList.forEach((org) => {
    const rawRoles = Array.isArray(org?.roles) ? org.roles : (org?.role ? [org.role] : []);
    rawRoles.forEach((role) => {
      const token = normalizeTagToken(role);
      if (token) roles.push(token);
    });
  });
  return dedupeTags(roles);
}

function buildAudienceTagsFromPerson(person) {
  const manual = dedupeTags(Array.isArray(person?.manualTags) ? person.manualTags : []);
  const system = dedupeTags(Array.isArray(person?.systemTags) ? person.systemTags : []);
  const merged = dedupeTags(Array.isArray(person?.tags) ? person.tags : []);
  const orgRoles = collectAudienceRolesFromOrganizations(person);

  const canonical = dedupeTags(
    ['all', 'user', ...manual, ...system, ...merged, ...orgRoles]
      .map(canonicalAudienceTag)
      .filter(Boolean)
  );
  const expanded = [...canonical];
  const registry = roleRegistryService.getRoleRegistrySnapshot();
  const canonicalExtra = registry.audienceCanonicalExtra || {};
  canonical.forEach((token) => {
    const extra = canonicalExtra[token];
    if (Array.isArray(extra)) expanded.push(...extra);
  });
  return dedupeTags(expanded);
}

function buildOrganizationMembershipFilter(orgId) {
  const target = toPublicId(orgId);
  if (!target) return { id: '__NO_MATCH__' };
  const candidates = [target];
  const numeric = Number(target);
  if (Number.isFinite(numeric)) candidates.push(numeric);
  return { organizations: { $elemMatch: { orgId: { $in: candidates } } } };
}

const personRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        const enrichment = normalizePersonEnrichmentOptions(options);
        return personModel.queryPersons({
          query,
          scope,
          enrichment,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoPersons(options)
    }, 'core.persons.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const enrichment = normalizePersonEnrichmentOptions(options);
        const rows = await personModel.queryPersons({
          query,
          scope,
          enrichment,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const filter = buildPersonCollectionFilter({
          ...(options || {}),
          query
        });
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.persons.count');
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
      json: async () => {
        const enrichment = normalizePersonEnrichmentOptions(options);
        return personModel.getPersonById(id, { enrichment });
      },
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const row = await collection.findOne(resolveMongoIdFilter(id));
        if (!row) return null;
        return hydratePersonForReadMongo(row, options);
      }
    }, 'core.persons.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => personModel.addPerson(data),
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const roleRegistry = await roleRegistryService.getRoleRegistry(options);
        const payload = normalizePersonForPersist(data || {}, roleRegistry);
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return hydratePersonForReadMongo(payload, { ...(options || {}), roleRegistry });
      }
    }, 'core.persons.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => personModel.updatePerson(id, data),
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Person not found');
        const roleRegistry = await roleRegistryService.getRoleRegistry(options);

        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const payload = normalizePersonForPersist(merged, roleRegistry);
        const { _id, ...toSet } = payload;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        const updated = await collection.findOne({ _id: existing._id });
        return hydratePersonForReadMongo(updated, { ...(options || {}), roleRegistry });
      }
    }, 'core.persons.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => personModel.deletePerson(id),
      mongo: async () => {
        const collection = getMongoCollection('persons');
        await collection.deleteOne(resolveMongoIdFilter(id));
      }
    }, 'core.persons.remove');
  },

  async getAudienceTags(personId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const enrichment = normalizePersonEnrichmentOptions(options);
        return personModel.getAudienceTagsForPerson(personId, { enrichment });
      },
      mongo: async () => {
        const person = await this.getById(personId, options);
        if (!person) return ['all', 'user'];
        return buildAudienceTagsFromPerson(person);
      }
    }, 'core.persons.getAudienceTags');
  },

  async findByOrganizationId(orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const enrichment = normalizePersonEnrichmentOptions(options);
        return personModel.findPersonsByOrganizationId(orgId, {
          ...options,
          enrichment
        });
      },
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const filter = buildOrganizationMembershipFilter(orgId);
        const limit = Number(options?.limit) > 0 ? Number(options.limit) : 0;
        let cursor = collection.find(filter).sort({ id: 1 });
        if (limit > 0) cursor = cursor.limit(limit);
        const rows = await cursor.toArray();
        return Promise.all(rows.map((row) => hydratePersonForReadMongo(row, options)));
      }
    }, 'core.persons.findByOrganizationId');
  },

  async countByOrganizationId(orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => personModel.countPersonsByOrganizationId(orgId),
      mongo: async () => {
        const collection = getMongoCollection('persons');
        return collection.countDocuments(buildOrganizationMembershipFilter(orgId));
      }
    }, 'core.persons.countByOrganizationId');
  },

  async existsByOrganizationId(orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => personModel.existsPersonByOrganizationId(orgId),
      mongo: async () => {
        const collection = getMongoCollection('persons');
        const row = await collection.findOne(buildOrganizationMembershipFilter(orgId), { projection: { _id: 1 } });
        return Boolean(row);
      }
    }, 'core.persons.existsByOrganizationId');
  },

  getAllowedManualTags() {
    return personModel.getAllowedManualTags();
  },

  getSystemTagKeys() {
    return personModel.getSystemTagKeys();
  }
};

assertQueryableCrudRepository('personRepository', personRepository);

module.exports = personRepository;
