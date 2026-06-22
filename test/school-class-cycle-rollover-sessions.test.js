const test = require('node:test');
const assert = require('node:assert/strict');

const classCycleService = require('../packages/school/MVC/services/school/classCycleService');

test('rolling cycle creation does not copy source class sessions to the new cycle', async () => {
  const sourceClass = {
    id: 'CLS-ROLL-1',
    orgId: '900000',
    title: 'Rolling Class',
    deliveryDepartmentId: 'DEP-1',
    registrationMode: 'rolling',
    cycleGroupId: 'CLS-ROLL-1',
    cycleNo: 1,
    cycleStartDate: '2026-06-01',
    cycleEndDate: '2026-06-30',
    isClosedForNewEnrollment: false,
    previousClassId: '',
    nextClassId: '',
    status: 'active',
    enrollment: {
      students: ['STU-1', 'STU-2'],
      capacity: 12
    },
    instructors: [{ personId: 'TEACHER-1', role: 'primary' }],
    sessions: [
      { sessionId: 'SES-001', date: '2026-06-03', startTime: '09:00', endTime: '12:00' },
      { sessionId: 'SES-002', date: '2026-06-05', startTime: '09:00', endTime: '12:00' }
    ]
  };
  let createdPayload = null;
  const updates = [];

  classCycleService.__setDependenciesForTest({
    repositories: {
      classes: {
        async getById(id) {
          return String(id) === sourceClass.id ? sourceClass : null;
        },
        async list() {
          return [sourceClass];
        },
        async create(payload) {
          createdPayload = payload;
          return { ...payload, id: 'CLS-ROLL-2' };
        },
        async update(id, patch) {
          updates.push({ id, patch });
          return { ...sourceClass, ...patch };
        }
      },
      classEnrollmentPeriods: {
        async findByClassId() {
          return [];
        }
      }
    },
    enrollmentPeriodService: {},
    policyService: {
      getPolicy: () => ({
        maxCycleGapDaysBetweenCycles: 0,
        maxCycleOverlapDaysBetweenCycles: 0
      })
    }
  });

  try {
    const result = await classCycleService.createNextCycleFromCurrentClassTemplate(
      sourceClass.id,
      {
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        currentCycleEndDate: '2026-06-30',
        closeCurrentCycle: true,
        carryForwardEligibleStudents: false
      },
      { id: 'admin' }
    );

    assert.deepEqual(createdPayload.sessions, []);
    assert.deepEqual(result.createdClass.sessions, []);
    assert.equal(createdPayload.previousClassId, sourceClass.id);
    assert.equal(createdPayload.registrationMode, 'rolling');
    assert.equal(createdPayload.cycleNo, 2);
    assert.equal(createdPayload.cycleStartDate, '2026-07-01');
    assert.equal(createdPayload.cycleEndDate, '2026-07-31');
    assert.deepEqual(createdPayload.enrollment.students, []);
    assert.deepEqual(createdPayload.instructors, sourceClass.instructors);
    assert.equal(updates.some((row) => row.id === sourceClass.id && row.patch.nextClassId === 'CLS-ROLL-2'), true);
  } finally {
    classCycleService.__resetDependenciesForTest();
  }
});
