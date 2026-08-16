const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('student form exposes add-only program registration wizard tab', () => {
  const source = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.doesNotMatch(source, /Edit Student:/);
  assert.match(source, /Edit <%= entityDisplayName %>/);
  assert.match(source, /badge bg-primary border font-monospace">ID: <%= entityRecordId %>/);
  assert.match(source, /id="hid_programRegistrationSelections"/);
  assert.match(source, /data-bs-target="#tab-programs"/);
  assert.match(source, /const wizardTabTargets = \['#tab-general', '#tab-financial', '#tab-programs', '#tab-documents'\]/);
  assert.match(source, /id="btnAddProgramRegistration"/);
  assert.match(source, /Existing Program Registrations/);
  assert.match(source, /\/school\/programs\/registrations\/<%= encodeURIComponent\(String\(registration\.id \|\| ''\)\) %>/);
  assert.match(source, /Manage\s*<\/a>/);
  assert.match(source, /renderProgramRegistrationResult/);
  assert.match(source, /id="studentSaveProgressModal"/);
  assert.match(source, /Successful/);
  assert.match(source, /Failed/);
  assert.match(source, /Not executable/);
});

test('student form validates program registration dates against admission date', () => {
  const source = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.match(source, /const enrollmentDateInput = form\.querySelector\('input\[name="enrollmentDate"\]'\)/);
  assert.match(source, /registrationDate < admissionDate/);
  assert.match(source, /Each program Registration Date must be on or after the Admission Date/);
  assert.match(source, /syncProgramRegistrationSelections\(\)/);
});

test('student controller processes selected programs after student save', () => {
  const source = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(source, /normalizeProgramRegistrationSelections/);
  assert.match(source, /programRegistrationSelections/);
  assert.match(source, /canCreateOrgScopedItem\(req\.user, \{ scopeLabel: 'program registrations' \}\)/);
  assert.match(source, /await txContext\.commit\(\{ flow: 'student_save'/);
  assert.match(source, /processSingleStudentProgramRegistration/);
  assert.match(source, /summarizeRegistrationResults/);
  assert.match(source, /programRegistrations: programRegistrationSummary/);
  assert.match(source, /deferProgramRegistrations/);
  assert.match(source, /personOperation/);
  assert.match(source, /studentOperation/);
  assert.match(source, /studentId: savedStudentId/);
});

test('program registration apply service supports draft and zero-fee finalized paths', () => {
  const source = read('packages/school/MVC/services/school/programRegistrationApplyService.js');
  assert.match(source, /function isZeroFeePreview/);
  assert.match(source, /createDraftRegistrationFromPreview/);
  assert.match(source, /createZeroFeeRegisteredFromPreview/);
  assert.match(source, /status: 'draft'/);
  assert.match(source, /status: 'registered'/);
  assert.match(source, /postProgramRegistration/);
  assert.match(source, /status: 'finalized'/);
});

test('program registration batch controller reuses shared draft helper', () => {
  const source = read('packages/school/MVC/controllers/school/programRegistrationController.js');
  assert.match(source, /programRegistrationApplyService/);
  assert.match(source, /createDraftRegistrationFromPreview/);
});

test('student form runs deferred program registrations with live progress rows', () => {
  const source = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.match(source, /fd\.set\('deferProgramRegistrations', '1'\)/);
  assert.match(source, /createStudentSaveProgressState/);
  assert.match(source, /runProgramRegistrationProgressRows/);
  assert.match(source, /postStudentProgramRegistrationRow/);
  assert.match(source, /\/school\/students\/' \+ encodeURIComponent\(studentId\) \+ '\/program-registrations\/apply-one/);
  assert.match(source, /Retry Failed Registrations/);
});

test('student form per-program endpoint is registered and implemented', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(routes, /\/:id\/program-registrations\/apply-one/);
  assert.match(routes, /SECTIONS\.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS\.CREATE/);
  assert.match(controller, /exports\.applySingleProgramRegistrationFromStudentForm/);
  assert.match(controller, /assertStudentOrgAccess\(student, activeOrgId, req\.user\)/);
  assert.match(controller, /normalizeProgramRegistrationSelections/);
  assert.match(controller, /processSingleStudentProgramRegistration/);
});
