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
