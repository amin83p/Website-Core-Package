const test = require('node:test');
const assert = require('node:assert/strict');

const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');

const rollingClass = {
  id: 'CLS_ROLL_001',
  registrationMode: 'rolling'
};

const basePayload = {
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  targetSessionCount: 5,
  availableCount: 2,
  alignmentStatus: 'insufficient_sessions',
  effectiveTarget: 5
};

test('does not throw when no target session count is set and sessions are insufficient', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      targetSessionCount: 0,
      alignmentStatus: 'insufficient_sessions'
    },
    plannedNaSessionIds: []
  });
  assert.equal(result.enforceSessionCount, false);
  assert.equal(result.alignmentStatus, 'insufficient_sessions');
});

test('allows a target session enrollment before enough sessions are scheduled', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: basePayload,
    plannedNaSessionIds: []
  });
  assert.equal(result.enforceSessionCount, true);
});

test('allows a target session enrollment without an end date', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      endDate: '',
      alignmentStatus: 'no_end_date',
      availableCount: 0
    },
    plannedNaSessionIds: []
  });
  assert.equal(result.enforceSessionCount, true);
});

test('allows enrollment when target is set and alignment is ok', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      alignmentStatus: 'ok',
      availableCount: 5
    },
    plannedNaSessionIds: []
  });
  assert.equal(result.alignmentStatus, 'ok');
  assert.equal(result.enforceSessionCount, true);
});

test('allows targeted enrollment without selecting scheduled sessions as N/A', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      targetSessionCount: 2,
      alignmentStatus: 'overage_requires_na',
      availableCount: 3,
      requiredNaCount: 1
    },
    plannedNaSessionIds: []
  });
  assert.equal(result.alignmentStatus, 'overage_requires_na');
});

test('does not use stale planned-N/A input to reject a target enrollment', () => {
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      targetSessionCount: 1,
      alignmentStatus: 'overage_requires_na',
      availableCount: 2,
      requiredNaCount: 1
    },
    plannedNaSessionIds: ['SES_001']
  });
  assert.equal(result.enforceSessionCount, true);
});

test('isTargetSessionCountEnforced reads numeric target values', () => {
  assert.equal(alignmentService.isTargetSessionCountEnforced(5), true);
  assert.equal(alignmentService.isTargetSessionCountEnforced('3'), true);
  assert.equal(alignmentService.isTargetSessionCountEnforced(0), false);
  assert.equal(alignmentService.isTargetSessionCountEnforced(''), false);
});

test('computeProposedCycleEndDate extends when sessions exceed current cycle end', () => {
  const proposed = alignmentService.computeProposedCycleEndDate({
    cycleEndDate: '2026-03-31',
    sessions: [
      { date: '2026-03-15' },
      { date: '2026-04-10' }
    ]
  });
  assert.equal(proposed, '2026-04-10');
});

test('computeProposedCycleEndDate keeps current end when sessions are within cycle', () => {
  const proposed = alignmentService.computeProposedCycleEndDate({
    cycleEndDate: '2026-03-31',
    sessions: [
      { date: '2026-03-15' },
      { date: '2026-03-20' }
    ]
  });
  assert.equal(proposed, '2026-03-31');
});

test('resolveDefaultTeacherFromClass uses active instructor when primaryTeacherId is missing', () => {
  const teacher = alignmentService.resolveDefaultTeacherFromClass({
    instructors: [{ personId: 'PERSON_01', name: 'Jane Doe', status: 'active' }]
  }, {});
  assert.equal(teacher.teacherId, 'PERSON_01');
  assert.equal(teacher.teacherName, 'Jane Doe');
});

test('generateBatchSessionRows skips exception dates', () => {
  const created = alignmentService.generateBatchSessionRows({
    classData: { id: 'CLS_ROLL_001', registrationMode: 'rolling' },
    existingSessions: [],
    batchSpec: {
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      daysOfWeek: [1],
      startTime: '09:00',
      endTime: '10:00',
      exceptionDates: ['2026-01-05'],
      skipExistingDates: false
    }
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].date, '2026-01-12');
});

test('generateBatchSessionRows assigns instructor from class when batchSpec teacher is empty', () => {
  const created = alignmentService.generateBatchSessionRows({
    classData: {
      id: 'CLS_ROLL_001',
      registrationMode: 'rolling',
      instructors: [{ personId: 'PERSON_99', name: 'Lead Teacher', status: 'active' }]
    },
    existingSessions: [],
    batchSpec: {
      startDate: '2026-01-05',
      endDate: '2026-01-05',
      daysOfWeek: [1],
      startTime: '09:00',
      endTime: '10:00',
      skipExistingDates: false
    }
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].delivery.deliveredBy, 'PERSON_99');
  assert.equal(created[0].delivery.deliveredByName, 'Lead Teacher');
});

test('generateBatchSessionRows assigns ids after unsaved staged sessions', () => {
  const created = alignmentService.generateBatchSessionRows({
    classData: { id: 'CLS_ROLL_001', registrationMode: 'rolling' },
    existingSessions: [{
      sessionId: 'SES_001',
      date: '2026-09-01',
      startTime: '09:00',
      endTime: '12:00'
    }],
    batchSpec: {
      startDate: '2026-09-08',
      endDate: '2026-09-08',
      daysOfWeek: [2],
      startTime: '09:00',
      endTime: '12:00',
      skipExistingDates: false
    }
  });
  assert.equal(created.length, 1);
  assert.notEqual(created[0].sessionId, 'SES_001');
});

test('evaluateAlignment reports insufficient_sessions for target enrollment without end date', () => {
  const result = alignmentService.evaluateAlignment({
    sessions: [
      { sessionId: 'SES_001', date: '2026-08-15', status: 'scheduled' }
    ],
    startDate: '2026-09-01',
    endDate: '',
    targetSessionCount: 15
  });
  assert.equal(result.alignmentStatus, 'insufficient_sessions');
  assert.equal(result.availableCount, 0);
  assert.equal(result.gapCount, 15);
  assert.equal(result.effectiveTarget, 15);
});

test('evaluateAlignment is ok when enough sessions exist from start without end date', () => {
  const sessions = Array.from({ length: 20 }, (_, index) => ({
    sessionId: `SES_${index + 1}`,
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    status: 'scheduled'
  }));
  const result = alignmentService.evaluateAlignment({
    sessions,
    startDate: '2026-09-01',
    endDate: '',
    targetSessionCount: 15
  });
  assert.equal(result.alignmentStatus, 'ok');
  assert.equal(result.availableCount, 20);
});

function scheduledSession(id, date, durationHours = 3) {
  return {
    sessionId: id,
    date,
    status: 'scheduled',
    durationHours
  };
}

test('evaluateAlignment reports insufficient_hours for hour target without end date', () => {
  const result = alignmentService.evaluateAlignment({
    sessions: [
      scheduledSession('SES_001', '2026-09-01', 3),
      scheduledSession('SES_002', '2026-09-08', 3)
    ],
    startDate: '2026-09-01',
    endDate: '',
    targetHours: 20
  });
  assert.equal(result.alignmentStatus, 'insufficient_hours');
  assert.equal(result.availableHours, 6);
  assert.equal(result.gapHours, 14);
  assert.equal(result.effectiveTargetHours, 20);
});

test('evaluateAlignment reports overage_requires_na when scheduled hours exceed hour target', () => {
  const sessions = Array.from({ length: 7 }, (_, index) => scheduledSession(
    `SES_${index + 1}`,
    `2026-09-${String(index + 1).padStart(2, '0')}`,
    3
  ));
  const result = alignmentService.evaluateAlignment({
    sessions,
    startDate: '2026-09-01',
    endDate: '',
    targetHours: 20
  });
  assert.equal(result.alignmentStatus, 'overage_requires_na');
  assert.equal(result.availableHours, 21);
  assert.equal(result.requiredNaHours, 1);
  assert.equal(result.allocatedSessionCount, 7);
});

test('evaluateAlignment is ok when scheduled hours match hour target', () => {
  const sessions = [
    scheduledSession('SES_001', '2026-09-01', 5),
    scheduledSession('SES_002', '2026-09-08', 5),
    scheduledSession('SES_003', '2026-09-15', 5),
    scheduledSession('SES_004', '2026-09-22', 5)
  ];
  const result = alignmentService.evaluateAlignment({
    sessions,
    startDate: '2026-09-01',
    endDate: '',
    targetHours: 20
  });
  assert.equal(result.alignmentStatus, 'ok');
  assert.equal(result.availableHours, 20);
  assert.equal(result.allocatedSessionCount, 4);
});
