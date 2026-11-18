'use strict';

const assert = require('assert');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');
const {
  FUTURE_GOAL_LISTENING_VALIDATION_RULES,
  FUTURE_GOAL_LISTENING_HELP_TEXT
} = require('../config/futureGoalListeningValidation');

function fieldWithRules() {
  return {
    id: 'futuregoal_listening',
    label: 'Future Goal: Listening',
    type: 'textarea',
    required: true,
    validationRules: FUTURE_GOAL_LISTENING_VALIDATION_RULES
  };
}

function testMaxLengthError() {
  const issues = reportRuleEngineService.evaluateFieldValidations({
    field: fieldWithRules(),
    value: 'x'.repeat(491),
    answers: {},
    prefill: {}
  });
  const lengthIssue = issues.find((row) => row.ruleId === 'fg_listen_max_490');
  assert.ok(lengthIssue, 'expected max length rule to fail');
  assert.equal(lengthIssue.severity, 'error');
}

function testValidTextPasses() {
  const issues = reportRuleEngineService.evaluateFieldValidations({
    field: fieldWithRules(),
    value: 'The student will practice listening to short classroom instructions.',
    answers: {},
    prefill: {}
  });
  const errors = issues.filter((row) => row.severity === 'error');
  assert.equal(errors.length, 0);
}

function testDigitsWarning() {
  const issues = reportRuleEngineService.evaluateFieldValidations({
    field: fieldWithRules(),
    value: 'The student will complete Unit 3 on page 12.',
    answers: {},
    prefill: {}
  });
  const warn = issues.find((row) => row.ruleId === 'fg_listen_no_digits_warn');
  assert.ok(warn, 'expected digits warning');
  assert.equal(warn.severity, 'warning');
}

function testHelpTextLength() {
  assert.ok(FUTURE_GOAL_LISTENING_HELP_TEXT.length <= 400, 'helpText must fit report template max 400 chars');
}

testMaxLengthError();
testValidTextPasses();
testDigitsWarning();
testHelpTextLength();
console.log('future-goal-listening-validation.test.js: ok');