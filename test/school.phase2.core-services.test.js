const test = require('node:test');
const assert = require('node:assert/strict');

const classEnrollmentPolicyService = require('../MVC/services/school/classEnrollmentPolicyService');
const classEnrollmentPeriodService = require('../MVC/services/school/classEnrollmentPeriodService');
const classCycleService = require('../MVC/services/school/classCycleService');
const { isRollingClassWorkflowEnabledForClass } = require('../MVC/services/school/phase2FeatureFlagService');

function buildInMemoryDeps() {
  const store = {
    classes: [
      {
        id: 'CLS-1',
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        deliveryDepartmentId: 'DEPT-1',
        registrationMode: 'rolling',
        cycleGroupId: '',
        cycleNo: 1,
        cycleStartDate: '2026-01-01',
        cycleEndDate: '',
        isClosedForNewEnrollment: false,
        previousClassId: '',
        nextClassId: '',
        status: 'active',
        enrollment: { students: [] }
      }
    ],
    periods: []
  };

  function normalizeDate(value) {
    const token = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
  }

  function overlaps(row, startDate, endDate) {
    const aStart = normalizeDate(row.startDate);
    const aEnd = normalizeDate(row.endDate) || '9999-12-31';
    const bStart = normalizeDate(startDate);
    const bEnd = normalizeDate(endDate) || '9999-12-31';
    return aStart <= bEnd && bStart <= aEnd;
  }

  const repositories = {
    classes: {
      async getById(id) {
        return store.classes.find((row) => String(row.id) === String(id)) || null;
      },
      async update(id, patch) {
        const index = store.classes.findIndex((row) => String(row.id) === String(id));
        if (index === -1) throw new Error('Class not found');
        store.classes[index] = { ...store.classes[index], ...patch };
        return store.classes[index];
      },
      async create(payload) {
        const id = `CLS-${store.classes.length + 1}`;
        const row = { ...payload, id };
        store.classes.push(row);
        return row;
      },
      async list(input = {}) {
        const orgId = String(input?.query?.orgId__eq || '').trim();
        if (!orgId) return [...store.classes];
        return store.classes.filter((row) => String(row.orgId) === orgId);
      }
    },
    classEnrollmentPeriods: {
      async getById(id) {
        return store.periods.find((row) => String(row.id) === String(id)) || null;
      },
      async findByClassId(classId) {
        return store.periods.filter((row) => String(row.classId) === String(classId));
      },
      async findByClassIdInRange(classId, startDate, endDate, options = {}) {
        const statuses = Array.isArray(options?.statuses)
          ? options.statuses.map((row) => String(row || '').trim().toLowerCase())
          : [];
        return store.periods.filter((row) => {
          if (String(row.classId) !== String(classId)) return false;
          if (statuses.length && !statuses.includes(String(row.status || '').trim().toLowerCase())) return false;
          return overlaps(row, startDate, endDate);
        });
      },
      async create(payload) {
        const id = payload.id || `CEP-${store.periods.length + 1}`;
        const row = { ...payload, id };
        store.periods.push(row);
        return row;
      },
      async update(id, patch) {
        const index = store.periods.findIndex((row) => String(row.id) === String(id));
        if (index === -1) throw new Error('Period not found');
        store.periods[index] = { ...store.periods[index], ...patch };
        return store.periods[index];
      }
    }
  };

  return { store, repositories };
}

test('classEnrollmentPolicyService reads env policy values', () => {
  const backup = {
    allow: process.env.SCHOOL_ALLOW_IMMEDIATE_REENTRY,
    minGap: process.env.SCHOOL_MIN_GAP_DAYS_BETWEEN_PERIODS,
    maxPeriods: process.env.SCHOOL_MAX_PERIODS_PER_STUDENT_PER_CLASS,
    maxCycleGap: process.env.SCHOOL_MAX_CYCLE_GAP_DAYS,
    maxCycleOverlap: process.env.SCHOOL_MAX_CYCLE_OVERLAP_DAYS
  };

  process.env.SCHOOL_ALLOW_IMMEDIATE_REENTRY = 'false';
  process.env.SCHOOL_MIN_GAP_DAYS_BETWEEN_PERIODS = '3';
  process.env.SCHOOL_MAX_PERIODS_PER_STUDENT_PER_CLASS = '5';
  process.env.SCHOOL_MAX_CYCLE_GAP_DAYS = '2';
  process.env.SCHOOL_MAX_CYCLE_OVERLAP_DAYS = '1';

  try {
    const policy = classEnrollmentPolicyService.getPolicy();
    assert.equal(policy.allowImmediateReentry, false);
    assert.equal(policy.minGapDaysBetweenPeriods, 3);
    assert.equal(policy.maxPeriodsPerStudentPerClass, 5);
    assert.equal(policy.maxCycleGapDaysBetweenCycles, 2);
    assert.equal(policy.maxCycleOverlapDaysBetweenCycles, 1);
  } finally {
    process.env.SCHOOL_ALLOW_IMMEDIATE_REENTRY = backup.allow;
    process.env.SCHOOL_MIN_GAP_DAYS_BETWEEN_PERIODS = backup.minGap;
    process.env.SCHOOL_MAX_PERIODS_PER_STUDENT_PER_CLASS = backup.maxPeriods;
    process.env.SCHOOL_MAX_CYCLE_GAP_DAYS = backup.maxCycleGap;
    process.env.SCHOOL_MAX_CYCLE_OVERLAP_DAYS = backup.maxCycleOverlap;
  }
});

test('classEnrollmentPeriodService.createPeriod enforces overlap using canonical periods', async () => {
  const { store, repositories } = buildInMemoryDeps();
  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    const first = await classEnrollmentPeriodService.createPeriod({
      orgId: 'ORG-1',
      classId: 'CLS-1',
      studentId: 'STU-1',
      startDate: '2026-01-10'
    }, { id: 'admin' });
    assert.equal(first.period.id, 'CEP-1');
    assert.equal(store.periods.length, 1);
    assert.equal(store.periods[0].id, 'CEP-1');
    assert.equal(store.periods[0].studentId, 'STU-1');
    assert.equal(store.classes[0].enrollment.students.length, 0);

    await assert.rejects(
      async () => classEnrollmentPeriodService.createPeriod({
        orgId: 'ORG-1',
        classId: 'CLS-1',
        studentId: 'STU-1',
        startDate: '2026-01-12'
      }, { id: 'admin' }),
      /Overlapping enrollment period exists/i
    );
  } finally {
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('classEnrollmentPeriodService enforces re-entry min gap and supports reopen via new period', async () => {
  const { repositories } = buildInMemoryDeps();
  repositories.classEnrollmentPeriods.create({
    id: 'CEP-BASE',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    studentId: 'STU-2',
    status: 'completed',
    startDate: '2026-01-01',
    endDate: '2026-01-10',
    sequenceNo: 1
  });

  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: false,
        minGapDaysBetweenPeriods: 2,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    await assert.rejects(
      async () => classEnrollmentPeriodService.createPeriod({
        orgId: 'ORG-1',
        classId: 'CLS-1',
        studentId: 'STU-2',
        startDate: '2026-01-12'
      }, { id: 'admin' }),
      /Minimum re-entry gap/i
    );

    const reopened = await classEnrollmentPeriodService.reopenViaNewPeriod('CEP-BASE', {
      startDate: '2026-01-20'
    }, { id: 'admin' });
    assert.equal(reopened.newPeriod.classId, 'CLS-1');
    assert.equal(reopened.newPeriod.startDate, '2026-01-20');
  } finally {
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('classEnrollmentPeriodService blocks open periods when rolling class is closed for enrollment', async () => {
  const { repositories, store } = buildInMemoryDeps();
  store.classes[0].isClosedForNewEnrollment = true;

  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    await assert.rejects(
      async () => classEnrollmentPeriodService.createPeriod({
        orgId: 'ORG-1',
        classId: 'CLS-1',
        studentId: 'STU-3',
        startDate: '2026-02-01',
        status: 'active'
      }, { id: 'admin' }),
      /closed for new enrollment/i
    );

    const created = await classEnrollmentPeriodService.createPeriod({
      orgId: 'ORG-1',
      classId: 'CLS-1',
      studentId: 'STU-3',
      startDate: '2026-02-01',
      endDate: '2026-02-01',
      status: 'completed'
    }, { id: 'admin' });
    assert.equal(created.period.status, 'completed');
  } finally {
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('classCycleService creates next cycle and links classes', async () => {
  const { store, repositories } = buildInMemoryDeps();

  classCycleService.__setDependenciesForTest({
    repositories,
    enrollmentPeriodService: classEnrollmentPeriodService,
    policyService: {
      getPolicy: () => ({
        maxCycleGapDaysBetweenCycles: 0,
        maxCycleOverlapDaysBetweenCycles: 0
      })
    }
  });
  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    const result = await classCycleService.createNextCycleFromCurrentClassTemplate(
      'CLS-1',
      {
        cycleStartDate: '2026-03-01',
        closeCurrentCycle: true,
        carryForwardEligibleStudents: false
      },
      { id: 'admin' }
    );

    assert.ok(result.createdClass?.id);
    assert.equal(result.createdClass.previousClassId, 'CLS-1');
    const sourceClass = store.classes.find((row) => row.id === 'CLS-1');
    assert.equal(sourceClass.nextClassId, result.createdClass.id);
    assert.equal(sourceClass.isClosedForNewEnrollment, true);
  } finally {
    classCycleService.__resetDependenciesForTest();
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('classCycleService enforces cycle boundary policy (gap) and allows policy-compliant gap', async () => {
  const { repositories } = buildInMemoryDeps();

  classCycleService.__setDependenciesForTest({
    repositories,
    enrollmentPeriodService: classEnrollmentPeriodService,
    policyService: {
      getPolicy: () => ({
        maxCycleGapDaysBetweenCycles: 0,
        maxCycleOverlapDaysBetweenCycles: 0
      })
    }
  });
  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    await assert.rejects(
      async () => classCycleService.createNextCycleFromCurrentClassTemplate('CLS-1', {
        cycleStartDate: '2026-03-10',
        currentCycleEndDate: '2026-03-01',
        closeCurrentCycle: false,
        carryForwardEligibleStudents: false
      }, { id: 'admin' }),
      /Cycle boundary gap/i
    );

    classCycleService.__setDependenciesForTest({
      repositories,
      enrollmentPeriodService: classEnrollmentPeriodService,
      policyService: {
        getPolicy: () => ({
          maxCycleGapDaysBetweenCycles: 10,
          maxCycleOverlapDaysBetweenCycles: 0
        })
      }
    });

    const ok = await classCycleService.createNextCycleFromCurrentClassTemplate('CLS-1', {
      cycleStartDate: '2026-03-10',
      currentCycleEndDate: '2026-03-01',
      closeCurrentCycle: false,
      carryForwardEligibleStudents: false
    }, { id: 'admin' });
    assert.equal(ok.cycleBoundary.gapDays, 8);
  } finally {
    classCycleService.__resetDependenciesForTest();
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('classCycleService carry-forward requires valid authorization window per carried period', async () => {
  const { repositories } = buildInMemoryDeps();
  await repositories.classes.create({
    orgId: 'ORG-1',
    title: 'Rolling Class B',
    registrationMode: 'rolling',
    cycleGroupId: 'CLS-1',
    cycleNo: 2,
    cycleStartDate: '2026-03-01',
    cycleEndDate: '',
    isClosedForNewEnrollment: false,
    previousClassId: 'CLS-1',
    nextClassId: '',
    status: 'active',
    enrollment: { students: [] }
  });

  await repositories.classEnrollmentPeriods.create({
    id: 'CEP-BAD',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    studentId: 'STU-9',
    status: 'active',
    startDate: '2026-03-03',
    endDate: '2026-03-01',
    sequenceNo: 1
  });

  classCycleService.__setDependenciesForTest({
    repositories,
    enrollmentPeriodService: classEnrollmentPeriodService,
    policyService: {
      getPolicy: () => ({
        maxCycleGapDaysBetweenCycles: 0,
        maxCycleOverlapDaysBetweenCycles: 0
      })
    }
  });
  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories,
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });

  try {
    await assert.rejects(
      async () => classCycleService.carryForwardEligibleStudents({
        fromClassId: 'CLS-1',
        toClassId: 'CLS-2',
        boundaryDate: '2026-03-01'
      }, { id: 'admin' }),
      /endDate before startDate|authorization window/i
    );
  } finally {
    classCycleService.__resetDependenciesForTest();
    classEnrollmentPeriodService.__resetDependenciesForTest();
  }
});

test('rolling workflow pilot scope allows only matching org/program', () => {
  const backup = {
    enabled: process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW,
    orgs: process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS,
    programs: process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_PROGRAM_IDS
  };

  process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW = 'true';
  process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS = 'ORG-1';
  process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_PROGRAM_IDS = 'PRG-1';

  try {
    const classRow = {
      orgId: 'ORG-1',
      allowedProgramTerms: [{ programId: 'PRG-1', termId: 'TERM-1' }]
    };

    assert.equal(isRollingClassWorkflowEnabledForClass({ classRow }), true);
    assert.equal(isRollingClassWorkflowEnabledForClass({
      classRow: { ...classRow, orgId: 'ORG-2' }
    }), false);
    assert.equal(isRollingClassWorkflowEnabledForClass({
      classRow: {
        orgId: 'ORG-1',
        allowedProgramTerms: [{ programId: 'PRG-9', termId: 'TERM-1' }]
      }
    }), false);
  } finally {
    process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW = backup.enabled;
    process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS = backup.orgs;
    process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_PROGRAM_IDS = backup.programs;
  }
});
