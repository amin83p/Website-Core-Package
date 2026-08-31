const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSessionCalendarCore() {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

test('generateRotatingWeekdaySessions rotates only through selected weekdays from first match on or after anchor', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-06',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 5,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-03-31',
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 5);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-01-07,2026-01-12,2026-01-14,2026-01-19,2026-01-21');
});

test('generateRotatingWeekdaySessions rotates Mon and Wed from Monday anchor date', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 4,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-03-31',
    existingSessions: [],
    alreadyStaged: [],
    scheduleDefaults: { teacherName: 'Coach A', room: 'R1' }
  });

  assert.equal(result.created, 4);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-01-05,2026-01-07,2026-01-12,2026-01-14');
  assert.equal(result.sessions[0].startTime, '09:00');
  assert.equal(result.sessions[0].endTime, '10:00');
  assert.equal(result.sessions[0].teacherName, 'Coach A');
  assert.equal(result.sessions[0].room, 'R1');
  assert.match(result.sessions[0].sessionId, /^STAGED_quick_/);
});

test('generateRotatingWeekdaySessions skips occupied dates in rotation without stopping early', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-06',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 3,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-03-31',
    existingSessions: [{ sessionId: 'SES_1', date: '2026-01-07', startTime: '08:00', endTime: '10:00' }],
    alreadyStaged: []
  });

  assert.equal(result.created, 3);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-01-12,2026-01-14,2026-01-19');
});

test('generateRotatingWeekdaySessions allows selected anchor weekday when another session exists same day at different time', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '11:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 2,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-03-31',
    existingSessions: [{ sessionId: 'SES_1', date: '2026-01-05', startTime: '08:00', endTime: '09:00' }],
    alreadyStaged: []
  });

  assert.equal(result.created, 2);
  assert.equal(result.sessions[0].date, '2026-01-05');
  assert.equal(result.sessions[0].startTime, '11:00');
});

test('generateRotatingWeekdaySessions skips occupied anchor date when times overlap', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 3,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-03-31',
    existingSessions: [{ sessionId: 'SES_1', date: '2026-01-05', startTime: '08:00', endTime: '10:00' }],
    alreadyStaged: []
  });

  assert.equal(result.created, 3);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-01-07,2026-01-12,2026-01-14');
});

test('generateRotatingWeekdaySessions respects enrollment end window', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1],
    count: 10,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '2026-01-20',
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 3);
  assert.equal(result.capacity, 3);
  assert.ok(result.sessions.every((row) => row.date <= '2026-01-20'));
});

test('buildRotationWeekdayOrder starts from anchor weekday when selected', () => {
  const core = loadSessionCalendarCore();
  const order = core.buildRotationWeekdayOrder([1, 3, 5], '2026-01-07');
  assert.equal(order.join(','), '3,5,1');
});

test('sessionScheduleKey and time helpers normalize schedule identity', () => {
  const core = loadSessionCalendarCore();
  assert.equal(core.sessionScheduleKey({ date: '2026-01-05', startTime: '09:00', endTime: '10:00' }), '2026-01-05|09:00|10:00');
  assert.equal(core.addDurationToTime('09:00', 1.5), '10:30');
  assert.equal(core.minutesToTime24(570), '09:30');
});

test('generateRotatingWeekdaySessions extends open-ended enrollment to place requested sessions', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3],
    count: 4,
    enrollmentStart: '2026-01-01',
    enrollmentEnd: '',
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 4);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-01-05,2026-01-07,2026-01-12,2026-01-14');
});

test('generateRotatingWeekdaySessions returns empty when enrollment starts after anchor', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-01-05',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1],
    count: 4,
    enrollmentStart: '2026-01-15',
    enrollmentEnd: '2026-01-20',
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 1);
  assert.equal(result.sessions[0].date, '2026-01-19');
});

test('generateRotatingWeekdaySessions uses other selected weekdays when one is a blocked holiday', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-08-31',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3, 5],
    count: 6,
    enrollmentStart: '2026-08-31',
    enrollmentEnd: '2026-09-30',
    blockedDates: ['2026-09-07'],
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 6);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-08-31,2026-09-02,2026-09-04,2026-09-09,2026-09-11,2026-09-14');
  assert.ok(!dates.includes('2026-09-07'));
});

test('generateRotatingWeekdaySessions rotates through three selected weekdays evenly', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-08-31',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3, 5],
    count: 6,
    enrollmentStart: '2026-08-31',
    enrollmentEnd: '2026-10-31',
    existingSessions: [],
    alreadyStaged: []
  });

  assert.equal(result.created, 6);
  const dates = result.sessions.map((row) => String(row.date));
  assert.equal(dates.join(','), '2026-08-31,2026-09-02,2026-09-04,2026-09-07,2026-09-09,2026-09-11');
});

test('resolveGridClickContext returns null without valid grid target', () => {
  const core = loadSessionCalendarCore();
  assert.equal(core.resolveGridClickContext(null, 0, 0, null), null);
  assert.equal(core.resolveGridClickContext({}, 0, 0, {}), null);
});
