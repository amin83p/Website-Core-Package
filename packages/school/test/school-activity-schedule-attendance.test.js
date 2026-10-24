const test = require('node:test');
const assert = require('node:assert/strict');

const activityService = require('../MVC/services/school/activityService');

test('buildActivityScheduleCompletionScan treats absent and excused as recorded attendance', () => {
  const activity = { evaluationType: 'attendance' };
  assert.equal(activityService.buildActivityScheduleCompletionScan(activity, { status: 'attended' }).isComplete, true);
  assert.equal(activityService.buildActivityScheduleCompletionScan(activity, { status: 'absent' }).isComplete, true);
  assert.equal(activityService.buildActivityScheduleCompletionScan(activity, { status: 'excused' }).isComplete, true);
  assert.equal(activityService.buildActivityScheduleCompletionScan(activity, { status: '' }).isComplete, false);
});

test('buildActivityTimesheetRowStatus marks absent as final attendance', () => {
  const activity = { evaluationType: 'attendance' };
  const absent = activityService.buildActivityTimesheetRowStatus(activity, { status: 'absent' });
  assert.equal(absent.isFinalStatus, true);
  assert.equal(absent.statusCode, 'absent');
  const attended = activityService.buildActivityTimesheetRowStatus(activity, { status: 'attended' });
  assert.equal(attended.isFinalStatus, true);
  assert.equal(attended.statusCode, 'attended');
});

test('isRecordedAttendanceStatus helper', () => {
  assert.equal(activityService.isRecordedAttendanceStatus('absent'), true);
  assert.equal(activityService.isRecordedAttendanceStatus('pending'), false);
});

test('isAssigneeTimesheetCountableStatus includes excused not absent', () => {
  assert.equal(activityService.isAssigneeTimesheetCountableStatus('attended'), true);
  assert.equal(activityService.isAssigneeTimesheetCountableStatus('excused'), true);
  assert.equal(activityService.isAssigneeTimesheetCountableStatus('absent'), false);
});
