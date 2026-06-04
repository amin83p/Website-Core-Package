const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const sourceModel = require('../../models/benchpath/sourceModel');
const sourceFragmentModel = require('../../models/benchpath/sourceFragmentModel');
const clbFrameworkModel = require('../../models/benchpath/clbFrameworkModel');
const clbStageModel = require('../../models/benchpath/clbStageModel');
const clbSkillModel = require('../../models/benchpath/clbSkillModel');
const referenceCatalogModel = require('../../models/benchpath/referenceCatalogModel');
const taskModel = require('../../models/benchpath/taskModel');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
const { getEntityQueryExecutor } = requireCoreModule('MVC/models/queryExecutionBridge');
const { assertQueryableCrudRepository } = requireCoreModule('MVC/repositories/contracts/crudRepositoryContract');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const DEFAULT_DATE_FIELDS = ['createdAt', 'updatedAt', 'approvedAt'];

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function readRecordOrgId(record, orgField) {
  return toPublicId(record?.[orgField]);
}

function applyOrgScope(rows, scope = {}, options = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll === true) return list;
  if (scope?.denyAll === true) return [];

  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return [];

  const orgField = options?.orgField || 'orgId';
  const allowSystemFallback = scope?.allowSystemFallback === true || options?.allowSystemFallback === true;
  const resolveOrgId = typeof options?.resolveOrgId === 'function'
    ? options.resolveOrgId
    : (record) => readRecordOrgId(record, orgField);

  return list.filter((record) => {
    const recordOrgId = toPublicId(resolveOrgId(record));
    if (allowSystemFallback && recordOrgId === 'SYSTEM') return true;
    return idsEqual(recordOrgId, activeOrgId);
  });
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildBenchpathScopeFilter(scope = {}, options = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };

  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return { id: '__NO_MATCH__' };

  const orgField = String(options?.orgField || 'orgId').trim() || 'orgId';
  if (options?.allowSystemFallback === true) {
    return { $or: [{ [orgField]: activeOrgId }, { [orgField]: 'SYSTEM' }] };
  }
  return { [orgField]: activeOrgId };
}

function buildMongoBenchpathListContext(collectionName, options = {}, queryOptions = {}) {
  const collection = getMongoCollection(collectionName);
  const query = normalizeQueryOptions(options?.query || {});
  const scopeFilter = buildBenchpathScopeFilter(options?.scope || {}, {
    orgField: queryOptions?.orgField || 'orgId',
    allowSystemFallback: queryOptions?.allowSystemFallback === true
  });
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: queryOptions?.defaultSearchFields || [],
    dateFields: queryOptions?.dateFields || DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const projection = options?.projection && typeof options.projection === 'object'
    ? options.projection
    : undefined;
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  return {
    collection,
    filter,
    projection,
    sort,
    skip,
    limit
  };
}

async function listMongoBenchpathRecords(collectionName, options = {}, queryOptions = {}) {
  const {
    collection,
    filter,
    projection,
    sort,
    skip,
    limit
  } = buildMongoBenchpathListContext(collectionName, options, queryOptions);

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

function createBenchPathRepository(config) {
  const {
    entityName,
    getAll,
    getById,
    create,
    update,
    remove,
    collectionName,
    defaultSearchFields = ['id', 'slug', 'code', 'title', 'status', 'reviewStatus'],
    dateFields = DEFAULT_DATE_FIELDS,
    orgField = 'orgId',
    allowSystemFallback = true,
    resolveOrgId,
    transformList,
    transformItem
  } = config;

  async function runLocalList(plan = {}, options = {}) {
    const query = plan?.query || {};
    const scope = plan?.scope || {};

    const allRows = await getAll();
    const transformedRows = typeof transformList === 'function'
      ? await transformList(normalizeRows(allRows), options)
      : normalizeRows(allRows);

    const scopedRows = applyOrgScope(transformedRows, scope, {
      orgField,
      allowSystemFallback,
      resolveOrgId
    });

    return applyGenericFilter(scopedRows, query, { defaultSearchFields, dateFields });
  }

  return {
    async list(options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          const plan = {
            entity: entityName ? `benchpath.${entityName}` : 'benchpath',
            query: normalizeQueryOptions(options?.query || {}),
            scope: options?.scope || {},
            projection: options?.projection || null,
            pagination: options?.pagination || null,
            sort: options?.sort || null,
            fallback: {
              defaultSearchFields,
              dateFields
            }
          };

          if (!options?.skipExecutor && entityName) {
            const executor = getEntityQueryExecutor(`benchpath.${entityName}`);
            if (typeof executor === 'function') {
              const result = await executor(plan);
              if (Array.isArray(result)) return result;
              if (result && Array.isArray(result.items)) return result.items;
            }
          }

          return runLocalList(plan, options);
        },
        mongo: async () => listMongoBenchpathRecords(collectionName, options, {
          defaultSearchFields,
          dateFields,
          orgField,
          allowSystemFallback
        })
      }, `benchpath.${entityName || 'entity'}.list`);
    },

    async count(options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          const query = stripPaginationFromQuery(normalizeQueryOptions(options?.query || {}));
          const rows = await this.list({
            ...options,
            query
          });
          return Array.isArray(rows) ? rows.length : 0;
        },
        mongo: async () => {
          const query = stripPaginationFromQuery(normalizeQueryOptions(options?.query || {}));
          const {
            collection,
            filter
          } = buildMongoBenchpathListContext(collectionName, {
            ...options,
            query
          }, {
            defaultSearchFields,
            dateFields,
            orgField,
            allowSystemFallback
          });
          return collection.countDocuments(filter);
        }
      }, `benchpath.${entityName || 'entity'}.count`);
    },

    async exists(options = {}) {
      const query = {
        ...stripPaginationFromQuery(normalizeQueryOptions(options?.query || {})),
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
          if (typeof getById !== 'function') return null;
          const item = await getById(id);
          if (!item) return null;
          return typeof transformItem === 'function' ? await transformItem(item) : item;
        },
        mongo: async () => {
          const item = normalizeMongoDocument(await getMongoCollection(collectionName).findOne(resolveMongoIdFilter(id)));
          if (!item) return null;
          return typeof transformItem === 'function' ? await transformItem(item) : item;
        }
      }, `benchpath.${entityName || 'entity'}.getById`);
    },

    async create(data, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          return create(data, options);
        },
        mongo: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const payload = { ...(data || {}) };
          payload.id = await generateUniqueStringId(collection, payload.id);
          await collection.insertOne(payload);
          return normalizeMongoDocument(payload);
        }
      }, `benchpath.${entityName || 'entity'}.create`);
    },

    async update(id, data, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          return update(id, data, options);
        },
        mongo: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const existing = await collection.findOne(resolveMongoIdFilter(id));
          if (!existing) throw new Error('Record not found');
          const merged = deepMerge(existing, data || {});
          merged.id = toPublicId(existing?.id || existing?._id);
          const { _id, ...toSet } = merged;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        }
      }, `benchpath.${entityName || 'entity'}.update`);
    },

    async remove(id, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof remove !== 'function') throw new Error('Delete operation is not supported.');
          return remove(id, options);
        },
        mongo: async () => {
          if (typeof remove !== 'function') throw new Error('Delete operation is not supported.');
          await getMongoCollection(collectionName).deleteOne(resolveMongoIdFilter(id));
        }
      }, `benchpath.${entityName || 'entity'}.remove`);
    }
  };
}

const benchpathRepositories = {
  sources: createBenchPathRepository({
    entityName: 'sources',
    collectionName: 'benchpathSources',
    getAll: sourceModel.getAllSources,
    getById: sourceModel.getSourceById,
    create: sourceModel.addSource,
    update: sourceModel.updateSource,
    remove: sourceModel.deleteSource,
    defaultSearchFields: ['id', 'slug', 'code', 'title', 'sourceType', 'authorityLevel', 'status', 'reviewStatus']
  }),
  sourceFragments: createBenchPathRepository({
    entityName: 'sourceFragments',
    collectionName: 'benchpathSourceFragments',
    getAll: sourceFragmentModel.getAllFragments,
    getById: sourceFragmentModel.getFragmentById,
    create: sourceFragmentModel.addFragment,
    update: sourceFragmentModel.updateFragment,
    remove: sourceFragmentModel.deleteFragment,
    defaultSearchFields: ['id', 'slug', 'code', 'sourceId', 'title', 'fragmentType', 'semanticRole', 'status', 'reviewStatus']
  }),
  clbFrameworks: createBenchPathRepository({
    entityName: 'clbFrameworks',
    collectionName: 'benchpathClbFrameworks',
    getAll: clbFrameworkModel.getAllFrameworks,
    getById: clbFrameworkModel.getFrameworkById,
    create: clbFrameworkModel.addFramework,
    update: clbFrameworkModel.updateFramework,
    remove: clbFrameworkModel.deleteFramework,
    defaultSearchFields: ['id', 'slug', 'code', 'title', 'frameworkType', 'language', 'status', 'reviewStatus']
  }),
  clbStages: createBenchPathRepository({
    entityName: 'clbStages',
    collectionName: 'benchpathClbStages',
    getAll: clbStageModel.getAllStages,
    getById: clbStageModel.getStageById,
    create: clbStageModel.addStage,
    update: clbStageModel.updateStage,
    remove: clbStageModel.deleteStage,
    defaultSearchFields: ['id', 'slug', 'code', 'label', 'frameworkId', 'status', 'reviewStatus']
  }),
  clbSkills: createBenchPathRepository({
    entityName: 'clbSkills',
    collectionName: 'benchpathClbSkills',
    getAll: clbSkillModel.getAllSkills,
    getById: clbSkillModel.getSkillById,
    create: clbSkillModel.addSkill,
    update: clbSkillModel.updateSkill,
    remove: clbSkillModel.deleteSkill,
    defaultSearchFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'modality', 'status', 'reviewStatus']
  }),
  clbCompetencyAreas: createBenchPathRepository({
    entityName: 'clbCompetencyAreas',
    collectionName: 'benchpathClbCompetencyAreas',
    getAll: () => referenceCatalogModel.getAll('competencyAreas'),
    getById: (id) => referenceCatalogModel.getById('competencyAreas', id),
    create: (payload, actor) => referenceCatalogModel.add('competencyAreas', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('competencyAreas', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('competencyAreas', id)
  }),
  clbBenchmarks: createBenchPathRepository({
    entityName: 'clbBenchmarks',
    collectionName: 'benchpathClbBenchmarks',
    getAll: () => referenceCatalogModel.getAll('benchmarks'),
    getById: (id) => referenceCatalogModel.getById('benchmarks', id),
    create: (payload, actor) => referenceCatalogModel.add('benchmarks', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('benchmarks', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('benchmarks', id)
  }),
  clbCompetencies: createBenchPathRepository({
    entityName: 'clbCompetencies',
    collectionName: 'benchpathClbCompetencies',
    getAll: () => referenceCatalogModel.getAll('competencies'),
    getById: (id) => referenceCatalogModel.getById('competencies', id),
    create: (payload, actor) => referenceCatalogModel.add('competencies', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('competencies', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('competencies', id)
  }),
  clbIndicators: createBenchPathRepository({
    entityName: 'clbIndicators',
    collectionName: 'benchpathClbIndicators',
    getAll: () => referenceCatalogModel.getAll('indicators'),
    getById: (id) => referenceCatalogModel.getById('indicators', id),
    create: (payload, actor) => referenceCatalogModel.add('indicators', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('indicators', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('indicators', id)
  }),
  clbProfileOfAbility: createBenchPathRepository({
    entityName: 'clbProfileOfAbility',
    collectionName: 'benchpathClbProfileOfAbility',
    getAll: () => referenceCatalogModel.getAll('profileOfAbility'),
    getById: (id) => referenceCatalogModel.getById('profileOfAbility', id),
    create: (payload, actor) => referenceCatalogModel.add('profileOfAbility', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('profileOfAbility', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('profileOfAbility', id)
  }),
  clbFeaturesOfCommunication: createBenchPathRepository({
    entityName: 'clbFeaturesOfCommunication',
    collectionName: 'benchpathClbFeaturesOfCommunication',
    getAll: () => referenceCatalogModel.getAll('featuresOfCommunication'),
    getById: (id) => referenceCatalogModel.getById('featuresOfCommunication', id),
    create: (payload, actor) => referenceCatalogModel.add('featuresOfCommunication', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('featuresOfCommunication', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('featuresOfCommunication', id)
  }),
  clbSampleTaskLabels: createBenchPathRepository({
    entityName: 'clbSampleTaskLabels',
    collectionName: 'benchpathClbSampleTaskLabels',
    getAll: () => referenceCatalogModel.getAll('sampleTaskLabels'),
    getById: (id) => referenceCatalogModel.getById('sampleTaskLabels', id),
    create: (payload, actor) => referenceCatalogModel.add('sampleTaskLabels', payload, actor),
    update: (id, payload, actor) => referenceCatalogModel.update('sampleTaskLabels', id, payload, actor),
    remove: (id) => referenceCatalogModel.remove('sampleTaskLabels', id)
  }),
  benchpathTasks: createBenchPathRepository({
    entityName: 'tasks',
    collectionName: 'benchpathTasks',
    getAll: taskModel.getAllTasks,
    getById: taskModel.getTaskById,
    create: taskModel.addTask,
    update: taskModel.updateTask,
    remove: taskModel.deleteTask,
    defaultSearchFields: ['id', 'slug', 'title', 'skill', 'selectedBenchmarkId', 'taskType', 'status', 'createdBy'],
    allowSystemFallback: false
  })
};

Object.entries(benchpathRepositories).forEach(([key, repository]) => {
  assertQueryableCrudRepository(`benchpathRepositories.${key}`, repository);
});

module.exports = benchpathRepositories;
