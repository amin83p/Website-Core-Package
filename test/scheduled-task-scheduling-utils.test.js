const assert = require('assert');
const test = require('node:test');

const {
  computeNextWeeklyRunAt,
  getWeekdayInTimezone
} = require('../MVC/services/scheduledTaskSchedulingUtils');

test('computeNextWeeklyRunAt skips days not in daysOfWeek', () => {
  const timeZone = 'UTC';
  const mondayKey = '2026-09-14';
  assert.equal(getWeekdayInTimezone(mondayKey, timeZone), 1);

  const from = new Date('2026-09-14T10:00:00.000Z');
  const next = computeNextWeeklyRunAt({
    runAtTime: '09:00',
    timeZone,
    daysOfWeek: [1],
    from
  });
  assert.ok(next);
  const nextDate = new Date(next);
  assert.ok(nextDate > from);
  assert.equal(getWeekdayInTimezone(next.slice(0, 10), timeZone), 1);
});

test('computeNextWeeklyRunAt finds next allowed weekday after today time passed', () => {
  const timeZone = 'UTC';
  const from = new Date('2026-09-14T12:00:00.000Z');
  const next = computeNextWeeklyRunAt({
    runAtTime: '09:00',
    timeZone,
    daysOfWeek: [1, 3],
    from
  });
  assert.ok(next);
  const weekday = getWeekdayInTimezone(next.slice(0, 10), timeZone);
  assert.ok([1, 3].includes(weekday));
});
