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

const core = loadSessionCalendarCore();
const modalSource = fs.readFileSync(
  path.join(__dirname, '../public/scripts/sessionEnrollmentCalendarModal.js'),
  'utf8'
);
const calendarPartialSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/partials/sessionEnrollmentCalendarModal.ejs'),
  'utf8'
);
const contextMenuPartialSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/partials/sessionEnrollmentContextMenu.ejs'),
  'utf8'
);
const rollingSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);

const sampleEvents = [
  { sessionId: 'S1', date: '2026-01-05', start: '09:00', end: '10:30', savedMarked: false },
  { sessionId: 'S2', date: '2026-01-12', start: '09:00', end: '10:30', savedMarked: true },
  { sessionId: 'S3', date: '2026-01-19', start: '13:00', end: '14:30', savedMarked: false },
  { sessionId: 'S4', date: '2026-01-26', start: '09:00', end: '10:30', savedMarked: false }
];

test('sessionTimeWindowKey normalizes start and end times', () => {
  assert.equal(core.sessionTimeWindowKey({ start: '9:00', end: '10:30' }), '09:00|10:30');
  assert.equal(core.sessionTimeWindowKey({ startTime: '09:00', endTime: '10:30' }), '09:00|10:30');
});

test('countSessionsByTimeWindow counts matching sessions only', () => {
  assert.equal(core.countSessionsByTimeWindow(sampleEvents, '09:00', '10:30'), 3);
  assert.equal(core.countSessionsByTimeWindow(sampleEvents, '13:00', '14:30'), 1);
});

test('countTimeSlotSessionsInRange respects date bounds', () => {
  assert.equal(core.countTimeSlotSessionsInRange(sampleEvents, '09:00', '10:30', '2026-01-05', '2026-01-19'), 2);
  assert.equal(core.countTimeSlotSessionsInRange(sampleEvents, '09:00', '10:30', '2026-01-12', '2026-01-26'), 2);
});

test('collectTimeSlotSessions filters by action and limits chronologically', () => {
  const markRows = core.collectTimeSlotSessions(sampleEvents, null, {
    startTime: '09:00',
    endTime: '10:30',
    startDate: '2026-01-05',
    endDate: '2026-01-26',
    limitCount: 2,
    action: 'mark_na'
  });
  assert.deepEqual(markRows.map((row) => row.sessionId), ['S1', 'S4']);

  const unmarkRows = core.collectTimeSlotSessions(sampleEvents, null, {
    startTime: '09:00',
    endTime: '10:30',
    startDate: '2026-01-05',
    endDate: '2026-01-26',
    action: 'unmark'
  });
  assert.deepEqual(unmarkRows.map((row) => row.sessionId), ['S2']);
});

test('collectTimeSlotSessions supports picker select and deselect actions', () => {
  const pickerEvents = [
    { sessionId: 'S1', date: '2026-01-05', start: '09:00', end: '10:30', selectable: true },
    { sessionId: 'S2', date: '2026-01-12', start: '09:00', end: '10:30', selectable: true },
    { sessionId: 'S3', date: '2026-01-19', start: '09:00', end: '10:30', selectable: false }
  ];
  const selectedSet = new Set(['S2']);

  const selectRows = core.collectTimeSlotSessions(pickerEvents, null, {
    startTime: '09:00',
    endTime: '10:30',
    startDate: '2026-01-05',
    endDate: '2026-01-26',
    action: 'select',
    selectedSet
  });
  assert.deepEqual(selectRows.map((row) => row.sessionId), ['S1']);

  const deselectRows = core.collectTimeSlotSessions(pickerEvents, null, {
    startTime: '09:00',
    endTime: '10:30',
    startDate: '2026-01-05',
    endDate: '2026-01-26',
    action: 'deselect',
    selectedSet
  });
  assert.deepEqual(deselectRows.map((row) => row.sessionId), ['S2']);
});

test('calendar modal exposes full preset toolbar and legend for picker parity', () => {
  assert.match(calendarPartialSource, /data-session-picker-preset="thirtyDays"/);
  assert.match(calendarPartialSource, /data-session-picker-preset="wholeCycle"/);
  assert.doesNotMatch(calendarPartialSource, /data-session-picker-preset="thirtyDays"[^>]*d-none/);
  assert.doesNotMatch(calendarPartialSource, /data-session-picker-preset="wholeCycle"[^>]*d-none/);
  assert.match(calendarPartialSource, /id="btn_sessionEnrollmentCalendarLegend"/);
  assert.doesNotMatch(calendarPartialSource, /id="btn_sessionEnrollmentCalendarLegend"[^>]*d-none/);
  assert.match(calendarPartialSource, /id="sessionEnrollmentCalendarStudentBanner"/);
});

test('calendar modal chrome and context menu work in picker mode', () => {
  assert.match(modalSource, /function renderPickerSessionsLegend/);
  assert.match(modalSource, /function initDefaultViewRange/);
  assert.doesNotMatch(modalSource, /thirtyDaysBtn\?\.classList\.toggle\('d-none', !manage\)/);
  assert.doesNotMatch(modalSource, /legendBtn\?\.classList\.toggle\('d-none', !manage\)/);
  assert.doesNotMatch(modalSource, /function handleHostContextMenu\(event\) \{\s*if \(!isManageMode\(\)\) return;/);
  assert.doesNotMatch(modalSource, /function showContextMenu\(event, sessionId\) \{\s*if \(!isManageMode\(\)\) return;/);
  assert.match(modalSource, /Exclude session/);
  assert.match(modalSource, /stageTimeSlotPickerChanges/);
});

test('calendar modal includes time-slot select overlay and context menu partials', () => {
  assert.match(calendarPartialSource, /sessionEnrollmentTimeSlotSelectModal/);
  assert.match(calendarPartialSource, /sessionEnrollmentContextMenu/);
  assert.match(contextMenuPartialSource, /dropdown-menu session-enrollment-context-menu/);
});

test('session enrollment calendar modal wires context menu and time-slot select flow', () => {
  assert.match(modalSource, /handleHostContextMenu/);
  assert.match(modalSource, /openTimeSlotSelectModal/);
  assert.match(modalSource, /stageTimeSlotSelectChanges/);
  assert.match(modalSource, /refreshTimeSlotSelectPreview/);
  assert.match(modalSource, /cycleEndDate/);
  assert.match(modalSource, /contextmenu/);
});

test('rolling enrollment passes cycle end date into manage sessions modal', () => {
  assert.match(rollingSource, /mode: 'manageEnrollmentSessions'/);
  assert.match(rollingSource, /cycleEndDate:\s*String\(cycleWindow\?\.endDate/);
});

test('rolling enrollment passes cycle end date into picker calendar modal', () => {
  const openPicker = rollingSource.match(/async function openEnrollmentSessionCalendarModal\(\) \{[\s\S]*?\n  \}/);
  assert.ok(openPicker, 'openEnrollmentSessionCalendarModal should exist');
  assert.match(openPicker[0], /cycleEndDate:\s*String\(cycleWindow\?\.endDate/);

  const openUnmark = rollingSource.match(/async function openUnmarkSessionCalendarModal\(\) \{[\s\S]*?\n  \}/);
  assert.ok(openUnmark, 'openUnmarkSessionCalendarModal should exist');
  assert.match(openUnmark[0], /cycleEndDate:\s*String\(cycleWindow\?\.endDate/);
});
