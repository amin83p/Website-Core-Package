const test = require('node:test');
const assert = require('node:assert/strict');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');

test('evaluateSafeExpression accepts single equals as equality', () => {
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression('num(value) = 0', { value: 0 }),
    true
  );
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression('caseof(true, num(value)=0, "-", "ok")', { value: 0 }),
    '-'
  );
});

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

test('formatSemiMonthlyDueDate maps first half to the 15th', () => {
  const expr = 'formatSemiMonthlyDueDate(source("T1", "report_period_due_date"), "dd/mm/yyyy")';
  const result = reportRuleEngineService.evaluateSafeExpression(expr, {
    sources: { T1: { report_period_due_date: '2026-03-08' } }
  });
  assert.equal(result, '15/03/2026');
});

test('formatSemiMonthlyDueDate via prefill.report_period_due_date coerces to date field storage', () => {
  const template = {
    schema: {
      fields: [{
        id: 'report_date',
        type: 'date',
        valueMode: 'calculated',
        calculationRule: {
          enabled: true,
          expression: 'formatSemiMonthlyDueDate(prefill.report_period_due_date, "dd/mm/yyyy")',
          onError: 'keep_last'
        }
      }]
    }
  };
  const { answers } = reportRuleEngineService.recomputeCalculatedAnswers({
    template,
    mergedAnswers: {},
    prefill: { report_period_due_date: '2026-10-29' }
  });
  assert.equal(answers.report_date, '2026-10-31');
});

test('formatSemiMonthlyDueDate maps second half to month end', () => {
  const expr = 'formatSemiMonthlyDueDate(source("T1", "report_period_due_date"), "dd/mm/yyyy")';
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression(expr, {
      sources: { T1: { report_period_due_date: '2026-03-20' } }
    }),
    '31/03/2026'
  );
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression(expr, {
      sources: { T1: { report_period_due_date: '2026-02-18' } }
    }),
    '28/02/2026'
  );
});
