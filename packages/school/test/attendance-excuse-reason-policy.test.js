const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../MVC/services/school/attendanceExcuseReasonPolicyService');
const attendanceAccessService = require('../MVC/services/school/attendanceAccessService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

test('DEFAULT_REASONS includes user seed list and normalizes to 17 unique items', () => {
  assert.equal(service.DEFAULT_REASONS.length, 17);
  assert.ok(service.DEFAULT_REASONS.includes('Appointment (Not Medcial).'));
  assert.ok(service.DEFAULT_REASONS.includes("Doctors' Appointment"));
});

test('normalizeReasons trims, dedupes case-insensitively, and caps length', () => {
  const rows = service.normalizeReasons([' Sick. ', 'sick.', '  ', 'A'.repeat(250)]);
  assert.deepEqual(rows, ['Sick.', 'A'.repeat(200)]);
});

test('sortReasonsForDisplay sorts alphabetically', () => {
  const sorted = service.sortReasonsForDisplay(['Zebra', 'apple', 'Mango']);
  assert.deepEqual(sorted, ['apple', 'Mango', 'Zebra']);
});

test('resolvePolicy falls back to defaults when org has no custom list', () => {
  const resolved = service.resolvePolicy(null);
  assert.equal(resolved.usesCustomList, false);
  assert.equal(resolved.reasons.length, 17);
  assert.deepEqual(resolved.reasons, service.sortReasonsForDisplay([...service.DEFAULT_REASONS]));
});

test('canManageExcuseReasonCatalog allows Family A bypass or admin scope override', () => {
  assert.equal(attendanceAccessService.canManageExcuseReasonCatalog({
    adminFlags: { update: true },
    canOverrideSessionLock: false
  }), true);
  assert.equal(attendanceAccessService.canManageExcuseReasonCatalog({
    adminFlags: { update: false },
    canOverrideSessionLock: true
  }), true);
  assert.equal(attendanceAccessService.canManageExcuseReasonCatalog({
    adminFlags: { update: false },
    canOverrideSessionLock: false
  }), false);
});

test('Manage Session attendance details includes excuse reason picker UI', () => {
  assert.match(viewSource, /id="btnPickExcuseReason"/);
  assert.match(viewSource, /installAttendanceExcuseReasonPicker/);
  assert.match(viewSource, /id="modalExcuseRef"/);
});

test('Attendance matrix includes excuse reason picker UI', () => {
  const matrixSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/attendance/attendanceViewer.ejs'),
    'utf8'
  );
  assert.match(matrixSource, /id="btnPickCellExcuseReason"/);
  assert.match(matrixSource, /matrixExcuseReasonPicker/);
  assert.match(matrixSource, /attendanceExcuseReasonPickerClient\.js/);
});
