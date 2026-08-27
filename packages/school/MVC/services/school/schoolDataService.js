const indexModel = require('../../models/school/schoolIndexModel');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const { buildSchoolListScope, SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { recordTransactionOperation } = requireCoreModule('MVC/services/transactionContextService');
function getClassEnrollmentPeriodService() {
  return require('./classEnrollmentPeriodService');
}

function getClassCycleService() {
  return require('./classCycleService');
}

function getClassCycleEnrollmentPolicyService() {
  return require('./classCycleEnrollmentPolicyService');
}

function getExamBuilderService() {
  return require('./examBuilderService');
}

const { isVoidPolicy } = require('./schoolDeletionPolicyRegistry');
const { buildVoidPatch, isVoidRecord } = require('../../models/school/voidRecordMetadata');
const studentSystemIdMigrationLockService = require('./studentSystemIdMigrationLockService');
const {
  applyDefaultFetchLimit,
  stripPaginationFromQuery,
  normalizePaginationQuery,
  buildPaginationMeta,
  buildCountCacheKey,
  getCachedCountValue,
  setCachedCountValue,
  clearSchoolCountCache,
  buildUnboundedQuery
} = require('./schoolPaginationUtils');

function applyVoidFilter(entityType, rawQuery, accessContext = {}) {
  const hasStatusFilter = Object.keys(rawQuery).some((key) => key === 'status' || key.startsWith('status__'));
  return isVoidPolicy(entityType) && accessContext?.includeVoided !== true && !hasStatusFilter
    ? { ...rawQuery, status__ne: 'void' }
    : rawQuery;
}

function clearSchoolCountCacheOnWrite() {
  clearSchoolCountCache();
}

function getDeletionGuardDeps() {
  const schoolDeletionGuardService = require('./schoolDeletionGuardService');
  const { resolveEntityKeyFromRepositoryKey } = require('./schoolDeletionRuleRegistry');
  return { schoolDeletionGuardService, resolveEntityKeyFromRepositoryKey };
}

const SCHOOL_ENTITY_REGISTRY = Object.freeze({
  funders: { repository: schoolRepositories.funders },
  students: { repository: schoolRepositories.students },
  programs: { repository: schoolRepositories.programs },
  transactionDefinitions: { repository: schoolRepositories.transactionDefinitions, allowSystemFallback: true },
  feeDefinitions: { alias: 'transactionDefinitions' },
  transactionTemplates: { alias: 'transactionDefinitions' },
  schoolAccounts: { repository: schoolRepositories.schoolAccounts },
  globalTransactions: { repository: schoolRepositories.globalTransactions },
  transactionJournals: { repository: schoolRepositories.transactionJournals },
  academicLedger: { repository: schoolRepositories.academicLedger },
  academicSnapshots: { repository: schoolRepositories.academicSnapshots },
  reportTemplates: { repository: schoolRepositories.reportTemplates },
  reportAssignments: { repository: schoolRepositories.reportAssignments },
  reportInstances: { repository: schoolRepositories.reportInstances },
  overallReportTemplates: { repository: schoolRepositories.overallReportTemplates },
  overallReportInstances: { repository: schoolRepositories.overallReportInstances },
  overallReportManagementSessions: { repository: schoolRepositories.overallReportManagementSessions },
  examTemplates: { repository: schoolRepositories.examTemplates },
  examRevisions: { repository: schoolRepositories.examRevisions },
  examQuestions: { repository: schoolRepositories.examQuestions },
  examAllocations: { repository: schoolRepositories.examAllocations },
  examAssignments: { repository: schoolRepositories.examAssignments },
  examAttempts: { repository: schoolRepositories.examAttempts },
  examAnswers: { repository: schoolRepositories.examAnswers },
  subjects: { repository: schoolRepositories.subjects },
  classes: { repository: schoolRepositories.classes },
  holidays: { repository: schoolRepositories.holidays },
  terms: { repository: schoolRepositories.terms },
  departments: { repository: schoolRepositories.departments },
  activityCategories: { repository: schoolRepositories.activityCategories },
  activities: { repository: schoolRepositories.activities },
  teachers: { repository: schoolRepositories.teachers },
  staff: { repository: schoolRepositories.staff },
  payRates: { repository: schoolRepositories.payRates },
  sessionStatuses: { repository: schoolRepositories.sessionStatuses },
  skills: { repository: schoolRepositories.skills, allowSystemFallback: true },
  books: { repository: schoolRepositories.books, allowSystemFallback: false },
  libraryCopies: { repository: schoolRepositories.libraryCopies, allowSystemFallback: false },
  libraryPatrons: { repository: schoolRepositories.libraryPatrons, allowSystemFallback: false },
  libraryPolicies: { repository: schoolRepositories.libraryPolicies, allowSystemFallback: false },
  libraryLoans: { repository: schoolRepositories.libraryLoans, allowSystemFallback: false },
  libraryLocations: { repository: schoolRepositories.libraryLocations, allowSystemFallback: false },
  bookAssignments: { repository: schoolRepositories.bookAssignments, allowSystemFallback: false },
  bookCoveringReports: { repository: schoolRepositories.bookCoveringReports, allowSystemFallback: false },
  teachingOutlineLevels: { repository: schoolRepositories.teachingOutlineLevels, allowSystemFallback: true },
  teachingOutlineSectionTemplates: { repository: schoolRepositories.teachingOutlineSectionTemplates, allowSystemFallback: true },
  teachingOutlineItems: { repository: schoolRepositories.teachingOutlineItems, allowSystemFallback: true },
  timesheetPeriods: { repository: schoolRepositories.timesheetPeriods },
  timesheets: { repository: schoolRepositories.timesheets },
  studentProgramRegistrations: { repository: schoolRepositories.studentProgramRegistrations },
  studentProgramPriorSubjects: { repository: schoolRepositories.studentProgramPriorSubjects },
  studentTermRegistrations: { repository: schoolRepositories.studentTermRegistrations },
  classEnrollmentPeriods: { repository: schoolRepositories.classEnrollmentPeriods },
  leaveRequests: { repository: schoolRepositories.leaveRequests },
  tasks: { repository: schoolRepositories.tasks },
  taskRoutingRules: { repository: schoolRepositories.taskRoutingRules },
  sessionStudentCases: { repository: schoolRepositories.sessionStudentCases },
  attendanceChangeLogs: { repository: schoolRepositories.attendanceChangeLogs }
});

const SCHOOL_INDEX_DOCS = Object.freeze({
  teachers: 'school-index-teachers',
  students: 'school-index-students'
});

async function getIndexDoc(key) {
  return runByRepositoryBackend({}, {
    json: async () => (key === 'teachers'
      ? indexModel.getTeacherIndex()
      : indexModel.getStudentIndex()),
    mongo: async () => {
      const row = normalizeMongoDocument(
        await getMongoCollection('schoolIndexes').findOne({ id: SCHOOL_INDEX_DOCS[key] })
      );
      const data = row?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
      return data;
    }
  }, `school.index.${key}.get`);
}

async function saveIndexDoc(key, data) {
  const payload = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  return runByRepositoryBackend({}, {
    json: async () => (key === 'teachers'
      ? indexModel.saveTeacherIndex(payload)
      : indexModel.saveStudentIndex(payload)),
    mongo: async () => {
      const nowIso = new Date().toISOString();
      await getMongoCollection('schoolIndexes').updateOne(
        { id: SCHOOL_INDEX_DOCS[key] },
        {
          $set: {
            id: SCHOOL_INDEX_DOCS[key],
            key,
            data: payload,
            updatedAt: nowIso
          }
        },
        { upsert: true }
      );
      return payload;
    }
  }, `school.index.${key}.save`);
}

function resolveEntityConfig(entityType) {
  const entry = SCHOOL_ENTITY_REGISTRY[String(entityType || '')];
  if (!entry) return null;
  if (entry.alias) return SCHOOL_ENTITY_REGISTRY[entry.alias] || null;
  return entry;
}

function allowsSystemFallbackEntity(entityType) {
  return ['transactionDefinitions', 'feeDefinitions', 'transactionTemplates', 'sessionStatuses',
    'teachingOutlineLevels', 'teachingOutlineSectionTemplates', 'teachingOutlineItems']
    .includes(String(entityType || ''));
}

function buildEntityScope(entityType, requestingUser, accessContext = {}) {
  const allowSystemFallback = allowsSystemFallbackEntity(entityType);
  return buildSchoolListScope(requestingUser, { allowSystemFallback, accessContext });
}

async function resolveLinkedAccountIdsForUser(requestingUser, scope = {}) {
  const personId = toPublicId(scope?.personId);
  if (!personId) return [];
  const orgScope = buildSchoolListScope(requestingUser, { accessContext: { scopeId: 'SCP_ORG' } });
  const personQuery = { personId__eq: personId, page: 1, limit: 100 };
  const linkedIds = new Set();
  const [teachers, staff, students] = await Promise.all([
    schoolRepositories.teachers.list({ query: personQuery, scope: orgScope }),
    schoolRepositories.staff.list({ query: personQuery, scope: orgScope }),
    schoolRepositories.students.list({ query: personQuery, scope: orgScope })
  ]);
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    const accountId = toPublicId(row?.teacherAccountId);
    if (accountId) linkedIds.add(accountId);
  });
  (Array.isArray(staff) ? staff : []).forEach((row) => {
    const accountId = toPublicId(row?.staffAccountId);
    if (accountId) linkedIds.add(accountId);
  });
  (Array.isArray(students) ? students : []).forEach((row) => {
    const accountId = toPublicId(row?.studentAccountId);
    if (accountId) linkedIds.add(accountId);
  });
  return Array.from(linkedIds);
}

async function resolveLinkedTeacherRecordIdsForPerson(requestingUser, scope = {}) {
  const personId = toPublicId(scope?.personId);
  if (!personId) return [];
  const orgScope = buildSchoolListScope(requestingUser, { accessContext: { scopeId: 'SCP_ORG' } });
  const teachers = await schoolRepositories.teachers.list({
    query: { personId__eq: personId, page: 1, limit: 100 },
    scope: orgScope
  });
  return (Array.isArray(teachers) ? teachers : [])
    .map((row) => toPublicId(row?.id))
    .filter(Boolean);
}

async function buildEntityScopeForRequest(entityType, requestingUser, accessContext = {}) {
  const scope = buildEntityScope(entityType, requestingUser, accessContext);
  if (String(entityType || '') === 'schoolAccounts' && scope.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    scope.linkedAccountIds = await resolveLinkedAccountIdsForUser(requestingUser, scope);
  }
  if (String(entityType || '') === 'classes' && scope.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    scope.delivererAliasIds = await resolveLinkedTeacherRecordIdsForPerson(requestingUser, scope);
  }
  return scope;
}

const schoolDataService = {
  fetchData: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type: ${entityType}`);

    const rawQuery = (query && typeof query === 'object') ? query : {};
    const scopedQuery = applyVoidFilter(entityType, applyDefaultFetchLimit(rawQuery, accessContext), accessContext);
    return await config.repository.list({
      query: normalizeQueryOptions(scopedQuery),
      scope: await buildEntityScopeForRequest(entityType, requestingUser, accessContext)
    });
  },

  countData: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type: ${entityType}`);

    const rawQuery = (query && typeof query === 'object') ? query : {};
    const scopedQuery = applyVoidFilter(entityType, rawQuery, accessContext);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(scopedQuery));
    const scope = await buildEntityScopeForRequest(entityType, requestingUser, accessContext);
    const countCacheKey = buildCountCacheKey(entityType, normalizedQuery, scope);
    const cachedValue = getCachedCountValue(countCacheKey);
    if (cachedValue !== null) return cachedValue;

    let totalRows = 0;
    if (typeof config.repository.count === 'function') {
      totalRows = Number(await config.repository.count({
        query: normalizedQuery,
        scope
      }) || 0);
    } else {
      const rows = await config.repository.list({
        query: normalizedQuery,
        scope
      });
      totalRows = Array.isArray(rows) ? rows.length : 0;
    }

    setCachedCountValue(countCacheKey, totalRows);
    return totalRows;
  },

  fetchDataPaged: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type: ${entityType}`);

    const rawQuery = (query && typeof query === 'object') ? query : {};
    const scopedQuery = applyVoidFilter(entityType, rawQuery, accessContext);
    const normalizedQuery = normalizeQueryOptions(scopedQuery);
    const paginationInput = normalizePaginationQuery(normalizedQuery);
    const pageQuery = {
      ...stripPaginationFromQuery(normalizedQuery),
      page: paginationInput.page,
      limit: paginationInput.limit
    };
    const scope = await buildEntityScopeForRequest(entityType, requestingUser, accessContext);

    const [totalRows, rows] = await Promise.all([
      schoolDataService.countData(entityType, scopedQuery, requestingUser, accessContext),
      config.repository.list({
        query: pageQuery,
        scope
      })
    ]);

    return {
      rows: Array.isArray(rows) ? rows : [],
      totalRows,
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  fetchAllData: async (entityType, query, requestingUser, accessContext = {}) => {
    return schoolDataService.fetchData(
      entityType,
      buildUnboundedQuery(query),
      requestingUser,
      { ...accessContext, unbounded: true }
    );
  },

  clearSchoolCountCache,

  addData: async (entityType, data, requestingUser, options = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for add: ${entityType}`);
    await studentSystemIdMigrationLockService.assertWriteAllowed(
      entityType,
      data?.orgId || requestingUser?.activeOrgId,
      options
    );
    const result = await config.repository.create(data, { ...options, requestingUser });
    recordTransactionOperation(options, {
      type: 'create',
      entityType: String(entityType || ''),
      size: Array.isArray(result) ? result.length : 1
    });
    clearSchoolCountCacheOnWrite();
    return result;
  },

  updateData: async (entityType, id, data, requestingUser, options = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for update: ${entityType}`);
    const currentForLock = await config.repository.getById(id, options);
    await studentSystemIdMigrationLockService.assertWriteAllowed(
      entityType,
      currentForLock?.orgId || data?.orgId || requestingUser?.activeOrgId,
      options
    );
    if (isVoidPolicy(entityType) && options.allowVoidMutation !== true) {
      const current = await config.repository.getById(id, options);
      if (current && isVoidRecord(current)) {
        throw new Error('This record is void and cannot be edited. Restore it before making changes.');
      }
    }
    const result = await config.repository.update(id, data, { ...options, requestingUser });
    recordTransactionOperation(options, {
      type: 'update',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
    clearSchoolCountCacheOnWrite();
    return result;
  },

  getDataById: async (entityType, id, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for ID: ${entityType}`);

    const normalizedId = toPublicId(id);
    if (!normalizedId) return null;

    const rows = await config.repository.list({
      query: normalizeQueryOptions({
        id__eq: normalizedId,
        page: 1,
        limit: 1
      }),
      scope: await buildEntityScopeForRequest(entityType, requestingUser, accessContext)
    });

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  },

  deleteData: async (entityType, id, requestingUser, options = {}) => {
    // options.skipDeletionGuard — bypass guard for internal maintenance (e.g. executeDelete API path).
    // options.deletionContext — extra context for composite deletes (e.g. session + classId).
    // options.orgId — org scope override when requestingUser lacks activeOrgId.
    const normalizedType = String(entityType || '');
    if (normalizedType === 'globalTransactions') {
      throw new Error('Global transactions are immutable. Use status/void/reversal operations.');
    }
    if (normalizedType === 'academicLedger') {
      throw new Error('Academic ledger is append-only. Use status/void operations.');
    }
    if (normalizedType === 'academicSnapshots') {
      throw new Error('Academic snapshots are derived records and cannot be deleted here.');
    }
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for delete: ${entityType}`);

    const currentForLock = await config.repository.getById(id, options);
    await studentSystemIdMigrationLockService.assertWriteAllowed(
      normalizedType,
      currentForLock?.orgId || requestingUser?.activeOrgId,
      options
    );

    let voidTarget = null;
    if (isVoidPolicy(normalizedType)) {
      voidTarget = await schoolDataService.getDataById(normalizedType, id, requestingUser, options.accessContext || {});
      if (!voidTarget) throw new Error('Record not found.');
      if (isVoidRecord(voidTarget)) return voidTarget;
    }

    const { schoolDeletionGuardService, resolveEntityKeyFromRepositoryKey } = getDeletionGuardDeps();
    const entityKey = resolveEntityKeyFromRepositoryKey(normalizedType);
    if (entityKey && options.skipDeletionGuard !== true) {
      const orgId = options.orgId || requestingUser?.activeOrgId;
      await schoolDeletionGuardService.assertCanDelete({
        entityKey,
        id,
        orgId,
        reqUser: requestingUser,
        context: options.deletionContext || {}
      });
    }

    if (normalizedType === 'overallReportInstances'
      && Array.isArray(currentForLock?.generatedDocs)
      && currentForLock.generatedDocs.length > 0) {
      const now = new Date().toISOString();
      const archived = await config.repository.update(id, {
        status: 'archived',
        revision: Math.max(1, Number(currentForLock.revision || 1) || 1) + 1,
        audit: {
          ...(currentForLock.audit || {}),
          lastUpdateUser: toPublicId(requestingUser?.id),
          lastUpdateDateTime: now,
          archivedAt: now
        }
      }, { ...options, requestingUser });
      recordTransactionOperation(options, {
        type: 'update',
        entityType: normalizedType,
        id: toPublicId(id)
      });
      clearSchoolCountCacheOnWrite();
      return archived;
    }

    let result;
    if (isVoidPolicy(normalizedType)) {
      result = await config.repository.update(id, buildVoidPatch(
        voidTarget,
        requestingUser,
        options.voidReason || options.reason || 'Deleted by user'
      ), { ...options, requestingUser });
    } else {
      result = await config.repository.remove(id, options);
    }
    recordTransactionOperation(options, {
      type: isVoidPolicy(normalizedType) ? 'void' : 'delete',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
    clearSchoolCountCacheOnWrite();
    return result;
  },

  restoreData: async (entityType, id, requestingUser, options = {}) => {
    const normalizedType = String(entityType || '').trim();
    if (!isVoidPolicy(normalizedType)) throw new Error('This record type does not support restore.');
    const config = resolveEntityConfig(normalizedType);
    if (!config) throw new Error(`Unknown school entity type for restore: ${entityType}`);
    const current = await schoolDataService.getDataById(normalizedType, id, requestingUser, options.accessContext || {});
    if (!current) throw new Error('Record not found.');
    if (!isVoidRecord(current)) return current;
    const restoredStatus = String(options.status || current.statusBeforeVoid || 'active').trim().toLowerCase();
    if (!restoredStatus || restoredStatus === 'void') throw new Error('A valid restored status is required.');
    const result = await config.repository.update(id, {
      ...current,
      status: restoredStatus,
      clearVoidMetadata: true,
      voidedAt: '', voidedBy: '', voidReason: '', statusBeforeVoid: ''
    }, { ...options, requestingUser });
    recordTransactionOperation(options, { type: 'restore', entityType: normalizedType, id: toPublicId(id) });
    clearSchoolCountCacheOnWrite();
    return result;
  },

  purgeData: async (entityType, id, requestingUser, options = {}) => {
    // options.skipDeletionGuard — bypass guard when controller already ran assertCanDelete.
    const normalizedType = String(entityType || '');
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for purge: ${entityType}`);
    if (!toPublicId(id)) throw new Error('Purge requires a valid id.');

    const { schoolDeletionGuardService, resolveEntityKeyFromRepositoryKey } = getDeletionGuardDeps();
    const entityKey = resolveEntityKeyFromRepositoryKey(normalizedType);
    if (entityKey && options.skipDeletionGuard !== true) {
      const orgId = options.orgId || requestingUser?.activeOrgId;
      await schoolDeletionGuardService.assertCanDelete({
        entityKey,
        id,
        orgId,
        reqUser: requestingUser,
        context: options.deletionContext || {}
      });
    }

    const purgeFn = config.repository?.purgeById;
    if (typeof purgeFn === 'function') {
      const result = await purgeFn(id, options);
      recordTransactionOperation(options, {
        type: 'purge',
        entityType: String(entityType || ''),
        id: toPublicId(id),
        size: 1
      });
      clearSchoolCountCacheOnWrite();
      return result;
    }

    throw new Error(`Hard delete is not supported for ${normalizedType}.`);
  },

  /* ----------------------------------------------------------------
    DIRECT FILE DELEGATES (Ensuring Controller has 0 fs logic)
  ---------------------------------------------------------------- */
  getClassSessions: async (classId, requestingUser = null, accessContext = null) => {
    const cls = await schoolDataService.getDataById('classes', classId, requestingUser, accessContext);
    if (!cls) return [];
    const sessions = Array.isArray(cls.sessions) ? cls.sessions : [];
    const sessionIdService = require('./sessionIdService');
    sessionIdService.assertUniqueSessionIds(sessions, `class ${classId}`);
    return sessions;
  },

  saveClassSessions: async (classId, sessions, requestingUser = null, accessContext = null) => {
    const cls = await schoolDataService.getDataById('classes', classId, requestingUser, accessContext);
    if (!cls) throw new Error('Class not found or inaccessible.');
    const sessionIdService = require('./sessionIdService');
    const ensured = sessionIdService.ensureClassSessionIds(classId, Array.isArray(sessions) ? sessions : []);
    const updated = await schoolDataService.updateData('classes', classId, {
      sessions: ensured.sessions
    }, requestingUser);
    return Array.isArray(updated?.sessions) ? updated.sessions : [];
  },

  getTeacherIndex: async () => {
    return await getIndexDoc('teachers');
  },

  getStudentIndex: async () => {
    return await getIndexDoc('students');
  },

  saveTeacherIndex: async (data) => {
    return await saveIndexDoc('teachers', data);
  },

  saveStudentIndex: async (data) => {
    return await saveIndexDoc('students', data);
  },

  getTimesheetByPeriodAndTeacher: async (periodId, teacherId, requestingUser) => {
    const results = await schoolDataService.fetchData(
      'timesheets',
      {
        periodId__eq: periodId,
        teacherId__eq: teacherId,
        limit: 1
      },
      requestingUser
    );
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
  },

  /* ----------------------------------------------------------------
    BACKWARD-COMPATIBLE ACCESS HELPERS
  ---------------------------------------------------------------- */
  getAccessibleSubjects: async (requestingUser) => schoolDataService.fetchAllData('subjects', {}, requestingUser),
  getAccessibleAcademicLedger: async (requestingUser) => schoolDataService.fetchAllData('academicLedger', {}, requestingUser),
  getAccessibleAcademicSnapshots: async (requestingUser) => schoolDataService.fetchAllData('academicSnapshots', {}, requestingUser),
  getAccessibleReportTemplates: async (requestingUser) => schoolDataService.fetchAllData('reportTemplates', {}, requestingUser),
  getAccessibleReportAssignments: async (requestingUser) => schoolDataService.fetchAllData('reportAssignments', {}, requestingUser),
  getAccessibleReportInstances: async (requestingUser) => schoolDataService.fetchAllData('reportInstances', {}, requestingUser),
  getAccessibleOverallReportTemplates: async (requestingUser) => schoolDataService.fetchAllData('overallReportTemplates', {}, requestingUser),
  getAccessibleOverallReportInstances: async (requestingUser) => schoolDataService.fetchAllData('overallReportInstances', {}, requestingUser),
  getAccessibleExamTemplates: async (requestingUser) => schoolDataService.fetchAllData('examTemplates', {}, requestingUser),
  getAccessibleExamRevisions: async (requestingUser) => schoolDataService.fetchAllData('examRevisions', {}, requestingUser),
  getAccessibleExamQuestions: async (requestingUser) => schoolDataService.fetchAllData('examQuestions', {}, requestingUser),
  getAccessibleExamAllocations: async (requestingUser) => schoolDataService.fetchAllData('examAllocations', {}, requestingUser),
  getAccessibleExamAssignments: async (requestingUser) => schoolDataService.fetchAllData('examAssignments', {}, requestingUser),
  getAccessibleExamAttempts: async (requestingUser) => schoolDataService.fetchAllData('examAttempts', {}, requestingUser),
  getAccessibleExamAnswers: async (requestingUser) => schoolDataService.fetchAllData('examAnswers', {}, requestingUser),
  createExamTemplate: async (input, requestingUser, options = {}) =>
    getExamBuilderService().createTemplate(input, requestingUser, options),
  cloneExamTemplateAsRevision: async (sourceTemplateId, input, requestingUser, options = {}) =>
    getExamBuilderService().cloneTemplateAsRevision(sourceTemplateId, input, requestingUser, options),
  createExamDraftRevision: async (templateId, input, requestingUser, options = {}) =>
    getExamBuilderService().createDraftRevision(templateId, input, requestingUser, options),
  updateExamDraftRevision: async (revisionId, updates, requestingUser, options = {}) =>
    getExamBuilderService().updateDraftRevision(revisionId, updates, requestingUser, options),
  saveExamDraftQuestion: async (revisionId, questionInput, requestingUser, options = {}) =>
    getExamBuilderService().saveDraftQuestion(revisionId, questionInput, requestingUser, options),
  deleteExamDraftQuestion: async (revisionId, questionId, requestingUser, options = {}) =>
    getExamBuilderService().deleteDraftQuestion(revisionId, questionId, requestingUser, options),
  publishExamRevision: async (revisionId, payload, requestingUser, options = {}) =>
    getExamBuilderService().publishRevision(revisionId, payload, requestingUser, options),
  createExamAllocation: async (input, requestingUser, options = {}) =>
    getExamBuilderService().createAllocationForPublishedRevision(input, requestingUser, options),
  createExamAssignmentsForAllocation: async (input, requestingUser, options = {}) =>
    getExamBuilderService().createAssignmentsForAllocation(input, requestingUser, options),
  startExamAttempt: async (input, requestingUser, options = {}) =>
    getExamBuilderService().startAttempt(input, requestingUser, options),
  saveExamAttemptAnswer: async (input, requestingUser, options = {}) =>
    getExamBuilderService().saveAttemptAnswer(input, requestingUser, options),
  submitExamAttempt: async (attemptId, input, requestingUser, options = {}) =>
    getExamBuilderService().submitAttempt(attemptId, input, requestingUser, options),
  gradeExamAttemptAnswer: async (answerId, gradingInput, requestingUser, options = {}) =>
    getExamBuilderService().gradeAttemptAnswer(answerId, gradingInput, requestingUser, options),
  getExamRevisionBundle: async (revisionId, requestingUser, options = {}) =>
    getExamBuilderService().getRevisionBundle(revisionId, requestingUser, options),
  getAccessibleClasses: async (requestingUser) => schoolDataService.fetchAllData('classes', {}, requestingUser),
  getAccessibleHolidays: async (requestingUser) => schoolDataService.fetchAllData('holidays', {}, requestingUser),
  getAccessibleTerms: async (requestingUser) => schoolDataService.fetchAllData('terms', {}, requestingUser),
  getAccessibleDepartments: async (requestingUser) => schoolDataService.fetchAllData('departments', {}, requestingUser),
  getAccessibleActivityCategories: async (requestingUser) => schoolDataService.fetchAllData('activityCategories', {}, requestingUser),
  getAccessibleActivities: async (requestingUser) => schoolDataService.fetchAllData('activities', {}, requestingUser),
  getAccessibleTeachers: async (requestingUser) => schoolDataService.fetchAllData('teachers', {}, requestingUser),
  getAccessibleStaff: async (requestingUser) => schoolDataService.fetchAllData('staff', {}, requestingUser),
  getAccessiblePayRates: async (requestingUser) => schoolDataService.fetchAllData('payRates', {}, requestingUser),
  getAccessibleSessionStatuses: async (requestingUser) => schoolDataService.fetchAllData('sessionStatuses', {}, requestingUser),
  getAccessibleTimesheetPeriods: async (requestingUser) => schoolDataService.fetchAllData('timesheetPeriods', {}, requestingUser),
  getAccessibleTimesheets: async (requestingUser) => schoolDataService.fetchAllData('timesheets', {}, requestingUser),
  getAccessibleStudentProgramRegistrations: async (requestingUser) => schoolDataService.fetchAllData('studentProgramRegistrations', {}, requestingUser),
  getAccessibleStudentProgramPriorSubjects: async (requestingUser) =>
    schoolDataService.fetchAllData('studentProgramPriorSubjects', {}, requestingUser),
  getAccessibleStudentTermRegistrations: async (requestingUser) => schoolDataService.fetchAllData('studentTermRegistrations', {}, requestingUser),
  getAccessibleClassEnrollmentPeriods: async (requestingUser) => schoolDataService.fetchAllData('classEnrollmentPeriods', {}, requestingUser),
  getClassEnrollmentPeriodsByOrg: async (orgId, requestingUser, options = {}) => schoolRepositories.classEnrollmentPeriods.findByOrgId(orgId, options),
  getClassEnrollmentPeriodsByClassId: async (classId, requestingUser, options = {}) => schoolRepositories.classEnrollmentPeriods.findByClassId(classId, options),
  getClassEnrollmentPeriodsByStudentId: async (studentId, requestingUser, options = {}) => schoolRepositories.classEnrollmentPeriods.findByStudentId(studentId, options),
  getClassEnrollmentPeriodsByClassIdInRange: async (classId, startDate, endDate, requestingUser, options = {}) =>
    schoolRepositories.classEnrollmentPeriods.findByClassIdInRange(classId, startDate, endDate, options),
  getClassEnrollmentPeriodsByStudentIdInRange: async (studentId, startDate, endDate, requestingUser, options = {}) =>
    schoolRepositories.classEnrollmentPeriods.findByStudentIdInRange(studentId, startDate, endDate, options),
  getActiveClassEnrollmentPeriodsByClassIdOnDate: async (classId, onDate, requestingUser, options = {}) =>
    schoolRepositories.classEnrollmentPeriods.findActiveByClassIdOnDate(classId, onDate, options),
  getActiveClassEnrollmentPeriodsByStudentIdOnDate: async (studentId, onDate, requestingUser, options = {}) =>
    schoolRepositories.classEnrollmentPeriods.findActiveByStudentIdOnDate(studentId, onDate, options),
  createClassEnrollmentPeriod: async (input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().createPeriod(input, requestingUser, options),
  updateClassEnrollmentPeriod: async (periodId, input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().updatePeriod(periodId, input, requestingUser, options),
  get classCycleEnrollmentPolicyService() {
    return getClassCycleEnrollmentPolicyService();
  },
  closeClassEnrollmentPeriod: async (periodId, input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().closePeriod(periodId, input, requestingUser, options),
  reopenClassEnrollmentPeriodViaNewPeriod: async (periodId, input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().reopenViaNewPeriod(periodId, input, requestingUser, options),
  checkClassEnrollmentPeriodOverlap: async (input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().checkOverlap(input, options),
  evaluateClassEnrollmentReentryRules: async (input, requestingUser, options = {}) =>
    getClassEnrollmentPeriodService().evaluateReentryRules(input, options),
  closeClassCycle: async (classId, input, requestingUser, options = {}) =>
    getClassCycleService().closeCycle(classId, input, requestingUser, options),
  createNextClassCycleFromTemplate: async (classId, input, requestingUser, options = {}) =>
    getClassCycleService().createNextCycleFromCurrentClassTemplate(classId, input, requestingUser, options),
  previewNextClassCycleFromTemplate: async (classId, input, requestingUser, options = {}) =>
    getClassCycleService().previewNextCycleFromCurrentClassTemplate(classId, input, options),
  carryForwardClassCycleStudents: async (input, requestingUser, options = {}) =>
    getClassCycleService().carryForwardEligibleStudents(input, requestingUser, options),
  splitClassEnrollmentPeriodsForCycleBoundary: async (input, requestingUser, options = {}) =>
    getClassCycleService().splitPeriodsCrossingCycleBoundary(input, requestingUser, options),
  getAccessibleStudents: async (requestingUser) => schoolDataService.fetchAllData('students', {}, requestingUser),
  getAccessiblePrograms: async (requestingUser) => schoolDataService.fetchAllData('programs', {}, requestingUser),
  getAccessibleTransactionDefinitions: async (requestingUser) => schoolDataService.fetchAllData('transactionDefinitions', {}, requestingUser),
  getAccessibleFeeDefinitions: async (requestingUser) => schoolDataService.fetchAllData('feeDefinitions', {}, requestingUser),
  getAccessibleSchoolAccounts: async (requestingUser) => schoolDataService.fetchAllData('schoolAccounts', {}, requestingUser),
  getAccessibleGlobalTransactions: async (requestingUser) => schoolDataService.fetchAllData('globalTransactions', {}, requestingUser),
  getAccessibleTransactionJournals: async (requestingUser) => schoolDataService.fetchAllData('transactionJournals', {}, requestingUser),
  buildRouteAccessContext(req) {
    return { scopeId: req?.accessScope || '' };
  },
  fetchDataForRequest(req, entityType, query = {}) {
    return schoolDataService.fetchData(entityType, query, req?.user, schoolDataService.buildRouteAccessContext(req));
  },
  getDataByIdForRequest(req, entityType, id) {
    return schoolDataService.getDataById(entityType, id, req?.user, schoolDataService.buildRouteAccessContext(req));
  }
};

module.exports = schoolDataService;

