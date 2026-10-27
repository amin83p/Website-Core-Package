'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reportPeriodBasePolicy = require('../MVC/services/school/reportPeriodBasePolicy');

test('computeSuggestedReportStartDateSync subtracts days from session date', () => {
  const start = reportPeriodBasePolicy.computeSuggestedReportStartDateSync({
    reportPeriodBase: 'days',
    reportPeriodOffset: 15,
    sessionDate: '2026-03-20'
  });
  assert.equal(start, '2026-03-05');
});

test('computeSuggestedReportStartDateSync uses calendar year start', () => {
  const start = reportPeriodBasePolicy.computeSuggestedReportStartDateSync({
    reportPeriodBase: 'year',
    sessionDate: '2026-09-15'
  });
  assert.equal(start, '2026-01-01');
});

test('parseReportPeriodFieldsFromBody requires offset for days', () => {
  assert.throws(() => reportPeriodBasePolicy.parseReportPeriodFieldsFromBody({
    reportPeriodBasePresent: 'true',
    reportPeriodBase: 'days'
  }));
});

test('parseReportPeriodFieldsFromBody normalizes weeks offset', () => {
  const fields = reportPeriodBasePolicy.parseReportPeriodFieldsFromBody({
    reportPeriodBasePresent: 'true',
    reportPeriodBase: 'weeks',
    reportPeriodOffset: '2'
  });
  assert.equal(fields.reportPeriodBase, 'weeks');
  assert.equal(fields.reportPeriodOffset, 2);
});
