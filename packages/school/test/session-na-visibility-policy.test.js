'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionAccessPolicyService = require('../MVC/services/school/sessionAccessPolicyService');
const sessionNaVisibilityService = require('../MVC/services/school/sessionNaVisibilityService');
const classEnrollmentSessionApplicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const { APPLICABILITY_REASON } = classEnrollmentSessionApplicabilityService;
const { NA_REASON } = sessionNaVisibilityService;

test('naAttendanceVisibility defaults match product rules', () => {
  const defaults = sessionAccessPolicyService.DEFAULT_POLICY.naAttendanceVisibility;
  assert.equal(defaults.teacherNa, true);
  assert.equal(defaults.onHoldNa, true);
  assert.equal(defaults.enrollmentExcludedNa, false);
  assert.equal(defaults.approvedLeaveNa, true);
  assert.equal(defaults.makeupRequiredNa, false);
  assert.equal(defaults.capReachedNa, false);
});

test('normalizeNaAttendanceVisibility enforces locked teacher and cap toggles', () => {
  const normalized = sessionAccessPolicyService.normalizeNaAttendanceVisibility({
    teacherNa: false,
    capReachedNa: true,
    enrollmentExcludedNa: true
  });
  assert.equal(normalized.teacherNa, true);
  assert.equal(normalized.capReachedNa, false);
  assert.equal(normalized.enrollmentExcludedNa, true);
});

test('shouldIncludeApplicabilityState respects per-type visibility', () => {
  const policy = sessionAccessPolicyService.DEFAULT_POLICY.naAttendanceVisibility;
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({ expected: true }, policy), true);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE
  }, policy), true);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.ENROLLMENT_EXCLUDED
  }, policy), false);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.ENROLLMENT_EXCLUDED
  }, { ...policy, enrollmentExcludedNa: true }), true);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.MAKEUP_REQUIRED
  }, policy), false);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.MAKEUP_REQUIRED
  }, { ...policy, makeupRequiredNa: true }), true);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.HOUR_CAP_REACHED
  }, policy), false);
  assert.equal(sessionNaVisibilityService.shouldIncludeApplicabilityState({
    expected: false,
    reason: APPLICABILITY_REASON.APPROVED_LEAVE
  }, { ...policy, approvedLeaveNa: false }), false);
});

test('resolveNaStatusContext classifies enrollment excluded with mark note', () => {
  const periodRows = [{
    id: 'PER_1',
    classId: 'CLS_1',
    personId: 'PER_STU',
    enrollmentSessionMarks: [{
      sessionId: 'S1',
      status: 'not_applicable',
      note: 'Transferred out',
      locked: true
    }],
    plannedNotApplicableSessionIds: ['S1']
  }];
  const context = sessionNaVisibilityService.resolveNaStatusContext({
    personId: 'PER_STU',
    session: { id: 'S1', date: '2026-01-10' },
    rosterRow: { attendance: 'not_applicable' },
    applicabilityState: { reason: APPLICABILITY_REASON.ENROLLMENT_EXCLUDED },
    periodRows,
    classId: 'CLS_1'
  });
  assert.equal(context.naReasonCode, NA_REASON.ENROLLMENT_EXCLUDED);
  assert.equal(context.naNote, 'Transferred out');
  assert.equal(context.displayOnlyEnrollmentExcluded, true);
});

test('resolveNaStatusContext detects on-hold N/A from hold period and roster notes', () => {
  const periodRows = [{
    id: 'PER_1',
    personId: 'PER_STU',
    enrollmentHoldPeriods: [{
      id: 'HOLD_1',
      status: 'applied',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      reason: 'Medical leave hold'
    }]
  }];
  const context = sessionNaVisibilityService.resolveNaStatusContext({
    personId: 'PER_STU',
    session: { id: 'S1', date: '2026-01-10' },
    rosterRow: {
      attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
      notes: 'Medical leave hold'
    },
    applicabilityState: { expected: false, reason: APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE },
    periodRows
  });
  assert.equal(context.naReasonCode, NA_REASON.ON_HOLD);
  assert.match(context.naNote, /Medical leave hold/);
});

test('filterRosterByNaVisibilityPolicy hides disabled N/A types', () => {
  const roster = [
    { personId: 'P1', attendance: 'present', naReasonCode: '' },
    { personId: 'P2', attendance: 'not_applicable', naReasonCode: NA_REASON.MAKEUP_REQUIRED },
    { personId: 'P3', attendance: 'not_applicable', naReasonCode: NA_REASON.MANUAL_NOT_APPLICABLE }
  ];
  const contextByPersonId = new Map([
    ['P2', { naReasonCode: NA_REASON.MAKEUP_REQUIRED }],
    ['P3', { naReasonCode: NA_REASON.MANUAL_NOT_APPLICABLE }]
  ]);
  const filtered = sessionNaVisibilityService.filterRosterByNaVisibilityPolicy(
    roster,
    sessionAccessPolicyService.DEFAULT_POLICY.naAttendanceVisibility,
    contextByPersonId
  );
  assert.deepEqual(filtered.map((row) => row.personId), ['P1', 'P3']);
});

test('stripDisplayOnlyEnrollmentExcludedFromSave removes locked marks absent from stored roster', () => {
  const incoming = [
    { personId: 'P1', attendance: 'not_applicable', displayOnlyEnrollmentExcluded: true },
    { personId: 'P2', attendance: 'present' }
  ];
  const existing = [{ personId: 'P2', attendance: 'present' }];
  const periodRows = [{
    classId: 'CLS_1',
    personId: 'P1',
    enrollmentSessionMarks: [{
      sessionId: 'S1',
      status: 'not_applicable',
      note: 'Office N/A',
      locked: true
    }]
  }];
  const stripped = sessionNaVisibilityService.stripDisplayOnlyEnrollmentExcludedFromSave({
    incomingRoster: incoming,
    existingRoster: existing,
    periodRows,
    classId: 'CLS_1',
    sessionId: 'S1'
  });
  assert.deepEqual(stripped.map((row) => row.personId), ['P2']);
});

test('attachNaContextToRosterRow copies na metadata fields', () => {
  const row = sessionNaVisibilityService.attachNaContextToRosterRow({ personId: 'P1' }, {
    naReasonCode: NA_REASON.APPROVED_LEAVE,
    naLabel: 'Approved leave',
    naNote: 'Family trip',
    displayOnlyEnrollmentExcluded: false
  });
  assert.equal(row.naReasonCode, NA_REASON.APPROVED_LEAVE);
  assert.equal(row.naNote, 'Family trip');
});
