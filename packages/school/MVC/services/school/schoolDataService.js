const indexModel = require('../../models/school/schoolIndexModel');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const { buildSchoolListScope } = require('./schoolDataScopeBuilder');
const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { recordTransactionOperation } = requireCoreModule('MVC/services/transactionContextService');
const classEnrollmentPeriodService = require('./classEnrollmentPeriodService');
const classCycleService = require('./classCycleService');
const examBuilderService = require('./examBuilderService');

const SCHOOL_ENTITY_REGISTRY = Object.freeze({
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
  teachers: { repository: schoolRepositories.teachers },
  staff: { repository: schoolRepositories.staff },
  payRates: { repository: schoolRepositories.payRates },
  sessionStatuses: { repository: schoolRepositories.sessionStatuses },
  timesheetPeriods: { repository: schoolRepositories.timesheetPeriods },
  timesheets: { repository: schoolRepositories.timesheets },
  studentProgramRegistrations: { repository: schoolRepositories.studentProgramRegistrations },
  studentProgramPriorSubjects: { repository: schoolRepositories.studentProgramPriorSubjects },
  studentTermRegistrations: { repository: schoolRepositories.studentTermRegistrations },
  classEnrollmentPeriods: { repository: schoolRepositories.classEnrollmentPeriods },
  leaveRequests: { repository: schoolRepositories.leaveRequests }
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
  return ['transactionDefinitions', 'feeDefinitions', 'transactionTemplates', 'sessionStatuses']
    .includes(String(entityType || ''));
}

function buildEntityScope(entityType, requestingUser, accessContext = {}) {
  const allowSystemFallback = allowsSystemFallbackEntity(entityType);
  return buildSchoolListScope(requestingUser, { allowSystemFallback, accessContext });
}

const schoolDataService = {
  fetchData: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type: ${entityType}`);

    return await config.repository.list({
      query: normalizeQueryOptions(query),
      scope: buildEntityScope(entityType, requestingUser, accessContext)
    });
  },

  addData: async (entityType, data, requestingUser, options = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for add: ${entityType}`);
    const result = await config.repository.create(data, { ...options, requestingUser });
    recordTransactionOperation(options, {
      type: 'create',
      entityType: String(entityType || ''),
      size: Array.isArray(result) ? result.length : 1
    });
    return result;
  },

  updateData: async (entityType, id, data, requestingUser, options = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for update: ${entityType}`);
    const result = await config.repository.update(id, data, { ...options, requestingUser });
    recordTransactionOperation(options, {
      type: 'update',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
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
      scope: buildEntityScope(entityType, requestingUser, accessContext)
    });

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  },

  deleteData: async (entityType, id, requestingUser, options = {}) => {
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
    if (normalizedType === 'studentProgramRegistrations') {
      throw new Error('Student program registrations cannot be deleted from this service.');
    }
    if (normalizedType === 'studentTermRegistrations') {
      throw new Error('Student term registrations cannot be deleted from this service.');
    }

    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for delete: ${entityType}`);
    const result = await config.repository.remove(id, options);
    recordTransactionOperation(options, {
      type: 'delete',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
    return result;
  },

  purgeData: async (entityType, id, requestingUser, options = {}) => {
    const normalizedType = String(entityType || '');
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown school entity type for purge: ${entityType}`);
    if (!toPublicId(id)) throw new Error('Purge requires a valid id.');

    const purgeFn = config.repository?.purgeById;
    if (typeof purgeFn === 'function') {
      const result = await purgeFn(id, options);
      recordTransactionOperation(options, {
        type: 'purge',
        entityType: String(entityType || ''),
        id: toPublicId(id),
        size: 1
      });
      return result;
    }

    throw new Error(`Hard delete is not supported for ${normalizedType}.`);
  },

  /* ----------------------------------------------------------------
    DIRECT FILE DELEGATES (Ensuring Controller has 0 fs logic)
  ---------------------------------------------------------------- */
  getClassSessions: async (classId, requestingUser = null) => {
    const cls = await schoolDataService.getDataById('classes', classId, requestingUser);
    if (!cls) return [];
    return Array.isArray(cls.sessions) ? cls.sessions : [];
  },

  saveClassSessions: async (classId, sessions, requestingUser = null) => {
    const cls = await schoolDataService.getDataById('classes', classId, requestingUser);
    if (!cls) throw new Error('Class not found or inaccessible.');
    const updated = await schoolDataService.updateData('classes', classId, {
      sessions: Array.isArray(sessions) ? sessions : []
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
  getAccessibleSubjects: async (requestingUser) => schoolDataService.fetchData('subjects', {}, requestingUser),
  getAccessibleAcademicLedger: async (requestingUser) => schoolDataService.fetchData('academicLedger', {}, requestingUser),
  getAccessibleAcademicSnapshots: async (requestingUser) => schoolDataService.fetchData('academicSnapshots', {}, requestingUser),
  getAccessibleReportTemplates: async (requestingUser) => schoolDataService.fetchData('reportTemplates', {}, requestingUser),
  getAccessibleReportAssignments: async (requestingUser) => schoolDataService.fetchData('reportAssignments', {}, requestingUser),
  getAccessibleReportInstances: async (requestingUser) => schoolDataService.fetchData('reportInstances', {}, requestingUser),
  getAccessibleExamTemplates: async (requestingUser) => schoolDataService.fetchData('examTemplates', {}, requestingUser),
  getAccessibleExamRevisions: async (requestingUser) => schoolDataService.fetchData('examRevisions', {}, requestingUser),
  getAccessibleExamQuestions: async (requestingUser) => schoolDataService.fetchData('examQuestions', {}, requestingUser),
  getAccessibleExamAllocations: async (requestingUser) => schoolDataService.fetchData('examAllocations', {}, requestingUser),
  getAccessibleExamAssignments: async (requestingUser) => schoolDataService.fetchData('examAssignments', {}, requestingUser),
  getAccessibleExamAttempts: async (requestingUser) => schoolDataService.fetchData('examAttempts', {}, requestingUser),
  getAccessibleExamAnswers: async (requestingUser) => schoolDataService.fetchData('examAnswers', {}, requestingUser),
  createExamTemplate: async (input, requestingUser, options = {}) =>
    examBuilderService.createTemplate(input, requestingUser, options),
  cloneExamTemplateAsRevision: async (sourceTemplateId, input, requestingUser, options = {}) =>
    examBuilderService.cloneTemplateAsRevision(sourceTemplateId, input, requestingUser, options),
  createExamDraftRevision: async (templateId, input, requestingUser, options = {}) =>
    examBuilderService.createDraftRevision(templateId, input, requestingUser, options),
  updateExamDraftRevision: async (revisionId, updates, requestingUser, options = {}) =>
    examBuilderService.updateDraftRevision(revisionId, updates, requestingUser, options),
  saveExamDraftQuestion: async (revisionId, questionInput, requestingUser, options = {}) =>
    examBuilderService.saveDraftQuestion(revisionId, questionInput, requestingUser, options),
  deleteExamDraftQuestion: async (revisionId, questionId, requestingUser, options = {}) =>
    examBuilderService.deleteDraftQuestion(revisionId, questionId, requestingUser, options),
  publishExamRevision: async (revisionId, payload, requestingUser, options = {}) =>
    examBuilderService.publishRevision(revisionId, payload, requestingUser, options),
  createExamAllocation: async (input, requestingUser, options = {}) =>
    examBuilderService.createAllocationForPublishedRevision(input, requestingUser, options),
  createExamAssignmentsForAllocation: async (input, requestingUser, options = {}) =>
    examBuilderService.createAssignmentsForAllocation(input, requestingUser, options),
  startExamAttempt: async (input, requestingUser, options = {}) =>
    examBuilderService.startAttempt(input, requestingUser, options),
  saveExamAttemptAnswer: async (input, requestingUser, options = {}) =>
    examBuilderService.saveAttemptAnswer(input, requestingUser, options),
  submitExamAttempt: async (attemptId, input, requestingUser, options = {}) =>
    examBuilderService.submitAttempt(attemptId, input, requestingUser, options),
  gradeExamAttemptAnswer: async (answerId, gradingInput, requestingUser, options = {}) =>
    examBuilderService.gradeAttemptAnswer(answerId, gradingInput, requestingUser, options),
  getExamRevisionBundle: async (revisionId, requestingUser, options = {}) =>
    examBuilderService.getRevisionBundle(revisionId, requestingUser, options),
  getAccessibleClasses: async (requestingUser) => schoolDataService.fetchData('classes', {}, requestingUser),
  getAccessibleHolidays: async (requestingUser) => schoolDataService.fetchData('holidays', {}, requestingUser),
  getAccessibleTerms: async (requestingUser) => schoolDataService.fetchData('terms', {}, requestingUser),
  getAccessibleDepartments: async (requestingUser) => schoolDataService.fetchData('departments', {}, requestingUser),
  getAccessibleTeachers: async (requestingUser) => schoolDataService.fetchData('teachers', {}, requestingUser),
  getAccessibleStaff: async (requestingUser) => schoolDataService.fetchData('staff', {}, requestingUser),
  getAccessiblePayRates: async (requestingUser) => schoolDataService.fetchData('payRates', {}, requestingUser),
  getAccessibleSessionStatuses: async (requestingUser) => schoolDataService.fetchData('sessionStatuses', {}, requestingUser),
  getAccessibleTimesheetPeriods: async (requestingUser) => schoolDataService.fetchData('timesheetPeriods', {}, requestingUser),
  getAccessibleTimesheets: async (requestingUser) => schoolDataService.fetchData('timesheets', {}, requestingUser),
  getAccessibleStudentProgramRegistrations: async (requestingUser) => schoolDataService.fetchData('studentProgramRegistrations', {}, requestingUser),
  getAccessibleStudentProgramPriorSubjects: async (requestingUser) =>
    schoolDataService.fetchData('studentProgramPriorSubjects', {}, requestingUser),
  getAccessibleStudentTermRegistrations: async (requestingUser) => schoolDataService.fetchData('studentTermRegistrations', {}, requestingUser),
  getAccessibleClassEnrollmentPeriods: async (requestingUser) => schoolDataService.fetchData('classEnrollmentPeriods', {}, requestingUser),
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
    classEnrollmentPeriodService.createPeriod(input, requestingUser, options),
  closeClassEnrollmentPeriod: async (periodId, input, requestingUser, options = {}) =>
    classEnrollmentPeriodService.closePeriod(periodId, input, requestingUser, options),
  reopenClassEnrollmentPeriodViaNewPeriod: async (periodId, input, requestingUser, options = {}) =>
    classEnrollmentPeriodService.reopenViaNewPeriod(periodId, input, requestingUser, options),
  checkClassEnrollmentPeriodOverlap: async (input, requestingUser, options = {}) =>
    classEnrollmentPeriodService.checkOverlap(input, options),
  evaluateClassEnrollmentReentryRules: async (input, requestingUser, options = {}) =>
    classEnrollmentPeriodService.evaluateReentryRules(input, options),
  closeClassCycle: async (classId, input, requestingUser, options = {}) =>
    classCycleService.closeCycle(classId, input, requestingUser, options),
  createNextClassCycleFromTemplate: async (classId, input, requestingUser, options = {}) =>
    classCycleService.createNextCycleFromCurrentClassTemplate(classId, input, requestingUser, options),
  previewNextClassCycleFromTemplate: async (classId, input, requestingUser, options = {}) =>
    classCycleService.previewNextCycleFromCurrentClassTemplate(classId, input, options),
  carryForwardClassCycleStudents: async (input, requestingUser, options = {}) =>
    classCycleService.carryForwardEligibleStudents(input, requestingUser, options),
  splitClassEnrollmentPeriodsForCycleBoundary: async (input, requestingUser, options = {}) =>
    classCycleService.splitPeriodsCrossingCycleBoundary(input, requestingUser, options),
  getAccessibleStudents: async (requestingUser) => schoolDataService.fetchData('students', {}, requestingUser),
  getAccessiblePrograms: async (requestingUser) => schoolDataService.fetchData('programs', {}, requestingUser),
  getAccessibleTransactionDefinitions: async (requestingUser) => schoolDataService.fetchData('transactionDefinitions', {}, requestingUser),
  getAccessibleFeeDefinitions: async (requestingUser) => schoolDataService.fetchData('feeDefinitions', {}, requestingUser),
  getAccessibleSchoolAccounts: async (requestingUser) => schoolDataService.fetchData('schoolAccounts', {}, requestingUser),
  getAccessibleGlobalTransactions: async (requestingUser) => schoolDataService.fetchData('globalTransactions', {}, requestingUser),
  getAccessibleTransactionJournals: async (requestingUser) => schoolDataService.fetchData('transactionJournals', {}, requestingUser)
};

module.exports = schoolDataService;
