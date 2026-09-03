const test = require('node:test');
const assert = require('node:assert/strict');

const classController = require('../packages/school/MVC/controllers/school/classController');
const rollingController = require('../packages/school/MVC/controllers/school/classRollingEnrollmentController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const idempotencyGuardService = require('../packages/school/MVC/services/school/idempotencyGuardService');
const schoolIndexService = require('../packages/school/MVC/services/school/schoolIndexService');
const classEnrollmentSessionApplicabilityService = require('../packages/school/MVC/services/school/classEnrollmentSessionApplicabilityService');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const activityService = require('../packages/school/MVC/services/school/activityService');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const sessionAttendanceEditAccessService = require('../packages/school/MVC/services/school/sessionAttendanceEditAccessService');
const schoolDeletionGuardService = require('../packages/school/MVC/services/school/schoolDeletionGuardService');
const sessionStudentCaseAccessService = require('../packages/school/MVC/services/school/sessionStudentCaseAccessService');
const sessionStudentCaseService = require('../packages/school/MVC/services/school/sessionStudentCaseService');
const sessionStudentCaseResultVisibilityService = require('../packages/school/MVC/services/school/sessionStudentCaseResultVisibilityService');

const schoolMethodNames = [
  'getDataById',
  'fetchData',
  'getClassEnrollmentPeriodsByClassId',
  'createClassEnrollmentPeriod',
  'closeClassEnrollmentPeriod',
  'reopenClassEnrollmentPeriodViaNewPeriod',
  'checkClassEnrollmentPeriodOverlap',
  'evaluateClassEnrollmentReentryRules',
  'closeClassCycle',
  'createNextClassCycleFromTemplate',
  'carryForwardClassCycleStudents',
  'splitClassEnrollmentPeriodsForCycleBoundary',
  'getClassSessions',
  'saveClassSessions',
  'updateData'
];

const guardMethodNames = [
  'createGuardKey',
  'beginGuard',
  'completeGuard',
  'failGuard'
];

const schoolOriginals = Object.fromEntries(
  schoolMethodNames.map((name) => [name, schoolDataService[name]])
);
const guardOriginals = Object.fromEntries(
  guardMethodNames.map((name) => [name, idempotencyGuardService[name]])
);
const schoolIndexOriginals = {
  rebuildIndexesForClass: schoolIndexService.rebuildIndexesForClass
};
const applicabilityOriginals = {
  recomputeSessionCappedEnrollmentCompletionsForClass: classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass
};
const classEnrollmentReadOriginals = {
  listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
};
const activityOriginals = {
  getScheduleEventsForPerson: activityService.getScheduleEventsForPerson
};
const schoolPersonAccessOriginals = {
  buildPersonByIdMap: schoolPersonAccessService.buildPersonByIdMap
};
const reportAssignmentOriginals = {
  list: schoolRepositories.reportAssignments.list
};
const sessionAttendanceEditAccessOriginals = {
  resolveSessionSectionEditAccess: sessionAttendanceEditAccessService.resolveSessionSectionEditAccess,
  assertSessionSectionEditable: sessionAttendanceEditAccessService.assertSessionSectionEditable
};
const deletionGuardOriginals = {
  previewDelete: schoolDeletionGuardService.previewDelete,
  assertCanDelete: schoolDeletionGuardService.assertCanDelete
};
const sessionStudentCaseAccessOriginals = {
  resolveCaseCapabilities: sessionStudentCaseAccessService.resolveCaseCapabilities,
  assertCanSave: sessionStudentCaseAccessService.assertCanSave
};
const sessionStudentCaseServiceOriginals = {
  saveCase: sessionStudentCaseService.saveCase,
  saveCasesBulk: sessionStudentCaseService.saveCasesBulk
};
const sessionStudentCaseVisibilityOriginals = {
  redactCaseForViewer: sessionStudentCaseResultVisibilityService.redactCaseForViewer
};

function restoreStubs() {
  schoolMethodNames.forEach((name) => {
    schoolDataService[name] = schoolOriginals[name];
  });
  guardMethodNames.forEach((name) => {
    idempotencyGuardService[name] = guardOriginals[name];
  });
  schoolIndexService.rebuildIndexesForClass = schoolIndexOriginals.rebuildIndexesForClass;
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = applicabilityOriginals.recomputeSessionCappedEnrollmentCompletionsForClass;
  classEnrollmentReadService.listActiveStudentIdsForClass = classEnrollmentReadOriginals.listActiveStudentIdsForClass;
  activityService.getScheduleEventsForPerson = activityOriginals.getScheduleEventsForPerson;
  schoolPersonAccessService.buildPersonByIdMap = schoolPersonAccessOriginals.buildPersonByIdMap;
  schoolRepositories.reportAssignments.list = reportAssignmentOriginals.list;
  sessionAttendanceEditAccessService.resolveSessionSectionEditAccess = sessionAttendanceEditAccessOriginals.resolveSessionSectionEditAccess;
  sessionAttendanceEditAccessService.assertSessionSectionEditable = sessionAttendanceEditAccessOriginals.assertSessionSectionEditable;
  schoolDeletionGuardService.previewDelete = deletionGuardOriginals.previewDelete;
  schoolDeletionGuardService.assertCanDelete = deletionGuardOriginals.assertCanDelete;
  sessionStudentCaseAccessService.resolveCaseCapabilities = sessionStudentCaseAccessOriginals.resolveCaseCapabilities;
  sessionStudentCaseAccessService.assertCanSave = sessionStudentCaseAccessOriginals.assertCanSave;
  sessionStudentCaseService.saveCase = sessionStudentCaseServiceOriginals.saveCase;
  sessionStudentCaseService.saveCasesBulk = sessionStudentCaseServiceOriginals.saveCasesBulk;
  sessionStudentCaseResultVisibilityService.redactCaseForViewer = sessionStudentCaseVisibilityOriginals.redactCaseForViewer;
}

function createReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: { 'x-ajax-request': true },
    xhr: true,
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: false },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    viewName: '',
    redirectUrl: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    render(viewName, payload) {
      this.viewName = viewName;
      this.payload = payload;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };
}

function applyDefaultGuardStubs() {
  idempotencyGuardService.createGuardKey = () => 'guard-key';
  idempotencyGuardService.beginGuard = () => ({ status: 'acquired', key: 'guard-key' });
  idempotencyGuardService.completeGuard = () => {};
  idempotencyGuardService.failGuard = () => {};
}

function applyClassLookupStubs(additional = {}) {
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        status: 'active',
        credits: 1,
        billingMode: 'no_charge',
        allowedProgramTerms: [{ programId: 'PGM-1', termId: '', order: 1 }],
        curriculum: {
          subjects: [{ subjectId: 'SUB-1', code: 'SUB1', name: 'Subject One', weight: 100 }]
        }
      };
    }
    if (entityType === 'programs') {
      return {
        id: String(id || 'PGM-1'),
        orgId: 'ORG-1',
        status: 'active',
        name: 'Program One',
        subjects: [{ subjectId: 'SUB-1', programCredits: 1, prerequisites: [], subjectType: 'main' }]
      };
    }
    if (entityType === 'classEnrollmentPeriods') {
      return {
        id: String(id || 'CEP-1'),
        classId: 'CLS-1',
        orgId: 'ORG-1'
      };
    }
    if (entityType === 'students') {
      return {
        id: String(id || 'STU-1'),
        personId: String(id || 'STU-1'),
        orgId: 'ORG-1',
        status: 'Active',
        feeCategory: 'standard'
      };
    }
    return null;
  };
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'studentProgramRegistrations') {
      return [{
        id: 'SPR-1',
        orgId: 'ORG-1',
        studentId: 'STU-1',
        programId: 'PGM-1',
        status: 'registered',
        registrationDate: '2026-02-01'
      }];
    }
    if (entityType === 'studentTermRegistrations') return [];
    if (entityType === 'subjects') return [];
    return [];
  };

  Object.entries(additional).forEach(([name, fn]) => {
    schoolDataService[name] = fn;
  });
}

function applySessionConflictSaveStubs({
  classes = [],
  sessionsByClass = {},
  activityEvents = [],
  reportAssignments = [],
  teachers = []
} = {}) {
  const scopedClasses = classes.length
    ? classes
    : [{ id: 'CLS-1', orgId: 'ORG-1', title: 'Rolling Class A', registrationMode: 'rolling', cycleStartDate: '2026-07-01', cycleEndDate: '2026-07-31' }];

  applyClassLookupStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'classes') {
        return scopedClasses.find((row) => String(row.id) === String(id)) || null;
      }
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'classes') return scopedClasses;
      if (entityType === 'students') return [];
      if (entityType === 'teachers') return teachers;
      return [];
    },
    getClassSessions: async (classId) => sessionsByClass[String(classId)] || [],
    saveClassSessions: async () => {
      throw new Error('saveClassSessions should not be called while conflict confirmation is required.');
    }
  });

  classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({ source: 'test', studentIds: new Set(), usedFallback: false });
  activityService.getScheduleEventsForPerson = async () => activityEvents;
  schoolRepositories.reportAssignments.list = async () => reportAssignments;
  schoolIndexService.rebuildIndexesForClass = async () => {};
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};
}

function createAdminSessionSaveReq(body = {}) {
  return createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true, orgId: 'ORG-1' },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    body: {
      status: 'scheduled',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '10:00',
      teacherId: 'T-1',
      teacherName: 'Teacher One',
      ...body
    }
  });
}

function applyTimesheetLockedSessionSaveStubs(sessionOverrides = {}) {
  let savedSessions = null;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '11:00',
      status: 'scheduled',
      room: '101',
      locked: true,
      lockReason: 'timesheet_approved',
      delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One', coTeachers: [] },
      roster: [],
      notes: 'Original note',
      ...sessionOverrides
    }
  ]);
  schoolDataService.saveClassSessions = async (_classId, sessions) => {
    savedSessions = sessions;
  };
  schoolIndexService.rebuildIndexesForClass = async () => {};
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};
  sessionAttendanceEditAccessService.resolveSessionSectionEditAccess = async ({ target }) => ({
    editable: true,
    target: target || 'attendance',
    targetLabel: 'Attendance',
    policy: {},
    timesheetPeriod: null
  });
  sessionAttendanceEditAccessService.assertSessionSectionEditable = async () => ({ editable: true });
  return {
    getSavedSessions: () => savedSessions
  };
}

function applySessionStudentCaseCreateStubs({ lockError = null } = {}) {
  let saveCaseCalls = 0;
  let assertCanSaveCalls = 0;
  let guardTarget = '';
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '11:00',
      status: 'completed',
      completedAt: '2026-07-10T18:00:00.000Z',
      roster: [{ personId: 'STU-1', name: 'Student One' }]
    }
  ]);
  sessionAttendanceEditAccessService.assertSessionSectionEditable = async ({ target }) => {
    guardTarget = String(target || '').trim().toLowerCase();
    if (lockError) throw lockError;
    return { editable: true, target: guardTarget };
  };
  sessionStudentCaseAccessService.assertCanSave = async () => {
    assertCanSaveCalls += 1;
    return { allowed: true };
  };
  sessionStudentCaseAccessService.resolveCaseCapabilities = async () => ({
    canCreate: true,
    canRead: true,
    canReadAll: true,
    canUpdate: true,
    canResolve: true,
    canDelete: true
  });
  sessionStudentCaseService.saveCase = async ({ input }) => {
    saveCaseCalls += 1;
    return {
      id: 'CASE-1',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      studentPersonId: input?.studentPersonId || 'STU-1',
      status: 'open',
      issue: input?.issue || 'Needs support'
    };
  };
  sessionStudentCaseResultVisibilityService.redactCaseForViewer = (saved) => saved;
  return {
    getSaveCaseCalls: () => saveCaseCalls,
    getAssertCanSaveCalls: () => assertCanSaveCalls,
    getGuardTarget: () => guardTarget
  };
}

test.afterEach(() => {
  restoreStubs();
});

test('listClassEnrollmentPeriods returns sorted periods', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    getClassEnrollmentPeriodsByClassId: async () => ([
      { id: 'CEP-2', startDate: '2026-02-01', sequenceNo: 2 },
      { id: 'CEP-1', startDate: '2026-01-01', sequenceNo: 1 }
    ])
  });

  const req = createReq({ params: { classId: 'CLS-1' } });
  const res = createRes();
  await rollingController.listClassEnrollmentPeriods(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(res.payload.count, 2);
  assert.equal(res.payload.items[0].id, 'CEP-1');
  assert.equal(res.payload.items[1].id, 'CEP-2');
});

test('listClassEnrollmentPeriods attaches student labels even without search query', async () => {
  applyDefaultGuardStubs();
  schoolPersonAccessService.buildPersonByIdMap = async () => new Map([
    ['PER-1', { name: { first: 'Maria', last: 'Maria' } }]
  ]);
  applyClassLookupStubs({
    getClassEnrollmentPeriodsByClassId: async () => ([
      { id: 'CEP-1', studentId: 'STU-1', startDate: '2026-01-01', sequenceNo: 1 }
    ]),
    fetchData: async (entityType) => {
      if (entityType === 'students') {
        return [{ id: 'STU-1', personId: 'PER-1', studentNumber: 'S001', orgId: 'ORG-1' }];
      }
      if (entityType === 'funders') return [];
      if (entityType === 'studentProgramRegistrations') return [];
      if (entityType === 'studentTermRegistrations') return [];
      if (entityType === 'subjects') return [];
      return [];
    },
    getClassSessions: async () => []
  });

  const req = createReq({ params: { classId: 'CLS-1' } });
  const res = createRes();
  await rollingController.listClassEnrollmentPeriods(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.items[0].studentLabel, 'Maria Maria (S001)');
  assert.equal(res.payload.items[0].studentRecordId, 'STU-1');
});

test('createClassEnrollmentPeriod uses guard + writes period', async () => {
  let completeCalls = 0;
  let capturedInput = null;

  applyDefaultGuardStubs();
  idempotencyGuardService.completeGuard = () => { completeCalls += 1; };
  applyClassLookupStubs({
    createClassEnrollmentPeriod: async (input) => {
      capturedInput = input;
      return { period: { id: 'CEP-100' } };
    }
  });

  const req = createReq({
    body: {
      classId: 'CLS-1',
      studentId: 'STU-1',
      startDate: '2026-03-01',
      endDate: '2026-05-01',
      status: 'active'
    }
  });
  const res = createRes();
  await rollingController.createClassEnrollmentPeriod(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(capturedInput.orgId, 'ORG-1');
  assert.equal(capturedInput.classId, 'CLS-1');
  assert.equal(capturedInput.studentId, 'STU-1');
  assert.equal(completeCalls, 1);
});

test('createClassEnrollmentPeriod returns busy guard response', async () => {
  let createCalls = 0;
  applyDefaultGuardStubs();
  idempotencyGuardService.beginGuard = () => ({ status: 'busy', retryAfterMs: 5000 });
  applyClassLookupStubs({
    createClassEnrollmentPeriod: async () => {
      createCalls += 1;
      return { period: { id: 'CEP-200' } };
    }
  });

  const req = createReq({
    body: {
      classId: 'CLS-1',
      studentId: 'STU-2',
      startDate: '2026-04-01'
    }
  });
  const res = createRes();
  await rollingController.createClassEnrollmentPeriod(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.status, 'warning');
  assert.match(String(res.payload.message || ''), /already in progress/i);
  assert.equal(createCalls, 0);
});

test('closeClassEnrollmentPeriod closes existing period', async () => {
  let closeCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    closeClassEnrollmentPeriod: async () => {
      closeCalls += 1;
      return { id: 'CEP-1', status: 'completed' };
    }
  });

  const req = createReq({
    params: { periodId: 'CEP-1' },
    body: { endDate: '2026-05-10', status: 'completed' }
  });
  const res = createRes();
  await rollingController.closeClassEnrollmentPeriod(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(closeCalls, 1);
});

test('reopenClassEnrollmentPeriod reopens via new period', async () => {
  let reopenCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    reopenClassEnrollmentPeriodViaNewPeriod: async () => {
      reopenCalls += 1;
      return { newPeriod: { id: 'CEP-NEW', startDate: '2026-06-01' } };
    }
  });

  const req = createReq({
    params: { periodId: 'CEP-1' },
    body: { startDate: '2026-06-01', status: 'active' }
  });
  const res = createRes();
  await rollingController.reopenClassEnrollmentPeriod(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(reopenCalls, 1);
});

test('checkClassEnrollmentPeriodOverlap returns overlap result', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    checkClassEnrollmentPeriodOverlap: async () => ({
      hasOverlap: true,
      overlaps: [{ id: 'CEP-EXISTING' }]
    })
  });

  const req = createReq({
    body: {
      classId: 'CLS-1',
      studentId: 'STU-5',
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  });
  const res = createRes();
  await rollingController.checkClassEnrollmentPeriodOverlap(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(res.payload.data.hasOverlap, true);
});

test('evaluateClassEnrollmentReentry returns rule result', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    evaluateClassEnrollmentReentryRules: async () => ({
      ok: false,
      violations: ['Minimum re-entry gap is 2 day(s); actual gap is 0.']
    })
  });

  const req = createReq({
    body: {
      classId: 'CLS-1',
      studentId: 'STU-6',
      startDate: '2026-03-01'
    }
  });
  const res = createRes();
  await rollingController.evaluateClassEnrollmentReentry(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(res.payload.data.ok, false);
  assert.equal(res.payload.data.violations.length, 1);
});

test('closeClassCycle closes cycle with guard', async () => {
  let closeCycleCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    closeClassCycle: async () => {
      closeCycleCalls += 1;
      return { id: 'CLS-1', isClosedForNewEnrollment: true };
    }
  });

  const req = createReq({
    params: { classId: 'CLS-1' },
    body: { cycleEndDate: '2026-06-30', isClosedForNewEnrollment: true }
  });
  const res = createRes();
  await rollingController.closeClassCycle(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(closeCycleCalls, 1);
});

test('createNextClassCycleFromTemplate creates next cycle with guard', async () => {
  let createCycleCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    createNextClassCycleFromTemplate: async () => {
      createCycleCalls += 1;
      return { createdClass: { id: 'CLS-2' } };
    }
  });

  const req = createReq({
    params: { classId: 'CLS-1' },
    body: {
      cycleStartDate: '2026-07-01',
      closeCurrentCycle: true,
      carryForwardEligibleStudents: true
    }
  });
  const res = createRes();
  await rollingController.createNextClassCycleFromTemplate(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(createCycleCalls, 1);
});

test('carryForwardClassCycleStudents runs guarded carry-forward', async () => {
  let carryForwardCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'classes') {
        return {
          id: String(id || ''),
          orgId: 'ORG-1',
          title: `Class ${String(id || '')}`,
          registrationMode: 'rolling'
        };
      }
      return null;
    },
    carryForwardClassCycleStudents: async () => {
      carryForwardCalls += 1;
      return { totalCrossing: 2, sourceUpdated: 2, targetCreated: 2 };
    }
  });

  const req = createReq({
    body: {
      fromClassId: 'CLS-1',
      toClassId: 'CLS-2',
      boundaryDate: '2026-07-01'
    }
  });
  const res = createRes();
  await rollingController.carryForwardClassCycleStudents(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(carryForwardCalls, 1);
});

test('splitClassEnrollmentPeriodsForCycleBoundary runs guarded split', async () => {
  let splitCalls = 0;
  applyDefaultGuardStubs();
  applyClassLookupStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'classes') {
        return {
          id: String(id || ''),
          orgId: 'ORG-1',
          title: `Class ${String(id || '')}`,
          registrationMode: 'rolling'
        };
      }
      return null;
    },
    splitClassEnrollmentPeriodsForCycleBoundary: async () => {
      splitCalls += 1;
      return { totalCrossing: 1, sourceUpdated: 1, targetCreated: 1 };
    }
  });

  const req = createReq({
    body: {
      fromClassId: 'CLS-1',
      toClassId: 'CLS-2',
      boundaryDate: '2026-07-01',
      note: 'Boundary split'
    }
  });
  const res = createRes();
  await rollingController.splitClassEnrollmentPeriodsForCycleBoundary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(splitCalls, 1);
});

test('rolling workflow endpoints reject when feature flag is disabled', async () => {
  const backup = process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW;
  process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW = 'false';

  try {
    applyDefaultGuardStubs();
    applyClassLookupStubs({
      createClassEnrollmentPeriod: async () => ({ period: { id: 'CEP-200' } })
    });

    const req = createReq({
      body: {
        classId: 'CLS-1',
        studentId: 'STU-1',
        startDate: '2026-03-01'
      }
    });
    const res = createRes();
    await rollingController.createClassEnrollmentPeriod(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.status, 'error');
    assert.match(String(res.payload.message || ''), /disabled/i);
  } finally {
    process.env.SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW = backup;
  }
});

test('checkConflicts rejects rolling sessions outside cycle window', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({});

  const req = createReq({
    body: {
      registrationMode: 'rolling',
      cycleStartDate: '2026-03-01',
      cycleEndDate: '2026-03-31',
      sessions: JSON.stringify([
        { sessionId: 'SES-1', date: '2026-04-02', startTime: '09:00', endTime: '11:00' }
      ])
    }
  });
  const res = createRes();
  await classController.checkConflicts(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /within cycle dates/i);
});

test('saveSession warns when admin metadata change overlaps another class session', async () => {
  applyDefaultGuardStubs();
  applySessionConflictSaveStubs({
    classes: [
      { id: 'CLS-1', orgId: 'ORG-1', title: 'Rolling Class A', registrationMode: 'rolling', cycleStartDate: '2026-07-01', cycleEndDate: '2026-07-31' },
      { id: 'CLS-2', orgId: 'ORG-1', title: 'Rolling Class B', registrationMode: 'rolling', cycleStartDate: '2026-07-01', cycleEndDate: '2026-07-31' }
    ],
    sessionsByClass: {
      'CLS-1': [{ sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One' } }],
      'CLS-2': [{ sessionId: 'SES-2', date: '2026-07-10', startTime: '09:30', endTime: '10:30', status: 'scheduled', delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One' } }]
    }
  });

  const req = createAdminSessionSaveReq();
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.status, 'warning');
  assert.equal(res.payload.code, 'SESSION_METADATA_CONFLICTS');
  assert.match(String(res.payload.data.conflicts[0].conflictClass || ''), /Rolling Class B/);
});

test('saveSession warns when admin metadata change overlaps activity work session', async () => {
  applyDefaultGuardStubs();
  applySessionConflictSaveStubs({
    sessionsByClass: {
      'CLS-1': [{ sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One' } }]
    },
    activityEvents: [{
      activityId: 'ACT-1',
      activityEntryId: 'ENTRY-1',
      title: 'Staff workshop',
      date: '2026-07-10',
      start: '09:30',
      end: '10:30'
    }]
  });

  const req = createAdminSessionSaveReq();
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'SESSION_METADATA_CONFLICTS');
  assert.match(String(res.payload.data.conflicts[0].conflictClass || ''), /Activity: Staff workshop/);
});

test('saveSession warns when admin metadata change overlaps non-permitted report assignment', async () => {
  applyDefaultGuardStubs();
  applySessionConflictSaveStubs({
    sessionsByClass: {
      'CLS-1': [{ sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One' } }]
    },
    reportAssignments: [{
      id: 'RPT-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      status: 'active',
      targetRows: [{
        rowId: 'ROW-1',
        targetType: 'date',
        dueDate: '2026-07-10',
        taskStartTime: '09:30',
        taskEndTime: '10:30',
        teacherId: 'T-1',
        conflictPermitted: false,
        status: 'active'
      }]
    }]
  });

  const req = createAdminSessionSaveReq();
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'SESSION_METADATA_CONFLICTS');
  assert.match(String(res.payload.data.conflicts[0].conflictClass || ''), /Report: Rolling Class A RPT-1/);
});

test('saveSession skips report assignment conflicts when intentional overlap is permitted', async () => {
  applyDefaultGuardStubs();
  let saved = false;
  applySessionConflictSaveStubs({
    sessionsByClass: {
      'CLS-1': [{ sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One' } }]
    },
    reportAssignments: [{
      id: 'RPT-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      status: 'active',
      targetRows: [{
        rowId: 'ROW-1',
        targetType: 'date',
        dueDate: '2026-07-10',
        taskStartTime: '09:30',
        taskEndTime: '10:30',
        teacherId: 'T-1',
        conflictPermitted: true,
        status: 'active'
      }]
    }]
  });
  schoolDataService.saveClassSessions = async () => {
    saved = true;
  };

  const req = createAdminSessionSaveReq();
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(saved, true);
});

test('saveSession resolves teacher record id before checking class session conflicts', async () => {
  applyDefaultGuardStubs();
  applySessionConflictSaveStubs({
    classes: [
      { id: 'CLS-1', orgId: 'ORG-1', title: 'Rolling Class A', registrationMode: 'rolling', cycleStartDate: '2026-07-01', cycleEndDate: '2026-07-31' },
      { id: 'CLS-2', orgId: 'ORG-1', title: 'Rolling Class B', registrationMode: 'rolling', cycleStartDate: '2026-07-01', cycleEndDate: '2026-07-31' }
    ],
    sessionsByClass: {
      'CLS-1': [{ sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'OLD-PERSON', deliveredByName: 'Old Teacher' } }],
      'CLS-2': [{ sessionId: 'SES-2', date: '2026-07-10', startTime: '09:30', endTime: '10:30', status: 'scheduled', delivery: { deliveredBy: 'P-1', deliveredByName: 'Teacher Person One' } }]
    },
    teachers: [{ id: 'TCH123', orgId: 'ORG-1', personId: 'P-1' }]
  });

  const req = createAdminSessionSaveReq({ teacherId: 'TCH123', teacherName: 'Teacher Person One' });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'SESSION_METADATA_CONFLICTS');
  assert.match(String(res.payload.data.conflicts[0].conflictClass || ''), /Rolling Class B/);
});

test('saveSession same-class teacher conflict ignores edited session but reports another overlap', async () => {
  applyDefaultGuardStubs();
  applySessionConflictSaveStubs({
    sessionsByClass: {
      'CLS-1': [
        { sessionId: 'SES-1', date: '2026-07-10', startTime: '08:00', endTime: '08:30', status: 'scheduled', delivery: { deliveredBy: 'OLD-PERSON', deliveredByName: 'Old Teacher' } },
        { sessionId: 'SES-OTHER', date: '2026-07-10', startTime: '09:15', endTime: '09:45', status: 'scheduled', delivery: { deliveredBy: 'P-1', deliveredByName: 'Teacher Person One' } }
      ]
    },
    teachers: [{ id: 'TCH123', orgId: 'ORG-1', personId: 'P-1' }]
  });

  const req = createAdminSessionSaveReq({ teacherId: 'TCH123', teacherName: 'Teacher Person One' });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'SESSION_METADATA_CONFLICTS');
  assert.ok(res.payload.data.conflicts.some((row) => row.existTime === '09:15 - 09:45'));
  assert.ok(!res.payload.data.conflicts.some((row) => row.conflictClassId === 'CLS-1' && row.conflictSessionId === 'SES-1'));
});

test('editClass saves rolling session payload when legacy class audit is missing', async () => {
  applyDefaultGuardStubs();
  let updateCalls = 0;
  let saveSessionCalls = 0;
  let capturedUpdates = null;

  applyClassLookupStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'classes') {
        return {
          id: String(id || 'CLS-1'),
          orgId: 'ORG-1',
          title: 'Legacy Rolling Class',
          registrationMode: 'rolling',
          status: 'active',
          allowedProgramTerms: [{ programId: 'PGM-1', termId: '', order: 1 }],
          enrollment: { maxCapacity: 30, students: [] },
          statusHistory: []
        };
      }
      if (entityType === 'departments') {
        return { id: 'DPT-1', orgId: 'ORG-1', code: 'PD', name: 'Professional Development' };
      }
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'programs') {
        return [{ id: 'PGM-1', orgId: 'ORG-1', code: 'PGM', name: 'Program One' }];
      }
      if (entityType === 'terms') return [];
      if (entityType === 'classes') return [];
      return [];
    },
    updateData: async (entityType, id, updates) => {
      updateCalls += 1;
      capturedUpdates = { entityType, id, updates };
      return { id, ...updates };
    },
    saveClassSessions: async () => {
      saveSessionCalls += 1;
    }
  });

  const req = createReq({
    params: { id: 'CLS-1' },
    body: {
      title: 'Legacy Rolling Class',
      status: 'active',
      registrationMode: 'rolling',
      cycleStartDate: '2026-07-01',
      cycleEndDate: '2026-07-31',
      deliveryDepartmentId: 'DPT-1',
      billingMode: 'no_charge',
      credits: '1',
      allowedProgramTerms: JSON.stringify([{ programId: 'PGM-1', termId: '', order: 1 }]),
      curriculum: JSON.stringify({ subjects: [], totalHours: 0 }),
      pricing: JSON.stringify({ feeRules: [] }),
      postingTemplates: JSON.stringify([]),
      schedule: JSON.stringify({ current: {}, history: [] }),
      instructors: JSON.stringify([]),
      enrollment: JSON.stringify({ maxCapacity: 30, students: [] }),
      evaluation: JSON.stringify({ passingScore: 60, weights: {} }),
      sessions: JSON.stringify([
        { sessionId: 'SES-1', date: '2026-07-10', startTime: '09:00', endTime: '10:00', status: 'scheduled' }
      ])
    }
  });
  const res = createRes();
  await classController.editClass(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(updateCalls, 1);
  assert.equal(saveSessionCalls, 1);
  assert.equal(capturedUpdates.updates.audit.createUser, 'USR-1');
  assert.ok(capturedUpdates.updates.audit.createDateTime);
});
test('saveSession rejects late roster rows without late or early minutes', async () => {
  applyDefaultGuardStubs();
  let saveCalled = false;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-07-10', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] }
  ]);
  schoolDataService.saveClassSessions = async () => {
    saveCalled = true;
  };
  schoolIndexService.rebuildIndexesForClass = async () => {};
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: {
      status: 'scheduled',
      roster: JSON.stringify([{ personId: 'STU-1', attendance: 'late', lateMinutes: '', earlyLeaveMinutes: '' }])
    }
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.equal(res.payload.code, 'LATE_MINUTES_REQUIRED');
  assert.match(String(res.payload.message || ''), /requires Late Arrival minutes or Left Early minutes/i);
  assert.equal(saveCalled, false);
});

test('saveSession accepts late roster rows with a positive minute value', async () => {
  applyDefaultGuardStubs();
  let savedSessions = null;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-07-10', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] }
  ]);
  schoolDataService.saveClassSessions = async (classId, sessions) => {
    savedSessions = sessions;
  };
  schoolIndexService.rebuildIndexesForClass = async () => {};
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: {
      status: 'scheduled',
      roster: JSON.stringify([{ personId: 'STU-1', attendance: 'late', lateMinutes: '', earlyLeaveMinutes: '5' }])
    }
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(savedSessions?.[0]?.roster?.[0]?.attendance, 'late');
  assert.equal(savedSessions?.[0]?.roster?.[0]?.earlyLeaveMinutes, 5);
});
test('saveSession rejects an existing rolling session outside the cycle window', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({});
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-08-01', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
  ]);
  schoolDataService.saveClassSessions = async () => {
    throw new Error('saveClassSessions should not be called for an out-of-window rolling session.');
  };

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: { status: 'scheduled', notes: 'Attempt save' }
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /within cycle dates/i);
  assert.match(String(res.payload.message || ''), /2026-08-01/);
});

test('saveSessionGradebooks rejects an existing rolling session outside the cycle window', async () => {
  applyDefaultGuardStubs();
  applyClassLookupStubs({});
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-06-30', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
  ]);
  schoolDataService.saveClassSessions = async () => {
    throw new Error('saveClassSessions should not be called for an out-of-window rolling session.');
  };

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: { gradebooks: [] }
  });
  const res = createRes();
  await classController.saveSessionGradebooks(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /within cycle dates/i);
  assert.match(String(res.payload.message || ''), /2026-06-30/);
});

test('saveSession rejects completed-session notes edits when notes window is closed', async () => {
  applyDefaultGuardStubs();
  let saveCalled = false;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '11:00',
      status: 'completed',
      completedAt: '2026-07-10T18:00:00.000Z',
      notes: 'Old note',
      room: '101',
      roster: []
    }
  ]);
  schoolDataService.saveClassSessions = async () => {
    saveCalled = true;
  };
  schoolIndexService.rebuildIndexesForClass = async () => {};
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};
  sessionAttendanceEditAccessService.resolveSessionSectionEditAccess = async ({ target }) => ({
    editable: true,
    target: target || 'attendance',
    targetLabel: 'Attendance',
    policy: {},
    timesheetPeriod: null
  });
  sessionAttendanceEditAccessService.assertSessionSectionEditable = async ({ target }) => {
    if (target === 'notes') {
      const error = new Error('Session Notes edits are locked for this completed session.');
      error.statusCode = 403;
      error.code = 'SESSION_NOTES_EDIT_WINDOW_EXPIRED';
      throw error;
    }
    return { editable: true };
  };

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: {
      status: 'completed',
      notes: 'Updated note while locked'
    }
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.equal(res.payload.code, 'SESSION_NOTES_EDIT_WINDOW_EXPIRED');
  assert.equal(saveCalled, false);
});

test('saveSessionConduct rejects completed-session conduct edits when conduct window is closed', async () => {
  applyDefaultGuardStubs();
  let saveCalled = false;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '11:00',
      status: 'completed',
      completedAt: '2026-07-10T18:00:00.000Z',
      roster: [{ personId: 'STU-1', classEffortPercent: null }]
    }
  ]);
  schoolDataService.saveClassSessions = async () => {
    saveCalled = true;
  };
  sessionAttendanceEditAccessService.assertSessionSectionEditable = async ({ target }) => {
    if (target === 'conduct') {
      const error = new Error('Class Conduct Before Reports edits are locked for this completed session.');
      error.statusCode = 403;
      error.code = 'SESSION_CONDUCT_EDIT_WINDOW_EXPIRED';
      throw error;
    }
    return { editable: true };
  };

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: {
      ready: true,
      roster: JSON.stringify([{ personId: 'STU-1', classEffortPercent: 85 }])
    }
  });
  const res = createRes();
  await classController.saveSessionConduct(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /conduct/i);
  assert.equal(saveCalled, false);
});

test('saveSessionGradebooks rejects completed-session gradebook edits when gradebook window is closed', async () => {
  applyDefaultGuardStubs();
  let saveCalled = false;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        cycleStartDate: '2026-07-01',
        cycleEndDate: '2026-07-31',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '11:00',
      status: 'completed',
      completedAt: '2026-07-10T18:00:00.000Z',
      roster: [],
      gradebooks: []
    }
  ]);
  schoolDataService.saveClassSessions = async () => {
    saveCalled = true;
  };
  sessionAttendanceEditAccessService.assertSessionSectionEditable = async ({ target }) => {
    if (target === 'gradebook') {
      const error = new Error('Grade book/Activities edits are locked for this completed session.');
      error.statusCode = 403;
      error.code = 'SESSION_GRADEBOOK_EDIT_WINDOW_EXPIRED';
      throw error;
    }
    return { editable: true };
  };

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: { gradebooks: [] }
  });
  const res = createRes();
  await classController.saveSessionGradebooks(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /grade book/i);
  assert.equal(saveCalled, false);
});

test('saveSessionStudentCase rejects create when student-cases window is closed', async () => {
  applyDefaultGuardStubs();
  const guardError = new Error('Student Cases edits are no longer allowed for this completed session (deadline: 2026-08-31).');
  guardError.statusCode = 403;
  guardError.code = 'SESSION_STUDENT_CASES_EDIT_WINDOW_EXPIRED';
  const state = applySessionStudentCaseCreateStubs({ lockError: guardError });

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true, orgId: 'ORG-1' },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    body: {
      studentPersonIds: ['STU-1'],
      issue: 'Need support'
    }
  });
  const res = createRes();
  await classController.saveSessionStudentCase(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /student cases/i);
  assert.equal(state.getGuardTarget(), 'studentcases');
  assert.equal(state.getAssertCanSaveCalls(), 0);
  assert.equal(state.getSaveCaseCalls(), 0);
});

test('saveSessionStudentCase allows create when student-cases window is open', async () => {
  applyDefaultGuardStubs();
  const state = applySessionStudentCaseCreateStubs();

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true, orgId: 'ORG-1' },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    body: {
      studentPersonIds: ['STU-1'],
      issue: 'Needs extra support during class'
    }
  });
  const res = createRes();
  await classController.saveSessionStudentCase(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(state.getGuardTarget(), 'studentcases');
  assert.equal(state.getAssertCanSaveCalls(), 1);
  assert.equal(state.getSaveCaseCalls(), 1);
  assert.equal(res.payload.case.studentPersonId, 'STU-1');
});

test('saveSession rejects targeted timesheet-locked metadata mutations', async () => {
  applyDefaultGuardStubs();
  const saveState = applyTimesheetLockedSessionSaveStubs();

  const req = createAdminSessionSaveReq({
    status: 'scheduled',
    room: '202',
    date: '2026-07-11',
    startTime: '12:00',
    endTime: '13:00',
    teacherId: 'T-2',
    teacherName: 'Teacher Two',
    coTeachers: JSON.stringify([{ personId: 'T-3', name: 'Co Teacher', roleLabel: 'Co-Teacher', canEdit: false }])
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /approved timesheet/i);
  assert.match(String(res.payload.message || ''), /date\/time/i);
  assert.equal(saveState.getSavedSessions(), null);
});

test('saveSession rejects status changes on timesheet-locked sessions', async () => {
  applyDefaultGuardStubs();
  const saveState = applyTimesheetLockedSessionSaveStubs();

  const req = createAdminSessionSaveReq({
    status: 'cancelled',
    room: '101'
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /approved timesheet/i);
  assert.match(String(res.payload.message || ''), /status/i);
  assert.equal(saveState.getSavedSessions(), null);
});

test('saveSession still allows notes-only updates on timesheet-locked sessions', async () => {
  applyDefaultGuardStubs();
  const saveState = applyTimesheetLockedSessionSaveStubs({
    status: 'completed',
    completedAt: '2026-07-10T18:00:00.000Z'
  });

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    body: {
      status: 'completed',
      notes: 'Updated note while timesheet lock is active',
      room: '101'
    }
  });
  const res = createRes();
  await classController.saveSession(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.ok(Array.isArray(saveState.getSavedSessions()));
  assert.equal(saveState.getSavedSessions()[0].notes, 'Updated note while timesheet lock is active');
});

test('deleteClassSession rejects approved-timesheet locked sessions before delete preview', async () => {
  applyDefaultGuardStubs();
  let previewCalls = 0;
  schoolDeletionGuardService.previewDelete = async () => {
    previewCalls += 1;
    return { allowed: true };
  };
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return {
        id: String(id || 'CLS-1'),
        orgId: 'ORG-1',
        title: 'Rolling Class A',
        registrationMode: 'rolling',
        status: 'active'
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-07-10', status: 'scheduled', locked: true, lockReason: 'timesheet_approved' }
  ]);

  const req = createReq({
    params: { id: 'CLS-1', sessionId: 'SES-1' },
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true, orgId: 'ORG-1' },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    }
  });
  const res = createRes();
  await classController.deleteClassSession(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /approved timesheet/i);
  assert.equal(previewCalls, 0);
});

test('editClass rejects room changes on approved-timesheet locked sessions', async () => {
  applyDefaultGuardStubs();
  let updateCalls = 0;
  let saveSessionCalls = 0;
  applyClassLookupStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'classes') {
        return {
          id: String(id || 'CLS-1'),
          orgId: 'ORG-1',
          title: 'Legacy Rolling Class',
          registrationMode: 'rolling',
          status: 'active',
          allowedProgramTerms: [{ programId: 'PGM-1', termId: '', order: 1 }],
          enrollment: { maxCapacity: 30, students: [] },
          statusHistory: []
        };
      }
      if (entityType === 'departments') {
        return { id: 'DPT-1', orgId: 'ORG-1', code: 'PD', name: 'Professional Development' };
      }
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'programs') {
        return [{ id: 'PGM-1', orgId: 'ORG-1', code: 'PGM', name: 'Program One' }];
      }
      if (entityType === 'terms') return [];
      if (entityType === 'classes') return [];
      return [];
    },
    getClassSessions: async () => ([
      {
        sessionId: 'SES-CLS-1-0001',
        date: '2026-07-10',
        startTime: '09:00',
        endTime: '10:00',
        status: 'scheduled',
        room: '101',
        locked: true,
        lockReason: 'timesheet_approved',
        delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One', coTeachers: [] }
      }
    ]),
    updateData: async () => {
      updateCalls += 1;
      return { id: 'CLS-1' };
    },
    saveClassSessions: async () => {
      saveSessionCalls += 1;
    }
  });

  const req = createReq({
    params: { id: 'CLS-1' },
    body: {
      title: 'Legacy Rolling Class',
      status: 'active',
      registrationMode: 'rolling',
      cycleStartDate: '2026-07-01',
      cycleEndDate: '2026-07-31',
      deliveryDepartmentId: 'DPT-1',
      billingMode: 'no_charge',
      credits: '1',
      allowedProgramTerms: JSON.stringify([{ programId: 'PGM-1', termId: '', order: 1 }]),
      curriculum: JSON.stringify({ subjects: [], totalHours: 0 }),
      pricing: JSON.stringify({ feeRules: [] }),
      postingTemplates: JSON.stringify([]),
      schedule: JSON.stringify({ current: {}, history: [] }),
      instructors: JSON.stringify([]),
      enrollment: JSON.stringify({ maxCapacity: 30, students: [] }),
      evaluation: JSON.stringify({ passingScore: 60, weights: {} }),
      sessions: JSON.stringify([
        {
          sessionId: 'SES-CLS-1-0001',
          date: '2026-07-10',
          startTime: '09:00',
          endTime: '10:00',
          status: 'scheduled',
          room: '202',
          locked: true,
          lockReason: 'timesheet_approved',
          delivery: { deliveredBy: 'T-1', deliveredByName: 'Teacher One', coTeachers: [] }
        }
      ])
    }
  });
  const res = createRes();
  await classController.editClass(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.status, 'error');
  assert.match(String(res.payload.message || ''), /approved timesheet/i);
  assert.match(String(res.payload.message || ''), /room/i);
  assert.equal(updateCalls, 0);
  assert.equal(saveSessionCalls, 0);
});
