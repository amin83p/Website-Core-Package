const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function loadSessionCalendarCore() {
  const code = read('public/scripts/sessionCalendarCore.js');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

test('generateRotatingWeekdaySessions skips blocked holiday dates', () => {
  const core = loadSessionCalendarCore();
  const result = core.generateRotatingWeekdaySessions({
    anchorDate: '2026-06-01',
    startTime: '09:00',
    durationHours: 1,
    weekdays: [1, 3, 5],
    count: 4,
    enrollmentStart: '2026-06-01',
    enrollmentEnd: '2026-06-30',
    blockedDates: ['2026-06-01', '2026-06-03']
  });
  const dates = result.sessions.map((row) => row.date);
  assert.ok(dates.length > 0);
  assert.ok(!dates.includes('2026-06-01'));
  assert.ok(!dates.includes('2026-06-03'));
});

test('stage modal includes skip holidays toggle', () => {
  const stageModal = read('MVC/views/school/partials/sessionEnrollmentStageModal.ejs');
  assert.match(stageModal, /sessionEnrollmentStageSkipHolidays/);
  assert.match(stageModal, /Skip Holidays\/Off Days/);
});

test('calendar modal supports partial mode and shared helpers', () => {
  const modalSource = read('public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(modalSource, /function isPartialMode\(\)/);
  assert.match(modalSource, /buildPartialPickerData/);
  assert.match(modalSource, /collectHolidayDatesForRange/);
  assert.match(modalSource, /Review staged sessions/);
  assert.match(modalSource, /Apply to schedule/);
  assert.match(modalSource, /blockedDates/);
});

test('schedule routes expose instructor-classes endpoint', () => {
  const routes = read('MVC/routes/scheduleRoutes.js');
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(routes, /\/api\/instructor-classes/);
  assert.match(routes, /listInstructorClassesForSchedule/);
  assert.match(controller, /listInstructorClassesForSchedule/);
  assert.match(controller, /buildRouteAccessContext\(req\)/);
  assert.match(controller, /isUserInstructorOnClass/);
});

test('person schedule wires class picker, partial calendar, and draft events', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /sessionEnrollmentCalendarModal/);
  assert.match(view, /sessionEnrollmentCalendarModal\.js/);
  assert.match(view, /scheduleClassPickerModal/);
  assert.match(view, /openScheduleClassPickerModal/);
  assert.match(view, /SessionEnrollmentCalendarModal\.open/);
  assert.match(view, /mode:\s*'partial'/);
  assert.match(view, /draftEventsByPersonId/);
  assert.match(view, /is-schedule-draft/);
  assert.doesNotMatch(view, /Session creation from Master Schedule is not enabled yet/);
});
