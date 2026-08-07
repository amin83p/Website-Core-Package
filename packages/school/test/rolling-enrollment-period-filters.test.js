'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const filterService = require('../MVC/services/school/rollingEnrollmentPeriodFilterService');

const ORG_TODAY = '2026-08-05';

test('classifyEnrollmentPeriodGroup marks session-applicable active periods as valid', () => {
  const period = {
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2026-08-31'
  };
  assert.equal(filterService.classifyEnrollmentPeriodGroup(period, ORG_TODAY), 'valid');
  assert.equal(filterService.isValidForSessionsToday(period, ORG_TODAY), true);
});

test('classifyEnrollmentPeriodGroup marks future periods before start date', () => {
  const period = {
    status: 'planned',
    startDate: '2026-08-10',
    endDate: '2026-08-31'
  };
  assert.equal(filterService.isFuturePeriod(period, ORG_TODAY), true);
  const filtered = filterService.filterEnrollmentPeriodRows([period], { enrollmentGroup: 'future' }, { orgToday: ORG_TODAY });
  assert.equal(filtered.length, 1);
});

test('classifyEnrollmentPeriodGroup marks ended periods as past', () => {
  const period = {
    status: 'completed',
    startDate: '2026-07-01',
    endDate: '2026-07-31'
  };
  assert.equal(filterService.isPastPeriod(period, ORG_TODAY), true);
  const filtered = filterService.filterEnrollmentPeriodRows([period], { enrollmentGroup: 'past' }, { orgToday: ORG_TODAY });
  assert.equal(filtered.length, 1);
});

test('filterEnrollmentPeriodRows applies period status and funder filters', () => {
  const rows = [
    { id: '1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-31', funderId: 'self' },
    { id: '2', status: 'draft', startDate: '2026-08-10', endDate: '2026-08-31', funderId: 'FND_1' }
  ];
  const byStatus = filterService.filterEnrollmentPeriodRows(rows, { periodStatus: 'draft' }, { orgToday: ORG_TODAY });
  assert.deepEqual(byStatus.map((row) => row.id), ['2']);

  const byFunder = filterService.filterEnrollmentPeriodRows(rows, { funderId: 'self' }, { orgToday: ORG_TODAY });
  assert.deepEqual(byFunder.map((row) => row.id), ['1']);
});

test('filterEnrollmentPeriodRows applies target type filter', () => {
  const rows = [
    { id: '1', status: 'active', startDate: '2026-08-01', targetSessionCount: 10 },
    { id: '2', status: 'active', startDate: '2026-08-01', endDate: '2026-08-31' }
  ];
  const sessionTarget = filterService.filterEnrollmentPeriodRows(rows, { targetType: 'session_target' }, { orgToday: ORG_TODAY });
  assert.deepEqual(sessionTarget.map((row) => row.id), ['1']);

  const dateWindow = filterService.filterEnrollmentPeriodRows(rows, { targetType: 'date_window' }, { orgToday: ORG_TODAY });
  assert.deepEqual(dateWindow.map((row) => row.id), ['2']);
});

test('target-session enrollment with open end date can be current and valid when active', () => {
  const period = {
    status: 'active',
    startDate: '2026-08-01',
    targetSessionCount: 8
  };
  assert.equal(filterService.isCurrentPeriod(period, ORG_TODAY), true);
  assert.equal(filterService.isValidForSessionsToday(period, ORG_TODAY), true);
});

test('hasRollingEnrollmentFiltersApplied detects active filter query params', () => {
  assert.equal(filterService.hasRollingEnrollmentFiltersApplied({}), false);
  assert.equal(filterService.hasRollingEnrollmentFiltersApplied({ enrollmentGroup: 'current' }), true);
  assert.equal(filterService.hasRollingEnrollmentFiltersApplied({ funderId: 'self' }), true);
});

const viewPath = path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs');
const viewSource = fs.readFileSync(viewPath, 'utf8');

test('rolling enrollment view exposes sortable headers and filter panel markup', () => {
  assert.match(viewSource, /data-column="student"/);
  assert.match(viewSource, /data-column="startDate"/);
  assert.match(viewSource, /class="[^"]*draggable[^"]*"[^>]*data-column="status"/);
  assert.match(viewSource, /sort-icon/);
  assert.match(viewSource, /id="rollingFilterCollapse"/);
  assert.match(viewSource, /name="enrollmentGroup"/);
  assert.match(viewSource, /name="periodStatus"/);
  assert.match(viewSource, /name="funderId"/);
  assert.match(viewSource, /name="targetType"/);
  assert.match(viewSource, /data-sort-value=/);
  assert.match(viewSource, /function reapplyActiveTableSort/);
});
