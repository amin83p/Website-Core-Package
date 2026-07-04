const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const teacherSource = fs.readFileSync('packages/school/MVC/controllers/school/teacherController.js', 'utf8');
const staffSource = fs.readFileSync('packages/school/MVC/controllers/school/staffController.js', 'utf8');
const studentSource = fs.readFileSync('packages/school/MVC/controllers/school/studentController.js', 'utf8');
const accountSource = fs.readFileSync('packages/school/MVC/controllers/school/schoolAccountController.js', 'utf8');

test('teacher list and detail pass route access context', () => {
  assert.match(teacherSource, /fetchData\('teachers', fetchQuery, req\.user, routeAccess\(req\)\)/);
  assert.match(teacherSource, /getDataById\('teachers', req\.params\.id, req\.user, routeAccess\(req\)\)/);
});

test('staff list and detail pass route access context', () => {
  assert.match(staffSource, /fetchData\('staff', fetchQuery, req\.user, routeAccess\(req\)\)/);
  assert.match(staffSource, /getDataById\('staff', req\.params\.id, req\.user, routeAccess\(req\)\)/);
});

test('student detail and account reads pass route access context', () => {
  assert.match(studentSource, /fetchData\('students', fetchQuery, req\.user, dataService\.buildRouteAccessContext\(req\)\)/);
  assert.match(studentSource, /getDataById\('students', req\.params\.id, req\.user, routeAccess\(req\)\)/);
  assert.match(studentSource, /fetchData\('schoolAccounts', \{\}, req\.user, routeAccess\(req\)\)/);
});

test('school accounts list and detail pass route access context', () => {
  assert.match(accountSource, /fetchData\('schoolAccounts', accountQuery, req\.user, routeAccess\(req\)\)/);
  assert.match(accountSource, /getDataById\('schoolAccounts', req\.params\.id, req\.user, routeAccess\(req\)\)/);
  assert.match(accountSource, /buildAccountOwnerMap\(req\.user, routeAccess\(req\)\)/);
});
