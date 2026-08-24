'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('student import routes use IMPORT access, upload, and import controller', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  assert.match(routes, /studentImportController/);
  assert.match(routes, /router\.post\('\/import\/preview'/);
  assert.match(routes, /router\.post\('\/import\/process'/);
  assert.match(routes, /OPERATIONS\.IMPORT/);
  assert.match(routes, /adminApproval/);
  assert.match(routes, /upload\('imports'\)\.single\('importFile'\)/);
  assert.match(routes, /previewImport/);
  assert.match(routes, /processImport/);
});

test('studentImportController uses preview and process endpoints and admission service', () => {
  const source = read('packages/school/MVC/controllers/school/studentImportController.js');
  assert.match(source, /previewImport/);
  assert.match(source, /processImport/);
  assert.match(source, /admitNewPersonAndStudentFromRecord/);
  assert.match(source, /validateImportRecord/);
  assert.match(source, /buildContext/);
  assert.match(source, /programRegistrationApplyService/);
  assert.match(source, /parseProgramRegistrationSelectionRows/);
  assert.match(source, /canCreateOrgScopedItem.*program registrations/);
  assert.doesNotMatch(source, /personMode.*existing/);
});

test('student import modal includes programs step and continue flow', () => {
  const modal = read('packages/school/MVC/views/school/student/modal_StudentImport.ejs');
  assert.match(modal, /id="studentImportProgramsContent"/);
  assert.match(modal, /id="studentImportContinueBtn"/);
  assert.match(modal, /id="studentImportBackBtn"/);
  assert.match(modal, /Step 4/);
  assert.match(modal, /programRegistrationSelections/);
  assert.match(modal, /GenericPickerPresets\.program/);
});

test('layout includes GenericPicker when student import modal is enabled', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  assert.match(layout, /includeModal_StudentImport[\s\S]*modal_GenericPicker/);
});

test('validateProgramSelectionsForStudent rejects registration before enrollment', () => {
  const { validateProgramSelectionsForStudent } = require('../packages/school/MVC/utils/programRegistrationSelectionUtils');
  const selections = [{
    programId: 'prog-1',
    registrationDate: '2025-12-01',
    externalReference: '',
    note: ''
  }];
  assert.throws(
    () => validateProgramSelectionsForStudent(selections, '2026-01-01'),
    /on or after the Admission Date/i
  );
  const normalized = validateProgramSelectionsForStudent(selections, '2025-01-01');
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].programId, 'prog-1');
});

test('studentPersonAdmissionService rejects personId and applies create defaults', () => {
  const service = require('../packages/school/MVC/services/school/studentPersonAdmissionService');
  assert.throws(
    () => service.validateImportRecord({ firstName: 'A', lastName: 'B', gender: 'male', personId: '123' }),
    /Remove personId/i
  );

  const row = service.validateImportRecord({
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female'
  }, { orgToday: '2026-07-22' });

  assert.equal(row.dateOfBirth, '2000-01-01');
  assert.equal(row.countryOfOrigin, 'Canada');
  assert.equal(row.feeCategory, 'Domestic');
  assert.equal(row.enrollmentDate, '2026-01-01');
  assert.match(row.email, /^[a-z0-9]{14}@equilibrium\.ab\.ca$/);
});

test('student directory enables file import modal like other core list pages', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /includeModal_StudentImport:\s*Boolean\(canCreateStudents\)/);
  assert.match(controller, /canCreateProgramRegistrations/);
  assert.match(controller, /newUrl:\s*'school\/students'/);
  assert.match(controller, /newLabel:\s*canCreateStudents\s*\?\s*'Admit Student'/);

  const form = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.doesNotMatch(form, /id="openBatchModalBtn"/);
  assert.doesNotMatch(form, /id="studentImportHint"/);
});
