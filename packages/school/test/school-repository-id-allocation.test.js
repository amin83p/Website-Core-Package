const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveSchoolCreateId,
  createPrefixedRandomAllocator
} = require('../MVC/services/school/schoolEntityIdAllocationService');

function readRepoIndexSource() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'MVC', 'repositories', 'school', 'index.js'),
    'utf8'
  );
}

function repoBlock(entityName) {
  const source = readRepoIndexSource();
  const marker = `${entityName}: createSchoolRepository({`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing repository block: ${entityName}`);
  const rest = source.slice(start + marker.length);
  const closeMatch = rest.match(/\n  \w+: createSchoolRepository\(\{/);
  const end = closeMatch ? start + marker.length + closeMatch.index : source.length;
  return source.slice(start, end);
}

const ENTITIES_REQUIRING_CUSTOM_MONGO_ID = [
  'reportTemplates',
  'reportAssignments',
  'reportInstances',
  'overallReportTemplates',
  'overallReportInstances',
  'overallReportManagementSessions',
  'books',
  'bookAssignments',
  'bookCoveringReports',
  'libraryCopies',
  'libraryPatrons',
  'libraryPolicies',
  'libraryLoans',
  'libraryLocations',
  'activities',
  'examTemplates',
  'examRevisions',
  'examQuestions',
  'examAllocations',
  'examAssignments',
  'examAttempts',
  'examAnswers',
  'students',
  'teachers',
  'staff',
  'notificationRules',
  'notificationRuns',
  'programs',
  'funders',
  'terms',
  'departments',
  'subjects',
  'classes',
  'classTemplates',
  'skills',
  'sessionStatuses',
  'schoolAccounts',
  'transactionDefinitions',
  'transactionJournals',
  'studentProgramRegistrations',
  'studentTermRegistrations',
  'studentProgramPriorSubjects',
  'classEnrollmentPeriods',
  'leaveRequests',
  'tasks',
  'taskRoutingRules',
  'sessionStudentCases',
  'attendanceChangeLogs',
  'teachingOutlineLevels',
  'teachingOutlineSectionTemplates',
  'teachingOutlineItems',
  'payRates',
  'timesheetPeriods',
  'timesheets',
  'holidays',
  'activityCategories'
];

const ENTITIES_WITH_VALIDATION_MONGO_ID = [
  'globalTransactions',
  'academicLedger',
  'academicSnapshots'
];

test('resolveSchoolCreateId uses free requested id', async () => {
  const id = await resolveSchoolCreateId({
    requestedId: 'LC-2026-FREE',
    reservedIds: ['LC-2026-TAKEN'],
    allocateNext: () => Promise.resolve('LC-2026-NEW')
  });
  assert.equal(id, 'LC-2026-FREE');
});

test('createPrefixedRandomAllocator skips reserved ids', async () => {
  const allocate = createPrefixedRandomAllocator('LC');
  const id = await allocate({ existingIds: ['LC-2026-TAKEN1', 'LC-2026-TAKEN2'] });
  assert.match(id, /^LC-\d{4}-[A-Z0-9]+$/);
  assert.notEqual(id, 'LC-2026-TAKEN1');
});

test('school repositories define generateMongoCreateId for covered entities', () => {
  ENTITIES_REQUIRING_CUSTOM_MONGO_ID.forEach((entityName) => {
    const block = repoBlock(entityName);
    assert.match(block, /generateMongoCreateId:/, `${entityName} missing generateMongoCreateId`);
    assert.doesNotMatch(
      block,
      /generateUniqueStringId\(collection,\s*requested\)/,
      `${entityName} still uses generateUniqueStringId requested fallback`
    );
  });
});

test('school repositories use resolveSchoolCreateId for domain entities', () => {
  const source = readRepoIndexSource();
  assert.match(source, /resolveSchoolCreateId/);
});

test('ledger and snapshot repositories define validation mongo id hooks', () => {
  ENTITIES_WITH_VALIDATION_MONGO_ID.forEach((entityName) => {
    const block = repoBlock(entityName);
    assert.match(block, /generateMongoCreateId:/, `${entityName} missing generateMongoCreateId`);
    assert.doesNotMatch(
      block,
      /generateUniqueStringId\(collection,\s*payload\.id\)/,
      `${entityName} still uses generateUniqueStringId on create`
    );
  });
});

test('withdrawal repository uses typed withdrawal id resolver on mongo create', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'MVC', 'repositories', 'school', 'withdrawalRepository.js'),
    'utf8'
  );
  assert.match(source, /resolveWithdrawalCreateId/);
  assert.doesNotMatch(source, /generateUniqueStringId\(collection,\s*payload\.id\)/);
});
