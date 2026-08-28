const test = require('node:test');
const assert = require('node:assert/strict');

const marksService = require('../MVC/services/school/enrollmentSessionMarksService');
const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');
const rollingAlignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');

const personId = 'PERSON_001';
const classId = 'CLS_001';
const periodId = 'PER_001';

function buildMocks({ sessions = [], period = null } = {}) {
  const periodRow = period || {
    id: periodId,
    classId,
    personId,
    studentId: 'STU_001',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    enrollmentSessionMarks: [],
    plannedNotApplicableSessionIds: []
  };
  const classRow = {
    id: classId,
    sessions
  };
  const updates = [];
  return {
    repositories: {
      classEnrollmentPeriods: {
        async getById(id) {
          return id === periodId ? { ...periodRow } : null;
        },
        async update(id, patch) {
          Object.assign(periodRow, patch);
          updates.push({ id, patch });
          return { ...periodRow };
        }
      },
      classes: {
        async getById(id) {
          return id === classId ? { ...classRow, sessions: [...classRow.sessions] } : null;
        },
        async update(id, patch) {
          if (patch.sessions) classRow.sessions = patch.sessions;
          updates.push({ id, patch });
          return classRow;
        }
      }
    },
    periodRow,
    classRow,
    updates
  };
}

test('findLockedEnrollmentNaMark returns locked mark for matching session and person', () => {
  const periods = [{
    id: periodId,
    classId,
    personId,
    enrollmentSessionMarks: [{
      sessionId: 'S1',
      status: 'not_applicable',
      note: 'Office marked',
      locked: true
    }]
  }];
  const lock = marksService.findLockedEnrollmentNaMark(periods, classId, 'S1', personId);
  assert.ok(lock);
  assert.equal(lock.periodId, periodId);
  assert.equal(lock.mark.note, 'Office marked');
});

test('findLockedEnrollmentNaMark ignores unlocked or missing marks', () => {
  const periods = [{
    id: periodId,
    classId,
    personId,
    enrollmentSessionMarks: [{
      sessionId: 'S1',
      status: 'not_applicable',
      locked: false
    }]
  }];
  assert.equal(marksService.findLockedEnrollmentNaMark(periods, classId, 'S1', personId), null);
});

test('applySessionMarks requires note when marking N/A', async () => {
  const mocks = buildMocks({
    sessions: [{
      id: 'S1',
      date: '2026-01-10',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId, attendance: '' }]
    }]
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    await assert.rejects(
      () => marksService.applySessionMarks(periodId, [{ sessionId: 'S1', action: 'mark_na', note: '' }], { id: 'USR_1' }),
      /note is required/i
    );
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks stores locked mark, removes person from roster, and sets enrollment_excluded', async () => {
  const mocks = buildMocks({
    sessions: [{
      id: 'S1',
      date: '2026-01-10',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId, attendance: '' }, { personId: 'OTHER', attendance: 'present' }]
    }]
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S1', action: 'mark_na', note: 'Student transferred' }],
      { id: 'USR_1' }
    );
    assert.equal(updated.enrollmentSessionMarks.length, 1);
    assert.equal(updated.enrollmentSessionMarks[0].locked, true);
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S1']);
    assert.deepEqual(
      mocks.classRow.sessions[0].roster.map((row) => row.personId),
      ['OTHER']
    );

    const applicability = applicabilityService.resolveRollingEnrollmentApplicability({
      sessions: mocks.classRow.sessions,
      periodRows: [updated],
      studentToPersonMap: new Map([['STU_001', personId]])
    });
    const state = applicabilityService.getApplicabilityState(
      applicability.stateByKey,
      personId,
      mocks.classRow.sessions[0],
      'S1'
    );
    assert.equal(state.expected, false);
    assert.equal(state.reason, applicabilityService.APPLICABILITY_REASON.ENROLLMENT_EXCLUDED);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('teacher roster N/A alone stays manual_not_applicable without enrollment exclusion', () => {
  const sessions = [{
    id: 'S1',
    date: '2026-01-10',
    startTime: '09:00',
    endTime: '10:00',
    roster: [{
      personId,
      attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
    }]
  }];
  const period = {
    id: periodId,
    classId,
    personId,
    studentId: 'STU_001',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    enrollmentSessionMarks: [],
    plannedNotApplicableSessionIds: []
  };
  const applicability = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap: new Map([['STU_001', personId]])
  });
  const state = applicabilityService.getApplicabilityState(
    applicability.stateByKey,
    personId,
    sessions[0],
    'S1'
  );
  assert.equal(state.expected, false);
  assert.equal(state.reason, applicabilityService.APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE);
});

test('enrollment_excluded session is not expected and is ineligible for rollup denominator', () => {
  const sessions = [{
    id: 'S1',
    date: '2026-01-10',
    startTime: '09:00',
    endTime: '10:00',
    roster: []
  }, {
    id: 'S2',
    date: '2026-01-11',
    startTime: '09:00',
    endTime: '10:00',
    roster: [{ personId, attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT }]
  }];
  const period = {
    id: periodId,
    classId,
    personId,
    studentId: 'STU_001',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    enrollmentSessionMarks: [{
      sessionId: 'S1',
      status: 'not_applicable',
      note: 'excluded',
      locked: true
    }],
    plannedNotApplicableSessionIds: ['S1']
  };
  const applicability = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap: new Map([['STU_001', personId]])
  });
  const excluded = applicabilityService.getApplicabilityState(
    applicability.stateByKey,
    personId,
    sessions[0],
    'S1'
  );
  const present = applicabilityService.getApplicabilityState(
    applicability.stateByKey,
    personId,
    sessions[1],
    'S2'
  );
  assert.equal(excluded.expected, false);
  assert.equal(excluded.reason, applicabilityService.APPLICABILITY_REASON.ENROLLMENT_EXCLUDED);
  assert.equal(present.expected, true);

  // Matrix / report path: non-expected cells render as N/A and stay out of rollup denom
  assert.equal(
    attendanceMatrixMetricsService.isEligibleRollupStatus(
      attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
    ),
    false
  );
});

test('computeOneOnOneExcludedSessionIds excludes non-selected in-window sessions', () => {
  const sessions = [
    { sessionId: 'SES_A', date: '2026-01-05' },
    { sessionId: 'SES_B', date: '2026-01-12' },
    { sessionId: 'SES_C', date: '2026-01-19' },
    { sessionId: 'SES_OUT', date: '2025-12-01' }
  ];
  const excluded = rollingAlignmentService.computeOneOnOneExcludedSessionIds({
    sessions,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    activeSessionIds: ['SES_A', 'SES_C']
  });
  assert.deepEqual(excluded, ['SES_B']);
});

test('removePersonFromExcludedSessionRosters drops only the target person', () => {
  const sessions = [{
    id: 'S1',
    roster: [
      { personId, attendance: 'present' },
      { personId: 'OTHER', attendance: 'present' }
    ]
  }, {
    id: 'S2',
    roster: [{ personId, attendance: 'present' }]
  }];
  const { nextSessions, updatedCount } = rollingAlignmentService.removePersonFromExcludedSessionRosters(
    sessions,
    personId,
    ['S1']
  );
  assert.equal(updatedCount, 1);
  assert.deepEqual(nextSessions[0].roster.map((row) => row.personId), ['OTHER']);
  assert.equal(nextSessions[1].roster.length, 1);
});

test('applySessionMarks unmark clears leftover roster N/A attendance', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      enrollmentSessionMarks: [{
        sessionId: 'S1',
        status: 'not_applicable',
        note: 'test',
        locked: true
      }],
      plannedNotApplicableSessionIds: ['S1']
    },
    sessions: [{
      id: 'S1',
      date: '2026-01-10',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{
        personId,
        attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
      }]
    }]
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S1', action: 'unmark' }],
      { id: 'USR_1' }
    );
    assert.deepEqual(mocks.periodRow.plannedNotApplicableSessionIds, []);
    assert.equal(mocks.periodRow.enrollmentSessionMarks.length, 0);
    const rosterRow = mocks.classRow.sessions[0].roster[0];
    assert.equal(rosterRow.attendance, '');

    const applicability = applicabilityService.resolveRollingEnrollmentApplicability({
      sessions: mocks.classRow.sessions,
      periodRows: [mocks.periodRow],
      studentToPersonMap: new Map([['STU_001', personId]])
    });
    const state = applicabilityService.getApplicabilityState(
      applicability.stateByKey,
      personId,
      mocks.classRow.sessions[0],
      'S1'
    );
    assert.equal(state.expected, true);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

function threeWindowSessions() {
  return [
    { id: 'S1', date: '2026-01-10', startTime: '09:00', endTime: '10:00', roster: [{ personId, attendance: '' }] },
    { id: 'S2', date: '2026-01-11', startTime: '09:00', endTime: '10:00', roster: [{ personId, attendance: '' }] },
    { id: 'S3', date: '2026-01-12', startTime: '09:00', endTime: '10:00', roster: [{ personId, attendance: '' }] }
  ];
}

test('applySessionMarks with session target rejects too few N/A marks', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 2,
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    // 3 window sessions, target 2 => need exactly 1 N/A. Saving with zero N/A fails.
    await assert.rejects(
      () => marksService.applySessionMarks(periodId, [], { id: 'USR_1' }),
      /exactly 1 session/i
    );
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks with session target accepts exact required N/A count', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 2,
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S3', action: 'mark_na', note: 'surplus session' }],
      { id: 'USR_1' }
    );
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S3']);
    assert.equal(updated.enrollmentSessionMarks.length, 1);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks with hour target rejects insufficient N/A hours', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetHours: 2,
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    // 3h available, target 2h => need >= 1h N/A. Marking nothing fails when we somehow try empty?
    // Mark zero changes with no existing marks — apply with empty changes should succeed (no change).
    // Marking is required only when saving a set that still has too few N/A.
    // With 0 N/A and target 2h / 3h available, validating plannedIds=[] fails.
    await assert.rejects(
      () => marksService.applySessionMarks(
        periodId,
        [{ sessionId: 'S1', action: 'mark_na', note: 'x' }, { sessionId: 'S1', action: 'unmark' }],
        { id: 'USR_1' }
      ),
      /at least 1 hour/i
    );
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks with hour target accepts enough N/A hours', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetHours: 2,
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S2', action: 'mark_na', note: '1h surplus' }],
      { id: 'USR_1' }
    );
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S2']);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks without target still allows N/A marks', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S1', action: 'mark_na', note: 'office exclusion' }],
      { id: 'USR_1' }
    );
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S1']);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks allows optional N/A marks when scheduled sessions are below target', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 96,
      enrollmentSessionMarks: [],
      plannedNotApplicableSessionIds: []
    },
    sessions: threeWindowSessions()
  });
  marksService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S1', action: 'mark_na', note: 'optional absence' }],
      { id: 'USR_1' }
    );
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S1']);
    assert.equal(updated.enrollmentSessionMarks.length, 1);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});
