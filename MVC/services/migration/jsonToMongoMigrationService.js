const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { once } = require('events');
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { connectMongo, getMongoCollection, getMongoDbOrNull } = require('../../infrastructure/mongo/mongoConnection');

const PROJECT_ROOT = path.join(__dirname, '../../../');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const WEBSITE_POLICY_SINGLETON_ID = 'website-policy';
const SOURCE_COUNT_CACHE = new Map();
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
let mongoDriver = null;

const GENERATED_FILE_PATTERNS = [
  /\.report\.json$/i,
  /(^|\/)mongoInsert-[^/]+\.json$/i,
  /(^|\/).*contract-audit\.report\.json$/i,
  /(^|\/)benchpath\/reference\/benchpath-.*(report|audit|map)\.json$/i,
  /(^|\/)(hard-delete|migrate|reset|backfill|audit|scaffold|extraction).*\.json$/i
];

const DERIVED_JSON_FILES = new Map([
  ['tasks.json', 'Derived task summary registry; full task JSON files are canonical.'],
  ['ielts/scoring/index.json', 'Derived IELTS scoring session index; session files are canonical.']
]);

function toPublicString(value) {
  return String(value == null ? '' : value).trim();
}

function toPositiveInt(value, fallback = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeToken(value) {
  return toPublicString(value).toLowerCase();
}

function toRelativeDataPath(filePath = '') {
  return path.relative(DATA_ROOT, filePath).replace(/\\/g, '/');
}

function loadMongoDriver() {
  if (mongoDriver) return mongoDriver;
  try {
    // Lazy-load so JSON mode does not require mongodb package at runtime.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    mongoDriver = require('mongodb');
    return mongoDriver;
  } catch (error) {
    const help = 'Install package "mongodb" and ensure dependencies are up to date.';
    throw new Error(`MongoDB driver is not available. ${help} Original: ${error.message}`);
  }
}

function inferDbNameFromUri(uri = '') {
  const safeUri = toPublicString(uri);
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = toPublicString(parsed.pathname).replace(/^\/+/, '');
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function normalizeMongoSearchParams(searchParams = new URLSearchParams()) {
  const rows = [];
  for (const [key, value] of searchParams.entries()) {
    rows.push([String(key || '').toLowerCase(), String(value || '')]);
  }
  return rows
    .sort((left, right) => {
      if (left[0] === right[0]) return left[1].localeCompare(right[1]);
      return left[0].localeCompare(right[0]);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function parseMongoUriIdentity(uri = '') {
  const safeUri = toPublicString(uri);
  if (!safeUri) return null;
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    return {
      protocol: String(parsed.protocol || '').toLowerCase(),
      username: decodeURIComponent(String(parsed.username || '')),
      password: decodeURIComponent(String(parsed.password || '')),
      hosts: String(parsed.host || '')
        .split(',')
        .map((part) => String(part || '').trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join(','),
      search: normalizeMongoSearchParams(parsed.searchParams)
    };
  } catch (_) {
    return null;
  }
}

function mongoUrisLikelySameDeployment(sourceUri = '', destinationUri = '') {
  const sourceRaw = toPublicString(sourceUri).toLowerCase();
  const destinationRaw = toPublicString(destinationUri).toLowerCase();
  if (!sourceRaw || !destinationRaw) return false;
  if (sourceRaw === destinationRaw) return true;

  const left = parseMongoUriIdentity(sourceUri);
  const right = parseMongoUriIdentity(destinationUri);
  if (!left || !right) return false;

  return left.protocol === right.protocol
    && left.username === right.username
    && left.password === right.password
    && left.hosts === right.hosts
    && left.search === right.search;
}

function assertCopyCollectionName(value = '') {
  const name = toPublicString(value);
  if (!name) throw new Error('Collection is required.');
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error('Collection name contains invalid characters.');
  }
  if (name.startsWith('system.')) {
    throw new Error('System collections are not allowed in this tool.');
  }
  return name;
}

async function runWithConcurrency(items = [], limit = 4, worker = async () => null) {
  const rows = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit || 1));
  const results = new Array(rows.length);
  let index = 0;

  async function next() {
    while (index < rows.length) {
      const current = index;
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      results[current] = await worker(rows[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => next()));
  return results;
}

function buildPagination(totalItems = 0, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const safeTotal = Math.max(0, Number(totalItems || 0));
  const safePageSize = toPositiveInt(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const start = safeTotal > 0 ? ((currentPage - 1) * safePageSize) + 1 : 0;
  const end = safeTotal > 0 ? Math.min(currentPage * safePageSize, safeTotal) : 0;
  return { currentPage, totalPages, totalItems: safeTotal, pageSize: safePageSize, startItem: start, endItem: end };
}

function buildCatalog() {
  const items = [
    // Core
    { key: 'core.users', domain: 'Core', section: 'Users', source: 'users.json', collection: 'users' },
    { key: 'core.persons', domain: 'Core', section: 'Persons', source: 'persons.json', collection: 'persons' },
    { key: 'core.organizations', domain: 'Core', section: 'Organizations', source: 'organizations.json', collection: 'organizations' },
    { key: 'core.contracts', domain: 'Core', section: 'Contracts', source: 'contracts.json', collection: 'contracts' },
    { key: 'core.sections', domain: 'Core', section: 'Sections', source: 'sections.json', collection: 'sections' },
    { key: 'core.operations', domain: 'Core', section: 'Operations', source: 'operations.json', collection: 'operations' },
    { key: 'core.roles', domain: 'Core', section: 'Roles', source: 'roles.json', collection: 'roles' },
    { key: 'core.scopes', domain: 'Core', section: 'Scopes', source: 'scopes.json', collection: 'scopes' },
    { key: 'core.accesses', domain: 'Core', section: 'Access Profiles', source: 'accesses.json', collection: 'accesses' },
    { key: 'core.accessPolicies', domain: 'Core', section: 'Access Policies', source: 'accessPolicies.json', collection: 'accessPolicies' },
    { key: 'core.tableSettings', domain: 'Core', section: 'Table Settings', source: 'tableSettings.json', collection: 'tableSettings' },
    { key: 'core.orgPolicies', domain: 'Core', section: 'Organization Policies', source: 'orgPolicies.json', collection: 'orgPolicies' },
    { key: 'core.symbols', domain: 'Core', section: 'Symbols', source: 'symbols.json', collection: 'symbols' },
    { key: 'core.sessions', domain: 'Core', section: 'Sessions', source: 'sessions.json', collection: 'sessions' },
    { key: 'core.news', domain: 'Core', section: 'News', source: 'news.json', collection: 'news' },
    { key: 'core.newsCategories', domain: 'Core', section: 'News Categories', source: 'newsCategories.json', collection: 'newsCategories' },
    { key: 'core.contacts', domain: 'Core', section: 'Contact Messages', source: 'contactMessages.json', collection: 'contacts' },
    { key: 'core.newsletterSubscriptions', domain: 'Core', section: 'Newsletter Subscriptions', source: 'newsletterSubscriptions.json', collection: 'newsletterSubscriptions' },
    { key: 'core.subscriptionGroups', domain: 'Core', section: 'Subscription Groups', source: 'subscriptionGroups.json', collection: 'subscriptionGroups' },
    { key: 'core.chatConversations', domain: 'Core', section: 'Chat Conversations', source: 'conversations.json', collection: 'chatConversations' },
    {
      key: 'core.tasks',
      domain: 'Core',
      section: 'Tasks',
      source: 'tasks',
      sourceType: 'json_directory',
      collection: 'tasks',
      summaryFile: 'tasks.json',
      notes: 'Full task files are canonical; tasks.json is regenerated as a summary registry on export.'
    },
    { key: 'core.helpArticles', domain: 'Core', section: 'Help Articles', source: 'helpArticles.json', collection: 'helpArticles' },
    { key: 'core.emailManagementTemplates', domain: 'Core', section: 'Email Templates', source: 'emailManagementTemplates.json', collection: 'emailManagementTemplates' },
    { key: 'core.emailLedger', domain: 'Core', section: 'Email Ledger', source: 'emailLedger.json', collection: 'emailLedger' },
    { key: 'core.userMemberships', domain: 'Core', section: 'User Memberships', source: 'userMemberships.json', collection: 'userMemberships' },
    { key: 'core.userDateTime', domain: 'Core', section: 'User Date/Time Constraints', source: 'userDateTime.json', collection: 'userDateTime' },
    { key: 'core.passwordResetCodes', domain: 'Core', section: 'Password Reset Codes', source: 'passwordResetCodes.json', collection: 'passwordResetCodes', optional: true, notes: 'Security-sensitive transient codes.' },
    { key: 'credit.customers', domain: 'Credit', section: 'Customers', source: 'credit/customers.json', collection: 'creditCustomers' },
    {
      key: 'core.websitePolicy',
      domain: 'Core',
      section: 'Website Policy',
      source: 'websitePolicy.json',
      collection: 'websitePolicy',
      sourceFormat: 'single_object',
      transformRecord: (record) => ({ ...(record || {}), id: WEBSITE_POLICY_SINGLETON_ID }),
      inverseTransformRecord: (record) => {
        const next = { ...(record || {}) };
        if (next.id === WEBSITE_POLICY_SINGLETON_ID) delete next.id;
        return next;
      }
    },
    {
      key: 'core.systemSettings',
      domain: 'Core',
      section: 'System Settings',
      source: 'systemSettings.json',
      collection: 'systemSettings',
      sourceFormat: 'single_object',
      transformRecord: (record) => ({ ...(record || {}), id: 'system-settings' }),
      inverseTransformRecord: (record) => {
        const next = { ...(record || {}) };
        if (next.id === 'system-settings') delete next.id;
        return next;
      }
    },
    {
      key: 'core.publicPageContentSettings',
      domain: 'Core',
      section: 'Public Page Content Settings',
      source: 'publicPageContentSettings.json',
      collection: 'publicPageContentSettings',
      sourceFormat: 'single_object',
      transformRecord: (record) => ({ ...(record || {}), id: 'public-page-content' }),
      inverseTransformRecord: (record) => {
        const next = { ...(record || {}) };
        delete next._id;
        return next;
      }
    },
    {
      key: 'core.logs',
      domain: 'Core',
      section: 'Logs',
      source: 'logs.json',
      collection: 'logs',
      optional: true,
      notes: 'Optional (ephemeral).'
    },
    {
      key: 'core.actionStates',
      domain: 'Core',
      section: 'Action States',
      source: 'actionStates.json',
      collection: 'actionStates',
      optional: true,
      notes: 'Optional (ephemeral).'
    },

    // School
    { key: 'school.students', domain: 'School', section: 'Students', source: 'school/students.json', collection: 'schoolStudents' },
    { key: 'school.programs', domain: 'School', section: 'Programs', source: 'school/programs.json', collection: 'schoolPrograms' },
    { key: 'school.transactionDefinitions', domain: 'School', section: 'Transaction Definitions', source: 'school/transactionDefinitions.json', collection: 'schoolTransactionDefinitions' },
    { key: 'school.accounts', domain: 'School', section: 'School Accounts', source: 'school/accounts.json', collection: 'schoolAccounts' },
    { key: 'school.globalTransactions', domain: 'School', section: 'Global Transactions', source: 'school/globalTransactionLedger.json', collection: 'schoolGlobalTransactions' },
    { key: 'school.transactionJournals', domain: 'School', section: 'Transaction Journals', source: 'school/transactionJournals.json', collection: 'schoolTransactionJournals' },
    { key: 'school.academicLedger', domain: 'School', section: 'Academic Ledger', source: 'school/academicLedger.json', collection: 'schoolAcademicLedger' },
    { key: 'school.academicSnapshots', domain: 'School', section: 'Academic Snapshots', source: 'school/academicSnapshots.json', collection: 'schoolAcademicSnapshots' },
    {
      key: 'school.studentProgramPriorSubjects',
      domain: 'School',
      section: 'Prior Subject Credits',
      source: 'school/studentProgramPriorSubjects.json',
      collection: 'schoolStudentProgramPriorSubjects'
    },
    { key: 'school.reportTemplates', domain: 'School', section: 'Report Templates', source: 'school/reportTemplates.json', collection: 'schoolReportTemplates' },
    { key: 'school.reportAssignments', domain: 'School', section: 'Report Assignments', source: 'school/reportAssignments.json', collection: 'schoolReportAssignments' },
    { key: 'school.reportInstances', domain: 'School', section: 'Report Instances', source: 'school/reportInstances.json', collection: 'schoolReportInstances' },
    { key: 'school.subjects', domain: 'School', section: 'Subjects', source: 'school/subjects.json', collection: 'schoolSubjects' },
    { key: 'school.classes', domain: 'School', section: 'Classes', source: 'school/classes.json', collection: 'schoolClasses' },
    { key: 'school.holidays', domain: 'School', section: 'Holidays', source: 'school/holidays.json', collection: 'schoolHolidays' },
    { key: 'school.terms', domain: 'School', section: 'Terms', source: 'school/terms.json', collection: 'schoolTerms' },
    { key: 'school.departments', domain: 'School', section: 'Departments', source: 'school/departments.json', collection: 'schoolDepartments' },
    { key: 'school.teachers', domain: 'School', section: 'Teachers', source: 'school/teachers.json', collection: 'schoolTeachers' },
    { key: 'school.staff', domain: 'School', section: 'Staff', source: 'school/staff.json', collection: 'schoolStaff' },
    { key: 'school.payRates', domain: 'School', section: 'Pay Rates', source: 'school/payRates.json', collection: 'schoolPayRates' },
    { key: 'school.sessionStatuses', domain: 'School', section: 'Session Statuses', source: 'school/sessionStatuses.json', collection: 'schoolSessionStatuses' },
    { key: 'school.timesheetPeriods', domain: 'School', section: 'Timesheet Periods', source: 'school/timesheetPeriods.json', collection: 'schoolTimesheetPeriods' },
    { key: 'school.timesheets', domain: 'School', section: 'Timesheets', source: 'school/timesheets.json', collection: 'schoolTimesheets' },
    { key: 'school.studentProgramRegistrations', domain: 'School', section: 'Program Registrations', source: 'school/studentProgramRegistrations.json', collection: 'schoolStudentProgramRegistrations' },
    { key: 'school.studentTermRegistrations', domain: 'School', section: 'Term Registrations', source: 'school/studentTermRegistrations.json', collection: 'schoolStudentTermRegistrations' },
    { key: 'school.classEnrollmentPeriods', domain: 'School', section: 'Class Enrollment Periods', source: 'school/classEnrollmentPeriods.json', collection: 'schoolClassEnrollmentPeriods' },
    { key: 'school.studentEnrollments', domain: 'School', section: 'Student Enrollments', source: 'school/student_enrollments.json', collection: 'schoolStudentEnrollments' },
    { key: 'school.feeDefinitions', domain: 'School', section: 'Fee Definitions', source: 'school/feeDefinitions.json', collection: 'schoolFeeDefinitions' },
    { key: 'school.teacherSchedules', domain: 'School', section: 'Teacher Schedules', source: 'school/teacher_schedules.json', collection: 'schoolTeacherSchedules' },
    { key: 'school.withdrawals', domain: 'School', section: 'Withdrawals', source: 'school/withdrawals.json', collection: 'schoolWithdrawals' },
    { key: 'school.examTemplates', domain: 'School', section: 'Exam Templates', source: 'school/examTemplates.json', collection: 'schoolExamTemplates' },
    { key: 'school.examRevisions', domain: 'School', section: 'Exam Revisions', source: 'school/examRevisions.json', collection: 'schoolExamRevisions' },
    { key: 'school.examQuestions', domain: 'School', section: 'Exam Questions', source: 'school/examQuestions.json', collection: 'schoolExamQuestions' },
    { key: 'school.examAllocations', domain: 'School', section: 'Exam Allocations', source: 'school/examAllocations.json', collection: 'schoolExamAllocations' },
    { key: 'school.examAssignments', domain: 'School', section: 'Exam Assignments', source: 'school/examAssignments.json', collection: 'schoolExamAssignments' },
    { key: 'school.examAttempts', domain: 'School', section: 'Exam Attempts', source: 'school/examAttempts.json', collection: 'schoolExamAttempts' },
    { key: 'school.examAnswers', domain: 'School', section: 'Exam Answers', source: 'school/examAnswers.json', collection: 'schoolExamAnswers' },
    {
      key: 'school.subjectStructures',
      domain: 'School',
      section: 'Subject Structures',
      source: 'school/subjects_storage',
      sourceType: 'json_directory',
      recursive: true,
      collection: 'schoolSubjectStructures',
      transformRecord: (record, context = {}) => {
        const relativePath = toPublicString(context.relativePath || context.fileName);
        const subjectId = relativePath.split('/').filter(Boolean)[0] || '';
        return {
          ...(record || {}),
          id: toPublicString(record?.id || relativePath || context.fileStem),
          subjectId,
          sourcePath: relativePath
        };
      },
      inverseTransformRecord: (record) => {
        const next = { ...(record || {}) };
        delete next._id;
        return next;
      },
      exportRelativePath: (doc, index) => {
        const sourcePath = toPublicString(doc?.sourcePath);
        if (sourcePath) return sourcePath;
        const subjectId = sanitizeFileName(doc?.subjectId || doc?.id || `subject_${index + 1}`);
        return `${subjectId}/structure.json`;
      }
    },
    {
      key: 'school.attendanceMatrixPolicy',
      domain: 'School',
      section: 'Attendance Matrix Policy',
      source: 'school/attendanceMatrixPolicy.json',
      collection: 'schoolAttendanceMatrixPolicy',
      sourceFormat: 'single_object',
      transformRecord: (record) => ({ ...(record || {}), id: 'attendance-matrix-policy' }),
      inverseTransformRecord: (record) => {
        const next = { ...(record || {}) };
        if (next.id === 'attendance-matrix-policy') delete next.id;
        return next;
      }
    },

    // IELTS
    { key: 'ielts.task2Samples', domain: 'IELTS', section: 'Task 2 Samples', source: 'ielts/task2samples.json', collection: 'ieltsTask2Samples' },
    { key: 'ielts.microAssessments', domain: 'IELTS', section: 'Micro Assessments', source: 'ielts/microAssessments.json', collection: 'ieltsMicroAssessments' },
    { key: 'ielts.prompts', domain: 'IELTS', section: 'Prompts', source: 'ielts/prompts.json', collection: 'ieltsPrompts' },
    { key: 'ielts.apiProviders', domain: 'IELTS', section: 'API Providers', source: 'ielts/apiProviders.json', collection: 'ieltsApiProviders' },
    { key: 'ielts.aiInteractions', domain: 'IELTS', section: 'AI Interactions', source: 'ielts/aiInteractions.json', collection: 'ieltsAiInteractions' },
    { key: 'ielts.aiTokenUsages', domain: 'IELTS', section: 'AI Token Usages', source: 'ielts/aiTokenUsages.json', collection: 'ieltsAiTokenUsages' },
    {
      key: 'ielts.scoringHistory',
      domain: 'IELTS',
      section: 'Scoring Sessions',
      source: 'ielts/scoring/sessions',
      sourceType: 'json_directory',
      collection: 'ieltsScoringHistory',
      idField: 'sessionId',
      transformRecord: (record, context = {}) => {
        const sessionId = toPublicString(record?.id || record?.sessionId || context?.fileStem);
        return {
          ...(record || {}),
          id: sessionId,
          sessionId
        };
      }
    },

    // BenchPath
    { key: 'benchpath.sources', domain: 'BenchPath', section: 'Sources', source: 'benchpath/reference/source.json', sourceFormat: 'items_by_id', collection: 'benchpathSources' },
    { key: 'benchpath.sourceFragments', domain: 'BenchPath', section: 'Source Fragments', source: 'benchpath/reference/source-fragments.json', sourceFormat: 'items_by_id', collection: 'benchpathSourceFragments' },
    { key: 'benchpath.clbFrameworks', domain: 'BenchPath', section: 'CLB Frameworks', source: 'benchpath/reference/clb.framework.json', sourceFormat: 'items_by_id', collection: 'benchpathClbFrameworks' },
    { key: 'benchpath.clbStages', domain: 'BenchPath', section: 'CLB Stages', source: 'benchpath/reference/clb.stages.json', sourceFormat: 'items_by_id', collection: 'benchpathClbStages' },
    { key: 'benchpath.clbSkills', domain: 'BenchPath', section: 'CLB Skills', source: 'benchpath/reference/clb.skills.json', sourceFormat: 'items_by_id', collection: 'benchpathClbSkills' },
    { key: 'benchpath.clbCompetencyAreas', domain: 'BenchPath', section: 'CLB Competency Areas', source: 'benchpath/reference/clb.competency-areas.json', sourceFormat: 'items_by_id', collection: 'benchpathClbCompetencyAreas' },
    { key: 'benchpath.clbBenchmarks', domain: 'BenchPath', section: 'CLB Benchmarks', source: 'benchpath/reference/clb.benchmarks.json', sourceFormat: 'items_by_id', collection: 'benchpathClbBenchmarks' },
    { key: 'benchpath.clbCompetencies', domain: 'BenchPath', section: 'CLB Competencies', source: 'benchpath/reference/clb.competencies.json', sourceFormat: 'items_by_id', collection: 'benchpathClbCompetencies' },
    { key: 'benchpath.clbIndicators', domain: 'BenchPath', section: 'CLB Indicators', source: 'benchpath/reference/clb.indicators.json', sourceFormat: 'items_by_id', collection: 'benchpathClbIndicators' },
    { key: 'benchpath.clbProfileOfAbility', domain: 'BenchPath', section: 'CLB Profile of Ability', source: 'benchpath/reference/clb.profile-of-ability.json', sourceFormat: 'items_by_id', collection: 'benchpathClbProfileOfAbility' },
    { key: 'benchpath.clbFeaturesOfCommunication', domain: 'BenchPath', section: 'CLB Features of Communication', source: 'benchpath/reference/clb.features-of-communication.json', sourceFormat: 'items_by_id', collection: 'benchpathClbFeaturesOfCommunication' },
    { key: 'benchpath.clbSampleTaskLabels', domain: 'BenchPath', section: 'CLB Sample Task Labels', source: 'benchpath/reference/clb.sample-task-labels.json', sourceFormat: 'items_by_id', collection: 'benchpathClbSampleTaskLabels' },
    { key: 'benchpath.tasks', domain: 'BenchPath', section: 'Runtime Tasks', source: 'benchpath/runtime/tasks.json', sourceFormat: 'items_by_id', collection: 'benchpathTasks' }
    ,

    // Activity Quota
    { key: 'activityQuota.packages', domain: 'Activity Quota', section: 'Packages', source: 'activityQuotaPackages.json', collection: 'activityQuotaPackages' },
    { key: 'activityQuota.packageAssignments', domain: 'Activity Quota', section: 'Package Assignments', source: 'activityQuotaPackageAssignments.json', collection: 'activityQuotaPackageAssignments' },
    { key: 'activityQuota.consumptionDefinitions', domain: 'Activity Quota', section: 'Consumption Definitions', source: 'activityQuotaConsumptionDefinitions.json', collection: 'activityQuotaConsumptionDefinitions' },
    { key: 'activityQuota.ledger', domain: 'Activity Quota', section: 'Ledger', source: 'activityQuotaLedger.json', collection: 'activityQuotaLedger' },
    { key: 'activityQuota.creditGroups', domain: 'Activity Quota', section: 'Credit Groups', source: 'activityQuotaCreditGroups.json', collection: 'activityQuotaCreditGroups' },
    { key: 'activityQuota.creditLots', domain: 'Activity Quota', section: 'Credit Lots', source: 'quotaCreditLots.json', collection: 'quotaCreditLots' },
    { key: 'activityQuota.balanceSnapshots', domain: 'Activity Quota', section: 'Balance Snapshots', source: 'quotaBalanceSnapshots.json', collection: 'quotaBalanceSnapshots' }
  ];

  return items.map((item) => ({
    sourceType: 'json_file',
    sourceFormat: 'auto',
    idField: 'id',
    optional: false,
    ...item
  }));
}

function resolveSourcePath(item) {
  return path.join(DATA_ROOT, item.source);
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
}

function extractRecordsFromPayload(payload, sourceFormat = 'auto') {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === 'object') {
    const hasItemsById = payload.itemsById && typeof payload.itemsById === 'object' && !Array.isArray(payload.itemsById);
    const hasAllIds = Array.isArray(payload.allIds);

    if (sourceFormat === 'items_by_id' || (sourceFormat === 'auto' && hasItemsById)) {
      if (hasAllIds) {
        return payload.allIds.map((id) => payload.itemsById[id]).filter((item) => item && typeof item === 'object');
      }
      return Object.values(payload.itemsById).filter((item) => item && typeof item === 'object');
    }

    if (sourceFormat === 'single_object') {
      return [payload];
    }

    if (sourceFormat === 'auto') return [payload];
  }

  return [];
}

async function loadSourceRecords(item) {
  const warnings = [];
  const sourcePath = resolveSourcePath(item);

  if (item.sourceType === 'json_directory') {
    const jsonFiles = await listDirectoryJsonFiles(sourcePath, { recursive: item.recursive === true });
    const allRecords = [];
    for (const relativeFilePath of jsonFiles) {
      const fileName = path.basename(relativeFilePath);
      const filePath = path.join(sourcePath, relativeFilePath);
      try {
        const payload = await readJsonFile(filePath);
        const fileStem = fileName.replace(/\.json$/i, '');
        const fileRecords = extractRecordsFromPayload(payload, item.sourceFormat);
        fileRecords.forEach((record, index) => {
          allRecords.push({
            record,
            context: {
              fileName,
              fileStem,
              relativePath: relativeFilePath.replace(/\\/g, '/'),
              indexInFile: index
            }
          });
        });
      } catch (error) {
        warnings.push(`Failed to parse ${relativeFilePath}: ${error.message}`);
      }
    }
    return { records: allRecords, warnings };
  }

  try {
    const payload = await readJsonFile(sourcePath);
    const records = extractRecordsFromPayload(payload, item.sourceFormat).map((record, index) => ({
      record,
      context: { fileName: path.basename(sourcePath), fileStem: path.basename(sourcePath, path.extname(sourcePath)), indexInFile: index }
    }));
    return { records, warnings };
  } catch (error) {
    if (error.code === 'ENOENT') return { records: [], warnings: ['Source file does not exist.'] };
    throw error;
  }
}

function normalizeForMigration(item, loadedRecords = []) {
  const warnings = [];
  const byId = new Map();
  let skippedInvalid = 0;
  let skippedMissingId = 0;

  loadedRecords.forEach((entry, idx) => {
    const rawRecord = entry?.record;
    const context = entry?.context || {};
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
      skippedInvalid += 1;
      return;
    }

    const transformed = typeof item.transformRecord === 'function'
      ? item.transformRecord({ ...rawRecord }, context)
      : { ...rawRecord };
    if (!transformed || typeof transformed !== 'object' || Array.isArray(transformed)) {
      skippedInvalid += 1;
      return;
    }

    const rawId = transformed?.id ?? transformed?.[item.idField] ?? context?.fileStem;
    const id = toPublicString(rawId);
    if (!id) {
      skippedMissingId += 1;
      return;
    }

    if (byId.has(id)) {
      warnings.push(`Duplicate id "${id}" found. Latest record was kept.`);
    }
    const doc = { ...transformed, id };
    delete doc._id;
    byId.set(id, doc);
  });

  return {
    docs: [...byId.values()],
    warnings,
    stats: {
      sourceCount: loadedRecords.length,
      uniqueValidCount: byId.size,
      skippedInvalid,
      skippedMissingId
    }
  };
}

function chunkArray(items, size = 500) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sanitizeFileName(name) {
  return String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 140);
}

function getDirectoryRecordId(item, doc, index = 0) {
  const candidate = toPublicString(doc?.[item.idField] || doc?.id || doc?.sessionId || '');
  if (candidate) return candidate;
  return `record_${String(index + 1).padStart(4, '0')}`;
}

async function listDirectoryJsonFiles(dirPath, options = {}) {
  const recursive = options?.recursive === true;
  try {
    const names = await fs.readdir(dirPath, { withFileTypes: true });
    const out = [];
    for (const entry of names) {
      const name = String(entry.name || '');
      const fullPath = path.join(dirPath, name);
      if (entry.isDirectory() && recursive) {
        // eslint-disable-next-line no-await-in-loop
        const childRows = await listDirectoryJsonFiles(fullPath, options);
        childRows.forEach((child) => out.push(`${name}/${child}`));
      } else if (entry.isFile() && name.toLowerCase().endsWith('.json')) {
        out.push(name);
      }
    }
    return out.sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function sortByIdStable(item, docs = []) {
  const rows = Array.isArray(docs) ? docs : [];
  return [...rows].sort((left, right) => {
    const leftId = toPublicString(left?.[item.idField] || left?.id);
    const rightId = toPublicString(right?.[item.idField] || right?.id);
    return leftId.localeCompare(rightId);
  });
}

async function ensureMongoReady() {
  const runtimeBackend = resolveDataBackendConfig(process.env);

  if (!runtimeBackend?.mongo?.ready) {
    throw new Error('Mongo URI is not configured. Set MONGODB_URI in deployment variables, then restart the app. Legacy MONGO_URI is still supported temporarily.');
  }

  await connectMongo({ uri: runtimeBackend.mongo.uri });
  return runtimeBackend;
}

async function loadMongoRecords(item) {
  const collection = getMongoCollection(item.collection);
  const rows = await collection.find({}, { projection: { _id: 0 } }).toArray();
  const warnings = [];
  const docs = [];
  let skippedInvalid = 0;

  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      skippedInvalid += 1;
      continue;
    }
    const base = { ...row };
    delete base._id;
    const transformed = typeof item.inverseTransformRecord === 'function'
      ? item.inverseTransformRecord(base)
      : base;
    if (!transformed || typeof transformed !== 'object' || Array.isArray(transformed)) {
      skippedInvalid += 1;
      continue;
    }
    docs.push(transformed);
  }

  if (skippedInvalid > 0) {
    warnings.push(`Skipped ${skippedInvalid} invalid Mongo documents while preparing export.`);
  }
  return { docs, warnings, stats: { mongoCount: rows.length, validCount: docs.length, skippedInvalid } };
}

function buildItemsByIdPayload(item, docs = [], existingPayload = null) {
  const base = (existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload))
    ? { ...existingPayload }
    : {};
  const sorted = sortByIdStable(item, docs);
  const itemsById = {};
  const allIds = [];
  const warnings = [];
  let skippedMissingId = 0;

  sorted.forEach((doc) => {
    const next = doc && typeof doc === 'object' ? { ...doc } : null;
    if (!next) return;
    const id = toPublicString(next?.[item.idField] || next?.id);
    if (!id) {
      skippedMissingId += 1;
      return;
    }
    next.id = id;
    delete next._id;
    itemsById[id] = next;
    allIds.push(id);
  });

  if (skippedMissingId > 0) {
    warnings.push(`Skipped ${skippedMissingId} documents without "${item.idField || 'id'}" for itemsById payload.`);
  }

  base.itemsById = itemsById;
  base.allIds = allIds;
  if (Object.prototype.hasOwnProperty.call(base, 'indexes')) {
    base.indexes = {};
    warnings.push('Cleared indexes on export. Rebuild indexes inside entity models after switching to file backend.');
  }

  return { payload: base, warnings, writtenCount: allIds.length, skippedMissingId };
}

function buildJsonFilePayload(item, docs = [], existingPayload = null) {
  const format = String(item?.sourceFormat || 'auto').trim().toLowerCase();
  if (format === 'items_by_id') {
    return buildItemsByIdPayload(item, docs, existingPayload);
  }

  if (format === 'single_object') {
    const sorted = sortByIdStable(item, docs);
    const warnings = [];
    if (sorted.length > 1) {
      warnings.push(`Found ${sorted.length} Mongo documents for single_object source; exported the first one.`);
    }
    const payload = sorted[0] && typeof sorted[0] === 'object' ? { ...sorted[0] } : {};
    delete payload._id;
    return {
      payload,
      warnings,
      writtenCount: payload && Object.keys(payload).length ? 1 : 0,
      skippedMissingId: 0
    };
  }

  // auto / arrays
  if (existingPayload && typeof existingPayload === 'object' && !Array.isArray(existingPayload)) {
    const hasItemsById = existingPayload.itemsById && typeof existingPayload.itemsById === 'object' && !Array.isArray(existingPayload.itemsById);
    const hasAllIds = Array.isArray(existingPayload.allIds);
    if (hasItemsById || hasAllIds) {
      return buildItemsByIdPayload(item, docs, existingPayload);
    }
  }

  const sorted = sortByIdStable(item, docs).map((row) => {
    const next = { ...(row || {}) };
    delete next._id;
    return next;
  });
  return {
    payload: sorted,
    warnings: [],
    writtenCount: sorted.length,
    skippedMissingId: 0
  };
}

function getCatalogItem(catalog, key) {
  const item = catalog.find((entry) => entry.key === key);
  if (!item) throw new Error(`Unknown migration item: ${key}`);
  return item;
}

async function countSourceRecords(item) {
  const loaded = await loadSourceRecords(item);
  const normalized = normalizeForMigration(item, loaded.records);
  return {
    sourceCount: normalized.stats.sourceCount,
    validSourceCount: normalized.stats.uniqueValidCount,
    sourceWarnings: [...loaded.warnings, ...normalized.warnings],
    skippedInvalid: normalized.stats.skippedInvalid,
    skippedMissingId: normalized.stats.skippedMissingId
  };
}

async function buildSourceCacheSignature(item) {
  const sourcePath = resolveSourcePath(item);
  try {
    if (item.sourceType === 'json_directory') {
      const files = await listDirectoryJsonFiles(sourcePath, { recursive: item.recursive === true });
      const parts = [];
      for (const fileName of files) {
        const filePath = path.join(sourcePath, fileName);
        // eslint-disable-next-line no-await-in-loop
        const stat = await fs.stat(filePath);
        parts.push(`${fileName}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
      }
      return parts.join('|');
    }
    const stat = await fs.stat(sourcePath);
    return `${toRelativeDataPath(sourcePath)}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch (error) {
    if (error.code === 'ENOENT') return `${toRelativeDataPath(sourcePath)}:missing`;
    throw error;
  }
}

async function countSourceRecordsCached(item) {
  const signature = await buildSourceCacheSignature(item);
  const cacheKey = `${item.key}:${signature}`;
  const cached = SOURCE_COUNT_CACHE.get(cacheKey);
  if (cached) return cached;
  const result = await countSourceRecords(item);
  SOURCE_COUNT_CACHE.set(cacheKey, result);
  return result;
}

async function countTargetDocuments(collectionName) {
  return getMongoCollection(collectionName).countDocuments({});
}

async function buildDashboardRows(options = {}) {
  const includeTargetCounts = options?.includeTargetCounts === true;
  const includeSourceCounts = options?.includeSourceCounts === true;
  const catalog = buildCatalog();
  const rows = [];

  for (const item of catalog) {
    const sourcePath = resolveSourcePath(item);
    const sourceStats = includeSourceCounts
      ? await countSourceRecordsCached(item)
      : {
        sourceCount: null,
        validSourceCount: null,
        sourceWarnings: [],
        skippedInvalid: null,
        skippedMissingId: null
      };
    let targetCount = null;
    if (includeTargetCounts) {
      targetCount = await countTargetDocuments(item.collection);
    }

    rows.push({
      ...item,
      sourcePath: path.relative(PROJECT_ROOT, sourcePath).replace(/\\/g, '/'),
      sourceCount: sourceStats.sourceCount,
      validSourceCount: sourceStats.validSourceCount,
      skippedInvalid: sourceStats.skippedInvalid,
      skippedMissingId: sourceStats.skippedMissingId,
      sourceWarnings: sourceStats.sourceWarnings,
      targetCount
    });
  }

  return rows;
}

function isGeneratedOrDerivedDataFile(relativePath = '') {
  const normalized = toPublicString(relativePath).replace(/\\/g, '/');
  if (DERIVED_JSON_FILES.has(normalized)) {
    return DERIVED_JSON_FILES.get(normalized);
  }
  if (GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'Generated audit/report/migration artifact.';
  }
  return '';
}

async function listAllDataJsonFiles() {
  const out = [];
  async function walk(dirPath) {
    let entries = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        out.push(toRelativeDataPath(fullPath));
      }
    }
  }
  await walk(DATA_ROOT);
  return out.sort();
}

function fileCoveredByCatalog(relativePath = '', catalog = buildCatalog()) {
  const normalized = toPublicString(relativePath).replace(/\\/g, '/');
  return catalog.some((item) => {
    const source = toPublicString(item.source).replace(/\\/g, '/').replace(/\/+$/, '');
    if (!source) return false;
    if (item.sourceType === 'json_directory') {
      return normalized.startsWith(`${source}/`);
    }
    return normalized === source;
  });
}

async function buildCoverageAudit() {
  const catalog = buildCatalog();
  const files = await listAllDataJsonFiles();
  const covered = [];
  const ignored = [];
  const unmapped = [];

  files.forEach((filePath) => {
    if (fileCoveredByCatalog(filePath, catalog)) {
      covered.push(filePath);
      return;
    }
    const reason = isGeneratedOrDerivedDataFile(filePath);
    if (reason) {
      ignored.push({ path: filePath, reason });
      return;
    }
    unmapped.push(filePath);
  });

  return {
    totalJsonFiles: files.length,
    catalogItems: catalog.length,
    coveredCount: covered.length,
    ignoredCount: ignored.length,
    unmappedCount: unmapped.length,
    covered,
    ignored,
    unmapped
  };
}

function filterCatalogRows(rows = [], query = {}) {
  const search = normalizeToken(query.search || query.q || '');
  const domain = normalizeToken(query.domain || '');
  const sourceType = normalizeToken(query.sourceType || '');
  const status = normalizeToken(query.status || '');

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (domain && normalizeToken(row.domain) !== domain) return false;
    if (sourceType && normalizeToken(row.sourceType) !== sourceType) return false;
    if (status === 'optional' && !row.optional) return false;
    if (status === 'required' && row.optional) return false;
    if (search) {
      const haystack = [
        row.key,
        row.domain,
        row.section,
        row.sourcePath,
        row.collection,
        row.notes
      ].map((value) => normalizeToken(value)).join(' ');
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

async function listMigrationItems(options = {}) {
  const page = toPositiveInt(options.page, 1);
  const pageSize = toPositiveInt(options.pageSize || options.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const allRows = await buildDashboardRows({ includeTargetCounts: false, includeSourceCounts: false });
  const filtered = filterCatalogRows(allRows, options.query || options);
  const pagination = buildPagination(filtered.length, page, pageSize);
  const startIndex = (pagination.currentPage - 1) * pagination.pageSize;
  const rows = filtered.slice(startIndex, startIndex + pagination.pageSize);
  const domains = [...new Set(allRows.map((row) => row.domain).filter(Boolean))].sort();
  const sourceTypes = [...new Set(allRows.map((row) => row.sourceType).filter(Boolean))].sort();
  return {
    rows,
    domains,
    sourceTypes,
    pagination,
    coverage: await buildCoverageAudit()
  };
}

async function listCopyEligibleCollections() {
  await ensureMongoReady();
  const sourceDb = getMongoDbOrNull();
  if (!sourceDb) throw new Error('MongoDB is not connected.');

  const rows = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
  const collections = (Array.isArray(rows) ? rows : [])
    .map((row) => toPublicString(row?.name || ''))
    .filter((name) => name && !name.startsWith('system.') && /^[A-Za-z0-9_.-]+$/.test(name))
    .sort((left, right) => left.localeCompare(right));

  return {
    sourceDbName: toPublicString(sourceDb.databaseName),
    collections
  };
}

async function overwriteCollectionToDestination(options = {}) {
  const startedAt = Date.now();
  const collectionName = assertCopyCollectionName(options.collectionName || options.collection);
  const destinationUri = toPublicString(options.destinationUri);
  if (!destinationUri) throw new Error('Destination Mongo URI is required.');

  const runtimeBackend = await ensureMongoReady();
  const sourceDb = getMongoDbOrNull();
  if (!sourceDb) throw new Error('MongoDB is not connected.');

  const sourceDbName = toPublicString(sourceDb.databaseName);
  const destinationDbName = inferDbNameFromUri(destinationUri) || sourceDbName;
  const sourceUri = toPublicString(
    runtimeBackend?.mongo?.uri || process.env.MONGODB_URI || process.env.MONGO_URI || ''
  );

  if (mongoUrisLikelySameDeployment(sourceUri, destinationUri) && destinationDbName === sourceDbName) {
    throw new Error('Source and destination cannot be the same database target for this overwrite operation.');
  }

  const sourceCollectionExists = await sourceDb
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();
  if (!sourceCollectionExists) {
    throw new Error(`Source collection "${collectionName}" was not found.`);
  }

  const sourceCollection = sourceDb.collection(collectionName);
  const sourceCount = await sourceCollection.countDocuments({});
  const { MongoClient } = loadMongoDriver();
  const destinationClient = new MongoClient(destinationUri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL || 0),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)
  });

  let destinationBeforeCount = 0;
  let deletedCount = 0;
  let insertedCount = 0;
  let destinationAfterCount = 0;
  const warnings = [];

  try {
    await destinationClient.connect();
    const destinationDb = destinationClient.db(destinationDbName);
    const destinationCollection = destinationDb.collection(collectionName);

    destinationBeforeCount = await destinationCollection.countDocuments({});
    if (destinationBeforeCount > 0) {
      const deleteResult = await destinationCollection.deleteMany({});
      deletedCount = Number(deleteResult?.deletedCount || 0);
    }

    const cursor = sourceCollection.find({});
    let batch = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const row of cursor) {
      batch.push(row);
      if (batch.length < 500) continue;
      // eslint-disable-next-line no-await-in-loop
      const insertResult = await destinationCollection.insertMany(batch, { ordered: true });
      insertedCount += Number(insertResult?.insertedCount || Object.keys(insertResult?.insertedIds || {}).length || 0);
      batch = [];
    }

    if (batch.length > 0) {
      const insertResult = await destinationCollection.insertMany(batch, { ordered: true });
      insertedCount += Number(insertResult?.insertedCount || Object.keys(insertResult?.insertedIds || {}).length || 0);
    }

    destinationAfterCount = await destinationCollection.countDocuments({});

    if (insertedCount !== sourceCount) {
      warnings.push(`Inserted count (${insertedCount}) does not match source count (${sourceCount}).`);
    }
  } catch (error) {
    throw new Error(`Destination overwrite failed: ${error.message}`);
  } finally {
    await destinationClient.close().catch(() => null);
  }

  return {
    collection: collectionName,
    sourceDbName,
    destinationDbName,
    sourceCount,
    destinationBeforeCount,
    deletedCount,
    insertedCount,
    destinationAfterCount,
    durationMs: Math.max(0, Date.now() - startedAt),
    warnings
  };
}

async function getMigrationCounts(keys = [], options = {}) {
  const includeTargetCounts = options?.includeTargetCounts !== false;
  const catalog = buildCatalog();
  const keySet = new Set((Array.isArray(keys) ? keys : []).map((key) => toPublicString(key)).filter(Boolean));
  const selected = catalog.filter((item) => keySet.has(item.key));
  const hasMongo = includeTargetCounts && Boolean(options?.mongoReady);

  return runWithConcurrency(selected, 4, async (item) => {
    const sourceStats = await countSourceRecordsCached(item);
    let targetCount = null;
    if (hasMongo) {
      targetCount = await countTargetDocuments(item.collection);
    }
    return {
      key: item.key,
      sourceCount: sourceStats.sourceCount,
      validSourceCount: sourceStats.validSourceCount,
      skippedInvalid: sourceStats.skippedInvalid,
      skippedMissingId: sourceStats.skippedMissingId,
      sourceWarnings: sourceStats.sourceWarnings,
      targetCount
    };
  });
}

async function dryRunMigrationItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const loaded = await loadSourceRecords(item);
  const normalized = normalizeForMigration(item, loaded.records);
  const ids = normalized.docs.map((doc) => doc.id);
  const collection = getMongoCollection(item.collection);
  const targetCountBefore = await collection.countDocuments({});

  let existingIds = new Set();
  if (ids.length) {
    const rows = await collection.find({ id: { $in: ids } }, { projection: { id: 1 } }).toArray();
    existingIds = new Set(rows.map((row) => toPublicString(row?.id)).filter(Boolean));
  }

  const existingCount = existingIds.size;
  const insertCount = Math.max(0, normalized.docs.length - existingCount);
  const updateCount = existingCount;

  return {
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, resolveSourcePath(item)).replace(/\\/g, '/'),
    sourceCount: normalized.stats.sourceCount,
    validSourceCount: normalized.docs.length,
    skippedInvalid: normalized.stats.skippedInvalid,
    skippedMissingId: normalized.stats.skippedMissingId,
    targetCountBefore,
    wouldInsert: insertCount,
    wouldUpdate: updateCount,
    warnings: [...loaded.warnings, ...normalized.warnings]
  };
}

async function transferMigrationItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const loaded = await loadSourceRecords(item);
  const normalized = normalizeForMigration(item, loaded.records);
  const docs = normalized.docs;
  const collection = getMongoCollection(item.collection);
  const targetCountBefore = await collection.countDocuments({});
  const ids = docs.map((doc) => doc.id);

  let existingIds = new Set();
  if (ids.length) {
    const rows = await collection.find({ id: { $in: ids } }, { projection: { id: 1 } }).toArray();
    existingIds = new Set(rows.map((row) => toPublicString(row?.id)).filter(Boolean));
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { id: doc.id },
      update: { $set: doc },
      upsert: true
    }
  }));

  if (operations.length) {
    const chunks = chunkArray(operations, 500);
    for (const ops of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await collection.bulkWrite(ops, { ordered: false });
    }
  }

  const targetCountAfter = await collection.countDocuments({});
  return {
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, resolveSourcePath(item)).replace(/\\/g, '/'),
    sourceCount: normalized.stats.sourceCount,
    validSourceCount: docs.length,
    skippedInvalid: normalized.stats.skippedInvalid,
    skippedMissingId: normalized.stats.skippedMissingId,
    inserted: Math.max(0, docs.length - existingIds.size),
    updated: existingIds.size,
    targetCountBefore,
    targetCountAfter,
    warnings: [...loaded.warnings, ...normalized.warnings]
  };
}

async function dryRunClearTargetCollectionItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const collection = getMongoCollection(item.collection);
  const targetCountBefore = await collection.countDocuments({});

  return {
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, resolveSourcePath(item)).replace(/\\/g, '/'),
    targetCountBefore,
    wouldDelete: targetCountBefore,
    warnings: []
  };
}

async function clearTargetCollectionItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const collection = getMongoCollection(item.collection);
  const targetCountBefore = await collection.countDocuments({});
  const deleteResult = await collection.deleteMany({});
  const targetCountAfter = await collection.countDocuments({});

  return {
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, resolveSourcePath(item)).replace(/\\/g, '/'),
    targetCountBefore,
    deleted: Number(deleteResult?.deletedCount || 0),
    targetCountAfter,
    warnings: []
  };
}

async function replaceMigrationItem(key) {
  const clearReport = await clearTargetCollectionItem(key);
  const transferReport = await transferMigrationItem(key);

  return {
    key: transferReport.key,
    domain: transferReport.domain,
    section: transferReport.section,
    collection: transferReport.collection,
    sourcePath: transferReport.sourcePath,
    clear: clearReport,
    transfer: transferReport,
    sourceCount: transferReport.sourceCount,
    validSourceCount: transferReport.validSourceCount,
    targetCountBefore: clearReport.targetCountBefore,
    deleted: clearReport.deleted,
    inserted: transferReport.inserted,
    updated: transferReport.updated,
    targetCountAfter: transferReport.targetCountAfter,
    skippedInvalid: transferReport.skippedInvalid,
    skippedMissingId: transferReport.skippedMissingId,
    warnings: [...(clearReport.warnings || []), ...(transferReport.warnings || [])]
  };
}

async function transferAllMigrationItems(options = {}) {
  const includeOptional = options?.includeOptional === true;
  const catalog = buildCatalog();
  const selected = catalog.filter((item) => includeOptional || !item.optional);
  const results = [];
  for (const item of selected) {
    // eslint-disable-next-line no-await-in-loop
    const result = await transferMigrationItem(item.key);
    results.push(result);
  }
  return results;
}

async function dryRunReverseMigrationItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const sourceStats = await countSourceRecords(item);
  const mongoStats = await loadMongoRecords(item);
  const sourcePath = resolveSourcePath(item);
  let wouldDeleteFiles = 0;

  if (item.sourceType === 'json_directory') {
    const existingJsonFiles = await listDirectoryJsonFiles(sourcePath, { recursive: item.recursive === true });
    const exportFileSet = new Set(
      mongoStats.docs.map((doc, index) => (
        typeof item.exportRelativePath === 'function'
          ? item.exportRelativePath(doc, index)
          : `${sanitizeFileName(getDirectoryRecordId(item, doc, index))}.json`
      ))
    );
    wouldDeleteFiles = existingJsonFiles.filter((name) => !exportFileSet.has(name)).length;
  }

  return {
    direction: 'mongo_to_json',
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, sourcePath).replace(/\\/g, '/'),
    sourceCountBefore: sourceStats.validSourceCount,
    mongoCount: mongoStats.stats.mongoCount,
    validMongoCount: mongoStats.stats.validCount,
    wouldWrite: mongoStats.stats.validCount,
    wouldOverwrite: Math.min(sourceStats.validSourceCount, mongoStats.stats.validCount),
    wouldDeleteFiles,
    skippedInvalidMongo: mongoStats.stats.skippedInvalid,
    warnings: [...(sourceStats.sourceWarnings || []), ...mongoStats.warnings]
  };
}

async function transferReverseMigrationItem(key) {
  const catalog = buildCatalog();
  const item = getCatalogItem(catalog, key);
  await ensureMongoReady();

  const sourcePath = resolveSourcePath(item);
  const sourceBefore = await countSourceRecords(item);
  const mongoStats = await loadMongoRecords(item);
  const warnings = [...mongoStats.warnings];
  let writtenCount = 0;
  let deletedFiles = 0;
  let skippedMissingId = 0;

  if (item.sourceType === 'json_directory') {
    await fs.mkdir(sourcePath, { recursive: true });
    const existingJsonFiles = await listDirectoryJsonFiles(sourcePath, { recursive: item.recursive === true });
    const writeMap = new Map();

    mongoStats.docs.forEach((doc, index) => {
      const recordId = getDirectoryRecordId(item, doc, index);
      const fileName = typeof item.exportRelativePath === 'function'
        ? item.exportRelativePath(doc, index)
        : `${sanitizeFileName(recordId)}.json`;
      writeMap.set(String(fileName || '').replace(/\\/g, '/'), { ...doc });
    });

    const writeEntries = [...writeMap.entries()];
    for (const [fileName, payload] of writeEntries) {
      const filePath = path.join(sourcePath, fileName);
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }
    writtenCount = writeEntries.length;

    const keepSet = new Set(writeEntries.map(([fileName]) => fileName));
    const stale = existingJsonFiles.filter((name) => !keepSet.has(name));
    for (const fileName of stale) {
      const filePath = path.join(sourcePath, fileName);
      // eslint-disable-next-line no-await-in-loop
      await fs.unlink(filePath);
    }
    deletedFiles = stale.length;

    if (item.summaryFile === 'tasks.json') {
      const summaryRows = sortByIdStable(item, mongoStats.docs).map((task) => ({
        id: task.id,
        title: task.title || '',
        projectName: task.projectName || '',
        phaseName: task.phaseName || '',
        status: task.status || '',
        priority: task.priority || '',
        assignees: Array.isArray(task.assignees)
          ? task.assignees
          : (Array.isArray(task.assignments)
            ? task.assignments
              .filter((assignee) => String(assignee?.status || 'active').toLowerCase() !== 'deleted')
              .map((assignee) => ({ userId: assignee.userId, role: assignee.role }))
            : []),
        progress: Number(task.progress || 0),
        updatedAt: task.updatedAt || task.audit?.lastUpdateDateTime || task.createdAt || ''
      }));
      const summaryPath = path.join(DATA_ROOT, item.summaryFile);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(summaryPath, `${JSON.stringify(summaryRows, null, 2)}\n`, 'utf8');
    }
  } else {
    let existingPayload = null;
    try {
      existingPayload = await readJsonFile(sourcePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const built = buildJsonFilePayload(item, mongoStats.docs, existingPayload);
    warnings.push(...(built.warnings || []));
    skippedMissingId = Number(built.skippedMissingId || 0);
    writtenCount = Number(built.writtenCount || 0);

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, `${JSON.stringify(built.payload, null, 2)}\n`, 'utf8');
  }

  const sourceAfter = await countSourceRecords(item);
  return {
    direction: 'mongo_to_json',
    key: item.key,
    domain: item.domain,
    section: item.section,
    collection: item.collection,
    sourcePath: path.relative(PROJECT_ROOT, sourcePath).replace(/\\/g, '/'),
    sourceCountBefore: sourceBefore.validSourceCount,
    sourceCountAfter: sourceAfter.validSourceCount,
    mongoCount: mongoStats.stats.mongoCount,
    validMongoCount: mongoStats.stats.validCount,
    written: writtenCount,
    deletedFiles,
    skippedInvalidMongo: mongoStats.stats.skippedInvalid,
    skippedMissingId,
    warnings: [...(sourceBefore.sourceWarnings || []), ...(sourceAfter.sourceWarnings || []), ...warnings]
  };
}

async function transferAllReverseMigrationItems(options = {}) {
  const includeOptional = options?.includeOptional === true;
  const catalog = buildCatalog();
  const selected = catalog.filter((item) => includeOptional || !item.optional);
  const results = [];
  for (const item of selected) {
    // eslint-disable-next-line no-await-in-loop
    const result = await transferReverseMigrationItem(item.key);
    results.push(result);
  }
  return results;
}

function buildBackupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('');
}

async function writeLine(stream, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  if (!stream.write(line)) {
    await once(stream, 'drain');
  }
}

async function buildMongoBackupManifest(db, collections = []) {
  let appVersion = '';
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    appVersion = require(path.join(PROJECT_ROOT, 'package.json'))?.version || '';
  } catch (_) {
    appVersion = '';
  }

  const collectionRows = [];
  for (const info of collections) {
    const name = toPublicString(info?.name);
    if (!name) continue;
    // eslint-disable-next-line no-await-in-loop
    const count = await db.collection(name).countDocuments({});
    collectionRows.push({ name, count });
  }

  return {
    type: 'manifest',
    format: 'mongo-backup-jsonl-gzip',
    generatedAt: new Date().toISOString(),
    appVersion,
    databaseName: db.databaseName,
    collections: collectionRows,
    totalCollections: collectionRows.length,
    totalDocuments: collectionRows.reduce((sum, item) => sum + Number(item.count || 0), 0)
  };
}

async function streamMongoBackup(response, options = {}) {
  await ensureMongoReady();
  const db = getMongoDbOrNull();
  if (!db) throw new Error('MongoDB is not connected.');

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const manifest = await buildMongoBackupManifest(db, collections);
  const fileName = `mongo-backup-${buildBackupTimestamp()}.jsonl.gz`;

  response.setHeader('Content-Type', 'application/gzip');
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const gzip = zlib.createGzip({ level: Number(options.level || 6) });
  gzip.pipe(response);

  await writeLine(gzip, manifest);
  for (const collectionMeta of manifest.collections) {
    const collectionName = collectionMeta.name;
    await writeLine(gzip, {
      type: 'collection',
      collection: collectionName,
      count: collectionMeta.count
    });

    const cursor = db.collection(collectionName).find({});
    // eslint-disable-next-line no-restricted-syntax
    for await (const document of cursor) {
      await writeLine(gzip, {
        type: 'document',
        collection: collectionName,
        document
      });
    }
  }

  const finished = once(response, 'finish').catch(() => null);
  gzip.end();
  await finished;
  return { fileName, manifest };
}

function decodeBackupBuffer(buffer, fileName = '') {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (!source.length) throw new Error('Backup file is empty.');

  const isGzip = source.length >= 2 && source[0] === 0x1f && source[1] === 0x8b;
  const nameLooksGzip = /\.gz$/i.test(String(fileName || ''));
  const decoded = isGzip || nameLooksGzip ? zlib.gunzipSync(source) : source;
  return decoded.toString('utf8');
}

function assertSafeBackupCollectionName(collectionName = '') {
  const name = toPublicString(collectionName);
  if (!name) throw new Error('Backup contains a collection entry without a name.');
  if (name.startsWith('system.')) {
    throw new Error(`Backup collection "${name}" is not restorable through this tool.`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`Backup collection "${name}" has an invalid name.`);
  }
  return name;
}

function parseMongoBackupText(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('Backup file does not contain any JSONL records.');

  let manifest = null;
  const collections = new Map();
  let totalDocuments = 0;

  lines.forEach((line, index) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Backup line ${index + 1} is not valid JSON.`);
    }

    const type = toPublicString(row?.type);
    if (index === 0) {
      if (type !== 'manifest') throw new Error('Backup must start with a manifest record.');
      if (row?.format !== 'mongo-backup-jsonl-gzip') {
        throw new Error('Unsupported backup format. Expected mongo-backup-jsonl-gzip.');
      }
      manifest = row;
      return;
    }

    if (type === 'collection') {
      const collectionName = assertSafeBackupCollectionName(row?.collection);
      if (!collections.has(collectionName)) {
        collections.set(collectionName, {
          name: collectionName,
          declaredCount: Number(row?.count || 0),
          documents: []
        });
      }
      return;
    }

    if (type === 'document') {
      const collectionName = assertSafeBackupCollectionName(row?.collection);
      if (!row.document || typeof row.document !== 'object' || Array.isArray(row.document)) {
        throw new Error(`Backup line ${index + 1} has an invalid document payload.`);
      }
      if (!collections.has(collectionName)) {
        collections.set(collectionName, {
          name: collectionName,
          declaredCount: 0,
          documents: []
        });
      }
      collections.get(collectionName).documents.push(row.document);
      totalDocuments += 1;
      return;
    }

    throw new Error(`Backup line ${index + 1} has unsupported record type "${type}".`);
  });

  if (!manifest) throw new Error('Backup manifest is missing.');
  return {
    manifest,
    collections: Array.from(collections.values()),
    totalCollections: collections.size,
    totalDocuments
  };
}

async function restoreMongoBackupFromBuffer(buffer, options = {}) {
  await ensureMongoReady();
  const db = getMongoDbOrNull();
  if (!db) throw new Error('MongoDB is not connected.');

  const fileName = toPublicString(options.fileName || 'mongo-backup.jsonl.gz');
  const dryRun = options.dryRun === true;
  const backup = parseMongoBackupText(decodeBackupBuffer(buffer, fileName));
  if (!backup.collections.length) throw new Error('Backup contains no collections to restore.');

  const reports = [];
  for (const item of backup.collections) {
    const collectionName = assertSafeBackupCollectionName(item.name);
    const collection = db.collection(collectionName);
    // eslint-disable-next-line no-await-in-loop
    const beforeCount = await collection.countDocuments({});
    const docs = Array.isArray(item.documents) ? item.documents : [];

    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await collection.deleteMany({});
      const chunks = chunkArray(docs, 500);
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        // eslint-disable-next-line no-await-in-loop
        await collection.insertMany(chunk);
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const afterCount = dryRun ? beforeCount : await collection.countDocuments({});
    reports.push({
      collection: collectionName,
      declaredCount: Number(item.declaredCount || 0),
      backupDocuments: docs.length,
      beforeCount,
      deleted: dryRun ? 0 : beforeCount,
      inserted: dryRun ? 0 : docs.length,
      afterCount,
      dryRun
    });
  }

  return {
    status: dryRun ? 'dry_run' : 'restored',
    fileName,
    manifest: backup.manifest,
    totalCollections: backup.totalCollections,
    totalDocuments: backup.totalDocuments,
    reports
  };
}

module.exports = {
  buildCatalog,
  buildCoverageAudit,
  ensureMongoReady,
  buildDashboardRows,
  listMigrationItems,
  listCopyEligibleCollections,
  overwriteCollectionToDestination,
  getMigrationCounts,
  dryRunMigrationItem,
  transferMigrationItem,
  dryRunClearTargetCollectionItem,
  clearTargetCollectionItem,
  replaceMigrationItem,
  transferAllMigrationItems,
  dryRunReverseMigrationItem,
  transferReverseMigrationItem,
  transferAllReverseMigrationItems,
  streamMongoBackup,
  restoreMongoBackupFromBuffer
};
