const test = require('node:test');
const assert = require('node:assert/strict');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');

function buildClbEffectiveExpression(slot, resultKey, currentKey) {
  const s = String(slot || 'T1').trim().toUpperCase();
  return [
    'ifelse(',
    `  str(source("${s}", "${resultKey}")) != ""`,
    `  && source("${s}", "${resultKey}") != "-"`,
    `  && str(source("${s}", "CLB_latest_result_recorded_at")) != ""`,
    `  && source("${s}", "CLB_latest_result_recorded_at") <= source("${s}", "report_period_due_date"),`,
    `  source("${s}", "${resultKey}"),`,
    `  source("${s}", "${currentKey}")`,
    ')'
  ].join('\n');
}

const listeningExpr = buildClbEffectiveExpression('T1', 'CLB_result_listening', 'CLB_current_listening');

test('overall CLB effective expression uses result when result date is on or before period due', () => {
  const sources = {
    T1: {
      report_period_due_date: '2026-09-30',
      CLB_latest_result_recorded_at: '2026-08-20',
      CLB_result_listening: '7',
      CLB_current_listening: '7+'
    }
  };
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression(listeningExpr, { sources }),
    '7'
  );
});

test('overall CLB effective expression uses current when result date is after period due', () => {
  const sources = {
    T1: {
      report_period_due_date: '2026-07-08',
      CLB_latest_result_recorded_at: '2026-08-20',
      CLB_result_listening: '7',
      CLB_current_listening: '7+'
    }
  };
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression(listeningExpr, { sources }),
    '7+'
  );
});

test('overall CLB effective expression uses current when result is dash or empty', () => {
  const sources = {
    T1: {
      report_period_due_date: '2026-09-30',
      CLB_latest_result_recorded_at: '2026-08-20',
      CLB_result_listening: '-',
      CLB_current_listening: '6-'
    }
  };
  assert.equal(
    reportRuleEngineService.evaluateSafeExpression(listeningExpr, { sources }),
    '6-'
  );
});

test('overall CLB effective expression supports non-T1 slots', () => {
  const expr = buildClbEffectiveExpression('T2', 'CLB_result_writing', 'CLB_current_writing');
  const sources = {
    T2: {
      report_period_due_date: '2026-10-31',
      CLB_latest_result_recorded_at: '2026-10-15',
      CLB_result_writing: '5',
      CLB_current_writing: '5+'
    }
  };
  assert.equal(reportRuleEngineService.evaluateSafeExpression(expr, { sources }), '5');
});