const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enrollmentMoveService = require('../MVC/services/school/enrollmentMoveService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
  'utf8'
);
const conflictServiceSource = fs.readFileSync(
  path.join(__dirname, '../MVC/services/school/sessionConflictDetectionService.js'),
  'utf8'
);

const sourcePeriod = {
  id: 'PER_SOURCE',
  orgId: 'ORG_001',
  classId: 'CLS_SOURCE',
  studentId: 'STU_001',
  personId: 'PERSON_001',
  startDate: '2026-01-01',
  endDate: '',
  status: 'active',
  programId: 'PRG_001',
  termId: 'TRM_001',
  enrollmentSource: 'office',
  funderType: 'self',
  funderId: 'self',
  claimNumber: 'CLM-100',
  sessionCapacityType: 'one_on_one',
  sessionCountPolicy: 'all_non_na',
  targetSessionCount: 12
};

const sourceClass = {
  id: 'CLS_SOURCE',
  orgId: 'ORG_001',
  title: 'Source Class',
  registrationMode: 'rolling',
  billingMode: 'no_charge',
  isClosedForNewEnrollment: false
};

const targetClass = {
  id: 'CLS_TARGET',
  orgId: 'ORG_001',
  title: 'Target Class',
  registrationMode: 'rolling',
  billingMode: 'no_charge',
  isClosedForNewEnrollment: false,
  cycleStartDate: '2026-01-01',
  cycleEndDate: '2026-12-31'
};

function buildPayload(overrides = {}) {
  return {
    close: {
      effectiveDate: '2026-03-15',
      targetStatus: 'completed',
      reason: 'Moved to Target Class: Student requested transfer'
    },
    target: {
      classId: 'CLS_TARGET',
      studentId: 'STU_001',
      startDate: '2026-03-15',
      endDate: '',
      targetSessionCount: 12,
      targetHours: 0,
      funder: { funderId: 'self', funderType: 'self' },
      reasonStart: 'Moved from source class',
      notes: '',
      status: 'active',
      claimNumber: 'CLM-100',
      sessionCapacityType: 'one_on_one',
      sessionCountPolicy: 'all_non_na',
      programId: 'PRG_001',
      termId: 'TRM_001'
    },
    ...overrides
  };
}

function buildMocks() {
  const periodStore = new Map([[sourcePeriod.id, { ...sourcePeriod }]]);
  const classStore = new Map([
    [sourceClass.id, { ...sourceClass }],
    [targetClass.id, { ...targetClass }]
  ]);
  const createdPeriods = [];
  let closedPeriod = null;

  return {
    repositories: {
      classEnrollmentPeriods: {
        async getById(id) {
          const row = periodStore.get(id);
          return row ? { ...row } : null;
        },
        async findByClassIdInRange() {
          return [];
        },
        async update(id, patch) {
          const existing = periodStore.get(id);
          if (!existing) return null;
          const updated = { ...existing, ...patch };
          periodStore.set(id, updated);
          return updated;
        }
      },
      classes: {
        async getById(id) {
          const row = classStore.get(id);
          return row ? { ...row } : null;
        }
      }
    },
    enrollmentPeriodService: {
      async checkOverlap() {
        return { hasOverlap: false, overlaps: [] };
      },
      async closePeriod(periodId, input, user) {
        const existing = periodStore.get(periodId);
        closedPeriod = { ...existing, ...input, status: input.status || 'withdrawn' };
        periodStore.set(periodId, closedPeriod);
        return closedPeriod;
      }
    },
    schoolDataService: {
      async fetchAllData(entity) {
        if (entity === 'classes') {
          return [...classStore.values()];
        }
        return [];
      },
      async getDataById(entity, id) {
        if (entity === 'students' && id === 'STU_001') {
          return { id: 'STU_001', orgId: 'ORG_001', personId: 'PERSON_001' };
        }
        return null;
      },
      async createClassEnrollmentPeriod(payload) {
        const period = { id: `PER_NEW_${createdPeriods.length + 1}`, ...payload };
        createdPeriods.push(period);
        periodStore.set(period.id, period);
        return { period };
      }
    },
    registrationStatusLifecycleService: {
      async previewTransition() {
        return {
          currentStatus: 'active',
          targetStatus: 'completed',
          canApply: true,
          blockers: [],
          unresolvedFinancialOperations: false,
          sourceTransactions: [],
          adjustmentTotal: 0
        };
      },
      async applyTransition() {
        const updated = { ...sourcePeriod, status: 'completed', endDate: '2026-03-15' };
        periodStore.set(sourcePeriod.id, updated);
        return { registration: updated, targetStatus: 'completed' };
      }
    },
    rollingEnrollmentEngineService: {
      normalizeEnrollmentEngineRequest(input, classRow) {
        return {
          classId: input.classId,
          students: [{ studentId: input.studentId }],
          enrollmentMode: 'date_window',
          startDate: input.startDate,
          endDate: input.endDate || '',
          targetSessionCount: 0,
          targetHours: 0,
          plannedNotApplicableSessionIds: [],
          funder: input.funder || { funderId: 'self', funderType: 'self' },
          status: input.status || 'active',
          reasonStart: input.reasonStart || '',
          notes: input.notes || '',
          sessionsToCreate: [],
          pendingGapBatch: null,
          sessionCapacityType: 'group',
          unmarkSessionIds: [],
          allowOverlap: false,
          finance: null
        };
      },
      async buildAlignmentPayload() {
        return { aligned: true };
      },
      buildAlignmentBodyFromRequest(normalized) {
        return {
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          targetSessionCount: normalized.targetSessionCount,
          targetHours: normalized.targetHours
        };
      },
      async assertEnrollmentAlignmentForCreate() {
        return true;
      },
      async execute({ classData, rawRequest }) {
        return {
          results: [{
            ok: true,
            studentId: rawRequest.studentId,
            period: {
              id: 'PER_TARGET_1',
              classId: classData.id,
              studentId: rawRequest.studentId,
              status: 'active',
              startDate: rawRequest.startDate
            }
          }],
          summary: { succeeded: 1, failed: 0, total: 1 }
        };
      }
    },
    createdPeriods,
    periodStore,
    getClosedPeriod: () => closedPeriod
  };
}

test('normalizeMovePayload maps close and target fields', () => {
  const normalized = enrollmentMoveService.normalizeMovePayload(buildPayload(), sourcePeriod);
  assert.equal(normalized.close.targetStatus, 'completed');
  assert.equal(normalized.target.classId, 'CLS_TARGET');
  assert.equal(normalized.target.studentId, 'STU_001');
  assert.equal(normalized.target.claimNumber, 'CLM-100');
  assert.equal(normalized.target.sessionCapacityType, 'one_on_one');
  assert.equal(normalized.target.sessionCountPolicy, 'all_non_na');
  assert.match(normalized.close.reason, /Moved to Target Class/i);
});

test('normalizeMovePayload always closes source as completed', () => {
  const normalized = enrollmentMoveService.normalizeMovePayload(buildPayload({
    close: {
      effectiveDate: '2026-03-15',
      targetStatus: 'withdrawn',
      reason: 'Should not stay withdrawn'
    }
  }), sourcePeriod);
  assert.equal(normalized.close.targetStatus, 'completed');
});

test('CLOSE_STATUSES only allows completed for move flow', () => {
  assert.deepEqual([...enrollmentMoveService.CLOSE_STATUSES], ['completed']);
});

test('previewMoveEnrollment succeeds for valid cross-class move payload', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001'
    });
    assert.equal(preview.canApply, true);
    assert.ok(preview.previewHash);
    assert.equal(preview.targetEnrollmentPreview.classId, 'CLS_TARGET');
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('previewMoveEnrollment rejects same-class target', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload({
        target: {
          ...buildPayload().target,
          classId: 'CLS_SOURCE'
        }
      }),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001'
    });
    assert.equal(preview.canApply, false);
    assert.match(preview.blockers[0].message, /different from the current class/i);
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('previewMoveEnrollment blocks when schedule conflicts are detected', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001',
      options: {
        detectScheduleConflicts: async () => ({
          hasConflicts: true,
          message: "Scheduling conflicts detected with the student's existing schedule.",
          conflicts: [{
            date: '2026-03-20',
            conflictClass: 'Other Class',
            existTime: '09:00 - 10:00',
            conflictType: 'student_schedule'
          }]
        })
      }
    });
    assert.equal(preview.canApply, false);
    assert.ok(preview.blockers.some((row) => row.code === 'TARGET_SCHEDULE_CONFLICT'));
    assert.equal(preview.scheduleConflicts?.hasConflicts, true);
    assert.equal(preview.scheduleConflicts?.conflicts?.length, 1);
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('previewMoveEnrollment succeeds when schedule conflict check passes', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001',
      options: {
        detectScheduleConflicts: async () => ({
          hasConflicts: false,
          message: '',
          conflicts: null
        })
      }
    });
    assert.equal(preview.canApply, true);
    assert.equal(preview.scheduleConflicts?.hasConflicts, false);
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('previewMoveEnrollment rejects non-rolling target', async () => {
  const mocks = buildMocks();
  mocks.repositories.classes.getById = async (id) => {
    if (id === 'CLS_TARGET') {
      return { ...targetClass, registrationMode: 'term_based' };
    }
    if (id === 'CLS_SOURCE') return { ...sourceClass };
    return null;
  };
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001'
    });
    assert.equal(preview.canApply, false);
    assert.ok(preview.blockers.some((row) => /rolling enrollment/i.test(row.message)));
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('applyMoveEnrollment requires matching previewHash', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    await assert.rejects(
      () => enrollmentMoveService.applyMoveEnrollment({
        sourcePeriodId: sourcePeriod.id,
        payload: buildPayload(),
        previewHash: 'stale-hash',
        reqUser: { id: 'USR_1' },
        orgId: 'ORG_001'
      }),
      /Preview is stale/i
    );
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('applyMoveEnrollment closes source and creates target period', async () => {
  const mocks = buildMocks();
  enrollmentMoveService.__setDependenciesForTest(mocks);
  try {
    const preview = await enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001'
    });
    const result = await enrollmentMoveService.applyMoveEnrollment({
      sourcePeriodId: sourcePeriod.id,
      payload: buildPayload(),
      previewHash: preview.previewHash,
      reqUser: { id: 'USR_1' },
      orgId: 'ORG_001'
    });
    assert.equal(result.targetPeriod.classId, 'CLS_TARGET');
    assert.equal(mocks.periodStore.get(sourcePeriod.id).status, 'completed');
    assert.equal(result.targetPeriod.id, 'PER_TARGET_1');
  } finally {
    enrollmentMoveService.__resetDependenciesForTest();
  }
});

test('rolling enrollment view wires move menu and modal', () => {
  assert.match(viewSource, /btn-row-move/);
  assert.match(viewSource, /id="moveEnrollmentModal"/);
  assert.match(viewSource, /function openMoveEnrollmentModal/);
  assert.match(viewSource, /function previewMoveEnrollmentAction/);
  assert.match(viewSource, /function applyMoveEnrollmentAction/);
  assert.match(viewSource, /function openMoveTargetClassPicker/);
  assert.match(viewSource, /id="btn_pickMoveTargetClass"/);
  assert.match(viewSource, /id="move_targetClassLabel"/);
  assert.match(viewSource, /id="move_status"/);
  assert.match(viewSource, /id="move_sessionCapacityType"/);
  assert.match(viewSource, /id="move_claimNumber"/);
  assert.match(viewSource, /value="Moved" readonly/);
  assert.match(viewSource, /targetStatus: 'completed'/);
  assert.match(viewSource, /function formatMoveScheduleConflictLines/);
  assert.match(viewSource, /scheduleConflicts/);
  assert.doesNotMatch(viewSource, /function loadMoveTargetClasses/);
  assert.doesNotMatch(viewSource, /<select id="move_targetClassId"/);
  assert.doesNotMatch(viewSource, /<select id="move_close_status"/);
  assert.match(viewSource, /canMove = canManageEnrollmentOffice && canClose/);
  assert.match(viewSource, /openDraftReviewModal\(result\.targetPeriod\.id\)/);
});

test('class routes expose enrollment move endpoints', () => {
  assert.match(routesSource, /enrollment-move-target-classes/);
  assert.match(routesSource, /move\/preview/);
  assert.match(routesSource, /move\/apply/);
});

test('detectStudentScheduleConflicts supports excludeClassIds for move enrollment', () => {
  assert.match(conflictServiceSource, /excludeClassIds = \[\]/);
  assert.match(conflictServiceSource, /excludedClassIds\.some/);
});

test('move enrollment controller excludes source class from schedule conflict review', () => {
  assert.match(controllerSource, /function buildMoveEnrollmentServiceOptions/);
  assert.match(controllerSource, /detectScheduleConflicts/);
  assert.match(controllerSource, /excludeClassIds:\s*\[sourceClassId\]/);
  assert.match(controllerSource, /detectRollingEnrollmentScheduleConflicts/);
});
