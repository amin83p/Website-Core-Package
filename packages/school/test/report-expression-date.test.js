const test = require('node:test');
const assert = require('node:assert/strict');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');

test('formatDate converts ISO report dates to dd/mm/yyyy', () => {
  const expr = 'formatDate(source("T1", "report_period_due_date"))';
  const result = reportRuleEngineService.evaluateSafeExpression(expr, {
    sources: {
      T1: { report_period_due_date: '2026-03-15' }
    }
  });
  assert.equal(result, '15/03/2026');
});

test('formatDate leaves empty when source date is missing', () => {
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression('formatDate(source("T1", "report_period_due_date"))', { sources: { T1: {} } }),
    ''
  );
});

test('formatDate supports custom patterns', () => {
  assert.equal(
    reportRuleEngineService.HELPERS.formatDate('2026-03-15', 'mm/dd/yyyy'),
    '03/15/2026'
  );
});
