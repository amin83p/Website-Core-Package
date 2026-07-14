const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../packages/school/MVC/services/school/studentSystemIdMigrationService');
const { generateStudentSystemIdCandidate } = require('../packages/school/MVC/services/school/studentSystemIdGenerator');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const OLD = 'STU10001';
const NEXT = 'STU20002';
const ORG = 'ORG-1';

function migrate(key, rows) {
  return service.transformRows(key, rows, OLD, NEXT, ORG);
}

test('student System Record ID registry covers every persisted reference family', () => {
  const keys = new Set(service.REFERENCE_REGISTRY.map((row) => row.key));
  [
    'students', 'studentProgramRegistrations', 'studentTermRegistrations', 'studentProgramPriorSubjects',
    'classEnrollmentPeriods', 'classes', 'academicLedger', 'academicSnapshots', 'globalTransactions',
    'withdrawals', 'reportInstances', 'reportAssignments', 'examAllocations', 'examAssignments',
    'examAttempts', 'examAnswers'
  ].forEach((key) => assert.equal(keys.has(key), true, key));
});

test('transformRows cascades direct, nested, array, and derived student references', () => {
  assert.equal(migrate('students', [{ id: OLD, orgId: ORG }]).rows[0].id, NEXT);
  for (const key of ['studentProgramRegistrations', 'studentTermRegistrations', 'studentProgramPriorSubjects', 'classEnrollmentPeriods', 'academicLedger', 'examAssignments', 'examAttempts', 'examAnswers']) {
    assert.equal(migrate(key, [{ id: key, orgId: ORG, studentId: OLD }]).rows[0].studentId, NEXT, key);
  }

  const classResult = migrate('classes', [{ id: 'CLASS-1', orgId: ORG, enrollment: { students: [{ studentId: OLD, personId: 'PER-1' }] } }]);
  assert.equal(classResult.rows[0].enrollment.students[0].studentId, NEXT);

  const snapshot = migrate('academicSnapshots', [{ id: 'ASNP-' + OLD + '-PROG-1', orgId: ORG, studentId: OLD, programId: 'PROG-1' }]).rows[0];
  assert.equal(snapshot.studentId, NEXT);
  assert.equal(snapshot.id, 'ASNP-' + NEXT + '-PROG-1');

  assert.equal(migrate('globalTransactions', [{ orgId: ORG, party: { studentId: OLD, amount: 10 } }]).rows[0].party.studentId, NEXT);
  const withdrawal = migrate('withdrawals', [{ orgId: ORG, studentId: OLD, rosterImpact: { removedEnrollments: [{ studentId: OLD }] } }]).rows[0];
  assert.equal(withdrawal.studentId, NEXT);
  assert.equal(withdrawal.rosterImpact.removedEnrollments[0].studentId, NEXT);

  const report = migrate('reportInstances', [{ orgId: ORG, studentId: OLD, targetKey: 'student:' + OLD }]).rows[0];
  assert.equal(report.studentId, NEXT);
  assert.equal(report.targetKey, 'student:' + NEXT);
  assert.deepEqual(migrate('reportAssignments', [{ orgId: ORG, targetStudentIds: [OLD, 'OTHER'] }]).rows[0].targetStudentIds, [NEXT, 'OTHER']);
  assert.deepEqual(migrate('examAllocations', [{ orgId: ORG, extensions: { exemptStudentIds: [OLD, 'OTHER'] } }]).rows[0].extensions.exemptStudentIds, [NEXT, 'OTHER']);
});

test('transformRows leaves other organizations and person-based values unchanged', () => {
  const otherOrg = migrate('academicLedger', [{ orgId: 'ORG-2', studentId: OLD }]);
  assert.equal(otherOrg.rows[0].studentId, OLD);
  assert.equal(otherOrg.count, 0);
  assert.equal(service.REFERENCE_REGISTRY.some((row) => ['sessionStudentCases', 'leaveRequests', 'tasks', 'student_enrollments'].includes(row.key)), false);
});

test('generated student System Record IDs use normal STU format and avoid collisions', () => {
  const id = service.generateCandidate(new Set(['STU12345']));
  assert.match(id, /^STU\d{5}$/);
  assert.notEqual(id, 'STU12345');
});

test('student admission and System Record ID migration use the same generator', () => {
  const id = generateStudentSystemIdCandidate(new Set(['STU12345']));
  const model = read('packages/school/MVC/models/school/studentModel.js');
  const repository = read('packages/school/MVC/repositories/school/index.js');
  const migration = read('packages/school/MVC/services/school/studentSystemIdMigrationService.js');

  assert.match(id, /^STU\d{5}$/);
  assert.match(model, /generateStudentSystemIdCandidate\(existingIds\)/);
  assert.match(repository, /generateMongoCreateId:[\s\S]*?generateStudentSystemIdCandidate/);
  assert.match(migration, /generateCandidate = generateStudentSystemIdCandidate/);
});

test('routes, controller, and directory expose guarded migration flow', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  const view = read('packages/school/MVC/views/school/student/studentList.ejs');
  const mongo = read('MVC/infrastructure/mongo/mongoConnection.js');
  assert.match(routes, /:id\/system-id-impact/);
  assert.match(routes, /:id\/system-id-generate/);
  assert.match(routes, /:id\/change-system-id/);
  assert.match(controller, /Only administrators can change a student System Record ID/);
  assert.match(controller, /isAdminForRequestAsync\([\s\S]*?SECTIONS\.SCHOOL_STUDENTS,[\s\S]*?OPERATIONS\.UPDATE/);
  assert.doesNotMatch(controller, /isAdminAsync\(req\.user\)/);
  assert.match(controller, /confirmationId/);
  assert.match(view, /Change System Record ID/);
  assert.match(view, /document\.body\.appendChild\(modalEl\)/);
  assert.match(view, /changeSystemIdImpact/);
  assert.match(view, /Custom Student ID is not changed/);
  assert.match(view, /Security Validation Failed/);
  assert.match(view, /formatMessageMarkup/);
  assert.match(view, /encodeURIComponent\(currentEl\.value\) \+ '\/system-id-generate'/);
  assert.doesNotMatch(view, /\/school\/students\/system-id\/generate/);
  assert.match(mongo, /withMongoTransaction/);
  assert.match(mongo, /getMongoTransactionCapability/);
  assert.match(view, /Standalone MongoDB detected/);
  assert.match(view, /showLoading/);
  assert.match(routes, /system-id-migrations\/:migrationId\/recover/);
});

test('standalone Mongo migration uses journaled compare-and-swap rollback', () => {
  const source = read('packages/school/MVC/services/school/studentSystemIdMigrationService.js');
  assert.match(source, /transactionMode: 'compensating'/);
  assert.match(source, /schoolStudentSystemIdMigrationJournals/);
  assert.match(source, /schoolStudentSystemIdMigrationBackups/);
  assert.match(source, /replacementFilter\(backup\.before\)/);
  assert.match(source, /rollbackStandaloneMigration/);
  assert.match(source, /recovery_required/);
  assert.match(source, /getMongoTransactionCapability/);
});

test('School writes honor the distributed Student ID migration lock', () => {
  const dataService = read('packages/school/MVC/services/school/schoolDataService.js');
  const lockService = read('packages/school/MVC/services/school/studentSystemIdMigrationLockService.js');
  assert.match(dataService, /studentSystemIdMigrationLockService\.assertWriteAllowed/);
  assert.match(lockService, /expiresAt: \{ \$gt: new Date\(\) \}/);
  assert.match(lockService, /STUDENT_ID_MIGRATION_IN_PROGRESS/);
});

test('JSON migration implementation stages backups, verifies, and restores on failure', () => {
  const source = read('packages/school/MVC/services/school/studentSystemIdMigrationService.js');
  assert.match(source, /queueWrite\(async \(\) =>/);
  assert.match(source, /Post-migration verification failed/);
  assert.match(source, /await fs\.rename\(item\.backup, item\.target\)\.catch/);
  assert.match(source, /studentSystemIdMigrations\.json/);
});
