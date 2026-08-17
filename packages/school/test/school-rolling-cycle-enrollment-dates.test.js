const test = require('node:test');
const assert = require('node:assert/strict');

const policyService = require('../MVC/services/school/classCycleEnrollmentPolicyService');
const periodService = require('../MVC/services/school/classEnrollmentPeriodService');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');

const rollingClass = {
  id: 'CLS_ROLL_001',
  orgId: 'ORG_001',
  registrationMode: 'rolling',
  status: 'active',
  cycleStartDate: '2026-01-01',
  cycleEndDate: '2026-06-30',
  isClosedForNewEnrollment: false,
  allowedProgramTerms: [{ programId: 'PRG_001', termId: 'TRM_001' }],
  curriculum: {
    subjects: [{ subjectId: 'SUB_001', subjectCode: 'MATH', subjectName: 'Math' }]
  },
  enrollment: { maxCapacity: 0 },
  credits: 1
};

const closedClass = {
  ...rollingClass,
  isClosedForNewEnrollment: true
};

function buildMockRepositories({
  classRow = rollingClass,
  existingPeriods = [],
  programRegistration = null
} = {}) {
  const periods = new Map(existingPeriods.map((row) => [row.id, { ...row }]));
  let nextPeriodId = 1;

  return {
    classes: {
      async getById() {
        return { ...classRow };
      }
    },
    classEnrollmentPeriods: {
      async getById(id) {
        return periods.get(id) || null;
      },
      async findByClassId() {
        return Array.from(periods.values());
      },
      async findByClassIdInRange(classId, startDate, endDate, options = {}) {
        const statuses = Array.isArray(options?.statuses)
          ? options.statuses.map((row) => String(row || '').trim().toLowerCase())
          : [];
        const overlaps = (row) => {
          const aStart = String(row?.startDate || '').trim();
          const aEnd = String(row?.endDate || '').trim() || '9999-12-31';
          const bStart = String(startDate || '').trim();
          const bEnd = String(endDate || '').trim() || '9999-12-31';
          return aStart <= bEnd && bStart <= aEnd;
        };
        return Array.from(periods.values()).filter((row) => {
          if (String(row?.classId || '') !== String(classId || '')) return false;
          if (statuses.length && !statuses.includes(String(row?.status || '').trim().toLowerCase())) return false;
          return overlaps(row);
        });
      },
      async create(input) {
        const created = {
          id: `PER_${nextPeriodId++}`,
          ...input
        };
        periods.set(created.id, created);
        return created;
      },
      async update(id, patch) {
        const existing = periods.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...patch };
        periods.set(id, updated);
        return updated;
      }
    },
    studentProgramRegistrations: {
      async getById(id) {
        if (!programRegistration) return null;
        if (programRegistration.id === id) return { ...programRegistration };
        return null;
      }
    }
  };
}

test('policy service rejects enrollment start before cycle start', () => {
  assert.throws(
    () => policyService.assertEnrollmentDatesWithinCycle({
      classRow: rollingClass,
      startDate: '2025-12-31',
      endDate: ''
    }),
    /cannot be before the class cycle start/
  );
});

test('policy service allows enrollment end after cycle end for rollover carry-forward', () => {
  assert.doesNotThrow(() => policyService.assertEnrollmentDatesWithinCycle({
    classRow: rollingClass,
    startDate: '2026-02-01',
    endDate: '2026-07-01'
  }));
});

test('policy service rejects program registration after cycle end', () => {
  assert.throws(
    () => policyService.assertProgramRegistrationDateWithinCycle({
      classRow: rollingClass,
      registrationDate: '2026-07-15'
    }),
    /cannot be after the class cycle end/
  );
});

test('createPeriod rejects active enrollment on closed cycle', async () => {
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({ classRow: closedClass })
  });
  try {
    await assert.rejects(
      () => periodService.createPeriod({
        orgId: closedClass.orgId,
        classId: closedClass.id,
        studentId: 'STU_001',
        startDate: '2026-02-01',
        status: 'active'
      }, { id: 'USR_001' }),
      /closed for new enrollment/
    );
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('createPeriod rejects startDate before cycleStartDate', async () => {
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories()
  });
  try {
    await assert.rejects(
      () => periodService.createPeriod({
        orgId: rollingClass.orgId,
        classId: rollingClass.id,
        studentId: 'STU_001',
        startDate: '2025-12-15',
        status: 'active'
      }, { id: 'USR_001' }),
      /cannot be before the class cycle start/
    );
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('updatePeriod allows funder edit on closed cycle without date changes', async () => {
  const existingPeriod = {
    id: 'PER_EXISTING',
    orgId: closedClass.orgId,
    classId: closedClass.id,
    studentId: 'STU_001',
    startDate: '2026-02-01',
    endDate: '',
    status: 'active',
    funderType: 'self',
    funderId: ''
  };
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({
      classRow: closedClass,
      existingPeriods: [existingPeriod]
    })
  });
  try {
    const updated = await periodService.updatePeriod('PER_EXISTING', {
      funderType: 'agency',
      funderId: 'FND_001'
    }, { id: 'USR_001' });
    assert.equal(updated.funderType, 'agency');
    assert.equal(updated.funderId, 'FND_001');
    assert.equal(updated.startDate, '2026-02-01');
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('updatePeriod still validates date edits on closed cycle', async () => {
  const existingPeriod = {
    id: 'PER_EXISTING',
    orgId: closedClass.orgId,
    classId: closedClass.id,
    studentId: 'STU_001',
    startDate: '2026-02-01',
    endDate: '',
    status: 'active'
  };
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({
      classRow: closedClass,
      existingPeriods: [existingPeriod]
    })
  });
  try {
    await assert.rejects(
      () => periodService.updatePeriod('PER_EXISTING', {
        startDate: '2025-12-01'
      }, { id: 'USR_001' }),
      /cannot be before the class cycle start/
    );
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('updatePeriod blocks draft promotion to active on closed cycle', async () => {
  const existingPeriod = {
    id: 'PER_DRAFT',
    orgId: closedClass.orgId,
    classId: closedClass.id,
    studentId: 'STU_001',
    startDate: '2026-02-01',
    endDate: '',
    status: 'draft'
  };
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({
      classRow: closedClass,
      existingPeriods: [existingPeriod]
    })
  });
  try {
    await assert.rejects(
      () => periodService.updatePeriod('PER_DRAFT', {
        status: 'active'
      }, { id: 'USR_001' }),
      /closed for new enrollment/
    );
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('createPeriod skips cycle policy when skipCyclePolicyCheck is set', async () => {
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({ classRow: closedClass })
  });
  try {
    const result = await periodService.createPeriod({
      orgId: closedClass.orgId,
      classId: closedClass.id,
      studentId: 'STU_001',
      startDate: '2025-12-01',
      status: 'active',
      skipCyclePolicyCheck: true,
      allowOverlap: true
    }, { id: 'USR_001' });
    assert.ok(result?.period?.id);
  } finally {
    periodService.__resetDependenciesForTest();
  }
});

test('buildTermClassPreview includes cycle issues for out-of-window enrollment date', () => {
  const preview = registrationIntegrityService.buildTermClassPreview({
    classItem: rollingClass,
    program: {
      id: 'PRG_001',
      orgId: 'ORG_001',
      departmentId: '',
      subjects: [{
        subjectId: 'SUB_001',
        programCredits: 1,
        prerequisites: [],
        subjectType: 'main'
      }]
    },
    department: null,
    termId: 'TRM_001',
    student: { id: 'STU_001', feeCategory: 'domestic' },
    effectiveDate: '2025-12-01',
    snapshot: { results: { passedSubjects: ['SUB_001'] } },
    subjectCatalogMap: new Map([['SUB_001', { id: 'SUB_001', code: 'MATH', name: 'Math' }]]),
    selectedSubjectOwners: new Map(),
    existingRosterClassIds: new Set(),
    classEnrollmentCountsByClassId: new Map([[rollingClass.id, 0]])
  });

  assert.equal(preview.status, 'error');
  assert.ok(preview.issues.some((issue) => /cannot be before the class cycle start/.test(issue)));
});

test('isProgramRegistrationDateWithinCycle excludes late registrations but allows early ones', () => {
  assert.equal(
    policyService.isProgramRegistrationDateWithinCycle(rollingClass, '2026-07-01'),
    false
  );
  assert.equal(
    policyService.isProgramRegistrationDateWithinCycle(rollingClass, '2026-03-01'),
    true
  );
  assert.equal(
    policyService.isProgramRegistrationDateWithinCycle(rollingClass, '2025-12-15'),
    true
  );
});

test('createPeriod allows a new enrollment when the only overlapping period is void', async () => {
  periodService.__setDependenciesForTest({
    repositories: buildMockRepositories({
      existingPeriods: [{
        id: 'PER_VOID',
        orgId: rollingClass.orgId,
        classId: rollingClass.id,
        studentId: 'STU_001',
        status: 'void',
        startDate: '2026-02-01',
        endDate: '2026-06-30',
        sequenceNo: 1
      }]
    }),
    policyService: {
      getPolicy: () => ({
        allowImmediateReentry: true,
        minGapDaysBetweenPeriods: 0,
        maxPeriodsPerStudentPerClass: 0
      })
    }
  });
  try {
    const created = await periodService.createPeriod({
      orgId: rollingClass.orgId,
      classId: rollingClass.id,
      studentId: 'STU_001',
      startDate: '2026-02-01',
      endDate: '2026-06-30',
      status: 'active'
    }, { id: 'USR_001' });
    assert.ok(created?.period?.id);
    assert.notEqual(created.period.id, 'PER_VOID');
  } finally {
    periodService.__resetDependenciesForTest();
  }
});
