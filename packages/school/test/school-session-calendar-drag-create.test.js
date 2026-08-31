const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadSessionCalendarCore() {
  const scriptPath = path.join(root, 'public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('formatDurationHrsMins formats hours and minutes', () => {
  const core = loadSessionCalendarCore();
  assert.equal(core.formatDurationHrsMins(90), '1 Hr 30 Mins');
  assert.equal(core.formatDurationHrsMins(45), '45 Mins');
  assert.equal(core.formatDurationHrsMins(120), '2 Hrs');
  assert.equal(core.formatDurationHrsMins(0), '0 Mins');
});

test('computeVerticalDragRange enforces downward minimum duration', () => {
  const core = loadSessionCalendarCore();
  const down = core.computeVerticalDragRange(60, 180);
  assert.equal(down.anchorOffset, 60);
  assert.equal(down.durationMinutes, 120);
  assert.equal(down.durationHours, 2);

  const up = core.computeVerticalDragRange(180, 60);
  assert.equal(up.durationMinutes, 30);
  assert.equal(up.endOffset, up.anchorOffset + 30);
});

test('resolveVerticalDragContext returns null without valid grid target', () => {
  const core = loadSessionCalendarCore();
  assert.equal(core.resolveVerticalDragContext(null, 0, 0, 0, null), null);
  assert.equal(core.resolveVerticalDragContext({}, 0, 0, 0, {}), null);
});

test('personSchedule includes stage modal and drag-create binding', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /sessionEnrollmentStageModal/);
  assert.match(source, /sessionEnrollmentCalendarModal/);
  assert.match(source, /bindScheduleDragCreate/);
  assert.match(source, /bindCalendarDragCreate/);
  assert.match(source, /session-enrollment-stage-standalone/);
  assert.match(source, /document\.body\.appendChild\(modalEl\)/);
  assert.match(source, /openScheduleClassPickerModal/);
});

test('session-calendar.css defines full-viewport standalone stage overlay', () => {
  const source = read('public/styles/session-calendar.css');
  assert.match(source, /\.session-enrollment-stage-overlay\.session-enrollment-stage-standalone[\s\S]*position:\s*fixed/s);
  assert.match(source, /\.session-enrollment-stage-overlay\.session-enrollment-stage-standalone[\s\S]*z-index:\s*1060/s);
});

test('personSchedule wires last-loaded refresh chip and stale detection', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /lastLoadedAtByPersonId/);
  assert.match(source, /data-schedule-refresh-loaded/);
  assert.match(source, /schedule-loaded-at-chip/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /markScheduleDataStaleAfterReturn/);
});

test('scheduleController exports buildScheduleEventsFingerprint and getPersonScheduleVersion', () => {
  const source = read('MVC/controllers/school/scheduleController.js');
  assert.match(source, /function buildScheduleEventsFingerprint/);
  assert.match(source, /function getPersonScheduleVersion/);
  assert.match(source, /skipEnrichment:\s*true/);
});

test('mySchedule wires last-loaded refresh chip and stale detection', () => {
  const source = read('MVC/views/school/schedule/mySchedule.ejs');
  assert.match(source, /ms_loadedAtChip/);
  assert.match(source, /lastLoadedAt/);
  assert.match(source, /schedule-loaded-at-chip/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /updateLoadedAtChip/);
});
