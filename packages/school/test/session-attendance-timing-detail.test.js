const test = require('node:test');
const assert = require('node:assert/strict');

const timingDetail = require('../MVC/services/school/sessionAttendanceTimingDetailService');

test('break-only lateness stores empty arrival and total late minutes', () => {
  const normalized = timingDetail.normalizeAttendanceTimingDetailForSave({
    startTime: '09:00',
    endTime: '12:00',
    arrivalTime: '',
    leaveTime: '',
    breakLateMinutes: 10,
    breakEarlyLeaveMinutes: 0
  });
  assert.equal(normalized.attendanceArrivalTime, '');
  assert.equal(normalized.attendanceLeaveTime, '');
  assert.equal(normalized.breakLateMinutes, 10);
  assert.equal(normalized.lateMinutes, 10);
  assert.equal(normalized.earlyLeaveMinutes, 0);
});

test('arrival late only normalizes on-time start to empty storage', () => {
  const normalized = timingDetail.normalizeAttendanceTimingDetailForSave({
    startTime: '09:00',
    endTime: '12:00',
    arrivalTime: '09:10',
    leaveTime: '12:00',
    breakLateMinutes: 0,
    breakEarlyLeaveMinutes: 0
  });
  assert.equal(normalized.attendanceArrivalTime, '09:10');
  assert.equal(normalized.attendanceLeaveTime, '');
  assert.equal(normalized.lateMinutes, 10);
  assert.equal(normalized.earlyLeaveMinutes, 0);
});

test('combined boundary and break minutes sum into totals', () => {
  const totals = timingDetail.computeAttendanceTimingTotals({
    start: '09:00',
    end: '12:00',
    arrival: '09:12',
    leave: '11:45',
    breakLate: 8,
    breakEarly: 5
  });
  assert.equal(totals.boundaryLate, 12);
  assert.equal(totals.boundaryEarly, 15);
  assert.equal(totals.lateMinutes, 20);
  assert.equal(totals.earlyLeaveMinutes, 20);
});

test('resolveModalDisplayTimes prefills session bounds when stored values are empty', () => {
  const display = timingDetail.resolveModalDisplayTimes({
    startTime: '09:00',
    endTime: '12:00',
    attendanceArrivalTime: '',
    attendanceLeaveTime: ''
  });
  assert.equal(display.arrivalDisplay, '09:00');
  assert.equal(display.leaveDisplay, '12:00');
});

test('empty arrival and leave count as on-time boundaries', () => {
  const totals = timingDetail.computeAttendanceTimingTotals({
    start: '09:00',
    end: '12:00',
    arrival: '',
    leave: '',
    breakLate: 0,
    breakEarly: 0
  });
  assert.equal(totals.lateMinutes, 0);
  assert.equal(totals.earlyLeaveMinutes, 0);
});
