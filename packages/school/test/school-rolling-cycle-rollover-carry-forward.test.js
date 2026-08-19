const test = require('node:test');
const assert = require('node:assert/strict');

const classCycleService = require('../MVC/services/school/classCycleService');

const fromClass = {
  id: 'CLS_CYCLE_1',
  orgId: 'ORG_001',
  registrationMode: 'rolling',
  cycleStartDate: '2026-01-01',
  cycleEndDate: '2026-06-30',
  sessions: [
    {
      id: 'S1',
      date: '2026-01-10',
      startTime: '09:00',
      endTime: '10:00',
      status: 'scheduled',
      roster: [{ personId: 'PERSON_001', attendance: 'present' }]
    },
    {
      id: 'S2',
      date: '2026-02-10',
      startTime: '09:00',
      endTime: '10:00',
      status: 'scheduled',
      roster: [{ personId: 'PERSON_001', attendance: 'absent' }]
    },
    {
      id: 'S3',
      date: '2026-03-10',
      startTime: '09:00',
      endTime: '10:00',
      status: 'scheduled',
      roster: [{ personId: 'PERSON_001', attendance: '' }]
    }
  ]
};

const toClass = {
  id: 'CLS_CYCLE_2',
  orgId: 'ORG_001',
  registrationMode: 'rolling',
  cycleStartDate: '2026-07-01',
  cycleEndDate: '2026-12-31',
  sessions: []
};

function buildRolloverMocks(existingPeriods = []) {
  const periods = new Map(existingPeriods.map((row) => [row.id, { ...row }]));
  let nextId = 1;
  const closedPeriods = [];
  const createdPeriods = [];

  const enrollmentPeriodService = {
    async closePeriod(id, patch, user) {
      const row = periods.get(id);
      if (!row) throw new Error('missing period');
      const updated = { ...row, ...patch };
      periods.set(id, updated);
      closedPeriods.push(updated);
      return updated;
    },
    async createPeriod(payload, user) {
      const created = {
        id: `PER_NEW_${nextId++}`,
        ...payload
      };
      periods.set(created.id, created);
      createdPeriods.push(created);
      return { period: created };
    }
  };

  return {
    repositories: {
      classes: {
        async getById(id) {
          if (id === fromClass.id) return { ...fromClass };
          if (id === toClass.id) return { ...toClass };
          return null;
        }
      },
      classEnrollmentPeriods: {
        async findByClassId(classId) {
          return [...periods.values()].filter((row) => row.classId === classId);
        },
        async update(id, patch) {
          const existing = periods.get(id);
          if (!existing) return null;
          const updated = { ...existing, ...patch };
          periods.set(id, updated);
          return updated;
        }
      }
    },
    enrollmentPeriodService,
    periods,
    closedPeriods,
    createdPeriods
  };
}

test('buildCarryForwardPreview includes consumed and remaining cap per student', () => {
  const period = {
    id: 'PER_SPLIT',
    studentId: 'STU_001',
    personId: 'PERSON_001',
    classId: fromClass.id,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    targetSessionCount: 5
  };
  const preview = classCycleService.buildCarryForwardPreview([period], '2026-07-01', {
    sessions: fromClass.sessions,
    classData: fromClass
  });
  assert.equal(preview.splitCount, 1);
  const student = preview.students.find((row) => row.studentId === 'STU_001');
  assert.ok(student);
  assert.equal(student.consumedSessions, 2);
  assert.equal(student.remainingSessions, 3);
  assert.equal(student.carryPlans[0].targetStartDate, '2026-07-01');
  assert.equal(student.carryPlans[0].targetEndDate, '2026-12-31');
});

test('splitPeriodsCrossingCycleBoundary closes source with summary and creates target with remaining cap', async () => {
  const crossingPeriod = {
    id: 'PER_SPLIT',
    orgId: 'ORG_001',
    classId: fromClass.id,
    studentId: 'STU_001',
    personId: 'PERSON_001',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    targetSessionCount: 5,
    programId: 'PRG_001',
    enrollmentSessionMarks: []
  };
  const mocks = buildRolloverMocks([crossingPeriod]);
  classCycleService.__setDependenciesForTest({
    repositories: mocks.repositories,
    enrollmentPeriodService: mocks.enrollmentPeriodService
  });
  try {
    const result = await classCycleService.splitPeriodsCrossingCycleBoundary({
      fromClassId: fromClass.id,
      toClassId: toClass.id,
      boundaryDate: '2026-07-01'
    }, { id: 'USR_1' });
    assert.equal(result.targetCreated, 1);
    const closed = mocks.periods.get('PER_SPLIT');
    assert.equal(closed.cycleAttendanceSummary.consumedSessions, 2);
    assert.equal(closed.cycleAttendanceSummary.remainingSessions, 3);
    const created = mocks.createdPeriods[0];
    assert.equal(created.classId, toClass.id);
    assert.equal(created.startDate, '2026-07-01');
    assert.equal(created.endDate, '2026-12-31');
    assert.equal(created.targetSessionCount, 3);
    assert.equal(created.carriedForwardFromPeriodId, 'PER_SPLIT');
    assert.equal(created.programId, 'PRG_001');
  } finally {
    classCycleService.__resetDependenciesForTest();
  }
});

test('splitPeriodsCrossingCycleBoundary carries end date for date-window enrollment', async () => {
  const datePeriod = {
    id: 'PER_DATE',
    orgId: 'ORG_001',
    classId: fromClass.id,
    studentId: 'STU_002',
    personId: 'PERSON_002',
    startDate: '2026-02-01',
    endDate: '2026-10-15',
    status: 'active',
    programId: 'PRG_001'
  };
  const mocks = buildRolloverMocks([datePeriod]);
  classCycleService.__setDependenciesForTest({
    repositories: mocks.repositories,
    enrollmentPeriodService: mocks.enrollmentPeriodService
  });
  try {
    await classCycleService.splitPeriodsCrossingCycleBoundary({
      fromClassId: fromClass.id,
      toClassId: toClass.id,
      boundaryDate: '2026-07-01'
    }, { id: 'USR_1' });
    const created = mocks.createdPeriods[0];
    assert.equal(created.startDate, '2026-07-01');
    assert.equal(created.endDate, '2026-10-15');
    assert.equal(created.targetSessionCount, 0);
    assert.equal(created.targetHours, 0);
  } finally {
    classCycleService.__resetDependenciesForTest();
  }
});
