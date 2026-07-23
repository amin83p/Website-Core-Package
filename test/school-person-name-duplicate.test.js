const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const service = require('../packages/school/MVC/services/school/schoolPersonNameDuplicateService');

test('normalizeNamePart trims, collapses spaces, and lowercases', () => {
  assert.equal(service.normalizeNamePart('  Ana   Maria '), 'ana maria');
  assert.equal(service.normalizeNamePart('ALVARENGA'), 'alvarenga');
  assert.equal(service.normalizeNamePart(''), '');
});

test('collectExactNameMatches matches case-insensitive first+last only', () => {
  const persons = [
    { id: 'P1', name: { first: 'Maria', last: 'Alvarenga' }, contact: { email: 'a@example.com' } },
    { id: 'P2', name: { first: 'maria', last: 'ALVARENGA' }, contact: { emails: [{ email: 'b@example.com' }] } },
    { id: 'P3', name: { first: 'Maria', middle: 'X', last: 'Alvarez' }, contact: { email: 'c@example.com' } },
    { id: 'P4', name: { first: 'Jose', last: 'Alvarenga' }, contact: { email: 'd@example.com' } }
  ];

  const matches = service.collectExactNameMatches(persons, 'Maria', 'Alvarenga');
  assert.deepEqual(matches.map((row) => row.personId), ['P1', 'P2']);
  assert.equal(matches[0].email, 'a@example.com');
  assert.equal(matches[0].displayName, 'Maria Alvarenga');
});

test('collectExactNameMatches returns empty for incomplete names', () => {
  const persons = [
    { id: 'P1', name: { first: 'Maria', last: 'Alvarenga' } }
  ];
  assert.deepEqual(service.collectExactNameMatches(persons, '', 'Alvarenga'), []);
  assert.deepEqual(service.collectExactNameMatches(persons, 'Maria', ''), []);
});

test('isNameDuplicateAcknowledged accepts common truthy values', () => {
  assert.equal(service.isNameDuplicateAcknowledged({ acknowledgeNameDuplicate: '1' }), true);
  assert.equal(service.isNameDuplicateAcknowledged({ acknowledgeNameDuplicate: true }), true);
  assert.equal(service.isNameDuplicateAcknowledged({ acknowledgeNameDuplicate: 'yes' }), true);
  assert.equal(service.isNameDuplicateAcknowledged({ acknowledgeNameDuplicate: '0' }), false);
  assert.equal(service.isNameDuplicateAcknowledged({}), false);
});

test('buildNameDuplicateWarningError sets 409 NAME_DUPLICATE_WARNING', () => {
  const error = service.buildNameDuplicateWarningError([
    { personId: 'P1', displayName: 'Maria Alvarenga', email: 'a@example.com' }
  ]);
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, service.NAME_DUPLICATE_WARNING_CODE);
  assert.equal(error.details.matches.length, 1);
});

test('student/teacher/staff routes wire api/name-matches with CREATE access', () => {
  const roots = [
    ['packages/school/MVC/routes/studentRoutes.js', 'SCHOOL_STUDENTS'],
    ['packages/school/MVC/routes/teacherRoutes.js', 'SCHOOL_TEACHERS'],
    ['packages/school/MVC/routes/staffRoutes.js', 'SCHOOL_STAFF']
  ];

  for (const [relativePath, section] of roots) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /\/api\/name-matches/);
    assert.match(source, /listNameMatches/);
    assert.match(source, new RegExp(`requireAccess\\(SECTIONS\\.${section}, OPERATIONS\\.CREATE\\)`));
  }
});

test('student/teacher/staff controllers expose listNameMatches and soft-gate', () => {
  const controllers = [
    'packages/school/MVC/controllers/school/studentController.js',
    'packages/school/MVC/controllers/school/teacherController.js',
    'packages/school/MVC/controllers/school/staffController.js'
  ];
  for (const relativePath of controllers) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /exports\.listNameMatches\s*=/);
    assert.match(source, /assertNoExactNameDuplicateOrThrow/);
    assert.match(source, /isNameDuplicateAcknowledged/);
  }
});

test('student/teacher/staff forms include name-duplicate confirm helpers', () => {
  const forms = [
    'packages/school/MVC/views/school/student/studentForm.ejs',
    'packages/school/MVC/views/school/teacher/teacherForm.ejs',
    'packages/school/MVC/views/school/staff/staffForm.ejs'
  ];
  for (const relativePath of forms) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /fetchExactNameMatches/);
    assert.match(source, /confirmNameDuplicateMatches/);
    assert.match(source, /acknowledgeNameDuplicate/);
    assert.match(source, /NAME_DUPLICATE_WARNING/);
  }
});
