const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../packages/school/MVC/services/school/schoolRoleSystemIdMigrationService');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Teacher and Staff generators use their five-digit System Record ID formats', () => {
  assert.match(service.generateCandidate('teacher'), /^TCH\d{5}$/);
  assert.match(service.generateCandidate('staff'), /^STF\d{5}$/);
});

test('Teacher migration replaces exact legacy role aliases without changing canonical Person IDs', () => {
  const source = { id: 'TCH10001', orgId: 'ORG_1', personId: 'PER_1', teacherAccountId: 'ACC_1' };
  const classes = [{ id: 'CLS_1', orgId: 'ORG_1', instructors: [{ personId: 'TCH10001', name: 'Teacher' }, { personId: 'PER_1', name: 'Teacher' }], sessions: [{ delivery: { deliveredBy: 'TCH10001' } }] }];
  const result = service.transformDataset('classes', classes, 'teacher', 'TCH10001', 'TCH20002', 'ORG_1', source);
  assert.equal(result.value[0].instructors[0].personId, 'TCH20002');
  assert.equal(result.value[0].instructors[1].personId, 'PER_1');
  assert.equal(result.value[0].sessions[0].delivery.deliveredBy, 'TCH20002');
});

test('role migration leaves matching aliases in another organization unchanged', () => {
  const source = { id: 'TCH10001', orgId: 'ORG_1', personId: 'PER_1' };
  const tasks = [
    { id: 'TSK_1', orgId: 'ORG_1', assignedPersonId: 'TCH10001' },
    { id: 'TSK_2', orgId: 'ORG_2', assignedPersonId: 'TCH10001' }
  ];
  const result = service.transformDataset('tasks', tasks, 'teacher', 'TCH10001', 'TCH20002', 'ORG_1', source);
  assert.equal(result.value[0].assignedPersonId, 'TCH20002');
  assert.equal(result.value[1].assignedPersonId, 'TCH10001');
});

test('Staff migration updates only default-derived linked account fields', () => {
  const source = { id: 'STF10001', orgId: 'ORG_1', personId: 'PER_2', staffAccountId: 'ACC_1' };
  const derived = service.transformDataset('accounts', [{ id: 'ACC_1', orgId: 'ORG_1', code: 'STF_STF10001', description: 'Auto-created for generated sample staff STF10001.' }], 'staff', 'STF10001', 'STF20002', 'ORG_1', source).value[0];
  assert.equal(derived.code, 'STF_STF20002');
  assert.equal(derived.description, 'Auto-created for generated sample staff STF20002.');
  const customized = service.transformDataset('accounts', [{ id: 'ACC_1', orgId: 'ORG_1', code: 'CUSTOM', description: 'Custom description' }], 'staff', 'STF10001', 'STF20002', 'ORG_1', source).value[0];
  assert.equal(customized.code, 'CUSTOM');
  assert.equal(customized.description, 'Custom description');
});

test('Teacher and Staff routes/controllers expose administrator-protected migration operations', () => {
  const teacherRoutes = read('packages/school/MVC/routes/teacherRoutes.js');
  const staffRoutes = read('packages/school/MVC/routes/staffRoutes.js');
  const teacherController = read('packages/school/MVC/controllers/school/teacherController.js');
  const staffController = read('packages/school/MVC/controllers/school/staffController.js');
  for (const source of [teacherRoutes, staffRoutes]) {
    assert.match(source, /:id\/system-id-impact/);
    assert.match(source, /:id\/system-id-generate/);
    assert.match(source, /:id\/change-system-id/);
  }
  assert.match(teacherController, /Only administrators can change a Teacher System Record ID/);
  assert.match(staffController, /Only administrators can change a Staff System Record ID/);
  assert.match(teacherController, /isAdminForRequestAsync/);
  assert.match(staffController, /isAdminForRequestAsync/);
});

test('Teacher and Staff directories expose the shared migration modal', () => {
  const teacher = read('packages/school/MVC/views/school/teacher/teacherList.ejs');
  const staff = read('packages/school/MVC/views/school/staff/staffList.ejs');
  const partial = read('packages/school/MVC/views/school/partials/roleSystemIdMigration.ejs');
  assert.match(teacher, /data-role-type="teacher"/);
  assert.match(staff, /data-role-type="staff"/);
  assert.match(teacher, /roleSystemIdMigration/);
  assert.match(staff, /roleSystemIdMigration/);
  assert.match(partial, /document\.body\.appendChild\(modalEl\)/);
  assert.match(partial, /window\.showLoading/);
  assert.match(partial, /window\.hideLoading\(token\)/);
  assert.doesNotMatch(partial, /loading\?\.close/);
  assert.match(partial, /confirmationId/);
  assert.match(partial, /currentActionStateId = payload\.actionStateId/);
  assert.match(partial, /actionStateId: currentActionStateId/);
});

test('migration implementation includes JSON rollback, Mongo compensation, verification, journals, and audits', () => {
  const source = read('packages/school/MVC/services/school/schoolRoleSystemIdMigrationService.js');
  assert.match(source, /queueWrite/);
  assert.match(source, /withMongoTransaction/);
  assert.match(source, /transactionMode: 'compensating'/);
  assert.match(source, /schoolRoleSystemIdMigrationJournals/);
  assert.match(source, /schoolRoleSystemIdMigrations/);
  assert.match(source, /remaining\.totalUpdates !== 0/);
  assert.match(source, /rollbackStatus = 'recovery_required'/);
});
