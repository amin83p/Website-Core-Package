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

test('isSourceSlotPopulated is false for empty placeholder bags', () => {
  assert.equal(twoClassAttendanceMergeService.isSourceSlotPopulated({}), false);
  assert.equal(twoClassAttendanceMergeService.isSourceSlotPopulated({ class_name: '', student_full_name: '' }), false);
});

test('isSourceSlotPopulated is true when anchor keys or any value is set', () => {
  assert.equal(twoClassAttendanceMergeService.isSourceSlotPopulated({ class_name: 'Math' }), true);
  assert.equal(twoClassAttendanceMergeService.isSourceSlotPopulated({ attendance_presence_01: 'Y' }), true);
});

test('flexTwoClassPresence uses T1 only when pm slot is inactive', () => {
  assert.equal(twoClassAttendanceMergeService.flexTwoClassPresence('Y', '', false), 'Y');
  assert.equal(twoClassAttendanceMergeService.flexTwoClassPresence('Y', 'N', true), 'Y/N');
});

test('flexTwoClassNote uses T1 note only when pm slot is inactive', () => {
  assert.equal(twoClassAttendanceMergeService.flexTwoClassNote('Y', 'Late', 'N', 'Absent PM', false), 'Late');
  assert.equal(
    twoClassAttendanceMergeService.flexTwoClassNote('Y', 'Late', 'N', 'Absent', true),
    'Late AM/Absent PM'
  );
});

test('flexTwoClassPresence expression avoids Y/X when T2 slot is empty', () => {
  const expr = 'flexTwoClassPresence(source("T1", "attendance_presence_01"), source("T2", "attendance_presence_01"), sourceSlotPopulated("T2"))';
  const sources = {
    T1: { attendance_presence_01: 'Y', class_name: 'AM Class' },
    T2: { attendance_presence_01: '' }
  };
  assert.equal(reportRuleEngineService.evaluateSafeExpression(expr, { sources }), 'Y');
});

test('flexTwoClassPresence expression merges when T2 slot is populated', () => {
  const expr = 'flexTwoClassPresence(source("T1", "attendance_presence_01"), source("T2", "attendance_presence_01"), sourceSlotPopulated("T2"))';
  const sources = {
    T1: { attendance_presence_01: 'Y', class_name: 'AM' },
    T2: { attendance_presence_01: 'N', class_name: 'PM' }
  };
  assert.equal(reportRuleEngineService.evaluateSafeExpression(expr, { sources }), 'Y/N');
});
