const test = require('node:test');
const assert = require('node:assert/strict');

const marksService = require('../MVC/services/school/enrollmentSessionMarksService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const personId = 'PERSON_001';
const classId = 'CLS_001';
const periodId = 'PER_001';

function buildMocks({ sessions = [], period = null } = {}) {
  const periodRow = period || {
    id: periodId,
    classId,
    personId,
    studentId: 'STU_001',
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

test('applySessionMarks stores locked mark and syncs planned N/A ids', async () => {
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
    const updated = await marksService.applySessionMarks(
      periodId,
      [{ sessionId: 'S1', action: 'mark_na', note: 'Student transferred' }],
      { id: 'USR_1' }
    );
    assert.equal(updated.enrollmentSessionMarks.length, 1);
    assert.equal(updated.enrollmentSessionMarks[0].locked, true);
    assert.deepEqual(updated.plannedNotApplicableSessionIds, ['S1']);
  } finally {
    marksService.__resetDependenciesForTest();
  }
});

test('applySessionMarks unmark clears roster N/A attendance', async () => {
  const mocks = buildMocks({
    period: {
      id: periodId,
      classId,
      personId,
      studentId: 'STU_001',
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
    const rosterRow = mocks.classRow.sessions[0].roster[0];
    assert.equal(rosterRow.attendance, '');
  } finally {
    marksService.__resetDependenciesForTest();
  }
});
