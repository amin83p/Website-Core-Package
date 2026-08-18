const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('../packages/school/MVC/services/school/sessionStatusPolicyService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function buildStatusMap(definition) {
  return new Map([[policy.normalizeStatusCode(definition.code), definition]]);
}

test('calculateMakeupSessionDurationHours applies percent to original duration', () => {
  assert.equal(policy.calculateMakeupSessionDurationHours(3, 50), 1.5);
  assert.equal(policy.calculateMakeupSessionDurationHours(2, 100), 2);
});

test('calculateTimesheetHoursByMap uses full duration with formula for make-up-required original', () => {
  const statusMap = buildStatusMap({
    code: 'missed_partial',
    makeUpRequired: true,
    makeupDurationPercent: 50,
    timesheetFormula: 'duration * 0.5'
  });
  const session = {
    status: 'missed_partial',
    makeupScheduling: {
      durationPercent: 50
    }
  };
  assert.equal(policy.calculateTimesheetHoursByMap(statusMap, {
    status: 'missed_partial',
    durationHours: 3,
    session
  }), 1.5);
});

test('calculateTimesheetHoursByMap uses full duration with formula regardless of makeup percent', () => {
  const statusMap = buildStatusMap({
    code: 'missed_partial',
    makeUpRequired: true,
    makeupDurationPercent: 50,
    timesheetFormula: 'duration'
  });
  assert.equal(policy.calculateTimesheetHoursByMap(statusMap, {
    status: 'missed_partial',
    durationHours: 3
  }), 3);
});

test('buildClientStatusMeta exposes makeup duration percent', () => {
  const meta = policy.buildClientStatusMeta([{
    code: 'missed_partial',
    label: 'Missed Partial',
    makeUpRequired: true,
    makeupDurationPercent: 50,
    timesheetFormula: 'duration',
    isFinal: true,
    excludeFromAttendance: false,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 10,
    colorBg: '#fff',
    colorText: '#000',
    colorBorder: '#ccc'
  }]);
  assert.equal(meta[0].makeupDurationPercent, 50);
  assert.equal('remainingTimeTimesheetBehavior' in meta[0], false);
});

test('session status form and makeup modals expose makeup duration controls', () => {
  const form = read('packages/school/MVC/views/school/sessionStatus/sessionStatusForm.ejs');
  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const hub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const controller = read('packages/school/MVC/controllers/school/classController.js');

  assert.match(form, /makeupDurationPercent/);
  assert.doesNotMatch(form, /remainingTimeTimesheetBehavior/);
  assert.match(form, /session-status-rule-group/);
  assert.match(form, /makeup-policy-panel/);
  assert.match(form, /Session Lifecycle/);
  assert.match(form, /Schedule Indexes/);
  assert.match(sessionManager, /makeupSessionDurationPercent/);
  assert.match(sessionManager, /makeupDurationPercent/);
  assert.doesNotMatch(sessionManager, /sessionRemainingTimesheetBehavior/);
  assert.match(hub, /hubMakeupSessionDurationPercent/);
  assert.doesNotMatch(hub, /hubMakeupRemainingTimesheetBehavior/);
  assert.match(controller, /makeupScheduling/);
  assert.match(controller, /durationPercent/);
  assert.doesNotMatch(controller, /remainingTimeTimesheetBehavior/);
});

test('normalizeAccessType defaults unknown values to users', () => {
  assert.equal(policy.normalizeAccessType(undefined), 'users');
  assert.equal(policy.normalizeAccessType(''), 'users');
  assert.equal(policy.normalizeAccessType('invalid'), 'users');
  assert.equal(policy.normalizeAccessType('admins'), 'admins');
  assert.equal(policy.normalizeAccessType('ADMINS'), 'admins');
});

test('buildClientStatusMeta includes accessType', () => {
  const meta = policy.buildClientStatusMeta([{
    code: 'admin_only',
    label: 'Admin Only',
    accessType: 'admins',
    timesheetFormula: 'duration',
    isFinal: false,
    makeUpRequired: false,
    excludeFromAttendance: false,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 1,
    colorBg: '#fff',
    colorText: '#000',
    colorBorder: '#ccc'
  }]);
  assert.equal(meta[0].accessType, 'admins');
});

test('filterSelectableStatusMeta hides admin statuses unless allowed', () => {
  const rows = [
    { code: 'scheduled', accessType: 'users', active: true },
    { code: 'admin_only', accessType: 'admins', active: true }
  ];
  const filtered = policy.filterSelectableStatusMeta(rows, { allowAdminStatuses: false });
  assert.deepEqual(filtered.map((row) => row.code), ['scheduled']);
  const all = policy.filterSelectableStatusMeta(rows, { allowAdminStatuses: true });
  assert.deepEqual(all.map((row) => row.code), ['scheduled', 'admin_only']);
});

test('assertStatusSelectableByAccess rejects admin status for non-admin selector', () => {
  const statusMap = buildStatusMap({
    code: 'admin_only',
    accessType: 'admins'
  });
  assert.throws(
    () => policy.assertStatusSelectableByAccess('admin_only', statusMap, { allowAdminStatuses: false }),
    /restricted to school session administrators/i
  );
  policy.assertStatusSelectableByAccess('admin_only', statusMap, { allowAdminStatuses: true });
});

test('normalizeSessionStatus maps legacy holiday code to cancelled and ignores holiday notes', () => {
  assert.equal(policy.normalizeSessionStatus('holiday', ''), 'cancelled');
  assert.equal(policy.normalizeSessionStatus('scheduled', 'holiday/off'), 'scheduled');
  assert.equal(policy.normalizeSessionStatus('completed', 'holiday'), 'completed');
});

test('buildClientStatusMeta excludes virtual holiday status code', () => {
  const meta = policy.buildClientStatusMeta([
    { code: 'scheduled', label: 'Scheduled', active: true, sortOrder: 1 },
    { code: 'holiday', label: 'Holiday', active: true, sortOrder: 2 }
  ]);
  assert.deepEqual(meta.map((row) => row.code), ['scheduled']);
});
