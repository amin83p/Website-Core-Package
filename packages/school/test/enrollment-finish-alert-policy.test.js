const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../MVC/services/school/enrollmentFinishAlertPolicyService');

test('evaluateAlert uses OR logic across enabled thresholds', () => {
  const result = service.evaluateAlert({
    policy: {
      daysToExpectedFinishDate: 30,
      sessionsToFinishEnrollment: 5,
      hoursToFinishEnrollment: null
    },
    sessionDate: '2026-03-01',
    finishDate: '2026-03-10',
    remainingSessionCount: 4,
    remainingHours: 20,
    hasSessionTarget: true,
    hasHourTarget: false
  });
  assert.equal(result.active, true);
  assert.deepEqual(result.reasons.sort(), ['days', 'sessions'].sort());
});

test('evaluateAlert ignores blank thresholds', () => {
  const result = service.evaluateAlert({
    policy: {},
    sessionDate: '2026-03-01',
    finishDate: '2026-03-02',
    remainingSessionCount: 1,
    remainingHours: 1,
    hasSessionTarget: true,
    hasHourTarget: true
  });
  assert.equal(result.active, false);
  assert.equal(result.reasons.length, 0);
});

test('evaluateAlert treats overdue finish dates as met for day threshold', () => {
  const result = service.evaluateAlert({
    policy: { daysToExpectedFinishDate: 7 },
    sessionDate: '2026-03-15',
    finishDate: '2026-03-01',
    remainingSessionCount: null,
    remainingHours: null,
    hasSessionTarget: false,
    hasHourTarget: false
  });
  assert.equal(result.active, true);
  assert.deepEqual(result.reasons, ['days']);
  assert.equal(result.details[0].daysUntilFinish < 0, true);
});

test('validatePolicyInput normalizes optional thresholds', () => {
  const policy = service.validatePolicyInput({
    daysToExpectedFinishDate: '14',
    sessionsToFinishEnrollment: '',
    hoursToFinishEnrollment: '0',
    alertMessage: '  Near finish  '
  });
  assert.equal(policy.daysToExpectedFinishDate, 14);
  assert.equal(policy.sessionsToFinishEnrollment, null);
  assert.equal(policy.hoursToFinishEnrollment, null);
  assert.equal(policy.alertMessage, 'Near finish');
});
