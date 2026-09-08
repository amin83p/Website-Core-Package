const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadSessionCalendarCore() {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('resolveTimelineBounds defaults to 7-22 and enforces minimum span', () => {
  const core = loadSessionCalendarCore();
  const defaults = core.resolveTimelineBounds();
  assert.equal(defaults.startHour, 7);
  assert.equal(defaults.endHour, 22);
  assert.equal(defaults.slotCount, 15);

  const custom = core.resolveTimelineBounds({ timelineStartHour: 8, timelineEndHour: 18 });
  assert.equal(custom.startHour, 8);
  assert.equal(custom.endHour, 18);
  assert.equal(custom.slotCount, 10);

  const invalid = core.resolveTimelineBounds({ timelineStartHour: 20, timelineEndHour: 21 });
  assert.equal(invalid.startHour, 7);
  assert.equal(invalid.endHour, 22);
});

test('calculatePosition respects custom timeline bounds', () => {
  const core = loadSessionCalendarCore();
  const bounds = core.resolveTimelineBounds({ timelineStartHour: 8, timelineEndHour: 12 });
  const pos = core.calculatePosition('07:00', '13:00', bounds);
  assert.equal(pos.startMin, 8 * 60);
  assert.equal(pos.endMin, 12 * 60);
  assert.equal(pos.left, 0);
  assert.equal(pos.width, 100);
});

test('sessionsOutsideTimelineBounds detects clipped sessions', () => {
  const core = loadSessionCalendarCore();
  const bounds = core.resolveTimelineBounds({ timelineStartHour: 8, timelineEndHour: 18 });
  const events = [
    { start: '07:30', end: '08:30' },
    { start: '09:00', end: '10:00' }
  ];
  assert.equal(core.sessionsOutsideTimelineBounds(events, bounds), true);
  assert.equal(core.sessionsOutsideTimelineBounds([events[1]], bounds), false);
});

test('expandTimelineBoundsToFitSessions widens only enough for sessions', () => {
  const core = loadSessionCalendarCore();
  const preset = core.resolveTimelineBounds({ timelineStartHour: 8, timelineEndHour: 18 });
  const events = [
    { start: '06:30', end: '07:30' },
    { start: '19:00', end: '20:00' }
  ];
  const expanded = core.expandTimelineBoundsToFitSessions(preset, events, 0);
  assert.equal(expanded.startHour, 6);
  assert.equal(expanded.endHour, 20);
});

test('personSchedule wires display-hours popover and per-week expand controls', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /data-schedule-time-range-toggle/);
  assert.match(source, /scheduleTimeRangePopover/);
  assert.match(source, /scheduleTimelineStartInput/);
  assert.match(source, /scheduleTimelineEndInput/);
  assert.match(source, /data-schedule-time-range-apply/);
  assert.match(source, /data-schedule-week-expand-time/);
  assert.match(source, /data-schedule-week-reset-time/);
  assert.match(source, /getScheduleMaxHourSlotsForLayout/);
  assert.match(source, /timelineStartHour/);
});
