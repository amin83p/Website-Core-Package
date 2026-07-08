const test = require('node:test');
const assert = require('node:assert/strict');

const applicabilityService = require('../packages/school/MVC/services/school/classEnrollmentSessionApplicabilityService');

test('make-up-required sessions derive N/A and do not consume session-capped rolling enrollment', () => {
  const sessions = [
    {
      sessionId: 'SES-MAKEUP',
      date: '2026-06-01',
      status: 'missed_informed24',
      roster: [{ personId: 'PERSON-1', attendance: 'present' }]
    },
    {
      sessionId: 'SES-COUNT-1',
      date: '2026-06-08',
      status: 'completed',
      roster: [{ personId: 'PERSON-1', attendance: 'present' }]
    },
    {
      sessionId: 'SES-COUNT-2',
      date: '2026-06-15',
      status: 'completed',
      roster: [{ personId: 'PERSON-1', attendance: 'late' }]
    }
  ];

  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [{
      id: 'PERIOD-1',
      orgId: '900000',
      studentId: 'STUDENT-1',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      status: 'active',
      targetSessionCount: 2
    }],
    studentToPersonMap: new Map([['STUDENT-1', 'PERSON-1']]),
    activeOrgId: '900000',
    forceNotApplicableSessionKeys: new Set(['SES-MAKEUP'])
  });

  const makeupState = applicabilityService.getApplicabilityState(result.stateByKey, 'PERSON-1', sessions[0]);
  const firstCountedState = applicabilityService.getApplicabilityState(result.stateByKey, 'PERSON-1', sessions[1]);
  const secondCountedState = applicabilityService.getApplicabilityState(result.stateByKey, 'PERSON-1', sessions[2]);
  const summary = result.summariesByPeriodId.get('PERIOD-1');

  assert.equal(makeupState.expected, false);
  assert.equal(makeupState.reason, 'makeup_required');
  assert.equal(firstCountedState.expected, true);
  assert.equal(secondCountedState.expected, true);
  assert.equal(summary.consumedCount, 2);
  assert.equal(summary.completionCandidate.sessionId, 'SES-COUNT-2');
});