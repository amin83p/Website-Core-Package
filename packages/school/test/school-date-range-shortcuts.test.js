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

test('buildDateRangeShortcutConfirmHtml formats range and all dates', () => {
  const shortcuts = loadSchoolDateRangeShortcuts();
  const html = shortcuts.buildDateRangeShortcutConfirmHtml({
    shortcutLabel: 'This week',
    startDate: '2026-03-02',
    endDate: '2026-03-08'
  });
  assert.match(html, /This week/);
  assert.match(html, /2026-03-02/);
  assert.match(html, /2026-03-08/);
  const allHtml = shortcuts.buildDateRangeShortcutConfirmHtml({
    shortcutLabel: 'All dates',
    allDates: true
  });
  assert.match(allHtml, /All dates/);
});

test('resolveRangeOptionLabel reads menu button text', () => {
  const shortcuts = loadSchoolDateRangeShortcuts();
  const menuEl = {
    querySelector(sel) {
      if (String(sel).includes('week')) {
        return { textContent: 'This week' };
      }
      return null;
    }
  };
  assert.equal(shortcuts.resolveRangeOptionLabel(menuEl, 'week'), 'This week');
});

test('bindDateRangeShortcuts waits for confirmBeforeApply before changing inputs', async () => {
  const src = fs.readFileSync(path.join(root, 'public/scripts/schoolDateRangeShortcuts.js'), 'utf8');
  const startInput = { value: '2026-01-01', addEventListener() {} };
  const endInput = { value: '2026-01-31', addEventListener() {} };
  const menuBtn = {
    getAttribute(name) {
      return name === 'data-range' ? 'week' : '';
    },
    textContent: 'This week',
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    addEventListener() {}
  };
  const menuEl = {
    hidden: true,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
    querySelector(sel) {
      if (String(sel).includes('week')) return menuBtn;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.schedule-date-range-option') return [menuBtn];
      return [];
    }
  };
  const document = {
    getElementById(id) {
      if (id === 'testMenu') return menuEl;
      if (id === 'testStart') return startInput;
      if (id === 'testEnd') return endInput;
      return null;
    },
    addEventListener() {}
  };
  const context = {
    window: {},
    document,
    requestAnimationFrame(fn) { fn(); }
  };
  vm.createContext(context);
  vm.runInContext(src, context);
  const shortcuts = context.window.SchoolDateRangeShortcuts;
  let applyCalls = 0;
  const binder = shortcuts.bindDateRangeShortcuts({
    menuId: 'testMenu',
    startInputId: 'testStart',
    endInputId: 'testEnd',
    confirmBeforeApply: async () => false,
    onApply: () => { applyCalls += 1; }
  });
  assert.ok(binder);
  const week = shortcuts.datesFromRangeToken('week');
  const rejected = await binder.applyToken('week', 'This week');
  assert.equal(rejected, false);
  assert.equal(startInput.value, '2026-01-01');
  assert.equal(endInput.value, '2026-01-31');
  assert.equal(applyCalls, 0);

  const binderOk = shortcuts.bindDateRangeShortcuts({
    menuId: 'testMenu',
    startInputId: 'testStart',
    endInputId: 'testEnd',
    confirmBeforeApply: async () => true,
    onApply: () => { applyCalls += 1; }
  });
  const accepted = await binderOk.applyToken('week', 'This week');
  assert.equal(accepted, true);
  assert.equal(startInput.value, week.startDate);
  assert.equal(endInput.value, week.endDate);
  assert.equal(applyCalls, 1);
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
  const conductClient = fs.readFileSync(path.join(root, 'public/scripts/conductMatrixClient.js'), 'utf8');

  for (const view of views) {
    assert.doesNotMatch(view, /Quick Ranges/);
    assert.match(view, /schoolDateRangeShortcuts\.js/);
    assert.match(view, /schedule-viewer\.css/);
    assert.match(view, /includeMatrixAllDates:\s*true/);
    assert.match(view, /personScheduleDateRangeShortcuts/);
  }
  assert.match(views[0], /confirmBeforeApply/);
  assert.match(views[1], /confirmBeforeApply/);
  assert.match(conductClient, /confirmBeforeApply/);
});
