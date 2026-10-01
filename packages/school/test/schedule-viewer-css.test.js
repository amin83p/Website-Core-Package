const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('personSchedule links external schedule-viewer stylesheet', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /href="\/styles\/schedule-viewer\.css"/);
  assert.doesNotMatch(view, /^<style>/m);
});

test('personSchedule loads session-calendar.css at most once', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const matches = view.match(/session-calendar\.css/g) || [];
  assert.equal(matches.length, 1);
});

test('schedule-viewer.css includes critical layout selectors', () => {
  const css = read('public/styles/schedule-viewer.css');
  assert.match(css, /\.schedule-shell\b/);
  assert.match(css, /\.schedule-viewbar-sticky\b/);
  assert.match(css, /body\.schedule-stage-overlay-open/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(hover: hover\)/);
  assert.match(css, /\.conflict-zone,\s*\n\s*\.cal-day\.conflict \{ animation: none; \}/);
  assert.match(css, /\.schedule-workspace-actions\b/);
  assert.match(css, /\.schedule-admin-week-rail-inner\b/);
  assert.match(css, /--schedule-admin-rail-sticky-top/);
});

test('admin Master Schedule week rail markup and sync wiring', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const core = read('public/scripts/masterScheduleViewer.js');
  assert.match(view, /if \(canSelectAnyPerson\) \{ %>\s*<aside id="scheduleAdminWeekRail"/s);
  assert.match(view, /data-schedule-admin-action="enroll-students"/);
  assert.match(view, /data-schedule-admin-action="move-enrollments"/);
  assert.match(view, /data-schedule-admin-action="delete-enrollment"/);
  assert.match(view, /data-schedule-admin-action="claim-numbers"/);
  assert.match(view, /schedule-view-icon-btn[\s\S]*Enroll Students/);
  const nonAdminBlock = view.split('<% if (canSelectAnyPerson) { %>')[0];
  assert.doesNotMatch(nonAdminBlock, /scheduleAdminWeekRail/);
  assert.match(core, /function syncScheduleAdminWeekRailVisibility/);
  assert.match(core, /function syncScheduleAdminWeekRailStickyTop/);
  assert.match(core, /--schedule-admin-rail-sticky-top/);
  assert.match(core, /bindScheduleAdminWeekRail/);
});

test('personSchedule keeps schedule layout in external assets without inline style or script blocks', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.doesNotMatch(view, /<style[\s>]/i);
  assert.doesNotMatch(view, /<script(?![^>]*\ssrc=)(?![^>]*type="application\/json")[^>]*>/i);
  assert.match(view, /schedule-calendar-card-body/);
  assert.doesNotMatch(view, /schedule-calendar-card-body[^>]*\spx-/);
  assert.doesNotMatch(view, /schedule-viewbar-sticky[^>]*\spx-/);
});

test('schedule-viewer.css defines compact schedule card padding in stylesheet', () => {
  const css = read('public/styles/schedule-viewer.css');
  assert.match(css, /#scheduleContainer > \.card > \.schedule-calendar-card-body/);
  assert.match(css, /#scheduleContainer > \.card > \.schedule-viewbar-sticky\.card-header/);
});

test('session-calendar.css does not duplicate Master Schedule viewbar workspace rules', () => {
  const calendarCss = fs.readFileSync(path.join(repoRoot, 'public/styles/session-calendar.css'), 'utf8');
  assert.doesNotMatch(calendarCss, /\.schedule-viewbar-chips\s*\{/);
  assert.doesNotMatch(calendarCss, /\.schedule-workspace-actions\s*\{/);
  assert.match(calendarCss, /schedule-viewer\.css/);
});

test('package mirror matches served schedule-viewer.css', () => {
  const pkgCss = fs.readFileSync(path.join(root, 'public/styles/schedule-viewer.css'), 'utf8');
  const servedCss = fs.readFileSync(path.join(repoRoot, 'public/styles/schedule-viewer.css'), 'utf8');
  assert.equal(pkgCss, servedCss);
});
