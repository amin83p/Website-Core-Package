const test = require('node:test');
const assert = require('node:assert/strict');
const twoClassAttendanceMergeService = require('../MVC/services/school/twoClassAttendanceMergeService');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');

test('mergeTwoClassPresence collapses matching values to a single token', () => {
  assert.equal(twoClassAttendanceMergeService.mergeTwoClassPresence('Y', 'Y'), 'Y');
  assert.equal(twoClassAttendanceMergeService.mergeTwoClassPresence('y', ' Y '), 'Y');
  assert.equal(twoClassAttendanceMergeService.mergeTwoClassPresence('Y', 'N'), 'Y/N');
  assert.equal(twoClassAttendanceMergeService.mergeTwoClassPresence('X', 'X'), 'X');
});

test('collapsePresence simplifies redundant slash forms', () => {
  assert.equal(twoClassAttendanceMergeService.collapsePresence('Y/Y'), 'Y');
  assert.equal(twoClassAttendanceMergeService.collapsePresence('Y/N'), 'Y/N');
});

test('overall attendance ifelse treats trimmed presence values as equal', () => {
  const expr = 'ifelse(source("T1", "attendance_presence_01") == source("T2", "attendance_presence_01"), source("T1", "attendance_presence_01"), source("T1", "attendance_presence_01") + "/" + source("T2", "attendance_presence_01"))';
  const sources = {
    T1: { attendance_presence_01: 'Y' },
    T2: { attendance_presence_01: ' Y' }
  };
  assert.equal(reportRuleEngineService.evaluateSafeExpression(expr, { sources }), 'Y');
});

test('twoClassPresence across slots returns Y when both classes are present', () => {
  const expr = 'twoClassPresence(source("T1", "attendance_presence_01"), source("T2", "attendance_presence_01"))';
  const sources = {
    T1: { attendance_presence_01: 'Y' },
    T2: { attendance_presence_01: 'Y' }
  };
  assert.equal(reportRuleEngineService.evaluateSafeExpression(expr, { sources }), 'Y');
});
