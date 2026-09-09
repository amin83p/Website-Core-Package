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
  assert.match(view, /computeStagedSessionsViewRange/);
  assert.doesNotMatch(view, /Session creation from Master Schedule is not enabled yet/);
});

test('computeStagedSessionsViewRange pads one session with two weeks before and after', () => {
  const core = loadSessionCalendarCore();
  const range = core.computeStagedSessionsViewRange([
    { date: '2026-01-15' }
  ]);
  assert.equal(range.startDate, '2025-12-29');
  assert.equal(range.endDate, '2026-02-01');
  assert.equal(range.preset, 'custom');
  assert.equal(range.anchorDate, '2026-01-15');
  const weeks = core.buildWeekBlocks(range);
  assert.equal(weeks.length, 5);
});

test('computeStagedSessionsViewRange spans padded weeks across multiple session dates', () => {
  const core = loadSessionCalendarCore();
  const range = core.computeStagedSessionsViewRange([
    { date: '2026-01-15' },
    { date: '2026-02-20' }
  ]);
  assert.equal(range.startDate, '2025-12-29');
  assert.equal(range.endDate, '2026-03-08');
  const weeks = core.buildWeekBlocks(range);
  assert.equal(weeks.length, 10);
});

test('computeStagedSessionsViewRange falls back to custom range when no sessions', () => {
  const core = loadSessionCalendarCore();
  const range = core.computeStagedSessionsViewRange([], {
    startDate: '2026-03-01',
    endDate: '2026-03-15'
  });
  assert.equal(range.startDate, '2026-03-01');
  assert.equal(range.endDate, '2026-03-15');
  assert.equal(range.preset, 'custom');
});

test('partial modal recomputes staged session view range from all sessions', () => {
  const modalSource = read('public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(modalSource, /refreshPartialViewRangeFromStagedSessions/);
  assert.match(modalSource, /computeStagedSessionsViewRange/);
});

test('commitScheduleStageCreate syncs master schedule before opening partial modal', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const fnMatch = view.match(/async function commitScheduleStageCreate\(\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'commitScheduleStageCreate should exist');
  const body = fnMatch[0];
  const applyIdx = body.indexOf('applyDraftStagedSessionsToSchedule');
  const openIdx = body.indexOf('SessionEnrollmentCalendarModal.open');
  assert.ok(applyIdx > -1, 'commitScheduleStageCreate should call applyDraftStagedSessionsToSchedule');
  assert.ok(openIdx > -1, 'commitScheduleStageCreate should open partial modal');
  assert.ok(applyIdx < openIdx, 'master schedule sync should happen before partial modal open');
});

test('applyDraftStagedSessionsToSchedule clears preset range chip for padded dates', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const fnMatch = view.match(/function applyDraftStagedSessionsToSchedule\(payload = \{\}\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'applyDraftStagedSessionsToSchedule should exist');
  const body = fnMatch[0];
  assert.match(body, /setDateRangeFromIso\(/);
  assert.match(body, /setActiveRangeChip\(''\)/);
});

test('buildPartialPickerData excludes synced draft events from existingEvents', () => {
  const modalSource = read('public/scripts/sessionEnrollmentCalendarModal.js');
  const fnMatch = modalSource.match(/function buildPartialPickerData\(options = \{\}\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'buildPartialPickerData should exist');
  assert.match(fnMatch[0], /stagedSessionIds/);
  assert.match(fnMatch[0], /ev\?\.isDraft !== true/);
});

test('commitScheduleStageCreate passes non-draft existing events to partial modal', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const fnMatch = view.match(/async function commitScheduleStageCreate\(\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'commitScheduleStageCreate should exist');
  assert.match(fnMatch[0], /filter\(\(ev\) => ev\?\.isDraft !== true\)/);
});

test('master schedule keeps stacked multi-week height for padded staged ranges', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const fnMatch = view.match(/function computeScheduleGridViewportHeight\(container, weekCount = 1\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'computeScheduleGridViewportHeight should exist');
  assert.match(fnMatch[0], /stackedHeight/);
  assert.doesNotMatch(view, /schedule-week-grid-multi-week/);
});

test('partial modal scrolls to first staged session week on open and focuses master schedule on close', () => {
  const modalSource = read('public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(modalSource, /function scrollPartialToFirstStagedSession\(/);
  assert.match(modalSource, /scrollPartialToFirstStagedSession\(\)/);
  assert.match(modalSource, /onClose: options\.onClose/);
  assert.match(modalSource, /setTimeout\(\(\) => \{[\s\S]*onClose\(closeDate\)/);
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /focusScheduleTimelineOnFirstStagedSession/);
  assert.match(view, /focusStagedSessionOnNextLayout/);
  assert.match(view, /scrollSchedulePageToWeekRow/);
  assert.match(view, /onClose:[\s\S]*focusScheduleTimelineOnFirstStagedSession/);
});
