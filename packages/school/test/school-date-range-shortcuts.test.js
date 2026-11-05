'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function loadSchoolDateRangeShortcuts() {
  const src = fs.readFileSync(path.join(root, 'public/scripts/schoolDateRangeShortcuts.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.window.SchoolDateRangeShortcuts;
}

test('schoolDateRangeShortcuts.js passes syntax check', () => {
  const scriptPath = path.join(root, 'public/scripts/schoolDateRangeShortcuts.js');
  execSync(`node --check "${scriptPath}"`, { stdio: 'pipe' });
});

test('normalizeRangeToken maps legacy matrix and schedule tokens', () => {
  const shortcuts = loadSchoolDateRangeShortcuts();
  assert.equal(shortcuts.normalizeRangeToken('today'), 'day');
  assert.equal(shortcuts.normalizeRangeToken('thisWeek'), 'week');
  assert.equal(shortcuts.normalizeRangeToken('thisMonth'), 'm0-full');
  assert.equal(shortcuts.normalizeRangeToken('prevMonth'), 'm-1-full');
  assert.equal(shortcuts.normalizeRangeToken('lastMonthFirstHalf'), 'm-1-first');
  assert.equal(shortcuts.normalizeRangeToken('lastMonthSecondHalf'), 'm-1-second');
  assert.equal(shortcuts.normalizeRangeToken('first15'), 'm0-first');
  assert.equal(shortcuts.normalizeRangeToken('allTime'), 'allTime');
  assert.equal(shortcuts.normalizeRangeToken('twoWeeks'), 'twoWeeks');
});

test('datesFromRangeToken handles allTime and resolved ranges', () => {
  const shortcuts = loadSchoolDateRangeShortcuts();
  const allTime = shortcuts.datesFromRangeToken('allTime');
  assert.equal(allTime.token, 'allTime');
  assert.equal(allTime.startDate, '');
  assert.equal(allTime.endDate, '');

  const week = shortcuts.datesFromRangeToken('week');
  assert.equal(week.token, 'week');
  assert.match(week.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(week.endDate, /^\d{4}-\d{2}-\d{2}$/);

  const firstHalf = shortcuts.datesFromRangeToken('m0-first');
  assert.equal(firstHalf.token, 'm0-first');
  assert.match(firstHalf.startDate, /-01$/);
  assert.match(firstHalf.endDate, /-15$/);

  const prevFull = shortcuts.datesFromRangeToken('m-1-full');
  assert.equal(prevFull.token, 'm-1-full');
  assert.ok(prevFull.startDate && prevFull.endDate);
});

test('matrix pages load shared shortcuts script and date range menu', () => {
  const menuPartial = fs.readFileSync(
    path.join(root, 'MVC/views/school/schedule/partials/personScheduleDateRangeShortcuts.ejs'),
    'utf8'
  );
  assert.match(menuPartial, /includeMatrixAllDates/);
  assert.match(menuPartial, /data-range="allTime"/);

  const views = [
    'MVC/views/school/attendance/attendanceViewer.ejs',
    'MVC/views/school/grades/gradesMatrix.ejs',
    'MVC/views/school/report/conductMatrix.ejs'
  ].map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'));

  for (const view of views) {
    assert.doesNotMatch(view, /Quick Ranges/);
    assert.match(view, /schoolDateRangeShortcuts\.js/);
    assert.match(view, /schedule-viewer\.css/);
    assert.match(view, /includeMatrixAllDates:\s*true/);
    assert.match(view, /personScheduleDateRangeShortcuts/);
  }
});
