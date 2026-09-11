'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const statutoryHolidaySchemeService = require('../MVC/services/school/statutoryHolidaySchemeService');
const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');

test('migrates legacy statutory holiday activity into equilibrium scheme', () => {
  const normalized = timesheetParametersPolicyService.normalizeStatutoryHolidayPay({
    activityId: 'ACT_LEGACY',
    enabled: true
  });
  assert.equal(
    normalized.schemes.equilibrium_school.activityId,
    'ACT_LEGACY'
  );
  assert.equal(normalized.defaultSchemeId, 'equilibrium_school');
  assert.equal(normalized.activityId, 'ACT_LEGACY');
});

test('LINC hour modes are mutually exclusive in normalization', () => {
  const fixed = timesheetParametersPolicyService.normalizeStatutoryHolidayPay({
    schemes: {
      linc: {
        hourMode: 'fixed',
        fixedHours: 6
      }
    }
  });
  assert.equal(fixed.schemes.linc.hourMode, 'fixed');
  assert.equal(fixed.schemes.linc.fixedHours, 6);

  const average = timesheetParametersPolicyService.normalizeStatutoryHolidayPay({
    schemes: {
      linc: {
        hourMode: 'average_weeks',
        averageWeeks: 3
      }
    }
  });
  assert.equal(average.schemes.linc.hourMode, 'average_weeks');
  assert.equal(average.schemes.linc.averageWeeks, 3);
});

test('calculateLincSchemeHours uses most recent same-weekday department hours', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({
    statutoryHolidayPay: {
      defaultSchemeId: 'linc',
      departmentSchemeAssignments: { DEPT_LINC: 'linc' },
      schemes: {
        equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
        linc: { id: 'linc', activityId: 'ACT_LINC', hourMode: 'most_recent' }
      }
    }
  });
  const result = statutoryHolidaySchemeService.calculateLincSchemeHours({
    holidayDate: '2026-01-01',
    workdayEntries: [
      { date: '2025-12-25', deliveryDepartmentId: 'DEPT_LINC', hours: 4, timesheetHours: 4 },
      { date: '2025-12-18', deliveryDepartmentId: 'DEPT_LINC', hours: 5, timesheetHours: 5 }
    ],
    policy
  });
  assert.equal(result.calculatedHours, 4);
  assert.deepEqual(result.departmentIds, ['DEPT_LINC']);
});

test('calculateEquilibriumSchemeHours scopes earnings average to assigned departments', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({
    statutoryHolidayPay: {
      earningsLookbackWeeks: 4,
      departmentSchemeAssignments: { DEPT_EQ: 'equilibrium_school' },
      schemes: {
        equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
        linc: { id: 'linc', activityId: 'ACT_LINC', hourMode: 'most_recent' }
      }
    }
  });
  const result = statutoryHolidaySchemeService.calculateEquilibriumSchemeHours({
    holidayDate: '2026-01-01',
    workdayEntries: [
      { date: '2025-12-29', deliveryDepartmentId: 'DEPT_EQ', hours: 8, timesheetHours: 8 },
      { date: '2025-12-30', deliveryDepartmentId: 'DEPT_EQ', hours: 4, timesheetHours: 4 },
      { date: '2025-12-29', deliveryDepartmentId: 'DEPT_OTHER', hours: 10, timesheetHours: 10 }
    ],
    policy
  });
  assert.equal(result.calculatedHours, 6);
});

test('buildStatHolidaySessionId supports scheme-aware and legacy formats', () => {
  assert.equal(
    statutoryHolidayEligibilityService.buildStatHolidaySessionId('H1', 'P1'),
    'stathol-H1-P1'
  );
  assert.equal(
    statutoryHolidayEligibilityService.buildStatHolidaySessionId('H1', 'P1', 'linc'),
    'stathol-linc-H1-P1'
  );
  const parsed = statutoryHolidayEligibilityService.parseStatHolidaySessionParts('stathol-linc-H1-P1', 'P1');
  assert.equal(parsed.schemeId, 'linc');
  assert.equal(parsed.holidayId, 'H1');
  const legacy = statutoryHolidayEligibilityService.parseStatHolidaySessionParts('stathol-H1-P1', 'P1');
  assert.equal(legacy.schemeId, 'equilibrium_school');
  assert.equal(legacy.holidayId, 'H1');
});

test('buildOverrideLookup keys overrides by scheme and holiday', () => {
  const lookup = statutoryHolidayEligibilityService.buildOverrideLookup([
    {
      sessionId: 'stathol-linc-H1-P1',
      statHolidayMeta: { holidayId: 'H1', schemeId: 'linc' },
      statHolidayOverride: { hours: 3 }
    }
  ], null, { personId: 'P1' });
  const key = statutoryHolidaySchemeService.buildStatHolidayOverrideKey('linc', 'H1');
  assert.ok(lookup.has(key));
  assert.equal(lookup.get(key).statHolidayOverride.hours, 3);
});
