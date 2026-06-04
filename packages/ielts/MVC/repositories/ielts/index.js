const task2SampleModel = require('../../models/ielts/task2SampleModel');
const microAssessmentModel = require('../../models/ielts/microAssessmentModel');
const promptModel = require('../../models/ielts/promptModel');
const scoringSessionModel = require('../../models/ielts/scoringSessionModel');
const apiProviderModel = require('../../models/ielts/apiProviderModel');
const aiTokenUsageModel = require('../../models/ielts/aiTokenUsageModel');
const { requireCoreModule } = require('../../services/ielts/ieltsCoreModuleResolver');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { getEntityQueryExecutor } = requireCoreModule('MVC/models/queryExecutionBridge');
const { assertQueryableCrudRepository } = requireCoreModule('MVC/repositories/contracts/crudRepositoryContract');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
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
const { encrypt } = requireCoreModule('MVC/utils/encyptors');

const DEFAULT_DATE_FIELDS = ['createdAt', 'updatedAt', 'date', 'timestamp'];

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function getRecordOrgId(item) {
  return toPublicId(item?.orgId) || 'SYSTEM';
}

function applyOrgScope(rows, scope = {}) {
  const list = normalizeRows(rows);
  if (scope?.canViewAll === true) return list;
  if (scope?.denyAll === true) return [];
  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return [];
  return list.filter((item) => idsEqual(getRecordOrgId(item), activeOrgId));
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildIeltsScopeFilter(scope = {}, options = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };

  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return { id: '__NO_MATCH__' };

  if (activeOrgId === 'SYSTEM') {
    return {
      $or: [
        { orgId: 'SYSTEM' },
        { orgId: null },
        { orgId: '' },
        { orgId: { $exists: false } }
      ]
    };
  }

  if (options?.allowSystemFallback === true) {
    return { $or: [{ orgId: activeOrgId }, { orgId: 'SYSTEM' }] };
  }
  return { orgId: activeOrgId };
}

async function listMongoIeltsRecords(collectionName, options = {}, queryOptions = {}) {
  const collection = getMongoCollection(collectionName);
  const query = options?.query || {};
  const scopeFilter = buildIeltsScopeFilter(options?.scope || {}, {
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

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

function matchesLegacySearch(item, queryText) {
  const q = String(queryText || '').toLowerCase().trim();
  if (!q) return true;

  const matchRef = item?.refName && String(item.refName).toLowerCase().includes(q);
  const matchText = item?.text && String(item.text).toLowerCase().includes(q);
  const matchTitle = item?.title && String(item.title).toLowerCase().includes(q);
  const matchDesc = item?.description && String(item.description).toLowerCase().includes(q);
  const matchPromptName = item?.name && String(item.name).toLowerCase().includes(q);

  let matchQuestion = false;
  if (Array.isArray(item?.questions)) {
    matchQuestion = item.questions.some((question) =>
      (question?.atomic_question && String(question.atomic_question).toLowerCase().includes(q)) ||
      (question?.question_key && String(question.question_key).toLowerCase().includes(q))
    );
  }

  return Boolean(matchRef || matchText || matchTitle || matchDesc || matchQuestion || matchPromptName);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeApiProviderRecord(record = {}, existing = null, strict = false) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const id = toPublicId(record?.id || base?.id);
  const userId = toPublicId(record?.userId || base?.userId);
  const providerId = String(record?.providerId ?? base?.providerId ?? '').trim().toLowerCase();
  const name = String(record?.name ?? base?.name ?? '').trim() || `${providerId || 'provider'} key`;
  const modelId = String(record?.modelId ?? base?.modelId ?? '').trim();
  const project = String(record?.project ?? base?.project ?? '').trim();
  const location = String(record?.location ?? base?.location ?? '').trim();
  const orgId = toPublicId(record?.orgId || base?.orgId) || 'SYSTEM';
  const notes = String(record?.notes ?? base?.notes ?? '').trim();
  const isDefault = normalizeBoolean(record?.isDefault, normalizeBoolean(base?.isDefault, false));
  const isActive = normalizeBoolean(record?.isActive, normalizeBoolean(base?.isActive, true));
  const createdBy = String(record?.createdBy ?? base?.createdBy ?? userId ?? 'system').trim();
  const updatedBy = String(record?.updatedBy ?? base?.updatedBy ?? userId ?? 'system').trim();

  const incomingApiKey = String(record?.apiKey ?? '').trim();
  let apiKeyEncrypted = String(record?.apiKeyEncrypted ?? base?.apiKeyEncrypted ?? '').trim();
  let apiKeyHint = String(record?.apiKeyHint ?? base?.apiKeyHint ?? '').trim();
  if (incomingApiKey) {
    apiKeyEncrypted = encrypt(incomingApiKey);
    apiKeyHint = incomingApiKey.length <= 4 ? `***${incomingApiKey}` : `***${incomingApiKey.slice(-4)}`;
  }

  if (strict) {
    if (!id) throw new Error('Provider ID is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!providerId) throw new Error('Provider is required.');
    if (!apiKeyEncrypted) throw new Error('API key is required.');
  }

  return {
    ...base,
    id,
    userId,
    orgId,
    name,
    providerId,
    modelId,
    project,
    location,
    notes,
    isDefault,
    isActive,
    apiKeyEncrypted,
    apiKeyHint,
    createdBy,
    updatedBy,
    createdAt: base?.createdAt || now,
    updatedAt: now
  };
}

function sanitizeApiProviderRecord(record = {}) {
  if (!record || typeof record !== 'object') return record;
  const clean = { ...record };
  delete clean.apiKeyEncrypted;
  clean.apiKeyMasked = String(clean.apiKeyHint || '').trim() || 'Not set';
  clean.hasApiKey = Boolean(clean.apiKeyHint);
  return clean;
}

async function assertUniqueMicroAssessmentBaseKey(collection, { orgId, baseKey, excludeId = null } = {}) {
  const normalizedBaseKey = String(baseKey || '').trim();
  const normalizedOrgId = toPublicId(orgId) || 'SYSTEM';
  if (!normalizedBaseKey) {
    throw new Error('Base Key is required.');
  }
  const filter = { orgId: normalizedOrgId, baseKey: normalizedBaseKey };
  if (excludeId) filter.id = { $ne: toPublicId(excludeId) || String(excludeId || '').trim() };
  const duplicate = await collection.findOne(filter);
  if (duplicate) {
    throw new Error(`Duplicate Base Key: ${normalizedBaseKey} already exists.`);
  }
}

function normalizeAiTokenUsageRecord(record = {}, existing = null, strict = false) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const id = toPublicId(record?.id || base?.id);
  const orgId = toPublicId(record?.orgId || base?.orgId) || 'SYSTEM';
  const userId = toPublicId(record?.userId || base?.userId);
  const providerId = String(record?.providerId ?? base?.providerId ?? '').trim().toLowerCase();

  const usageRaw = (record?.usage && typeof record.usage === 'object')
    ? record.usage
    : ((base?.usage && typeof base.usage === 'object') ? base.usage : {});
  const normalizeUsageNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const usage = {
    promptTokenCount: normalizeUsageNumber(usageRaw.promptTokenCount),
    candidatesTokenCount: normalizeUsageNumber(usageRaw.candidatesTokenCount),
    totalTokenCount: normalizeUsageNumber(usageRaw.totalTokenCount),
    cachedContentTokenCount: normalizeUsageNumber(usageRaw.cachedContentTokenCount)
  };

  const normalizeStatus = (value) => {
    const token = String(value ?? '').trim().toLowerCase();
    return token === 'failed' ? 'failed' : 'success';
  };
  const normalizeBillingStatus = (value) => {
    const token = String(value ?? '').trim().toLowerCase();
    if (token === 'billed' || token === 'waived') return token;
    return 'unbilled';
  };

  const toIsoOrNull = (value, fallback = null) => {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
  };

  const consumedAt = toIsoOrNull(record?.consumedAt ?? base?.consumedAt, now) || now;
  const createdAt = toIsoOrNull(base?.createdAt, consumedAt) || consumedAt;
  const updatedAt = toIsoOrNull(record?.updatedAt, now) || now;
  const billingStatus = normalizeBillingStatus(record?.billingStatus ?? base?.billingStatus);
  const billedAt = billingStatus === 'billed'
    ? (toIsoOrNull(record?.billedAt, null) || toIsoOrNull(base?.billedAt, null) || now)
    : null;

  if (strict) {
    if (!id) throw new Error('Token usage ID is required.');
    if (!userId) throw new Error('Token usage userId is required.');
    if (!providerId) throw new Error('Token usage providerId is required.');
  }

  return {
    ...base,
    id,
    orgId,
    userId,
    providerId,
    providerRecordId: toPublicId(record?.providerRecordId || base?.providerRecordId) || null,
    providerRecordName: String(record?.providerRecordName ?? base?.providerRecordName ?? '').trim() || null,
    modelUsed: String(record?.modelUsed ?? base?.modelUsed ?? '').trim() || null,
    requestLabel: String(record?.requestLabel ?? base?.requestLabel ?? '').trim() || null,
    messageCount: normalizeUsageNumber(record?.messageCount ?? base?.messageCount),
    hasSystemInstruction: normalizeBoolean(record?.hasSystemInstruction, normalizeBoolean(base?.hasSystemInstruction, false)),
    status: normalizeStatus(record?.status ?? base?.status),
    errorMessage: String(record?.errorMessage ?? base?.errorMessage ?? '').trim() || null,
    usage,
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount,
    requestMeta: record?.requestMeta && typeof record.requestMeta === 'object'
      ? record.requestMeta
      : (base?.requestMeta && typeof base.requestMeta === 'object' ? base.requestMeta : {}),
    billingStatus,
    billingReference: String(record?.billingReference ?? base?.billingReference ?? '').trim() || null,
    billingNotes: String(record?.billingNotes ?? base?.billingNotes ?? '').trim(),
    billedAt,
    consumedAt,
    createdAt,
    updatedAt
  };
}

async function enforceSingleDefaultApiProvider(collection, userId, keepId, orgId = null) {
  const scopedUserId = toPublicId(userId);
  const scopedKeepId = toPublicId(keepId);
  const scopedOrgId = toPublicId(orgId);
  if (!scopedUserId || !scopedKeepId) return;
  const filter = {
    userId: scopedUserId,
    id: { $ne: scopedKeepId }
  };
  if (scopedOrgId) filter.orgId = scopedOrgId;
  await collection.updateMany(
    filter,
    { $set: { isDefault: false } }
  );
}

function createIeltsRepository(config) {
  const getAll = config.getAll;
  const getById = config.getById;
  const create = config.create;
  const update = config.update;
  const remove = config.remove;
  const entityName = String(config.entityName || '').trim();
  const collectionName = String(config.collectionName || '').trim();
  const defaultSearchFields = config.defaultSearchFields || ['id', 'title', 'description', 'name', 'refName'];
  const dateFields = config.dateFields || DEFAULT_DATE_FIELDS;
  const allowSystemFallback = config.allowSystemFallback === true;
  const sanitizeRecord = typeof config.sanitizeRecord === 'function' ? config.sanitizeRecord : ((row) => row);
  const prepareMongoCreate = typeof config.prepareMongoCreate === 'function' ? config.prepareMongoCreate : null;
  const prepareMongoUpdate = typeof config.prepareMongoUpdate === 'function' ? config.prepareMongoUpdate : null;
  const afterMongoCreate = typeof config.afterMongoCreate === 'function' ? config.afterMongoCreate : null;
  const afterMongoUpdate = typeof config.afterMongoUpdate === 'function' ? config.afterMongoUpdate : null;

  async function runLocalList(plan = {}) {
    const query = plan?.query || {};
    const allRows = normalizeRows(await getAll());
    const rows = applyOrgScope(allRows, plan?.scope || {});

    // Preserve historical free-text behavior for simple q searches.
    const hasOnlyLegacyQ = Boolean(query?.q) &&
      !query?.searchFields &&
      !query?.type &&
      Object.keys(query).every((key) => ['q', 'page', 'limit', 'sort', 'order'].includes(key));

    if (hasOnlyLegacyQ) {
      return rows.filter((item) => matchesLegacySearch(item, query.q));
    }

    return applyGenericFilter(rows, query, { defaultSearchFields, dateFields });
  }

  return {
    async list(options = {}) {
      const rows = await runByRepositoryBackend(options, {
        json: async () => {
          const plan = {
            entity: entityName ? `ielts.${entityName}` : 'ielts',
            query: options?.query || {},
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
            const executor = getEntityQueryExecutor(`ielts.${entityName}`);
            if (typeof executor === 'function') {
              const result = await executor(plan);
              if (Array.isArray(result)) return result;
              if (result && Array.isArray(result.items)) return result.items;
            }
          }

          return runLocalList(plan);
        },
        mongo: async () => listMongoIeltsRecords(collectionName, options, {
          defaultSearchFields,
          dateFields,
          allowSystemFallback
        })
      }, `ielts.${entityName || 'entity'}.list`);
      return normalizeRows(rows).map((row) => sanitizeRecord(row));
    },

    async count(options = {}) {
      const query = stripPaginationFromQuery(options?.query || {});
      const total = await runByRepositoryBackend(options, {
        json: async () => {
          const plan = {
            entity: entityName ? `ielts.${entityName}` : 'ielts',
            query,
            scope: options?.scope || {},
            projection: null,
            pagination: null,
            sort: null
          };

          if (!options?.skipExecutor && entityName) {
            const executor = getEntityQueryExecutor(`ielts.${entityName}`);
            if (typeof executor === 'function') {
              const result = await executor(plan);
              if (result && typeof result === 'object' && !Array.isArray(result)) {
                if (Number.isFinite(Number(result.totalItems))) return Number(result.totalItems);
                if (Array.isArray(result.items)) return result.items.length;
              }
              if (Array.isArray(result)) return result.length;
            }
          }

          const rows = await runLocalList(plan);
          return Array.isArray(rows) ? rows.length : 0;
        },
        mongo: async () => {
          const collection = getMongoCollection(collectionName);
          const scopeFilter = buildIeltsScopeFilter(options?.scope || {}, {
            allowSystemFallback: allowSystemFallback === true
          });
          const queryFilter = buildMongoFilterFromQuery(query, {
            defaultSearchFields,
            dateFields
          });
          const filter = combineMongoFilters(scopeFilter, queryFilter);
          return await collection.countDocuments(filter);
        }
      }, `ielts.${entityName || 'entity'}.count`);
      return Number.isFinite(Number(total)) ? Number(total) : 0;
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
      const row = await runByRepositoryBackend(options, {
        json: async () => (typeof getById === 'function' ? getById(id, options) : null),
        mongo: async () => normalizeMongoDocument(await getMongoCollection(collectionName).findOne(resolveMongoIdFilter(id)))
      }, `ielts.${entityName || 'entity'}.getById`);
      return row ? sanitizeRecord(row) : row;
    },

    async create(data, options = {}) {
      const row = await runByRepositoryBackend(options, {
        json: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          return create(data, options);
        },
        mongo: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const payload = { ...(data || {}) };
          payload.id = await generateUniqueStringId(collection, payload.id);
          const prepared = prepareMongoCreate
            ? await prepareMongoCreate(payload, { collection, options })
            : payload;
          const toInsert = prepared && typeof prepared === 'object' ? prepared : payload;
          await collection.insertOne(toInsert);
          if (afterMongoCreate) {
            await afterMongoCreate(toInsert, { collection, options });
          }
          const fresh = await collection.findOne(resolveMongoIdFilter(toInsert.id));
          return normalizeMongoDocument(fresh || toInsert);
        }
      }, `ielts.${entityName || 'entity'}.create`);
      return sanitizeRecord(row);
    },

    async update(id, data, options = {}) {
      const row = await runByRepositoryBackend(options, {
        json: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          return update(id, data, options);
        },
        mongo: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const existing = await collection.findOne(resolveMongoIdFilter(id));
          if (!existing) throw new Error('Record not found');
          const merged = prepareMongoUpdate
            ? await prepareMongoUpdate({
              id,
              existing: normalizeMongoDocument(existing),
              incoming: data || {},
              collection,
              options
            })
            : deepMerge(existing, data || {});
          merged.id = toPublicId(existing?.id || existing?._id);
          const { _id, ...toSet } = merged;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          if (afterMongoUpdate) {
            await afterMongoUpdate(toSet, { collection, options });
          }
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        }
      }, `ielts.${entityName || 'entity'}.update`);
      return sanitizeRecord(row);
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
      }, `ielts.${entityName || 'entity'}.remove`);
    }
  };
}

const ieltsRepositories = {
  task2Samples: createIeltsRepository({
    entityName: 'task2Samples',
    collectionName: 'ieltsTask2Samples',
    getAll: task2SampleModel.getAllSamples,
    getById: task2SampleModel.getSampleById,
    create: task2SampleModel.addSample,
    update: task2SampleModel.updateSample,
    remove: task2SampleModel.deleteSample,
    defaultSearchFields: ['id', 'refName', 'text', 'type', 'source']
  }),
  microAssessments: createIeltsRepository({
    entityName: 'microAssessments',
    collectionName: 'ieltsMicroAssessments',
    getAll: microAssessmentModel.getAllAssessments,
    getById: microAssessmentModel.getAssessmentById,
    create: microAssessmentModel.addAssessment,
    update: microAssessmentModel.updateAssessment,
    remove: microAssessmentModel.deleteAssessment,
    defaultSearchFields: ['id', 'baseKey', 'question_key', 'title', 'description', 'criterion', 'band', 'scope', 'is_active'],
    prepareMongoCreate: async (payload, { collection } = {}) => {
      const normalized = microAssessmentModel.normalizeAssessmentRecord(payload, null);
      microAssessmentModel.validateAssessmentRecordOrThrow(normalized);
      await assertUniqueMicroAssessmentBaseKey(collection, {
        orgId: normalized.orgId,
        baseKey: normalized.baseKey
      });
      return normalized;
    },
    prepareMongoUpdate: async ({ id, existing, incoming, collection }) => {
      const normalized = microAssessmentModel.normalizeAssessmentRecord(
        {
          ...(incoming || {}),
          id: toPublicId(id || existing?.id),
          orgId: toPublicId(existing?.orgId) || toPublicId(incoming?.orgId) || 'SYSTEM'
        },
        existing || {}
      );
      microAssessmentModel.validateAssessmentRecordOrThrow(normalized);
      await assertUniqueMicroAssessmentBaseKey(collection, {
        orgId: normalized.orgId,
        baseKey: normalized.baseKey,
        excludeId: normalized.id
      });
      return normalized;
    }
  }),
  prompts: createIeltsRepository({
    entityName: 'prompts',
    collectionName: 'ieltsPrompts',
    getAll: promptModel.getAllPrompts,
    getById: promptModel.getPromptById,
    create: async (data) => promptModel.savePrompt(data),
    update: async (id, data) => promptModel.savePrompt({ ...data, id }),
    remove: async (id, options = {}) => promptModel.deletePrompt(id, options?.orgId),
    defaultSearchFields: ['id', 'name', 'description', 'category', 'content']
  }),
  apiProviders: createIeltsRepository({
    entityName: 'apiProviders',
    collectionName: 'ieltsApiProviders',
    getAll: apiProviderModel.getAllApiProviders,
    getById: apiProviderModel.getApiProviderById,
    create: async (data) => apiProviderModel.saveApiProvider(data),
    update: async (id, data) => apiProviderModel.saveApiProvider({ ...data, id }),
    remove: async (id, options = {}) => apiProviderModel.deleteApiProvider(id, options?.userId),
    defaultSearchFields: ['id', 'name', 'providerId', 'modelId', 'project', 'location', 'notes', 'userId'],
    sanitizeRecord: sanitizeApiProviderRecord,
    prepareMongoCreate: async (payload) => normalizeApiProviderRecord(payload, null, true),
    afterMongoCreate: async (payload, context = {}) => {
      if (payload?.isDefault) {
        await enforceSingleDefaultApiProvider(context.collection, payload.userId, payload.id, payload.orgId);
      }
    },
    prepareMongoUpdate: async ({ id, existing, incoming }) => {
      const merged = normalizeApiProviderRecord(
        { ...(incoming || {}), id: toPublicId(id || existing?.id) },
        existing || {},
        true
      );
      return merged;
    },
    afterMongoUpdate: async (payload, context = {}) => {
      if (payload?.isDefault) {
        await enforceSingleDefaultApiProvider(context.collection, payload.userId, payload.id, payload.orgId);
      }
    }
  }),
  aiTokenUsages: createIeltsRepository({
    entityName: 'aiTokenUsages',
    collectionName: 'ieltsAiTokenUsages',
    getAll: aiTokenUsageModel.getAllAiTokenUsages,
    getById: aiTokenUsageModel.getAiTokenUsageById,
    create: aiTokenUsageModel.addAiTokenUsage,
    update: aiTokenUsageModel.updateAiTokenUsage,
    remove: aiTokenUsageModel.deleteAiTokenUsage,
    defaultSearchFields: ['id', 'userId', 'providerId', 'providerRecordName', 'modelUsed', 'requestLabel', 'status', 'billingStatus'],
    prepareMongoCreate: async (payload) => normalizeAiTokenUsageRecord(payload, null, true),
    prepareMongoUpdate: async ({ id, existing, incoming }) => normalizeAiTokenUsageRecord(
      { ...(incoming || {}), id: toPublicId(id || existing?.id) },
      existing || {},
      true
    )
  }),
  scoringHistory: createIeltsRepository({
    entityName: 'scoringHistory',
    collectionName: 'ieltsScoringHistory',
    getAll: scoringSessionModel.getAllSessions,
    getById: scoringSessionModel.getSessionById,
    create: scoringSessionModel.saveSession,
    update: async (id, data) => scoringSessionModel.saveSession({
      ...(data || {}),
      id: toPublicId(id),
      sessionId: toPublicId(id)
    }),
    remove: scoringSessionModel.deleteSession,
    defaultSearchFields: ['id', 'userId', 'sampleId', 'status', 'title']
  }),

  // Specialized delegates
  getMicroAssessmentFields: async () => microAssessmentModel.SYSTEM_FIELDS
};

assertQueryableCrudRepository('ieltsRepositories.task2Samples', ieltsRepositories.task2Samples);
assertQueryableCrudRepository('ieltsRepositories.microAssessments', ieltsRepositories.microAssessments);
assertQueryableCrudRepository('ieltsRepositories.prompts', ieltsRepositories.prompts);
assertQueryableCrudRepository('ieltsRepositories.apiProviders', ieltsRepositories.apiProviders);
assertQueryableCrudRepository('ieltsRepositories.aiTokenUsages', ieltsRepositories.aiTokenUsages);
assertQueryableCrudRepository('ieltsRepositories.scoringHistory', ieltsRepositories.scoringHistory);

module.exports = ieltsRepositories;
