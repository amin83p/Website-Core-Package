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

test('throws when target is set and sessions are insufficient', () => {
  assert.throws(
    () => alignmentService.assertEnrollmentSessionAlignmentForCreate({
      classData: rollingClass,
      payload: basePayload,
      plannedNaSessionIds: []
    }),
    /Not enough countable sessions/
  );
});

test('throws when target is set and end date is missing', () => {
  assert.throws(
    () => alignmentService.assertEnrollmentSessionAlignmentForCreate({
      classData: rollingClass,
      payload: {
        ...basePayload,
        endDate: '',
        alignmentStatus: 'ok',
        availableCount: 10
      },
      plannedNaSessionIds: []
    }),
    /End date is required/
  );
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

test('allows targeted enrollment when overage is resolved with planned N/A sessions', () => {
  const countableSessions = [
    { sessionId: 'SES_001' },
    { sessionId: 'SES_002' },
    { sessionId: 'SES_003' }
  ];
  const result = alignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData: rollingClass,
    payload: {
      ...basePayload,
      targetSessionCount: 2,
      alignmentStatus: 'overage_requires_na',
      availableCount: 3,
      countableSessions,
      requiredNaCount: 1
    },
    plannedNaSessionIds: ['SES_003']
  });
  assert.equal(result.alignmentStatus, 'overage_requires_na');
});

test('throws when targeted overage has invalid N/A selection', () => {
  assert.throws(
    () => alignmentService.assertEnrollmentSessionAlignmentForCreate({
      classData: rollingClass,
      payload: {
        ...basePayload,
        targetSessionCount: 1,
        alignmentStatus: 'overage_requires_na',
        availableCount: 2,
        countableSessions: [{ sessionId: 'SES_001' }, { sessionId: 'SES_002' }],
        requiredNaCount: 1
      },
      plannedNaSessionIds: []
    }),
    /Select exactly 1 session/
  );
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
    classData: { registrationMode: 'rolling' },
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
