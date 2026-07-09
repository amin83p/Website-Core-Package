const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const PHASE_1_REPOSITORY_KEYS = [
  'programs',
  'departments',
  'subjects',
  'terms',
  'classes',
  'reportTemplates',
  'reportAssignments',
  'reportInstances',
  'timesheetPeriods',
  'activities',
  'activityCategories',
  'sessionStatuses',
  'holidays'
];

const PHASE_2A_REPOSITORY_KEYS = [
  'students',
  'teachers',
  'staff'
];

const PHASE_2B_REPOSITORY_KEYS = [
  'schoolAccounts',
  'transactionDefinitions',
  'transactionTemplates',
  'transactionJournals',
  'examTemplates',
  'examRevisions',
  'examQuestions',
  'examAllocations',
  'examAssignments',
  'examAttempts',
  'examAnswers',
  'classEnrollmentPeriods',
  'studentProgramPriorSubjects',
  'leaveRequests',
  'tasks'
];

const PHASE_1_DELETE_CONTROLLERS = [
  'MVC/controllers/school/programController.js',
  'MVC/controllers/school/departmentController.js',
  'MVC/controllers/school/subjectController.js',
  'MVC/controllers/school/termController.js',
  'MVC/controllers/school/classController.js',
  'MVC/controllers/school/reportController.js',
  'MVC/controllers/school/activityController.js',
  'MVC/controllers/school/timesheetPeriodController.js',
  'MVC/controllers/school/sessionStatusController.js',
  'MVC/controllers/school/holidayController.js'
];

const PHASE_2A_PEOPLE_CONTROLLERS = [
  'MVC/controllers/school/studentController.js',
  'MVC/controllers/school/teacherController.js',
  'MVC/controllers/school/staffController.js'
];

test('school deletion guard registry exports phase 1, 2a, and 2b entity definitions', () => {
  const registry = require('../MVC/services/school/schoolDeletionRuleRegistry');
  const expectedKeys = [
    'program',
    'department',
    'subject',
    'term',
    'class',
    'session',
    'reportTemplate',
    'reportAssignment',
    'reportInstance',
    'timesheetPeriod',
    'activity',
    'activityCategory',
    'sessionStatus',
    'holiday',
    'student',
    'teacher',
    'staff',
    'schoolAccount',
    'transactionDefinition',
    'transactionJournal',
    'examTemplate',
    'examRevision',
    'examQuestion',
    'examAllocation',
    'examAssignment',
    'examAttempt',
    'examAnswer',
    'classEnrollmentPeriod',
    'studentProgramPriorSubject',
    'leaveRequest',
    'task'
  ];
  expectedKeys.forEach((key) => {
    const def = registry.getEntityDefinition(key);
    assert.ok(def, `missing entity definition for ${key}`);
    if (key !== 'session') {
      assert.ok(def.repositoryKey, `repositoryKey required for ${key}`);
    }
    if (['student', 'teacher', 'staff'].includes(key)) {
      assert.equal(def.deleteMode, 'purge_only', `${key} should use purge_only delete mode`);
    }
    if (key === 'schoolAccount') {
      assert.equal(def.deleteMode, 'archive_only', 'schoolAccount should use archive_only delete mode');
    }
  });
});

test('REPOSITORY_KEY_TO_ENTITY_KEY covers phase 1, 2a, and 2b repository keys', () => {
  const { REPOSITORY_KEY_TO_ENTITY_KEY, resolveEntityKeyFromRepositoryKey } = require('../MVC/services/school/schoolDeletionRuleRegistry');
  [...PHASE_1_REPOSITORY_KEYS, ...PHASE_2A_REPOSITORY_KEYS, ...PHASE_2B_REPOSITORY_KEYS].forEach((repositoryKey) => {
    assert.ok(REPOSITORY_KEY_TO_ENTITY_KEY[repositoryKey], `missing map entry for ${repositoryKey}`);
    assert.ok(resolveEntityKeyFromRepositoryKey(repositoryKey), `resolveEntityKeyFromRepositoryKey failed for ${repositoryKey}`);
  });
  assert.equal(resolveEntityKeyFromRepositoryKey('persons'), '');
  assert.equal(resolveEntityKeyFromRepositoryKey(''), '');
  assert.equal(resolveEntityKeyFromRepositoryKey('transactionTemplates'), 'transactionDefinition');
  assert.equal(resolveEntityKeyFromRepositoryKey('feeDefinitions'), 'transactionDefinition');
});

test('school deletion guard service exposes preview and blocked error helpers', () => {
  const guard = require('../MVC/services/school/schoolDeletionGuardService');
  assert.equal(typeof guard.previewDelete, 'function');
  assert.equal(typeof guard.assertCanDelete, 'function');
  assert.equal(typeof guard.executeDelete, 'function');
  assert.equal(typeof guard.respondDeleteBlocked, 'function');
  assert.equal(guard.DELETE_BLOCKED_CODE, 'DELETE_BLOCKED');
});

test('DeleteBlockedError carries preview payload', () => {
  const { DeleteBlockedError } = require('../MVC/services/school/schoolDeletionGuardService');
  const preview = {
    canDelete: false,
    entityKey: 'term',
    id: 'term-1',
    label: 'Fall 2026',
    blockers: [{ code: 'PROGRAM_EMBED', count: 1, label: 'Programs' }]
  };
  const error = new DeleteBlockedError(preview);
  assert.equal(error.code, 'DELETE_BLOCKED');
  assert.deepEqual(error.preview, preview);
  assert.match(error.message, /Fall 2026/);
  assert.match(error.message, /Programs/);
});

test('buildBlocker omits empty reference groups', () => {
  const { buildBlocker } = require('../MVC/services/school/schoolDeletionRuleRegistry');
  assert.equal(buildBlocker({ code: 'X', label: 'Test', count: 0 }), null);
  const blocker = buildBlocker({ code: 'X', label: 'Programs', count: 2, section: 'programs' });
  assert.equal(blocker.count, 2);
  assert.equal(blocker.code, 'X');
});

test('school deletion guard can load schoolDataService.getDataById after module init', () => {
  const guard = require('../MVC/services/school/schoolDeletionGuardService');
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  assert.equal(typeof schoolDataService.getDataById, 'function');
  assert.equal(typeof guard.previewDelete, 'function');
});

test('schoolDataService.deleteData invokes guard before repository remove', () => {
  const source = read('MVC/services/school/schoolDataService.js');
  const deleteDataStart = source.indexOf('deleteData: async');
  assert.ok(deleteDataStart >= 0, 'deleteData method not found');
  const deleteDataBody = source.slice(deleteDataStart);
  const guardIndex = deleteDataBody.indexOf('schoolDeletionGuardService.assertCanDelete');
  const removeIndex = deleteDataBody.indexOf('config.repository.remove');
  assert.ok(guardIndex >= 0, 'deleteData should call assertCanDelete');
  assert.ok(removeIndex >= 0, 'deleteData should call repository.remove');
  assert.ok(guardIndex < removeIndex, 'guard must run before repository.remove');
  assert.match(deleteDataBody, /getDeletionGuardDeps/);
  assert.match(deleteDataBody, /skipDeletionGuard/);
  assert.match(deleteDataBody, /resolveEntityKeyFromRepositoryKey/);
});

test('schoolDataService.purgeData invokes guard before repository purge', () => {
  const source = read('MVC/services/school/schoolDataService.js');
  const purgeDataStart = source.indexOf('purgeData: async');
  assert.ok(purgeDataStart >= 0, 'purgeData method not found');
  const purgeDataBody = source.slice(purgeDataStart);
  const guardIndex = purgeDataBody.indexOf('schoolDeletionGuardService.assertCanDelete');
  const purgeIndex = purgeDataBody.indexOf('config.repository?.purgeById');
  assert.ok(guardIndex >= 0, 'purgeData should call assertCanDelete');
  assert.ok(purgeIndex >= 0, 'purgeData should call repository.purgeById');
  assert.ok(guardIndex < purgeIndex, 'guard must run before repository.purgeById');
  assert.match(purgeDataBody, /getDeletionGuardDeps/);
  assert.match(purgeDataBody, /skipDeletionGuard/);
});

test('deletion guard routes and controller are wired', () => {
  const routes = read('MVC/routes/deletionGuardRoutes.js');
  assert.match(routes, /deletion-preview\/:entityKey\/:id/);
  assert.match(routes, /delete\/:entityKey\/:id/);
  const mainRoute = read('MVC/routes/schoolMainRoute.js');
  assert.match(mainRoute, /deletionGuardRoutes/);
  const controller = read('MVC/controllers/school/deletionGuardController.js');
  assert.match(controller, /previewDeletion/);
  assert.match(controller, /executeDeletion/);
});

test('phase 1 delete controllers route through deleteData without per-controller guard boilerplate', () => {
  PHASE_1_DELETE_CONTROLLERS.forEach((relativePath) => {
    const source = read(relativePath);
    assert.doesNotMatch(source, /executeDelete\s*\(/, `${relativePath} should not call executeDelete`);
    assert.doesNotMatch(source, /respondDeleteBlocked/, `${relativePath} should not call respondDeleteBlocked`);
    if (relativePath.endsWith('classController.js')) {
      assert.match(source, /deleteData\s*\(\s*['"]classes['"]/, 'classController deleteClass should use deleteData');
      assert.match(source, /assertCanDelete/, 'classController keeps session makeup assertCanDelete');
      assert.doesNotMatch(source, /schoolDeletionGuardService\.executeDelete/, 'classController should not use executeDelete');
      return;
    }
    assert.doesNotMatch(source, /schoolDeletionGuardService/, `${relativePath} should not import deletion guard service`);
    assert.match(source, /deleteData\s*\(/, `${relativePath} should call deleteData`);
  });
});

test('phase 2a people delete controllers use central guard instead of local footprint collectors', () => {
  PHASE_2A_PEOPLE_CONTROLLERS.forEach((relativePath) => {
    const source = read(relativePath);
    assert.doesNotMatch(source, /collectStudentFootprint|collectTeacherFootprint|collectStaffFootprint/, `${relativePath} should not keep local footprint collectors`);
    assert.doesNotMatch(source, /STUDENT_DELETE_FOOTPRINT|TEACHER_DELETE_FOOTPRINT|STAFF_DELETE_FOOTPRINT/, `${relativePath} should not keep local footprint rule tables`);
    assert.match(source, /schoolDeletionGuardService\.assertCanDelete/, `${relativePath} should call assertCanDelete before purge`);
    assert.match(source, /respondDeleteBlocked/, `${relativePath} should handle blocked deletes via guard service`);
    assert.match(source, /skipDeletionGuard:\s*true/, `${relativePath} should skip duplicate guard on purgeData`);
  });
});

test('phase 2b services route task and leave deletes through schoolDataService.deleteData', () => {
  const taskService = read('MVC/services/school/taskService.js');
  assert.match(taskService, /schoolDataService\.deleteData\('tasks'/);
  const leaveService = read('MVC/services/school/leaveRequestService.js');
  assert.match(leaveService, /schoolDataService\.deleteData\('leaveRequests'/);
  const accountController = read('MVC/controllers/school/schoolAccountController.js');
  const deleteAccountStart = accountController.indexOf('exports.deleteAccount');
  assert.ok(deleteAccountStart >= 0, 'deleteAccount export not found');
  const deleteAccountBody = accountController.slice(deleteAccountStart, deleteAccountStart + 1800);
  assert.doesNotMatch(deleteAccountBody, /findAccountOwnerConflicts/);
  assert.match(deleteAccountBody, /deleteData\('schoolAccounts'/);
  assert.match(deleteAccountBody, /respondDeleteBlocked/);
});

test('schoolDeletionGuard client helper is published for optional future UI', () => {
  const script = read('public/scripts/schoolDeletionGuard.js');
  assert.match(script, /SchoolDeletionGuard/);
  assert.match(script, /deletion-preview/);
  assert.match(script, /DELETE_BLOCKED|canDelete/);
});

test('error page renders structured delete blocked details', () => {
  const errorView = read('../../MVC/views/error.ejs');
  assert.match(errorView, /isDeleteBlocked/);
  assert.match(errorView, /partials\/deleteBlockedDetails/);
  assert.match(errorView, /delete-blocked-page/);
});

test('program delete uses school delete error response helper', () => {
  const source = read('MVC/controllers/school/programController.js');
  assert.match(source, /respondSchoolDeleteError/);
  assert.doesNotMatch(source, /schoolDeletionGuardService/, 'programController should not import deletion guard service');
});

test('global delete action renders structured blocked preview in modal', () => {
  const mainScript = read('../../public/scripts/main.js');
  assert.match(mainScript, /renderDeleteBlockedPreview/);
  assert.match(mainScript, /DELETE_BLOCKED/);
});
