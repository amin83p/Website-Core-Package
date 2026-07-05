const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sessionReportInstanceService = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/sessionReportInstanceService'
));
const sessionStatusPolicyService = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/sessionStatusPolicyService'
));

test('isReportRowSubmitted treats pending and draft as not submitted', () => {
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ isPendingAssignment: true, status: 'pending' }), false);
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: 'draft' }), false);
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: 'pending' }), false);
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: '' }), false);
});

test('isReportRowSubmitted treats submitted and locked as submitted', () => {
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: 'submitted' }), true);
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: 'locked' }), true);
  assert.equal(sessionReportInstanceService.isReportRowSubmitted({ status: 'SUBMITTED' }), true);
});

test('isSessionCompletionStatusByMeta matches completion-like statuses only', () => {
  assert.equal(sessionReportInstanceService.isSessionCompletionStatusByMeta({
    isFinal: true,
    makeUpRequired: false,
    excludeFromAttendance: false
  }), true);
  assert.equal(sessionReportInstanceService.isSessionCompletionStatusByMeta({
    isFinal: true,
    makeUpRequired: true,
    excludeFromAttendance: false
  }), false);
  assert.equal(sessionReportInstanceService.isSessionCompletionStatusByMeta({
    isFinal: true,
    makeUpRequired: false,
    excludeFromAttendance: true
  }), false);
  assert.equal(sessionReportInstanceService.isSessionCompletionStatusByMeta({
    isFinal: false,
    makeUpRequired: false,
    excludeFromAttendance: false
  }), false);
});

test('isSessionCompletionStatusByMap uses status definitions', () => {
  const statusMap = new Map([
    ['completed', { code: 'completed', isFinal: true, makeUpRequired: false, excludeFromAttendance: false }],
    ['cancelled', { code: 'cancelled', isFinal: true, makeUpRequired: false, excludeFromAttendance: true }],
    ['missed_informed24', { code: 'missed_informed24', isFinal: true, makeUpRequired: true, excludeFromAttendance: true }],
    ['scheduled', { code: 'scheduled', isFinal: false, makeUpRequired: false, excludeFromAttendance: false }]
  ]);

  assert.equal(sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, { status: 'completed' }), true);
  assert.equal(sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, { status: 'cancelled' }), false);
  assert.equal(sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, { status: 'missed_informed24' }), false);
  assert.equal(sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, { status: 'scheduled' }), false);
});

test('mapPendingReportDto returns compact pending report shape', () => {
  const dto = sessionReportInstanceService.mapPendingReportDto({
    templateTitle: 'Daily Report',
    studentName: 'Ada',
    teacherName: 'Turing',
    status: 'draft',
    statusLabel: 'draft',
    href: '/school/reports/instances/edit-v2/R1',
    isPending: false
  });
  assert.equal(dto.templateTitle, 'Daily Report');
  assert.equal(dto.studentName, 'Ada');
  assert.equal(dto.teacherName, 'Turing');
  assert.equal(dto.status, 'draft');
  assert.equal(dto.href, '/school/reports/instances/edit-v2/R1');
  assert.equal(dto.isPending, false);
});
