const test = require('node:test');
const assert = require('node:assert/strict');

const timingDetail = require('../MVC/services/school/sessionAttendanceTimingDetailService');

test('late only backfills breakLateMinutes and clears arrival/leave', () => {
  const result = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '1',
    attendance: 'late',
    lateMinutes: 15
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.attendanceArrivalTime, '');
  assert.equal(result.row.attendanceLeaveTime, '');
  assert.equal(result.row.breakLateMinutes, 15);
  assert.equal(result.row.breakEarlyLeaveMinutes, 0);
  assert.equal(result.row.lateMinutes, 15);
  assert.equal(result.row.earlyLeaveMinutes, 0);
});

test('early only backfills breakEarlyLeaveMinutes and clears arrival/leave', () => {
  const result = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '2',
    attendance: 'late',
    earlyLeaveMinutes: 8
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.attendanceArrivalTime, '');
  assert.equal(result.row.attendanceLeaveTime, '');
  assert.equal(result.row.breakLateMinutes, 0);
  assert.equal(result.row.breakEarlyLeaveMinutes, 8);
  assert.equal(result.row.lateMinutes, 0);
  assert.equal(result.row.earlyLeaveMinutes, 8);
});

test('both totals backfill both break fields', () => {
  const result = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '3',
    attendance: 'late',
    lateMinutes: 10,
    earlyLeaveMinutes: 20
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.breakLateMinutes, 10);
  assert.equal(result.row.breakEarlyLeaveMinutes, 20);
  assert.equal(result.row.lateMinutes, 10);
  assert.equal(result.row.earlyLeaveMinutes, 20);
});

test('force overwrite replaces existing detail fields', () => {
  const result = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '4',
    attendance: 'late',
    lateMinutes: 12,
    earlyLeaveMinutes: 0,
    attendanceArrivalTime: '09:10',
    attendanceLeaveTime: '11:30',
    breakLateMinutes: 2,
    breakEarlyLeaveMinutes: 5
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.attendanceArrivalTime, '');
  assert.equal(result.row.attendanceLeaveTime, '');
  assert.equal(result.row.breakLateMinutes, 12);
  assert.equal(result.row.breakEarlyLeaveMinutes, 0);
});

test('zero totals clear detail fields', () => {
  const result = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '5',
    attendance: 'present',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    attendanceArrivalTime: '09:05',
    breakLateMinutes: 3
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.attendanceArrivalTime, '');
  assert.equal(result.row.attendanceLeaveTime, '');
  assert.equal(result.row.breakLateMinutes, 0);
  assert.equal(result.row.breakEarlyLeaveMinutes, 0);
});

test('second pass is idempotent', () => {
  const first = timingDetail.backfillRosterTimingDetailFromTotals({
    personId: '6',
    lateMinutes: 7,
    earlyLeaveMinutes: 4
  });
  const second = timingDetail.backfillRosterTimingDetailFromTotals(first.row);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(second.row, first.row);
});
