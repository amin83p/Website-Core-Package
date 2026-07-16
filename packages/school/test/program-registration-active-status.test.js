const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');

test('program active lookup excludes terminal registrations and keeps blocking statuses', async () => {
  const originalFindByStudentAndProgram = schoolRepositories.studentProgramRegistrations.findByStudentAndProgram;
  schoolRepositories.studentProgramRegistrations.findByStudentAndProgram = async () => ([
    { id: 'VOID', status: 'void' },
    { id: 'COMPLETED', status: 'completed' },
    { id: 'WITHDRAWN', status: 'withdrawn' },
    { id: 'CANCELLED', status: 'cancelled' },
    { id: 'ROLLED-BACK', status: 'rolled_back' },
    { id: 'DRAFT', status: 'draft' },
    { id: 'REGISTERED', status: 'registered' },
    { id: 'ERROR', status: 'error' }
  ]);

  try {
    const active = await schoolRepositories.studentProgramRegistrations.findActiveByStudentAndProgram('STU-1', 'PRG-2');
    assert.deepEqual(active.map((row) => row.id), ['DRAFT', 'REGISTERED', 'ERROR']);
  } finally {
    schoolRepositories.studentProgramRegistrations.findByStudentAndProgram = originalFindByStudentAndProgram;
  }
});

test('program registration duplicate lookup remains scoped to the selected program id', () => {
  const repositorySource = fs.readFileSync(
    path.join(__dirname, '../MVC/repositories/school/index.js'),
    'utf8'
  );

  const lookup = repositorySource.slice(
    repositorySource.indexOf('schoolRepositories.studentProgramRegistrations.findByStudentAndProgram'),
    repositorySource.indexOf('function isInactiveRegistrationStatus')
  );
  assert.match(lookup, /studentId__eq: studentId/);
  assert.match(lookup, /programId__eq: programId/);
});

test('rolling enrollment preserves and renders structured program-registration save errors', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/programRegistrationController.js'),
    'utf8'
  );
  const viewSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
    'utf8'
  );

  assert.match(controllerSource, /feeCategory: preview\.feeCategory/);
  assert.match(controllerSource, /studentAccountId: preview\.studentAccountId/);
  assert.match(controllerSource, /issues: \[message\]/);
  assert.match(viewSource, /\{ allowErrorResult: true \}/);
  assert.match(viewSource, /setProgramRegistrationShortcutFeedback\('danger', result\.message/);
  assert.match(viewSource, /row\?\.message && !issues\.length/);
});
