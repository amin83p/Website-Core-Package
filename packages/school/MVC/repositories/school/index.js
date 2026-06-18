const studentModel = require('../../models/school/studentModel');
const programModel = require('../../models/school/programModel');
const transactionDefinitionModel = require('../../models/school/transactionDefinitionModel');
const globalTransactionLedgerModel = require('../../models/school/globalTransactionLedgerModel');
const subjectModel = require('../../models/school/subjectModel');
const classModel = require('../../models/school/classModel');
const holidayModel = require('../../models/school/holidayModel');
const departmentModel = require('../../models/school/departmentModel');
const payRateModel = require('../../models/school/payRateModel');
const sessionStatusModel = require('../../models/school/sessionStatusModel');
const timesheetPeriodModel = require('../../models/school/timesheetPeriodModel');
const timesheetModel = require('../../models/school/timesheetModel');
const schoolAccountModel = require('../../models/school/schoolAccountModel');
const teacherModel = require('../../models/school/teacherModel');
const staffModel = require('../../models/school/staffModel');
const termModel = require('../../models/school/termModel');
const transactionJournalModel = require('../../models/school/transactionJournalModel');
const academicLedgerModel = require('../../models/school/academicLedgerModel');
const academicSnapshotModel = require('../../models/school/academicSnapshotModel');
const reportTemplateModel = require('../../models/school/reportTemplateModel');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportInstanceModel = require('../../models/school/reportInstanceModel');
const examTemplateModel = require('../../models/school/examTemplateModel');
const examRevisionModel = require('../../models/school/examRevisionModel');
const examQuestionModel = require('../../models/school/examQuestionModel');
const examAllocationModel = require('../../models/school/examAllocationModel');
const examAssignmentModel = require('../../models/school/examAssignmentModel');
const examAttemptModel = require('../../models/school/examAttemptModel');
const examAnswerModel = require('../../models/school/examAnswerModel');
const studentProgramRegistrationModel = require('../../models/school/studentProgramRegistrationModel');
const studentProgramPriorSubjectModel = require('../../models/school/studentProgramPriorSubjectModel');
const studentTermRegistrationModel = require('../../models/school/studentTermRegistrationModel');
const classEnrollmentPeriodModel = require('../../models/school/classEnrollmentPeriodModel');
const leaveRequestModel = require('../../models/school/leaveRequestModel');
const notificationModel = require('../../models/school/notificationModel');
const notificationRoutingRuleModel = require('../../models/school/notificationRoutingRuleModel');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
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

const DEFAULT_DATE_FIELDS = ['audit.createDateTime', 'audit.lastUpdateDateTime', 'createdAt', 'date'];

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function readRecordOrgId(record, orgField) {
  return toPublicId(record?.[orgField]);
}

function readOwnerUserIds(record = {}) {
  return [
    record?.ownerUserId,
    record?.createdBy,
    record?.createdByUserId,
    record?.creator?.userId,
    record?.audit?.createUser
  ].map((value) => toPublicId(value)).filter(Boolean);
}

function isRecordOwnedByScopeUser(record = {}, scope = {}) {
  if (scope?.ownerScoped !== true && !scope?.userId) return true;
  const scopedUserId = toPublicId(scope?.userId);
  if (!scopedUserId) return false;
  return readOwnerUserIds(record).some((ownerId) => idsEqual(ownerId, scopedUserId));
}

function buildOwnerScopeFilter(scope = {}) {
  if (scope?.ownerScoped !== true && !scope?.userId) return null;
  const scopedUserId = toPublicId(scope?.userId);
  if (!scopedUserId) return { id: '__NO_MATCH__' };
  return {
    $or: [
      { ownerUserId: scopedUserId },
      { createdBy: scopedUserId },
      { createdByUserId: scopedUserId },
      { 'creator.userId': scopedUserId },
      { 'audit.createUser': scopedUserId }
    ]
  };
}

function getRequestingUserIdFromOptions(options = {}) {
  return toPublicId(options?.requestingUser?.id || options?.requestingUser?.userId || options?.requestingUser?._id);
}

function stampCreateOwnershipPayload(raw, options = {}) {
  if (Array.isArray(raw)) return raw.map((row) => stampCreateOwnershipPayload(row, options));
  if (!raw || typeof raw !== 'object') return raw;
  const userId = getRequestingUserIdFromOptions(options);
  if (!userId) return raw;
  const nowIso = new Date().toISOString();
  const payload = { ...raw };
  const audit = (payload.audit && typeof payload.audit === 'object' && !Array.isArray(payload.audit))
    ? { ...payload.audit }
    : {};
  if (!toPublicId(audit.createUser)) audit.createUser = userId;
  if (!audit.createDateTime) audit.createDateTime = nowIso;
  if (!toPublicId(audit.lastUpdateUser)) audit.lastUpdateUser = userId;
  if (!audit.lastUpdateDateTime) audit.lastUpdateDateTime = nowIso;
  payload.audit = audit;
  if (!toPublicId(payload.ownerUserId)) payload.ownerUserId = userId;
  const creator = (payload.creator && typeof payload.creator === 'object' && !Array.isArray(payload.creator))
    ? { ...payload.creator }
    : {};
  if (!toPublicId(creator.userId)) creator.userId = userId;
  payload.creator = creator;
  return payload;
}

function stampUpdateAuditPayload(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const userId = getRequestingUserIdFromOptions(options);
  if (!userId) return raw;
  const audit = (raw.audit && typeof raw.audit === 'object' && !Array.isArray(raw.audit))
    ? { ...raw.audit }
    : {};
  return {
    ...raw,
    audit: {
      ...audit,
      lastUpdateUser: userId,
      lastUpdateDateTime: new Date().toISOString()
    }
  };
}

function preserveExistingOwnershipFields(merged = {}, existing = {}) {
  const output = { ...merged };
  if (toPublicId(existing?.ownerUserId)) output.ownerUserId = existing.ownerUserId;
  if (toPublicId(existing?.createdBy)) output.createdBy = existing.createdBy;
  if (toPublicId(existing?.createdByUserId)) output.createdByUserId = existing.createdByUserId;
  if (existing?.creator && typeof existing.creator === 'object' && toPublicId(existing.creator.userId)) {
    output.creator = { ...(output.creator || {}), userId: existing.creator.userId };
  }
  if (existing?.audit && typeof existing.audit === 'object') {
    output.audit = { ...(output.audit || {}) };
    if (toPublicId(existing.audit.createUser)) output.audit.createUser = existing.audit.createUser;
    if (existing.audit.createDateTime) output.audit.createDateTime = existing.audit.createDateTime;
  }
  return output;
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

  const orgScopedRows = list.filter((record) => {
    const recordOrgId = toPublicId(resolveOrgId(record));
    if (allowSystemFallback && recordOrgId === 'SYSTEM') return true;
    return idsEqual(recordOrgId, activeOrgId);
  });

  return orgScopedRows.filter((record) => isRecordOwnedByScopeUser(record, scope));
}

function buildSchoolScopeFilter(scope = {}, options = {}) {
  if (scope?.canViewAll === true) return {};
  if (scope?.denyAll === true) return { id: '__NO_MATCH__' };

  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return { id: '__NO_MATCH__' };

  const orgField = String(options?.orgField || 'orgId').trim() || 'orgId';
  const clauses = [];
  if (options?.allowSystemFallback === true) {
    clauses.push({ $or: [{ [orgField]: activeOrgId }, { [orgField]: 'SYSTEM' }] });
  } else {
    clauses.push({ [orgField]: activeOrgId });
  }
  const ownerFilter = buildOwnerScopeFilter(scope);
  if (ownerFilter) clauses.push(ownerFilter);
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function normalizeClassRegistrationModeValue(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function normalizeClassDataContract(record) {
  if (!record || typeof record !== 'object') return record;
  const normalized = { ...record };
  normalized.registrationMode = normalizeClassRegistrationModeValue(record.registrationMode);
  normalized.cycleGroupId = String(record.cycleGroupId || '').trim();
  normalized.cycleStartDate = String(record.cycleStartDate || '').trim();
  normalized.cycleEndDate = String(record.cycleEndDate || '').trim();
  normalized.isClosedForNewEnrollment = record.isClosedForNewEnrollment === true || String(record.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true';
  normalized.previousClassId = String(record.previousClassId || '').trim();
  normalized.nextClassId = String(record.nextClassId || '').trim();
  const parsedCycleNo = Number.parseInt(String(record.cycleNo || '').trim(), 10);
  normalized.cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;
  return normalized;
}

async function purgeMongoDocumentByResolvedId(collectionName, targetId, label, beforeDelete = null) {
  const collection = getMongoCollection(collectionName);
  const existingRaw = await collection.findOne(resolveMongoIdFilter(targetId));
  if (!existingRaw) return false;
  if (typeof beforeDelete === 'function') {
    await beforeDelete(collection, existingRaw);
  }
  if (existingRaw._id === undefined || existingRaw._id === null) {
    throw new Error(`${label} is missing Mongo _id.`);
  }
  const deleteResult = await collection.deleteOne({ _id: existingRaw._id });
  if (!deleteResult || Number(deleteResult.deletedCount || 0) < 1) {
    throw new Error(`${label} could not be deleted.`);
  }
  return normalizeMongoDocument(existingRaw);
}

function normalizeDateOnlyToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function buildDateRangeOverlapFilter(startDate, endDate, options = {}) {
  const startField = String(options?.startField || 'startDate').trim() || 'startDate';
  const endField = String(options?.endField || 'endDate').trim() || 'endDate';
  const from = normalizeDateOnlyToken(startDate);
  const to = normalizeDateOnlyToken(endDate);
  if (!from || !to) return null;

  return {
    [startField]: { $lte: to },
    $or: [
      { [endField]: { $exists: false } },
      { [endField]: '' },
      { [endField]: null },
      { [endField]: { $gte: from } }
    ]
  };
}

function createSchoolRepository(config) {
  const getAll = config.getAll;
  const getById = config.getById;
  const create = config.create;
  const update = config.update;
  const remove = config.remove;
  const entityName = String(config.entityName || '').trim();
  const collectionName = String(config.collectionName || '').trim();
  const defaultSearchFields = config.defaultSearchFields || ['id', 'name', 'code', 'description'];
  const dateFields = config.dateFields || DEFAULT_DATE_FIELDS;
  const orgField = config.orgField || 'orgId';
  const allowSystemFallback = config.allowSystemFallback === true;
  const transformList = config.transformList;
  const resolveOrgId = config.resolveOrgId;
  const transformItem = config.transformItem;
  const mongoScopeInMemory = config.mongoScopeInMemory === true;
  const mongoRemoveUnsupported = config.mongoRemoveUnsupported === true;
  const mongoRemoveMessage = String(config.mongoRemoveMessage || 'Delete operation is not supported.');

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

  async function runMongoList(options = {}) {
    const collection = getMongoCollection(collectionName);
    const query = options?.query || {};
    const scopeFilter = mongoScopeInMemory
      ? {}
      : buildSchoolScopeFilter(options?.scope || {}, { orgField, allowSystemFallback });
    const queryFilter = buildMongoFilterFromQuery(query, {
      defaultSearchFields,
      dateFields
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

    const rows = (await cursor.toArray()).map((row) => normalizeMongoDocument(row)).filter(Boolean);
    const transformedRows = typeof transformList === 'function'
      ? await transformList(rows, { ...options, backendMode: 'mongo' })
      : rows;
    const scopedRows = mongoScopeInMemory
      ? applyOrgScope(transformedRows, options?.scope || {}, { orgField, allowSystemFallback, resolveOrgId })
      : transformedRows;
    return scopedRows;
  }

  return {
    async list(options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          const plan = {
            entity: entityName ? `school.${entityName}` : 'school',
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
            const executor = getEntityQueryExecutor(`school.${entityName}`);
            if (typeof executor === 'function') {
              const result = await executor(plan);
              if (Array.isArray(result)) return result;
              if (result && Array.isArray(result.items)) return result.items;
            }
          }

          return runLocalList(plan, options);
        },
        mongo: async () => runMongoList(options)
      }, `school.${entityName || 'entity'}.list`);
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
        json: async () => {
          if (typeof getById !== 'function') return null;
          const item = await getById(id);
          if (!item) return null;
          return typeof transformItem === 'function' ? await transformItem(item) : item;
        },
        mongo: async () => {
          const item = normalizeMongoDocument(await getMongoCollection(collectionName).findOne(resolveMongoIdFilter(id)));
          if (!item) return null;
          return typeof transformItem === 'function' ? await transformItem(item, { ...options, backendMode: 'mongo' }) : item;
        }
      }, `school.${entityName || 'entity'}.getById`);
    },

    async create(data, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          return create(stampCreateOwnershipPayload(data, options), options);
        },
        mongo: async () => {
          if (typeof create !== 'function') throw new Error('Create operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const stampedData = stampCreateOwnershipPayload(data, options);
          if (Array.isArray(data)) {
            const payloads = [];
            for (const raw of stampedData) {
              const payload = { ...(raw || {}) };
              // eslint-disable-next-line no-await-in-loop
              payload.id = await generateUniqueStringId(collection, payload.id);
              payloads.push(payload);
            }
            if (payloads.length) await collection.insertMany(payloads);
            return payloads.map((row) => normalizeMongoDocument(row)).filter(Boolean);
          }
          const payload = { ...(stampedData || {}) };
          payload.id = await generateUniqueStringId(collection, payload.id);
          await collection.insertOne(payload);
          return normalizeMongoDocument(payload);
        }
      }, `school.${entityName || 'entity'}.create`);
    },

    async update(id, data, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          return update(id, stampUpdateAuditPayload(data, options), options);
        },
        mongo: async () => {
          if (typeof update !== 'function') throw new Error('Update operation is not supported.');
          const collection = getMongoCollection(collectionName);
          const existing = await collection.findOne(resolveMongoIdFilter(id));
          if (!existing) throw new Error('Record not found');
          const incoming = stampUpdateAuditPayload(data, options);
          const merged = preserveExistingOwnershipFields(deepMerge(existing, incoming || {}), existing);
          merged.id = toPublicId(existing?.id || existing?._id);
          const { _id, ...toSet } = merged;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        }
      }, `school.${entityName || 'entity'}.update`);
    },

    async remove(id, options = {}) {
      return runByRepositoryBackend(options, {
        json: async () => {
          if (typeof remove !== 'function') throw new Error('Delete operation is not supported.');
          return remove(id, options);
        },
        mongo: async () => {
          if (typeof remove !== 'function') throw new Error('Delete operation is not supported.');
          if (mongoRemoveUnsupported) throw new Error(mongoRemoveMessage);
          await getMongoCollection(collectionName).deleteOne(resolveMongoIdFilter(id));
        }
      }, `school.${entityName || 'entity'}.remove`);
    }
  };
}

async function buildTimesheetOrgLookup(options = {}) {
  return runByRepositoryBackend(options, {
    json: async () => {
      const periods = await timesheetPeriodModel.getAllTimesheetPeriods();
      return new Map(normalizeRows(periods).map((item) => [toPublicId(item.id), toPublicId(item.orgId)]));
    },
    mongo: async () => {
      const rows = await getMongoCollection('schoolTimesheetPeriods')
        .find({}, { projection: { id: 1, orgId: 1 } })
        .toArray();
      return new Map(
        normalizeRows(rows)
          .map((row) => normalizeMongoDocument(row))
          .filter(Boolean)
          .map((item) => [toPublicId(item.id), toPublicId(item.orgId)])
      );
    }
  }, 'school.timesheets.buildOrgLookup');
}

async function enrichTimesheetsWithOrg(rows, options = {}) {
  const periodOrgLookup = await buildTimesheetOrgLookup(options);
  return normalizeRows(rows).map((timesheet) => {
    const directOrgId = toPublicId(timesheet?.orgId);
    if (directOrgId) return timesheet;

    const periodOrgId = periodOrgLookup.get(toPublicId(timesheet?.periodId)) || '';
    if (!periodOrgId) return timesheet;

    return { ...timesheet, orgId: periodOrgId };
  });
}

async function enrichTimesheetItem(item, options = {}) {
  if (!item) return null;
  const directOrgId = toPublicId(item.orgId);
  if (directOrgId) return item;
  const lookup = await buildTimesheetOrgLookup(options);
  const periodOrgId = lookup.get(toPublicId(item.periodId)) || '';
  if (!periodOrgId) return item;
  return { ...item, orgId: periodOrgId };
}

const schoolRepositories = {
  students: createSchoolRepository({
    entityName: 'students',
    collectionName: 'schoolStudents',
    getAll: studentModel.getAllStudents,
    getById: studentModel.getStudentById,
    create: studentModel.addStudent,
    update: studentModel.updateStudent,
    remove: studentModel.deleteStudent,
    defaultSearchFields: ['id', 'personId', 'studentCode', 'status']
  }),
  programs: createSchoolRepository({
    entityName: 'programs',
    collectionName: 'schoolPrograms',
    getAll: programModel.getAllPrograms,
    getById: programModel.getProgramById,
    create: programModel.addProgram,
    update: programModel.updateProgram,
    remove: programModel.deleteProgram,
    defaultSearchFields: ['id', 'name', 'programCode', 'status', 'description']
  }),
  transactionDefinitions: createSchoolRepository({
    entityName: 'transactionDefinitions',
    collectionName: 'schoolTransactionDefinitions',
    getAll: transactionDefinitionModel.getAllTransactionDefinitions,
    getById: transactionDefinitionModel.getTransactionDefinitionById,
    create: transactionDefinitionModel.addTransactionDefinition,
    update: transactionDefinitionModel.updateTransactionDefinition,
    remove: transactionDefinitionModel.deleteTransactionDefinition,
    defaultSearchFields: ['id', 'name', 'code', 'status', 'description'],
    allowSystemFallback: true
  }),
  schoolAccounts: createSchoolRepository({
    entityName: 'schoolAccounts',
    collectionName: 'schoolAccounts',
    getAll: schoolAccountModel.getAllAccounts,
    getById: schoolAccountModel.getAccountById,
    create: schoolAccountModel.addAccount,
    update: schoolAccountModel.updateAccount,
    remove: schoolAccountModel.deleteAccount,
    defaultSearchFields: ['id', 'name', 'partyId', 'status', 'category']
  }),
  globalTransactions: createSchoolRepository({
    entityName: 'globalTransactions',
    collectionName: 'schoolGlobalTransactions',
    getAll: globalTransactionLedgerModel.getAllTransactions,
    getById: globalTransactionLedgerModel.getTransactionById,
    create: async (data) => (Array.isArray(data)
      ? globalTransactionLedgerModel.addTransactionsBatch(data)
      : globalTransactionLedgerModel.addTransaction(data)),
    update: globalTransactionLedgerModel.updateTransaction,
    remove: async () => {
      throw new Error('Global transactions are immutable. Use status/void/reversal operations.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Global transactions are immutable. Use status/void/reversal operations.',
    defaultSearchFields: ['id', 'orgId', 'accountId', 'direction', 'status', 'memo']
  }),
  transactionJournals: createSchoolRepository({
    entityName: 'transactionJournals',
    collectionName: 'schoolTransactionJournals',
    getAll: transactionJournalModel.getAllJournals,
    getById: transactionJournalModel.getJournalById,
    create: transactionJournalModel.addJournal,
    update: transactionJournalModel.updateJournal,
    remove: transactionJournalModel.deleteJournal,
    defaultSearchFields: ['id', 'orgId', 'journalType', 'status', 'description']
  }),
  academicLedger: createSchoolRepository({
    entityName: 'academicLedger',
    collectionName: 'schoolAcademicLedger',
    getAll: academicLedgerModel.getAllEntries,
    getById: academicLedgerModel.getEntryById,
    create: async (data) => (Array.isArray(data)
      ? academicLedgerModel.addEntries(data)
      : academicLedgerModel.addEntry(data)),
    update: async (id, data) => academicLedgerModel.updateEntryStatus(id, data?.status, data?.note),
    remove: async () => {
      throw new Error('Academic ledger is append-only. Use status/void operations.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Academic ledger is append-only. Use status/void operations.',
    defaultSearchFields: ['id', 'orgId', 'studentId', 'programId', 'termId', 'classId', 'status']
  }),
  academicSnapshots: createSchoolRepository({
    entityName: 'academicSnapshots',
    collectionName: 'schoolAcademicSnapshots',
    getAll: academicSnapshotModel.getAllSnapshots,
    getById: async (id) => {
      const rows = await academicSnapshotModel.getAllSnapshots();
      return normalizeRows(rows).find((item) => idsEqual(item?.id, id)) || null;
    },
    create: academicSnapshotModel.upsertSnapshot,
    update: async (id, data) => academicSnapshotModel.upsertSnapshot({ ...data, id }),
    remove: async () => {
      throw new Error('Academic snapshots are derived records and cannot be deleted here.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Academic snapshots are derived records and cannot be deleted here.',
    defaultSearchFields: ['id', 'orgId', 'studentId', 'programId', 'termId', 'classId']
  }),
  reportTemplates: createSchoolRepository({
    entityName: 'reportTemplates',
    collectionName: 'schoolReportTemplates',
    getAll: reportTemplateModel.getAllTemplates,
    getById: reportTemplateModel.getTemplateById,
    create: reportTemplateModel.addTemplate,
    update: reportTemplateModel.updateTemplate,
    remove: reportTemplateModel.deleteTemplate,
    defaultSearchFields: ['id', 'orgId', 'title', 'type', 'status', 'description']
  }),
  reportAssignments: createSchoolRepository({
    entityName: 'reportAssignments',
    collectionName: 'schoolReportAssignments',
    getAll: reportAssignmentModel.getAllAssignments,
    getById: reportAssignmentModel.getAssignmentById,
    create: reportAssignmentModel.addAssignment,
    update: reportAssignmentModel.updateAssignment,
    remove: reportAssignmentModel.deleteAssignment,
    defaultSearchFields: ['id', 'orgId', 'classId', 'templateId', 'status', 'targetType', 'sessionDate', 'dueDate']
  }),
  reportInstances: createSchoolRepository({
    entityName: 'reportInstances',
    collectionName: 'schoolReportInstances',
    getAll: reportInstanceModel.getAllInstances,
    getById: reportInstanceModel.getInstanceById,
    create: reportInstanceModel.addInstance,
    update: reportInstanceModel.updateInstance,
    remove: reportInstanceModel.deleteInstance,
    defaultSearchFields: ['id', 'orgId', 'assignmentId', 'classId', 'templateId', 'teacherId', 'studentId', 'status', 'sessionDate']
  }),
  examTemplates: createSchoolRepository({
    entityName: 'examTemplates',
    collectionName: 'schoolExamTemplates',
    getAll: examTemplateModel.getAllTemplates,
    getById: examTemplateModel.getTemplateById,
    create: examTemplateModel.addTemplate,
    update: examTemplateModel.updateTemplate,
    remove: examTemplateModel.deleteTemplate,
    defaultSearchFields: ['id', 'orgId', 'code', 'title', 'status', 'subjectId', 'ownerTeacherId']
  }),
  examRevisions: createSchoolRepository({
    entityName: 'examRevisions',
    collectionName: 'schoolExamRevisions',
    getAll: examRevisionModel.getAllRevisions,
    getById: examRevisionModel.getRevisionById,
    create: examRevisionModel.addRevision,
    update: examRevisionModel.updateRevision,
    remove: examRevisionModel.deleteRevision,
    defaultSearchFields: ['id', 'orgId', 'templateId', 'title', 'status', 'revisionNo']
  }),
  examQuestions: createSchoolRepository({
    entityName: 'examQuestions',
    collectionName: 'schoolExamQuestions',
    getAll: examQuestionModel.getAllQuestions,
    getById: examQuestionModel.getQuestionById,
    create: examQuestionModel.addQuestion,
    update: examQuestionModel.updateQuestion,
    remove: examQuestionModel.deleteQuestion,
    defaultSearchFields: ['id', 'orgId', 'templateId', 'revisionId', 'questionType', 'status', 'promptText']
  }),
  examAllocations: createSchoolRepository({
    entityName: 'examAllocations',
    collectionName: 'schoolExamAllocations',
    getAll: examAllocationModel.getAllAllocations,
    getById: examAllocationModel.getAllocationById,
    create: examAllocationModel.addAllocation,
    update: examAllocationModel.updateAllocation,
    remove: examAllocationModel.deleteAllocation,
    defaultSearchFields: ['id', 'orgId', 'classId', 'templateId', 'revisionId', 'allocationName', 'status']
  }),
  examAssignments: createSchoolRepository({
    entityName: 'examAssignments',
    collectionName: 'schoolExamAssignments',
    getAll: examAssignmentModel.getAllAssignments,
    getById: examAssignmentModel.getAssignmentById,
    create: examAssignmentModel.addAssignment,
    update: examAssignmentModel.updateAssignment,
    remove: examAssignmentModel.deleteAssignment,
    defaultSearchFields: ['id', 'orgId', 'allocationId', 'classId', 'studentId', 'status', 'revisionId']
  }),
  examAttempts: createSchoolRepository({
    entityName: 'examAttempts',
    collectionName: 'schoolExamAttempts',
    getAll: examAttemptModel.getAllAttempts,
    getById: examAttemptModel.getAttemptById,
    create: examAttemptModel.addAttempt,
    update: examAttemptModel.updateAttempt,
    remove: examAttemptModel.deleteAttempt,
    defaultSearchFields: ['id', 'orgId', 'assignmentId', 'allocationId', 'studentId', 'status', 'revisionId']
  }),
  examAnswers: createSchoolRepository({
    entityName: 'examAnswers',
    collectionName: 'schoolExamAnswers',
    getAll: examAnswerModel.getAllAnswers,
    getById: examAnswerModel.getAnswerById,
    create: examAnswerModel.addAnswer,
    update: examAnswerModel.updateAnswer,
    remove: examAnswerModel.deleteAnswer,
    defaultSearchFields: ['id', 'orgId', 'attemptId', 'assignmentId', 'studentId', 'questionId', 'status']
  }),
  subjects: createSchoolRepository({
    entityName: 'subjects',
    collectionName: 'schoolSubjects',
    getAll: subjectModel.getAllSubjects,
    getById: subjectModel.getSubjectById,
    create: subjectModel.addSubject,
    update: subjectModel.updateSubject,
    remove: subjectModel.deleteSubject,
    defaultSearchFields: ['id', 'name', 'code', 'description']
  }),
  classes: createSchoolRepository({
    entityName: 'classes',
    collectionName: 'schoolClasses',
    getAll: classModel.getAllClasses,
    getById: classModel.getClassById,
    create: classModel.addClass,
    update: classModel.updateClass,
    remove: classModel.deleteClass,
    defaultSearchFields: ['id', 'title', 'code', 'description', 'status'],
    transformList: (rows) => normalizeRows(rows).map((row) => normalizeClassDataContract(row)),
    transformItem: (row) => normalizeClassDataContract(row)
  }),
  holidays: createSchoolRepository({
    entityName: 'holidays',
    collectionName: 'schoolHolidays',
    getAll: holidayModel.getAllHolidays,
    getById: holidayModel.getHolidayById,
    create: holidayModel.addHoliday,
    update: holidayModel.updateHoliday,
    remove: holidayModel.deleteHoliday,
    defaultSearchFields: ['id', 'title', 'type', 'description']
  }),
  terms: createSchoolRepository({
    entityName: 'terms',
    collectionName: 'schoolTerms',
    getAll: termModel.getAllTerms,
    getById: termModel.getTermById,
    create: termModel.addTerm,
    update: termModel.updateTerm,
    remove: termModel.deleteTerm,
    defaultSearchFields: ['id', 'name', 'status', 'description']
  }),
  departments: createSchoolRepository({
    entityName: 'departments',
    collectionName: 'schoolDepartments',
    getAll: departmentModel.getAllDepartments,
    getById: departmentModel.getDepartmentById,
    create: departmentModel.addDepartment,
    update: departmentModel.updateDepartment,
    remove: departmentModel.deleteDepartment,
    defaultSearchFields: ['id', 'name', 'code', 'description']
  }),
  teachers: createSchoolRepository({
    entityName: 'teachers',
    collectionName: 'schoolTeachers',
    getAll: teacherModel.getAllTeachers,
    getById: teacherModel.getTeacherById,
    create: teacherModel.addTeacher,
    update: teacherModel.updateTeacher,
    remove: teacherModel.deleteTeacher,
    defaultSearchFields: ['id', 'personId', 'status', 'employmentType']
  }),
  staff: createSchoolRepository({
    entityName: 'staff',
    collectionName: 'schoolStaff',
    getAll: staffModel.getAllStaff,
    getById: staffModel.getStaffById,
    create: staffModel.addStaff,
    update: staffModel.updateStaff,
    remove: staffModel.deleteStaff,
    defaultSearchFields: ['id', 'personId', 'status', 'employmentType']
  }),
  payRates: createSchoolRepository({
    entityName: 'payRates',
    collectionName: 'schoolPayRates',
    getAll: payRateModel.getAllPayRates,
    getById: payRateModel.getPayRateById,
    create: payRateModel.addPayRate,
    update: payRateModel.updatePayRate,
    remove: payRateModel.deletePayRate,
    defaultSearchFields: ['id', 'personId', 'orgId', 'compensationMethod', 'status']
  }),
  sessionStatuses: createSchoolRepository({
    entityName: 'sessionStatuses',
    collectionName: 'schoolSessionStatuses',
    getAll: sessionStatusModel.getAllSessionStatuses,
    getById: sessionStatusModel.getSessionStatusById,
    create: sessionStatusModel.addSessionStatus,
    update: sessionStatusModel.updateSessionStatus,
    remove: sessionStatusModel.deleteSessionStatus,
    defaultSearchFields: ['id', 'orgId', 'code', 'label', 'description', 'timesheetFormula'],
    allowSystemFallback: true
  }),
  timesheetPeriods: createSchoolRepository({
    entityName: 'timesheetPeriods',
    collectionName: 'schoolTimesheetPeriods',
    getAll: timesheetPeriodModel.getAllTimesheetPeriods,
    getById: timesheetPeriodModel.getTimesheetPeriodById,
    create: timesheetPeriodModel.addTimesheetPeriod,
    update: timesheetPeriodModel.updateTimesheetPeriod,
    remove: timesheetPeriodModel.deleteTimesheetPeriod,
    defaultSearchFields: ['id', 'name', 'status', 'orgId', 'description']
  }),
  timesheets: createSchoolRepository({
    entityName: 'timesheets',
    collectionName: 'schoolTimesheets',
    getAll: timesheetModel.getAllTimesheets,
    getById: timesheetModel.getTimesheetById,
    create: timesheetModel.saveTimesheet,
    update: async (_id, data) => timesheetModel.saveTimesheet(data),
    remove: async () => {
      throw new Error('Timesheets cannot be deleted from this service.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Timesheets cannot be deleted from this service.',
    defaultSearchFields: ['id', 'periodId', 'teacherId', 'status', 'orgId'],
    transformList: enrichTimesheetsWithOrg,
    transformItem: enrichTimesheetItem,
    mongoScopeInMemory: true
  }),
  studentProgramRegistrations: createSchoolRepository({
    entityName: 'studentProgramRegistrations',
    collectionName: 'schoolStudentProgramRegistrations',
    getAll: studentProgramRegistrationModel.getAllRegistrations,
    getById: studentProgramRegistrationModel.getRegistrationById,
    create: studentProgramRegistrationModel.addRegistration,
    update: studentProgramRegistrationModel.updateRegistration,
    remove: async () => {
      throw new Error('Student program registrations cannot be deleted from this service.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Student program registrations cannot be deleted from this service.',
    defaultSearchFields: ['id', 'orgId', 'studentId', 'personId', 'programId', 'status', 'registrationDate']
  }),
  studentTermRegistrations: createSchoolRepository({
    entityName: 'studentTermRegistrations',
    collectionName: 'schoolStudentTermRegistrations',
    getAll: studentTermRegistrationModel.getAllRegistrations,
    getById: studentTermRegistrationModel.getRegistrationById,
    create: studentTermRegistrationModel.addRegistration,
    update: studentTermRegistrationModel.updateRegistration,
    remove: async () => {
      throw new Error('Student term registrations cannot be deleted from this service.');
    },
    mongoRemoveUnsupported: true,
    mongoRemoveMessage: 'Student term registrations cannot be deleted from this service.',
    defaultSearchFields: ['id', 'orgId', 'studentId', 'personId', 'programId', 'termId', 'status', 'registrationDate']
  }),
  studentProgramPriorSubjects: createSchoolRepository({
    entityName: 'studentProgramPriorSubjects',
    collectionName: 'schoolStudentProgramPriorSubjects',
    getAll: studentProgramPriorSubjectModel.getAllRecords,
    getById: studentProgramPriorSubjectModel.getRecordById,
    create: studentProgramPriorSubjectModel.addRecord,
    update: studentProgramPriorSubjectModel.updateRecord,
    remove: studentProgramPriorSubjectModel.deleteRecord,
    defaultSearchFields: [
      'id',
      'orgId',
      'studentId',
      'programId',
      'subjectId',
      'source',
      'status',
      'evidenceNote'
    ]
  }),
  classEnrollmentPeriods: createSchoolRepository({
    entityName: 'classEnrollmentPeriods',
    collectionName: 'schoolClassEnrollmentPeriods',
    getAll: classEnrollmentPeriodModel.getAllEnrollmentPeriods,
    getById: classEnrollmentPeriodModel.getEnrollmentPeriodById,
    create: classEnrollmentPeriodModel.addEnrollmentPeriod,
    update: classEnrollmentPeriodModel.updateEnrollmentPeriod,
    remove: classEnrollmentPeriodModel.deleteEnrollmentPeriod,
    defaultSearchFields: [
      'id',
      'orgId',
      'classId',
      'studentId',
      'status',
      'funderType',
      'funderId',
      'authorizationRef',
      'reasonStart',
      'reasonEnd'
    ]
  }),
  leaveRequests: createSchoolRepository({
    entityName: 'leaveRequests',
    collectionName: 'schoolLeaveRequests',
    getAll: leaveRequestModel.getAllLeaveRequests,
    getById: leaveRequestModel.getLeaveRequestById,
    create: leaveRequestModel.addLeaveRequest,
    update: leaveRequestModel.updateLeaveRequest,
    remove: leaveRequestModel.deleteLeaveRequest,
    defaultSearchFields: [
      'id',
      'orgId',
      'requesterPersonId',
      'requesterName',
      'requesterRole',
      'status',
      'reason',
      'details'
    ],
    dateFields: ['requestDate', 'startDate', 'endDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  }),
  notifications: createSchoolRepository({
    entityName: 'notifications',
    collectionName: 'schoolNotifications',
    getAll: notificationModel.getAllNotifications,
    getById: notificationModel.getNotificationById,
    create: notificationModel.addNotification,
    update: notificationModel.updateNotification,
    remove: notificationModel.deleteNotification,
    defaultSearchFields: [
      'id',
      'orgId',
      'sourceType',
      'sourceId',
      'title',
      'message',
      'severity',
      'status',
      'assignedRole',
      'assignedPersonId',
      'assignedPersonName'
    ],
    dateFields: ['dueDate', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  }),
  notificationRoutingRules: createSchoolRepository({
    entityName: 'notificationRoutingRules',
    collectionName: 'schoolNotificationRoutingRules',
    getAll: notificationRoutingRuleModel.getAllNotificationRoutingRules,
    getById: notificationRoutingRuleModel.getNotificationRoutingRuleById,
    create: notificationRoutingRuleModel.addNotificationRoutingRule,
    update: notificationRoutingRuleModel.updateNotificationRoutingRule,
    remove: notificationRoutingRuleModel.deleteNotificationRoutingRule,
    defaultSearchFields: [
      'id',
      'orgId',
      'sourceType',
      'assigneePersonId',
      'assigneePersonName',
      'label',
      'notes'
    ],
    dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
  })
};

schoolRepositories.students.purgeById = async (id, options = {}) => {
  const targetId = toPublicId(id);
  if (!targetId) throw new Error('Student id is required.');
  return runByRepositoryBackend(options, {
    json: async () => studentModel.purgeStudent(targetId, options),
    mongo: async () => purgeMongoDocumentByResolvedId('schoolStudents', targetId, 'Student record')
  }, 'school.students.purgeById');
};

schoolRepositories.teachers.purgeById = async (id, options = {}) => {
  const targetId = toPublicId(id);
  if (!targetId) throw new Error('Teacher id is required.');
  return runByRepositoryBackend(options, {
    json: async () => teacherModel.purgeTeacher(targetId, options),
    mongo: async () => purgeMongoDocumentByResolvedId('schoolTeachers', targetId, 'Teacher record')
  }, 'school.teachers.purgeById');
};

schoolRepositories.staff.purgeById = async (id, options = {}) => {
  const targetId = toPublicId(id);
  if (!targetId) throw new Error('Staff id is required.');
  return runByRepositoryBackend(options, {
    json: async () => staffModel.purgeStaff(targetId, options),
    mongo: async () => purgeMongoDocumentByResolvedId('schoolStaff', targetId, 'Staff record')
  }, 'school.staff.purgeById');
};

schoolRepositories.schoolAccounts.purgeById = async (id, options = {}) => {
  const targetId = toPublicId(id);
  if (!targetId) throw new Error('School account id is required.');
  return runByRepositoryBackend(options, {
    json: async () => schoolAccountModel.purgeAccount(targetId, options),
    mongo: async () => purgeMongoDocumentByResolvedId('schoolAccounts', targetId, 'School account', async (collection) => {
      const childCount = await collection.countDocuments({ parentId: String(targetId) });
      if (childCount > 0) {
        throw new Error('Cannot delete an account that has child accounts.');
      }
    })
  }, 'school.schoolAccounts.purgeById');
};

schoolRepositories.reportInstances.findByAssignmentTeacherTarget = async (assignmentId, teacherId, targetKey = 'class') => {
  return runByRepositoryBackend({}, {
    json: async () => reportInstanceModel.findByAssignmentTeacherTarget(assignmentId, teacherId, targetKey),
    mongo: async () => {
      const rows = await schoolRepositories.reportInstances.list({
        query: {
          assignmentId__eq: assignmentId,
          teacherId__eq: teacherId,
          targetKey__eq: targetKey,
          page: 1,
          limit: 1
        },
        scope: { canViewAll: true }
      });
      return rows[0] || null;
    }
  }, 'school.reportInstances.findByAssignmentTeacherTarget');
};

schoolRepositories.reportInstances.existsByAssignmentTeacherTarget = async (assignmentId, teacherId, targetKey = 'class') => {
  const found = await schoolRepositories.reportInstances.findByAssignmentTeacherTarget(assignmentId, teacherId, targetKey);
  return Boolean(found);
};

schoolRepositories.globalTransactions.findReversalByTransactionId = async (transactionId) => {
  const rows = await schoolRepositories.globalTransactions.list({
    query: {
      reversalOfTransactionId__eq: transactionId,
      page: 1,
      limit: 1
    },
    scope: { canViewAll: true }
  });
  return rows[0] || null;
};

schoolRepositories.globalTransactions.reverseTransaction = async (transactionId, payload = {}, options = {}) => {
  return runByRepositoryBackend(options, {
    json: async () => globalTransactionLedgerModel.reverseTransaction(transactionId, payload, options),
    mongo: async () => {
      const collection = getMongoCollection('schoolGlobalTransactions');
      const original = normalizeMongoDocument(await collection.findOne(resolveMongoIdFilter(transactionId)));
      if (!original) throw new Error('Original transaction not found.');
      if (String(original?.status || '').trim().toLowerCase() !== 'posted') {
        throw new Error('Only posted transactions can be reversed.');
      }

      const existingReverse = await collection.findOne({ reversalOfTransactionId: original.id });
      if (existingReverse) throw new Error('This transaction is already reversed.');

      const newId = await generateUniqueStringId(collection, null);
      const reversedDirection = String(original?.amount?.direction || '').toLowerCase() === 'debit' ? 'credit' : 'debit';
      const nowIso = new Date().toISOString();

      const reversed = {
        ...original,
        id: newId,
        postedAt: nowIso,
        effectiveDate: String(payload?.effectiveDate || '').trim() || original.effectiveDate,
        status: 'posted',
        transactionType: 'reversal',
        source: {
          ...(original.source || {}),
          eventType: 'transaction_reversal',
          eventId: String(payload?.eventId || '').trim() || `REV-${original.id}`,
          idempotencyKey: String(payload?.idempotencyKey || '').trim() || `REV|${original.id}`
        },
        amount: {
          ...(original.amount || {}),
          direction: reversedDirection
        },
        balanceEffect: -Number(original.balanceEffect || 0),
        memo: String(payload?.memo || '').trim() || `Reversal of ${original.id}`,
        internalNote: String(payload?.internalNote || '').trim(),
        comments: [],
        hold: {
          isOnHold: false,
          holdReasonCode: '',
          holdReasonText: '',
          holdPlacedBy: '',
          holdPlacedAt: '',
          holdUntil: '',
          holdReleasedBy: '',
          holdReleasedAt: ''
        },
        reversalOfTransactionId: original.id,
        audit: { createDateTime: nowIso }
      };

      delete reversed._id;
      await collection.insertOne(reversed);
      return normalizeMongoDocument(reversed);
    }
  }, 'school.globalTransactions.reverseTransaction');
};

schoolRepositories.globalTransactions.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear global transactions.');
  return runByRepositoryBackend(options, {
    json: async () => globalTransactionLedgerModel.clearTransactionsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolGlobalTransactions');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.globalTransactions.clearByOrg');
};

schoolRepositories.academicLedger.voidEntry = async (entryId, note = '', options = {}) => {
  return await schoolRepositories.academicLedger.update(entryId, { status: 'void', note }, options);
};

// Backward-compatible aliases used by existing services.
schoolRepositories.academicLedger.addEntry = async (entry, options = {}) => {
  return await schoolRepositories.academicLedger.create(entry, options);
};

schoolRepositories.academicLedger.addEntries = async (entries, options = {}) => {
  return await schoolRepositories.academicLedger.create(entries, options);
};

schoolRepositories.academicLedger.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear academic ledger entries.');
  return runByRepositoryBackend(options, {
    json: async () => academicLedgerModel.clearEntriesByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolAcademicLedger');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.academicLedger.clearByOrg');
};

schoolRepositories.transactionJournals.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear transaction journals.');
  return runByRepositoryBackend(options, {
    json: async () => transactionJournalModel.clearJournalsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolTransactionJournals');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.transactionJournals.clearByOrg');
};

schoolRepositories.studentProgramRegistrations.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear program registrations.');
  return runByRepositoryBackend(options, {
    json: async () => studentProgramRegistrationModel.clearRegistrationsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolStudentProgramRegistrations');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.studentProgramRegistrations.clearByOrg');
};

schoolRepositories.studentTermRegistrations.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear term registrations.');
  return runByRepositoryBackend(options, {
    json: async () => studentTermRegistrationModel.clearRegistrationsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolStudentTermRegistrations');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.studentTermRegistrations.clearByOrg');
};

schoolRepositories.studentProgramPriorSubjects.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear prior subject credits.');
  return runByRepositoryBackend(options, {
    json: async () => studentProgramPriorSubjectModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolStudentProgramPriorSubjects');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.studentProgramPriorSubjects.clearByOrg');
};

schoolRepositories.classEnrollmentPeriods.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear class enrollment periods.');
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolClassEnrollmentPeriods');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.classEnrollmentPeriods.clearByOrg');
};

schoolRepositories.leaveRequests.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear leave requests.');
  return runByRepositoryBackend(options, {
    json: async () => leaveRequestModel.clearLeaveRequestsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolLeaveRequests');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.leaveRequests.clearByOrg');
};

schoolRepositories.notifications.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear notifications.');
  return runByRepositoryBackend(options, {
    json: async () => notificationModel.clearNotificationsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolNotifications');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.notifications.clearByOrg');
};

schoolRepositories.notificationRoutingRules.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear notification routing rules.');
  return runByRepositoryBackend(options, {
    json: async () => notificationRoutingRuleModel.clearNotificationRoutingRulesByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolNotificationRoutingRules');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.notificationRoutingRules.clearByOrg');
};

schoolRepositories.reportInstances.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear report instances.');
  return runByRepositoryBackend(options, {
    json: async () => reportInstanceModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolReportInstances');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.reportInstances.clearByOrg');
};

schoolRepositories.reportAssignments.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear report assignments.');
  return runByRepositoryBackend(options, {
    json: async () => reportAssignmentModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolReportAssignments');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.reportAssignments.clearByOrg');
};

schoolRepositories.examTemplates.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam templates.');
  return runByRepositoryBackend(options, {
    json: async () => examTemplateModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamTemplates');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examTemplates.clearByOrg');
};

schoolRepositories.examRevisions.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam revisions.');
  return runByRepositoryBackend(options, {
    json: async () => examRevisionModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamRevisions');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examRevisions.clearByOrg');
};

schoolRepositories.examQuestions.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam questions.');
  return runByRepositoryBackend(options, {
    json: async () => examQuestionModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamQuestions');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examQuestions.clearByOrg');
};

schoolRepositories.examAllocations.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam allocations.');
  return runByRepositoryBackend(options, {
    json: async () => examAllocationModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamAllocations');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examAllocations.clearByOrg');
};

schoolRepositories.examAssignments.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam assignments.');
  return runByRepositoryBackend(options, {
    json: async () => examAssignmentModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamAssignments');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examAssignments.clearByOrg');
};

schoolRepositories.examAttempts.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam attempts.');
  return runByRepositoryBackend(options, {
    json: async () => examAttemptModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamAttempts');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examAttempts.clearByOrg');
};

schoolRepositories.examAnswers.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear exam answers.');
  return runByRepositoryBackend(options, {
    json: async () => examAnswerModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolExamAnswers');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return { removed: Number(result?.deletedCount || 0), remaining: await collection.countDocuments({}) };
    }
  }, 'school.examAnswers.clearByOrg');
};

schoolRepositories.timesheets.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear timesheets.');
  return runByRepositoryBackend(options, {
    json: async () => timesheetModel.clearByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolTimesheets');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.timesheets.clearByOrg');
};

schoolRepositories.classes.clearRuntimeStorageByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear class runtime storage.');
  return runByRepositoryBackend(options, {
    json: async () => classModel.clearRuntimeStorageByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolClasses');
      const rows = await collection.find({ orgId: targetOrgId }, { projection: { _id: 1, id: 1, sessions: 1 } }).toArray();
      const classIds = rows.map((r) => String(r.id || '').trim()).filter(Boolean);
      const errors = [];
      let mongoSessionsClearedClasses = 0;
      for (const row of rows) {
        const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
        if (!sessions.length) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          await collection.updateOne({ _id: row._id }, { $set: { sessions: [] } });
          mongoSessionsClearedClasses += 1;
        } catch (err) {
          errors.push(`${row.id}: ${String(err?.message || err)}`);
        }
      }
      const fsResult = await classModel.removePhysicalClassStorageByClassIds(classIds);
      return {
        removedDirs: fsResult.removedDirs,
        mongoSessionsClearedClasses,
        jsonSessionsClearedClasses: 0,
        errors: [...errors, ...(fsResult.errors || [])]
      };
    }
  }, 'school.classes.clearRuntimeStorageByOrg');
};

schoolRepositories.subjects.clearStorageByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear subject storage.');
  return runByRepositoryBackend(options, {
    json: async () => subjectModel.clearStorageByOrg(targetOrgId),
    mongo: async () => subjectModel.clearStorageByOrg(targetOrgId)
  }, 'school.subjects.clearStorageByOrg');
};

schoolRepositories.classEnrollmentPeriods.findByClassId = async (classId, options = {}) => {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return [];
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.findByClassId(normalizedClassId),
    mongo: async () => {
      const rows = await schoolRepositories.classEnrollmentPeriods.list({
        query: { classId__eq: normalizedClassId },
        scope: { canViewAll: true }
      });
      return normalizeRows(rows);
    }
  }, 'school.classEnrollmentPeriods.findByClassId');
};

schoolRepositories.classEnrollmentPeriods.findByStudentId = async (studentId, options = {}) => {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) return [];
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.findByStudentId(normalizedStudentId),
    mongo: async () => {
      const rows = await schoolRepositories.classEnrollmentPeriods.list({
        query: { studentId__eq: normalizedStudentId },
        scope: { canViewAll: true }
      });
      return normalizeRows(rows);
    }
  }, 'school.classEnrollmentPeriods.findByStudentId');
};

schoolRepositories.classEnrollmentPeriods.findByOrgId = async (orgId, options = {}) => {
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedOrgId) return [];
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.findByOrgId(normalizedOrgId),
    mongo: async () => {
      const rows = await schoolRepositories.classEnrollmentPeriods.list({
        query: { orgId__eq: normalizedOrgId },
        scope: { canViewAll: true }
      });
      return normalizeRows(rows);
    }
  }, 'school.classEnrollmentPeriods.findByOrgId');
};

schoolRepositories.classEnrollmentPeriods.findByClassIdInRange = async (classId, startDate, endDate, options = {}) => {
  const normalizedClassId = toPublicId(classId);
  const overlapFilter = buildDateRangeOverlapFilter(startDate, endDate);
  if (!normalizedClassId || !overlapFilter) return [];
  const statuses = Array.isArray(options?.statuses)
    ? options.statuses.map((row) => String(row || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.findByClassIdInRange(normalizedClassId, startDate, endDate, options),
    mongo: async () => {
      const query = {
        classId: normalizedClassId,
        ...overlapFilter
      };
      if (statuses.length) query.status = { $in: statuses };
      const rows = await getMongoCollection('schoolClassEnrollmentPeriods').find(query).toArray();
      return normalizeRows(rows).map((row) => normalizeMongoDocument(row)).filter(Boolean);
    }
  }, 'school.classEnrollmentPeriods.findByClassIdInRange');
};

schoolRepositories.classEnrollmentPeriods.findByStudentIdInRange = async (studentId, startDate, endDate, options = {}) => {
  const normalizedStudentId = toPublicId(studentId);
  const overlapFilter = buildDateRangeOverlapFilter(startDate, endDate);
  if (!normalizedStudentId || !overlapFilter) return [];
  const statuses = Array.isArray(options?.statuses)
    ? options.statuses.map((row) => String(row || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return runByRepositoryBackend(options, {
    json: async () => classEnrollmentPeriodModel.findByStudentIdInRange(normalizedStudentId, startDate, endDate, options),
    mongo: async () => {
      const query = {
        studentId: normalizedStudentId,
        ...overlapFilter
      };
      if (statuses.length) query.status = { $in: statuses };
      const rows = await getMongoCollection('schoolClassEnrollmentPeriods').find(query).toArray();
      return normalizeRows(rows).map((row) => normalizeMongoDocument(row)).filter(Boolean);
    }
  }, 'school.classEnrollmentPeriods.findByStudentIdInRange');
};

schoolRepositories.classEnrollmentPeriods.findActiveByClassIdOnDate = async (classId, onDate, options = {}) => {
  const day = normalizeDateOnlyToken(onDate);
  if (!day) return [];
  return schoolRepositories.classEnrollmentPeriods.findByClassIdInRange(
    classId,
    day,
    day,
    { ...options, statuses: ['active'] }
  );
};

schoolRepositories.classEnrollmentPeriods.findActiveByStudentIdOnDate = async (studentId, onDate, options = {}) => {
  const day = normalizeDateOnlyToken(onDate);
  if (!day) return [];
  return schoolRepositories.classEnrollmentPeriods.findByStudentIdInRange(
    studentId,
    day,
    day,
    { ...options, statuses: ['active'] }
  );
};

schoolRepositories.examRevisions.findByTemplateId = async (templateId, options = {}) => {
  const normalizedTemplateId = toPublicId(templateId);
  if (!normalizedTemplateId) return [];
  const rows = await schoolRepositories.examRevisions.list({
    query: { templateId__eq: normalizedTemplateId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examQuestions.findByRevisionId = async (revisionId, options = {}) => {
  const normalizedRevisionId = toPublicId(revisionId);
  if (!normalizedRevisionId) return [];
  const rows = await schoolRepositories.examQuestions.list({
    query: { revisionId__eq: normalizedRevisionId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examAllocations.findByClassId = async (classId, options = {}) => {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return [];
  const rows = await schoolRepositories.examAllocations.list({
    query: { classId__eq: normalizedClassId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examAssignments.findByAllocationId = async (allocationId, options = {}) => {
  const normalizedAllocationId = toPublicId(allocationId);
  if (!normalizedAllocationId) return [];
  const rows = await schoolRepositories.examAssignments.list({
    query: { allocationId__eq: normalizedAllocationId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examAssignments.findByStudentId = async (studentId, options = {}) => {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) return [];
  const rows = await schoolRepositories.examAssignments.list({
    query: { studentId__eq: normalizedStudentId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examAttempts.findByAssignmentId = async (assignmentId, options = {}) => {
  const normalizedAssignmentId = toPublicId(assignmentId);
  if (!normalizedAssignmentId) return [];
  const rows = await schoolRepositories.examAttempts.list({
    query: { assignmentId__eq: normalizedAssignmentId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.examAnswers.findByAttemptId = async (attemptId, options = {}) => {
  const normalizedAttemptId = toPublicId(attemptId);
  if (!normalizedAttemptId) return [];
  const rows = await schoolRepositories.examAnswers.list({
    query: { attemptId__eq: normalizedAttemptId },
    scope: { canViewAll: true },
    ...options
  });
  return normalizeRows(rows);
};

schoolRepositories.academicSnapshots.clearByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear academic snapshots.');
  return runByRepositoryBackend(options, {
    json: async () => academicSnapshotModel.clearSnapshotsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolAcademicSnapshots');
      const result = await collection.deleteMany({ orgId: targetOrgId });
      return {
        removed: Number(result?.deletedCount || 0),
        remaining: await collection.countDocuments({})
      };
    }
  }, 'school.academicSnapshots.clearByOrg');
};

schoolRepositories.classes.clearEnrollmentsByOrg = async (orgId, options = {}) => {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('orgId is required to clear class enrollments.');
  return runByRepositoryBackend(options, {
    json: async () => classModel.clearEnrollmentsByOrg(targetOrgId),
    mongo: async () => {
      const collection = getMongoCollection('schoolClasses');
      const rows = await collection.find({ orgId: targetOrgId }, { projection: { _id: 1, enrollment: 1 } }).toArray();
      let removedEnrollments = 0;
      let classesTouched = 0;
      for (const row of rows) {
        const students = Array.isArray(row?.enrollment?.students) ? row.enrollment.students : [];
        if (!students.length) continue;
        removedEnrollments += students.length;
        classesTouched += 1;
        // eslint-disable-next-line no-await-in-loop
        await collection.updateOne({ _id: row._id }, { $set: { 'enrollment.students': [] } });
      }
      const remainingRows = await collection.find({ orgId: targetOrgId }, { projection: { enrollment: 1 } }).toArray();
      const remainingEnrollmentsInOrg = remainingRows.reduce((sum, row) => {
        const students = Array.isArray(row?.enrollment?.students) ? row.enrollment.students : [];
        return sum + students.length;
      }, 0);
      return {
        removedEnrollments,
        classesTouched,
        remainingEnrollmentsInOrg
      };
    }
  }, 'school.classes.clearEnrollmentsByOrg');
};

schoolRepositories.studentProgramRegistrations.findByStudentAndProgram = async (studentId, programId) => {
  const rows = await schoolRepositories.studentProgramRegistrations.list({
    query: {
      studentId__eq: studentId,
      programId__eq: programId
    },
    scope: { canViewAll: true }
  });
  return normalizeRows(rows);
};

function isInactiveRegistrationStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(normalized);
}

schoolRepositories.studentProgramRegistrations.findActiveByStudentAndProgram = async (studentId, programId, options = {}) => {
  const limit = Number(options?.limit) > 0 ? Number(options.limit) : null;
  const rows = await schoolRepositories.studentProgramRegistrations.findByStudentAndProgram(studentId, programId);
  const activeRows = normalizeRows(rows).filter((row) => !isInactiveRegistrationStatus(row?.status));
  return limit ? activeRows.slice(0, limit) : activeRows;
};

schoolRepositories.studentProgramRegistrations.existsActiveByStudentAndProgram = async (studentId, programId, options = {}) => {
  const rows = await schoolRepositories.studentProgramRegistrations.findActiveByStudentAndProgram(studentId, programId, {
    ...options,
    limit: 1
  });
  return rows.length > 0;
};

schoolRepositories.studentProgramRegistrations.getByIdInOrg = async (registrationId, orgId) => {
  const registration = await schoolRepositories.studentProgramRegistrations.getById(registrationId);
  if (!registration) return null;
  if (!orgId) return registration;
  return idsEqual(registration?.orgId, orgId) ? registration : null;
};

schoolRepositories.studentTermRegistrations.findByStudentProgramAndTerm = async (studentId, programId, termId) => {
  const rows = await schoolRepositories.studentTermRegistrations.list({
    query: {
      studentId__eq: studentId,
      programId__eq: programId,
      termId__eq: termId
    },
    scope: { canViewAll: true }
  });
  return normalizeRows(rows);
};

schoolRepositories.studentTermRegistrations.findActiveByStudentProgramAndTerm = async (studentId, programId, termId, options = {}) => {
  const excludeId = options?.excludeId ? toPublicId(options.excludeId) : '';
  const limit = Number(options?.limit) > 0 ? Number(options.limit) : null;
  const rows = await schoolRepositories.studentTermRegistrations.findByStudentProgramAndTerm(studentId, programId, termId);
  const activeRows = normalizeRows(rows)
    .filter((row) => !excludeId || !idsEqual(row?.id, excludeId))
    .filter((row) => !isInactiveRegistrationStatus(row?.status));
  return limit ? activeRows.slice(0, limit) : activeRows;
};

schoolRepositories.studentTermRegistrations.existsActiveByStudentProgramAndTerm = async (studentId, programId, termId, options = {}) => {
  const rows = await schoolRepositories.studentTermRegistrations.findActiveByStudentProgramAndTerm(studentId, programId, termId, {
    ...options,
    limit: 1
  });
  return rows.length > 0;
};

schoolRepositories.studentTermRegistrations.getByIdInOrg = async (registrationId, orgId) => {
  const registration = await schoolRepositories.studentTermRegistrations.getById(registrationId);
  if (!registration) return null;
  if (!orgId) return registration;
  return idsEqual(registration?.orgId, orgId) ? registration : null;
};

function isRolledBackRegistration(status) {
  return String(status || '').trim().toLowerCase() === 'rolled_back';
}

schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId = async (programRegistrationId, options = {}) => {
  const orgId = options?.orgId ? toPublicId(options.orgId) : '';
  const limit = Number(options?.limit) > 0 ? Number(options.limit) : null;
  const rows = await schoolRepositories.studentTermRegistrations.list({
    query: {
      programRegistrationId__eq: programRegistrationId,
      ...(orgId ? { orgId__eq: orgId } : {})
    },
    scope: { canViewAll: true }
  });

  const activeRows = normalizeRows(rows).filter((row) => !isRolledBackRegistration(row?.status));
  return limit ? activeRows.slice(0, limit) : activeRows;
};

schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async (programRegistrationId, options = {}) => {
  const rows = await schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId(programRegistrationId, options);
  return rows.length;
};

schoolRepositories.studentTermRegistrations.existsActiveByProgramRegistrationId = async (programRegistrationId, options = {}) => {
  return (await schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId(programRegistrationId, options)) > 0;
};

assertQueryableCrudRepository('schoolRepositories.students', schoolRepositories.students);
assertQueryableCrudRepository('schoolRepositories.programs', schoolRepositories.programs);
assertQueryableCrudRepository('schoolRepositories.transactionDefinitions', schoolRepositories.transactionDefinitions);
assertQueryableCrudRepository('schoolRepositories.schoolAccounts', schoolRepositories.schoolAccounts);
assertQueryableCrudRepository('schoolRepositories.globalTransactions', schoolRepositories.globalTransactions);
assertQueryableCrudRepository('schoolRepositories.transactionJournals', schoolRepositories.transactionJournals);
assertQueryableCrudRepository('schoolRepositories.academicLedger', schoolRepositories.academicLedger);
assertQueryableCrudRepository('schoolRepositories.academicSnapshots', schoolRepositories.academicSnapshots);
assertQueryableCrudRepository('schoolRepositories.reportTemplates', schoolRepositories.reportTemplates);
assertQueryableCrudRepository('schoolRepositories.reportAssignments', schoolRepositories.reportAssignments);
assertQueryableCrudRepository('schoolRepositories.reportInstances', schoolRepositories.reportInstances);
assertQueryableCrudRepository('schoolRepositories.examTemplates', schoolRepositories.examTemplates);
assertQueryableCrudRepository('schoolRepositories.examRevisions', schoolRepositories.examRevisions);
assertQueryableCrudRepository('schoolRepositories.examQuestions', schoolRepositories.examQuestions);
assertQueryableCrudRepository('schoolRepositories.examAllocations', schoolRepositories.examAllocations);
assertQueryableCrudRepository('schoolRepositories.examAssignments', schoolRepositories.examAssignments);
assertQueryableCrudRepository('schoolRepositories.examAttempts', schoolRepositories.examAttempts);
assertQueryableCrudRepository('schoolRepositories.examAnswers', schoolRepositories.examAnswers);
assertQueryableCrudRepository('schoolRepositories.subjects', schoolRepositories.subjects);
assertQueryableCrudRepository('schoolRepositories.classes', schoolRepositories.classes);
assertQueryableCrudRepository('schoolRepositories.holidays', schoolRepositories.holidays);
assertQueryableCrudRepository('schoolRepositories.terms', schoolRepositories.terms);
assertQueryableCrudRepository('schoolRepositories.departments', schoolRepositories.departments);
assertQueryableCrudRepository('schoolRepositories.teachers', schoolRepositories.teachers);
assertQueryableCrudRepository('schoolRepositories.staff', schoolRepositories.staff);
assertQueryableCrudRepository('schoolRepositories.payRates', schoolRepositories.payRates);
assertQueryableCrudRepository('schoolRepositories.sessionStatuses', schoolRepositories.sessionStatuses);
assertQueryableCrudRepository('schoolRepositories.timesheetPeriods', schoolRepositories.timesheetPeriods);
assertQueryableCrudRepository('schoolRepositories.timesheets', schoolRepositories.timesheets);
assertQueryableCrudRepository('schoolRepositories.studentProgramRegistrations', schoolRepositories.studentProgramRegistrations);
assertQueryableCrudRepository('schoolRepositories.studentTermRegistrations', schoolRepositories.studentTermRegistrations);
assertQueryableCrudRepository('schoolRepositories.classEnrollmentPeriods', schoolRepositories.classEnrollmentPeriods);
assertQueryableCrudRepository('schoolRepositories.leaveRequests', schoolRepositories.leaveRequests);
assertQueryableCrudRepository('schoolRepositories.notifications', schoolRepositories.notifications);
assertQueryableCrudRepository('schoolRepositories.notificationRoutingRules', schoolRepositories.notificationRoutingRules);

module.exports = schoolRepositories;

