const test = require('node:test');
const assert = require('node:assert/strict');

const classController = require('../packages/school/MVC/controllers/school/classController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const idempotencyGuardService = require('../packages/school/MVC/services/school/idempotencyGuardService');

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

function restoreStubs() {
  schoolMethodNames.forEach((name) => {
    schoolDataService[name] = schoolOriginals[name];
  });
  guardMethodNames.forEach((name) => {
    idempotencyGuardService[name] = guardOriginals[name];
  });
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
  await classController.listClassEnrollmentPeriods(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(res.payload.count, 2);
  assert.equal(res.payload.items[0].id, 'CEP-1');
  assert.equal(res.payload.items[1].id, 'CEP-2');
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
  await classController.createClassEnrollmentPeriod(req, res);

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
  await classController.createClassEnrollmentPeriod(req, res);

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
  await classController.closeClassEnrollmentPeriod(req, res);

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
  await classController.reopenClassEnrollmentPeriod(req, res);

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
  await classController.checkClassEnrollmentPeriodOverlap(req, res);

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
  await classController.evaluateClassEnrollmentReentry(req, res);

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
  await classController.closeClassCycle(req, res);

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
  await classController.createNextClassCycleFromTemplate(req, res);

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
  await classController.carryForwardClassCycleStudents(req, res);

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
  await classController.splitClassEnrollmentPeriodsForCycleBoundary(req, res);

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
    await classController.createClassEnrollmentPeriod(req, res);

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
