'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reportPeriodBaseService = require('../MVC/services/school/reportPeriodBaseService');

test('resolveSuggestedReportStartDate uses enrollment only for single student scope', async () => {
  const start = await reportPeriodBaseService.resolveSuggestedReportStartDate({
    template: { reportPeriodBase: 'enrollment' },
    sessionDate: '2026-06-15',
    classData: { id: 'CLS_1' },
    reqUser: {},
    reportScope: 'class',
    targetStudentIds: ['STU_1']
  });
  assert.equal(start, '2026-06-15');
});

test('resolveSuggestedReportStartDate delegates days offset to policy', async () => {
  const start = await reportPeriodBaseService.resolveSuggestedReportStartDate({
    template: { reportPeriodBase: 'days', reportPeriodOffset: 7 },
    sessionDate: '2026-06-15',
    reportScope: 'each_student',
    targetStudentIds: ['A', 'B']
  });
  assert.equal(start, '2026-06-08');
});
