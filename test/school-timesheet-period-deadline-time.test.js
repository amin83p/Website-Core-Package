const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetPeriodModel = require('../packages/school/MVC/models/school/timesheetPeriodModel');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function validPayload(overrides = {}) {
  return {
    orgId: '900000',
    name: 'June 1 - 15, 2026',
    startDate: '2026-06-01',
    endDate: '2026-06-15',
    submissionDeadline: '2026-06-16',
    status: 'open',
    ...overrides
  };
}

test('timesheet period model stores and defaults submission deadline time', () => {
  assert.equal(timesheetPeriodModel.DEFAULT_SUBMISSION_DEADLINE_TIME, '23:59');

  const explicit = timesheetPeriodModel.sanitizeTimesheetPeriodInput(validPayload({ submissionDeadlineTime: '17:30' }));
  assert.equal(explicit.submissionDeadline, '2026-06-16');
  assert.equal(explicit.submissionDeadlineTime, '17:30');

  const legacy = timesheetPeriodModel.sanitizeTimesheetPeriodInput(validPayload());
  assert.equal(legacy.submissionDeadlineTime, '23:59');

  assert.throws(
    () => timesheetPeriodModel.sanitizeTimesheetPeriodInput(validPayload({ submissionDeadlineTime: '24:00' })),
    /Invalid Submission Deadline Time/
  );
  assert.throws(
    () => timesheetPeriodModel.sanitizeTimesheetPeriodInput(validPayload({ submissionDeadlineTime: '9:00' })),
    /Invalid Submission Deadline Time/
  );
});

test('timesheet period controller persists submission deadline time', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetPeriodController.js');

  assert.match(source, /submissionDeadline:\s*req\.body\.submissionDeadline/);
  assert.match(source, /submissionDeadlineTime:\s*req\.body\.submissionDeadlineTime\s*\|\|\s*'23:59'/);
});

test('timesheet period and timesheet views display deadline date and time', () => {
  const periodForm = read('packages/school/MVC/views/school/timesheetPeriod/timesheetPeriodForm.ejs');
  const periodList = read('packages/school/MVC/views/school/timesheetPeriod/timesheetPeriodList.ejs');
  const timesheetList = read('packages/school/MVC/views/school/timesheet/timesheetList.ejs');
  const timesheetEditor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const timesheetManage = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const timesheetController = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(periodForm, /const submissionDeadlineTime = p\.submissionDeadlineTime \|\| '23:59'/);
  assert.match(periodForm, /type="time" name="submissionDeadlineTime"/);
  assert.match(periodList, /function formatDeadline\(period\)/);
  assert.match(periodList, /formatDeadline\(item\)/);
  assert.match(timesheetList, /function formatDeadline\(period\)/);
  assert.match(timesheetList, /formatDeadline\(p\)/);
  assert.match(timesheetEditor, /deadlineLabel/);
  assert.match(timesheetManage, /function formatPeriodDeadline\(period\)/);
  assert.match(timesheetController, /submissionDeadlineTime:\s*String\(period\?\.submissionDeadlineTime \|\| '23:59'\)/);
});