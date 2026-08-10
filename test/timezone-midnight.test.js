const test = require('node:test');
const assert = require('node:assert/strict');

const timezoneUtils = require('../MVC/utils/timezoneUtils');

test('getDateTimePartsInTimezone normalizes hour 24 at midnight', () => {
  const ms = Date.parse('2026-04-08T00:00:00.000Z');
  const parts = timezoneUtils.getDateTimePartsInTimezone(ms, 'UTC');
  assert.ok(parts);
  assert.equal(parts.hour, 0);
  assert.equal(parts.day, 8);
});

test('getDayBoundsMs returns valid windows for three UTC days', () => {
  const startMs = Date.parse('2026-04-08T00:00:00.000Z');
  const endMs = Date.parse('2026-04-10T23:59:59.999Z');
  const windows = [];
  let bounds = timezoneUtils.getDayBoundsMs(startMs, 'UTC');
  while (bounds.dayStartMs <= endMs && windows.length < 7) {
    windows.push({
      dateKey: bounds.dateKey,
      dayStartMs: Math.max(bounds.dayStartMs, startMs),
      dayEndMs: Math.min(bounds.dayEndMs, endMs)
    });
    const nextMs = bounds.dayEndMs + 1;
    const previousStartMs = bounds.dayStartMs;
    bounds = timezoneUtils.getDayBoundsMs(nextMs, 'UTC');
    if (!bounds?.dateKey || !Number.isFinite(bounds.dayStartMs)) break;
    if (bounds.dayStartMs <= previousStartMs) break;
  }

  assert.equal(windows.length, 3);
  windows.forEach((window) => {
    assert.ok(window.dayEndMs >= window.dayStartMs);
  });
});

test('zonedWallClockToUtcMs resolves midnight wall clock in org timezone', () => {
  const ms = timezoneUtils.zonedWallClockToUtcMs('2026-04-08', '00:00', 'UTC');
  assert.equal(ms, Date.parse('2026-04-08T00:00:00.000Z'));
});
