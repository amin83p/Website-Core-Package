const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetManualConflictService = require('../MVC/services/school/timesheetManualConflictService');

test('manual overlap skips schedule event for the same bound activity work session', () => {
  const candidates = [{
    sessionId: 'MAN-1',
    classId: '',
    activityId: '705736',
    activityEntryId: 'ENTRY-1',
    className: 'LINC: Afternoon Class',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:00',
    isTimed: true
  }];
  const scheduleEvents = [{
    id: 'ACT-705736-ENTRY-1-TEACHER',
    activityId: '705736',
    activityEntryId: 'ENTRY-1',
    label: 'LINC: Afternoon Class',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:30'
  }];
  const conflicts = timesheetManualConflictService.detectManualOverlapConflicts(candidates, scheduleEvents);
  assert.equal(conflicts.length, 0);
});

test('manual overlap skips schedule event by activity and class label when entry id missing', () => {
  const candidates = [{
    sessionId: 'MAN-705736-0014',
    activityId: '705736',
    activityEntryId: '',
    className: 'LINC: Afternoon Class',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:00',
    isTimed: true
  }];
  const scheduleEvents = [{
    activityId: '705736',
    activityEntryId: 'ENTRY-1',
    label: 'LINC: Afternoon Class',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:30'
  }];
  const conflicts = timesheetManualConflictService.detectManualOverlapConflicts(candidates, scheduleEvents);
  assert.equal(conflicts.length, 0);
});

test('manual overlap skips when class label is short title matching schedule prefix label', () => {
  const candidates = [{
    sessionId: 'MAN-705736-0014',
    activityId: '705736',
    activityEntryId: '',
    className: 'Afternoon Class',
    activityName: 'LINC',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:00',
    isTimed: true
  }];
  const scheduleEvents = [{
    activityId: '705736',
    activityEntryId: 'ENTRY-1',
    label: 'LINC: Afternoon Class',
    date: '2026-08-13',
    startTime: '12:30',
    endTime: '15:30'
  }];
  const conflicts = timesheetManualConflictService.detectManualOverlapConflicts(candidates, scheduleEvents);
  assert.equal(conflicts.length, 0);
});

test('manual overlap still flags a different activity schedule event', () => {
  const candidates = [{
    sessionId: 'MAN-1',
    activityId: '705736',
    activityEntryId: 'ENTRY-1',
    date: '2026-08-13',
    startTime: '11:00',
    endTime: '15:00',
    isTimed: true
  }];
  const scheduleEvents = [{
    activityId: '705736',
    activityEntryId: 'ENTRY-2',
    label: 'LINC: Morning Class',
    date: '2026-08-13',
    startTime: '09:00',
    endTime: '12:00'
  }];
  const conflicts = timesheetManualConflictService.detectManualOverlapConflicts(candidates, scheduleEvents);
  assert.ok(conflicts.length >= 1);
});
