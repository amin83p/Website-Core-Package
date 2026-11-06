'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('schoolRollingEnrollmentAccessService exposes canAccessRollingEnrollment', () => {
  const src = read('packages/school/MVC/services/school/schoolRollingEnrollmentAccessService.js');
  assert.match(src, /SCHOOL_ROLLING_ENROLLMENT/);
  assert.match(src, /canAccessRollingEnrollment/);
});

test('schoolRollingEnrollmentDeepLink exposes URL builder and menu init', () => {
  const src = read('packages/school/public/scripts/schoolRollingEnrollmentDeepLink.js');
  assert.match(src, /buildRollingEnrollmentUrl/);
  assert.match(src, /initRollingEnrollmentContextMenu/);
  assert.match(src, /searchFields/);
});

test('attendance matrix payload includes registrationMode key', () => {
  const src = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(src, /registrationMode:\s*registrationMode\s*===\s*'rolling'\s*\?\s*'rolling'\s*:\s*'term_based'/);
});

test('conduct matrix payload includes registrationMode key', () => {
  const src = read('packages/school/MVC/services/school/conductMatrixService.js');
  assert.match(src, /registrationMode:\s*isRollingClass\s*\?\s*'rolling'\s*:\s*'term_based'/);
});

test('rolling enrollment page syncs search inputs after loadRows', () => {
  const src = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(src, /syncRollingEnrollmentSearchInputsFromUrl/);
  assert.match(src, /getElementById\('searchInput'\)/);
});

test('matrix and report views load rolling deep-link script when canOpenRollingEnrollment', () => {
  const files = [
    'packages/school/MVC/views/school/attendance/attendanceViewer.ejs',
    'packages/school/MVC/views/school/grades/gradesMatrix.ejs',
    'packages/school/MVC/views/school/report/conductMatrix.ejs',
    'packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs',
    'packages/school/MVC/views/school/report/classConductReport.ejs',
    'packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'
  ];
  files.forEach((rel) => {
    const src = read(rel);
    assert.match(src, /canOpenRollingEnrollment/);
    assert.match(src, /schoolRollingEnrollmentDeepLink\.js/);
    assert.match(src, /__schoolRollingEnrollmentAccess/);
  });
});

test('SAR/CCR/semi-monthly services attach registrationMode to class rows', () => {
  const sar = read('packages/school/MVC/services/school/studentAttendanceReportService.js');
  assert.match(sar, /registrationMode:\s*payload\.registrationMode\s*\|\|\s*registrationModeKeyFromClassRow/);
  assert.match(sar, /registrationMode:\s*registrationModeKeyFromClassRow/);
  const ccr = read('packages/school/MVC/services/school/classConductReportService.js');
  assert.match(ccr, /registrationMode:\s*payload\.registrationMode\s*\|\|\s*registrationModeKeyFromClassRow/);
  const smmr = read('packages/school/MVC/services/school/schoolSemiMonthlyReportService.js');
  assert.match(smmr, /registrationMode:\s*registrationMode\s*\|\|\s*'term_based'/);
});
