const test = require('node:test');
const assert = require('node:assert/strict');

const orderService = require('../MVC/services/school/studentAttendanceReportClassOrderService');

test('computeEarliestSessionStartMinutes uses minimum start in window', () => {
  const minutes = orderService.computeEarliestSessionStartMinutes([
    { startTime: '13:30' },
    { startTime: '09:15' },
    { startTime: '10:00' }
  ]);
  assert.equal(minutes, 9 * 60 + 15);
});

test('attachScheduleSortFields respects report date window', () => {
  const row = { classId: 'C1', className: 'EAL-AM-I/G' };
  orderService.attachScheduleSortFields(row, [
    { date: '2026-01-05', startTime: '09:00' },
    { date: '2026-02-01', startTime: '08:30' }
  ], { startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.equal(row.earliestSessionStartMinutes, 9 * 60);
  assert.equal(row.daypartRank, orderService.DAYPART_RANK.AM);
});

test('sortStudentAttendanceReportClasses orders morning before afternoon by session time', () => {
  const sorted = orderService.sortStudentAttendanceReportClasses([
    { classId: 'PM', className: 'EAL-PM-I/G-Zebra', earliestSessionStartMinutes: 13 * 60 },
    { classId: 'AM', className: 'EAL-AM-I/G-Alpha', earliestSessionStartMinutes: 9 * 60 }
  ]);
  assert.equal(sorted[0].classId, 'AM');
  assert.equal(sorted[1].classId, 'PM');
});

test('sort falls back to daypart in class name when start times missing', () => {
  const sorted = orderService.sortStudentAttendanceReportClasses([
    { classId: 'C2', className: 'EAL-PM-I/G' },
    { classId: 'C1', className: 'EAL-AM-I/G' }
  ]);
  assert.equal(sorted[0].classId, 'C1');
  assert.equal(sorted[1].classId, 'C2');
});

test('sort uses className when schedule and daypart tie', () => {
  const sorted = orderService.sortStudentAttendanceReportClasses([
    { classId: 'C2', className: 'Beta', earliestSessionStartMinutes: 540 },
    { classId: 'C1', className: 'Alpha', earliestSessionStartMinutes: 540 }
  ]);
  assert.equal(sorted[0].classId, 'C1');
  assert.equal(sorted[1].classId, 'C2');
});

test('computeEarliestSessionStartMinutesForStudent ignores class-wide AM when student only has PM rollups', () => {
  const sessions = [
    { date: '2026-01-06', startTime: '09:00', id: 'S1' },
    { date: '2026-01-06', startTime: '13:00', id: 'S2' }
  ];
  const amOnlyRollups = [
    { date: '2026-01-06', sessionId: 'S2', expectedForSession: true }
  ];
  const studentEarliest = orderService.computeEarliestSessionStartMinutesForStudent(
    sessions,
    amOnlyRollups,
    'EAL-PM-O/G-Example'
  );
  assert.equal(studentEarliest, 13 * 60);
  const classEarliest = orderService.computeEarliestSessionStartMinutes(sessions);
  assert.equal(classEarliest, 9 * 60);
});

test('PM class name ignores morning rollups when an afternoon session exists', () => {
  const sessions = [
    { date: '2026-01-07', startTime: '09:00', id: 'S1' },
    { date: '2026-01-08', startTime: '13:00', id: 'S2' }
  ];
  const rollups = [
    { date: '2026-01-07', sessionId: 'S1', expectedForSession: true },
    { date: '2026-01-08', sessionId: 'S2', expectedForSession: true }
  ];
  const earliest = orderService.computeEarliestSessionStartMinutesForStudent(
    sessions,
    rollups,
    'EAL/CUSTMIZED-PM-O/1-TEACHER'
  );
  assert.equal(earliest, 13 * 60);
});

test('sortStudentAttendanceReportClasses mutates array in place', () => {
  const rows = [
    { classId: 'PM', className: 'EAL-PM', earliestSessionStartMinutes: 13 * 60 },
    { classId: 'AM', className: 'EAL-AM', earliestSessionStartMinutes: 9 * 60 }
  ];
  orderService.sortStudentAttendanceReportClasses(rows);
  assert.equal(rows[0].classId, 'AM');
  assert.equal(rows[1].classId, 'PM');
});
