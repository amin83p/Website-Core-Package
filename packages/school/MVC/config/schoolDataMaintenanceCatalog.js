/**
 * Catalog of school collections exposed on the Data Maintenance admin page.
 * deleteStrategy: remove | purge | maintenancePurge | unsupported
 */
const GROUPS = Object.freeze([
  { id: 'people', label: 'People' },
  { id: 'academics', label: 'Academics' },
  { id: 'registrations', label: 'Registrations & Ledger' },
  { id: 'reports', label: 'Reports' },
  { id: 'exams', label: 'Exams' },
  { id: 'finance', label: 'Finance' },
  { id: 'operations', label: 'Operations' }
]);

const DELETE_STRATEGIES = Object.freeze({
  REMOVE: 'remove',
  PURGE: 'purge',
  MAINTENANCE_PURGE: 'maintenancePurge',
  UNSUPPORTED: 'unsupported'
});

const LABEL_FIELDS = Object.freeze({
  students: ['localId', 'personId'],
  teachers: ['employeeNumber', 'personId'],
  staff: ['employeeNumber', 'personId'],
  schoolAccounts: ['name', 'partyId'],
  classes: ['title', 'code'],
  classSessions: ['date', 'classTitle', 'sessionId'],
  subjects: ['name', 'code'],
  programs: ['name', 'code'],
  terms: ['name', 'code'],
  departments: ['name', 'code'],
  holidays: ['name'],
  reportTemplates: ['title'],
  reportAssignments: ['templateId'],
  reportInstances: ['assignmentId'],
  examTemplates: ['title', 'code'],
  examRevisions: ['title'],
  examQuestions: ['promptText'],
  activities: ['title', 'name'],
  activityCategories: ['name'],
  sessionStatuses: ['name', 'code'],
  timesheetPeriods: ['name', 'code'],
  transactionDefinitions: ['name', 'code'],
  transactionJournals: ['description'],
  leaveRequests: ['studentId'],
  tasks: ['title', 'subject'],
  payRates: ['name'],
  withdrawals: ['type', 'studentId'],
  attendanceMatrixPolicy: ['orgId'],
  conductRatingScalePolicy: ['orgId'],
  studentEnrollments: ['key'],
  teacherSchedules: ['key']
});

const SCHOOL_DATA_MAINTENANCE_CATALOG = Object.freeze([
  { entityType: 'funders', label: 'Funders', group: 'people', collectionName: 'schoolFunders', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'students', label: 'Students', group: 'people', collectionName: 'schoolStudents', deleteStrategy: DELETE_STRATEGIES.PURGE, supportsClearAll: false },
  { entityType: 'teachers', label: 'Teachers', group: 'people', collectionName: 'schoolTeachers', deleteStrategy: DELETE_STRATEGIES.PURGE, supportsClearAll: false },
  { entityType: 'staff', label: 'Staff', group: 'people', collectionName: 'schoolStaff', deleteStrategy: DELETE_STRATEGIES.PURGE, supportsClearAll: false },

  { entityType: 'programs', label: 'Programs', group: 'academics', collectionName: 'schoolPrograms', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'terms', label: 'Terms', group: 'academics', collectionName: 'schoolTerms', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'departments', label: 'Departments', group: 'academics', collectionName: 'schoolDepartments', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'subjects', label: 'Subjects', group: 'academics', collectionName: 'schoolSubjects', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'classes', label: 'Classes', group: 'academics', collectionName: 'schoolClasses', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false, cascadeClassSessionAssets: true },
  { entityType: 'classSessions', label: 'Class Sessions', group: 'academics', collectionName: 'schoolClassSessions', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true, storage: 'classSessions' },
  { entityType: 'holidays', label: 'Holidays', group: 'academics', collectionName: 'schoolHolidays', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'classEnrollmentPeriods', label: 'Class Enrollment Periods', group: 'academics', collectionName: 'schoolClassEnrollmentPeriods', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },

  { entityType: 'studentProgramRegistrations', label: 'Program Registrations', group: 'registrations', collectionName: 'schoolStudentProgramRegistrations', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },
  { entityType: 'studentTermRegistrations', label: 'Term Registrations', group: 'registrations', collectionName: 'schoolStudentTermRegistrations', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },
  { entityType: 'studentProgramPriorSubjects', label: 'Prior Subject Credits', group: 'registrations', collectionName: 'schoolStudentProgramPriorSubjects', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'academicLedger', label: 'Academic Ledger', group: 'registrations', collectionName: 'schoolAcademicLedger', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },
  { entityType: 'academicSnapshots', label: 'Academic Snapshots', group: 'registrations', collectionName: 'schoolAcademicSnapshots', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },
  { entityType: 'withdrawals', label: 'Withdrawals', group: 'registrations', collectionName: 'schoolWithdrawals', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true, externalRepository: 'withdrawals' },

  { entityType: 'reportTemplates', label: 'Report Templates', group: 'reports', collectionName: 'schoolReportTemplates', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'reportAssignments', label: 'Report Assignments', group: 'reports', collectionName: 'schoolReportAssignments', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'reportInstances', label: 'Report Instances', group: 'reports', collectionName: 'schoolReportInstances', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },

  { entityType: 'examTemplates', label: 'Exam Templates', group: 'exams', collectionName: 'schoolExamTemplates', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examRevisions', label: 'Exam Revisions', group: 'exams', collectionName: 'schoolExamRevisions', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examQuestions', label: 'Exam Questions', group: 'exams', collectionName: 'schoolExamQuestions', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examAllocations', label: 'Exam Allocations', group: 'exams', collectionName: 'schoolExamAllocations', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examAssignments', label: 'Exam Assignments', group: 'exams', collectionName: 'schoolExamAssignments', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examAttempts', label: 'Exam Attempts', group: 'exams', collectionName: 'schoolExamAttempts', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'examAnswers', label: 'Exam Answers', group: 'exams', collectionName: 'schoolExamAnswers', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },

  { entityType: 'schoolAccounts', label: 'School Accounts', group: 'finance', collectionName: 'schoolAccounts', deleteStrategy: DELETE_STRATEGIES.PURGE, supportsClearAll: false, protectHeadAccounts: true },
  { entityType: 'transactionDefinitions', label: 'Transaction Definitions', group: 'finance', collectionName: 'schoolTransactionDefinitions', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'transactionJournals', label: 'Transaction Journals', group: 'finance', collectionName: 'schoolTransactionJournals', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'globalTransactions', label: 'Global Transactions', group: 'finance', collectionName: 'schoolGlobalTransactions', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },
  { entityType: 'timesheetPeriods', label: 'Timesheet Periods', group: 'finance', collectionName: 'schoolTimesheetPeriods', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'timesheets', label: 'Timesheets', group: 'finance', collectionName: 'schoolTimesheets', deleteStrategy: DELETE_STRATEGIES.MAINTENANCE_PURGE, supportsClearAll: true },

  { entityType: 'activities', label: 'Activities', group: 'operations', collectionName: 'schoolActivities', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'activityCategories', label: 'Activity Categories', group: 'operations', collectionName: 'schoolActivityCategories', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'sessionStatuses', label: 'Session Statuses', group: 'operations', collectionName: 'schoolSessionStatuses', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: false },
  { entityType: 'attendanceMatrixPolicy', label: 'Attendance Matrix Policies', group: 'operations', collectionName: 'schoolAttendanceMatrixPolicy', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true, storage: 'orgPolicy', policyModel: 'attendanceMatrix' },
  { entityType: 'conductRatingScalePolicy', label: 'Conduct Rating Scale Policies', group: 'operations', collectionName: 'schoolConductRatingScalePolicy', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true, storage: 'orgPolicy', policyModel: 'conductRatingScale' },
  { entityType: 'leaveRequests', label: 'Leave Requests', group: 'operations', collectionName: 'schoolLeaveRequests', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'tasks', label: 'Tasks', group: 'operations', collectionName: 'schoolTasks', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'taskRoutingRules', label: 'Task Routing Rules', group: 'operations', collectionName: 'schoolTaskRoutingRules', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'sessionStudentCases', label: 'Session Student Cases', group: 'operations', collectionName: 'schoolSessionStudentCases', deleteStrategy: DELETE_STRATEGIES.REMOVE, supportsClearAll: true },
  { entityType: 'payRates', label: 'Pay Rates', group: 'operations', collectionName: 'schoolPayRates', deleteStrategy: DELETE_STRATEGIES.UNSUPPORTED, supportsClearAll: false, listOnly: true },
  { entityType: 'studentEnrollments', label: 'Student Enrollments Index', group: 'operations', collectionName: 'schoolStudentEnrollments', deleteStrategy: DELETE_STRATEGIES.UNSUPPORTED, supportsClearAll: false, listOnly: true, storage: 'index', indexKey: 'students' },
  { entityType: 'teacherSchedules', label: 'Teacher Schedules Index', group: 'operations', collectionName: 'schoolTeacherSchedules', deleteStrategy: DELETE_STRATEGIES.UNSUPPORTED, supportsClearAll: false, listOnly: true, storage: 'index', indexKey: 'teachers' }
]);

const CATALOG_BY_ENTITY_TYPE = new Map(
  SCHOOL_DATA_MAINTENANCE_CATALOG.map((entry) => [entry.entityType, entry])
);

function getCatalogEntry(entityType) {
  return CATALOG_BY_ENTITY_TYPE.get(String(entityType || '').trim()) || null;
}

function listCatalogEntries() {
  return [...SCHOOL_DATA_MAINTENANCE_CATALOG];
}

function listCatalogGroups() {
  return [...GROUPS];
}

function resolveRowLabel(entityType, row = {}) {
  const fields = LABEL_FIELDS[entityType] || ['name', 'title', 'code', 'id'];
  for (const field of fields) {
    const value = String(row?.[field] || '').trim();
    if (value) return value;
  }
  return String(row?.id || '').trim();
}

function resolveListFields(entityType) {
  const common = ['id', 'status', 'orgId', 'updatedAt'];
  const extras = {
    students: ['localId', 'personId'],
    teachers: ['employeeNumber', 'personId'],
    staff: ['employeeNumber', 'personId'],
    classes: ['title', 'code', 'termId'],
    classSessions: ['classId', 'classTitle', 'date', 'startTime', 'endTime', 'status'],
    reportInstances: ['classId', 'assignmentId', 'studentId'],
    reportAssignments: ['classId', 'templateId'],
    examAllocations: ['classId', 'templateId'],
    examAssignments: ['classId', 'allocationId'],
    examAttempts: ['assignmentId', 'studentId'],
    examAnswers: ['attemptId', 'questionId'],
    globalTransactions: ['accountId', 'direction', 'amount'],
    academicLedger: ['studentId', 'classId', 'entryType'],
    withdrawals: ['studentId', 'type', 'status'],
    schoolAccounts: ['name', 'headCategory', 'partyId'],
    attendanceMatrixPolicy: ['scheduledMinutes'],
    conductRatingScalePolicy: ['levelCount'],
    studentEnrollments: ['key'],
    teacherSchedules: ['key']
  };
  const merged = new Set([...common, ...(extras[entityType] || [])]);
  return [...merged];
}

module.exports = {
  GROUPS,
  DELETE_STRATEGIES,
  SCHOOL_DATA_MAINTENANCE_CATALOG,
  getCatalogEntry,
  listCatalogEntries,
  listCatalogGroups,
  resolveRowLabel,
  resolveListFields
};
