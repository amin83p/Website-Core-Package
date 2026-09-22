'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const priorPeriodAdjustmentService = require('../MVC/services/school/timesheetPriorPeriodAdjustmentService');

test('isStatutoryHolidayLegacyDriftExemptEntry detects stathol session rows', () => {
  assert.equal(
    priorPeriodAdjustmentService.isStatutoryHolidayLegacyDriftExemptEntry({
      sessionId: 'stathol-linc-H1-P1',
      isStatutoryHoliday: true,
      hours: 12
    }, null),
    true
  );
});

test('isStatutoryHolidayLegacyDriftExemptEntry detects scheme activity id', () => {
  const schemeIds = new Set(['ACT_STAT_SCHOOL']);
  assert.equal(
    priorPeriodAdjustmentService.isStatutoryHolidayLegacyDriftExemptEntry({
      sessionId: 'act-ACT_STAT_SCHOOL-entry1-P1',
      activityId: 'ACT_STAT_SCHOOL',
      className: 'STATUTORY HOLIDAY (School Payable): WINTER BREAK',
      hours: 12
    }, schemeIds),
    true
  );
  assert.equal(
    priorPeriodAdjustmentService.isStatutoryHolidayLegacyDriftExemptEntry({
      sessionId: 'act-OTHER-entry1-P1',
      activityId: 'OTHER',
      hours: 12
    }, schemeIds),
    false
  );
});

test('detectLegacyAdjustments skips statutory holiday drift when prior is processed', async () => {
  const sessionId = 'act-ACT_STAT_SCHOOL-e1-TEACHER1';
  const priorPayableIndex = new Map([
    [sessionId, {
      sessionId,
      date: '2026-01-01',
      classId: '',
      className: 'STATUTORY HOLIDAY (School Payable): WINTER BREAK',
      hours: 0,
      status: 'activity',
      inPriorPeriod: true,
      inCurrentPeriod: false
    }]
  ]);
  const adjustments = await priorPeriodAdjustmentService.detectLegacyAdjustments({
    snapshotEntries: [{
      sessionId,
      date: '2026-01-01',
      activityId: 'ACT_STAT_SCHOOL',
      className: 'STATUTORY HOLIDAY (School Payable): WINTER BREAK',
      hours: 12,
      isSchoolActivity: true,
      isStatutoryHoliday: true,
      status: 'activity',
      statHolidayMeta: { holidayId: 'WINTER_BREAK', schemeId: 'equilibrium_school' }
    }],
    priorTimesheet: { status: 'processed' },
    priorPeriod: { id: 'PERIOD_JAN', name: '2026-JAN-01', startDate: '2026-01-01', endDate: '2026-01-15', status: 'processed' },
    currentPeriod: { id: 'PERIOD_SEP', startDate: '2026-09-01', endDate: '2026-09-15' },
    teacherId: 'TEACHER1',
    activeOrgId: '',
    reqUser: {},
    priorPayableIndex,
    currentPayableIndex: new Map()
  });
  assert.equal(adjustments.length, 0);
});

test('detectLegacyAdjustments still reports non-stat legacy drift when prior is processed', async () => {
  const sessionId = 'sess-regular-1';
  const priorPayableIndex = new Map([
    [sessionId, {
      sessionId,
      date: '2026-01-02',
      classId: 'CLASS1',
      className: 'LINC 6 Morning',
      hours: 4,
      status: 'completed',
      inPriorPeriod: true,
      inCurrentPeriod: false
    }]
  ]);
  const adjustments = await priorPeriodAdjustmentService.detectLegacyAdjustments({
    snapshotEntries: [{
      sessionId,
      date: '2026-01-02',
      classId: 'CLASS1',
      className: 'LINC 6 Morning',
      hours: 6,
      status: 'completed'
    }],
    priorTimesheet: { status: 'processed' },
    priorPeriod: { id: 'PERIOD_JAN', startDate: '2026-01-01', endDate: '2026-01-15', status: 'processed' },
    currentPeriod: { id: 'PERIOD_SEP', startDate: '2026-09-01', endDate: '2026-09-15' },
    teacherId: 'TEACHER1',
    activeOrgId: '',
    reqUser: {},
    priorPayableIndex,
    currentPayableIndex: new Map()
  });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].reconciliationReason, 'legacy_drift');
  assert.equal(adjustments[0].deltaHours, -2);
});

test('detectLegacyAdjustments still reports statutory holiday drift when prior is not processed', async () => {
  const sessionId = 'stathol-H1-P1';
  const priorPayableIndex = new Map([
    [sessionId, {
      sessionId,
      date: '2026-01-01',
      className: 'STATUTORY HOLIDAY',
      hours: 0,
      status: 'stat_holiday',
      inPriorPeriod: true,
      inCurrentPeriod: false
    }]
  ]);
  const adjustments = await priorPeriodAdjustmentService.detectLegacyAdjustments({
    snapshotEntries: [{
      sessionId,
      date: '2026-01-01',
      isStatutoryHoliday: true,
      className: 'STATUTORY HOLIDAY',
      hours: 12,
      status: 'stat_holiday'
    }],
    priorTimesheet: { status: 'submitted' },
    priorPeriod: { id: 'PERIOD_JAN', startDate: '2026-01-01', endDate: '2026-01-15', status: 'submitted' },
    currentPeriod: { id: 'PERIOD_SEP', startDate: '2026-09-01', endDate: '2026-09-15' },
    teacherId: 'TEACHER1',
    activeOrgId: '',
    reqUser: {},
    priorPayableIndex,
    currentPayableIndex: new Map()
  });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].deltaHours, -12);
});
