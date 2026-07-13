const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classDeletePreparationService = require('../MVC/services/school/classDeletePreparationService');
const classEnrollmentDeleteService = require('../MVC/services/school/classEnrollmentDeleteService');
const {
  SECTION_HREFS,
  samplesFromRows
} = require('../MVC/services/school/schoolDeletionRuleRegistry');

const C1 = 'CLASS/CYCLE-1';
const C2 = 'CLASS/CYCLE-2';
const C3 = 'CLASS/CYCLE-3';
const ORG_ID = 'ORG-1';
const STUDENT_ID = 'STU/1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

test('buildDeletePreparationHref includes target, focus, and returnTo', () => {
  const href = classDeletePreparationService.buildDeletePreparationHref(C2, C3, 'delete');
  assert.match(href, /\/school\/classes\/CLASS%2FCYCLE-2\/delete-preparation\?/);
  assert.match(href, /returnTo=delete/);
  assert.match(href, /focus=CLASS%2FCYCLE-3/);
});

test('classifyEnrollmentPeriod detects carry-forward and native origins', () => {
  assert.equal(classEnrollmentDeleteService.classifyEnrollmentPeriod({
    reasonStart: 'Moved whole period from CLASS/CYCLE-1 during carry-forward.'
  }), 'carry_forward');
  assert.equal(classEnrollmentDeleteService.classifyEnrollmentPeriod({
    reasonStart: 'Continuation split from CLASS/CYCLE-1 at cycle boundary.'
  }), 'carry_forward');
  assert.equal(classEnrollmentDeleteService.classifyEnrollmentPeriod({
    enrollmentSource: 'term_registration'
  }), 'term_registration');
  assert.equal(classEnrollmentDeleteService.classifyEnrollmentPeriod({
    reasonStart: 'Rolling enrollment'
  }), 'native');
});

test('buildCycleChainFromClass walks upstream head then downstream tail', async () => {
  const originalGetById = schoolDataService.getDataById;
  const classes = new Map([
    [C1, { id: C1, orgId: ORG_ID, title: 'Cycle 1', cycleNo: 1, previousClassId: '', nextClassId: C2 }],
    [C2, { id: C2, orgId: ORG_ID, title: 'Cycle 2', cycleNo: 2, previousClassId: C1, nextClassId: C3 }],
    [C3, { id: C3, orgId: ORG_ID, title: 'Cycle 3', cycleNo: 3, previousClassId: C2, nextClassId: '' }]
  ]);
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType !== 'classes') return null;
    return classes.get(id) || null;
  };
  try {
    const chainInfo = await classDeletePreparationService.buildCycleChainFromClass(C2, REQ_USER);
    assert.equal(chainInfo.chain.length, 3);
    assert.equal(chainInfo.chain[0].id, C1);
    assert.equal(chainInfo.chain[2].id, C3);
    assert.equal(chainInfo.tailClassId, C3);
  } finally {
    schoolDataService.getDataById = originalGetById;
  }
});

test('buildDeletePreparationPlan orders tail-first and marks downstream blocker', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalSessions = schoolDataService.getClassSessions;

  const classes = new Map([
    [C1, { id: C1, orgId: ORG_ID, title: 'Cycle 1', cycleNo: 1, previousClassId: '', nextClassId: C2 }],
    [C2, { id: C2, orgId: ORG_ID, title: 'Cycle 2', cycleNo: 2, previousClassId: C1, nextClassId: C3 }],
    [C3, { id: C3, orgId: ORG_ID, title: 'Cycle 3', cycleNo: 3, previousClassId: C2, nextClassId: '' }]
  ]);

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') return classes.get(id) || null;
    if (entityType === 'students' && id === STUDENT_ID) return { id: STUDENT_ID, displayName: 'Student One' };
    return null;
  };
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'classEnrollmentPeriods') return [];
    return [];
  };
  schoolDataService.getClassSessions = async () => [];

  try {
    const plan = await classDeletePreparationService.buildDeletePreparationPlan(C2, REQ_USER);
    assert.deepEqual(plan.recommendedOrder, [C3, C2, C1]);
    assert.equal(plan.currentStepClassId, C3);
    const c2 = plan.chain.find((row) => row.id === C2);
    assert.equal(c2.hasDownstream, true);
    assert.equal(c2.canDeleteClass, false);
    const c3 = plan.chain.find((row) => row.id === C3);
    assert.equal(c3.hasDownstream, false);
    assert.equal(c3.canDeleteClass, true);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('assessEnrollmentDeleteEligibility allows carry-forward delete', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === C1) {
      return { id: C1, title: 'Cycle 1', cycleNo: 1 };
    }
    return null;
  };
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'classEnrollmentPeriods' && query.classId__eq === C1) {
      return [{ id: 'PER/UP', studentId: STUDENT_ID, status: 'cancelled', startDate: '2026-01-01', endDate: '2026-06-30' }];
    }
    return [];
  };
  schoolDataService.getClassSessions = async () => [];

  const period = {
    id: 'PER/DOWN',
    classId: C2,
    studentId: STUDENT_ID,
    startDate: '2026-04-01',
    endDate: '',
    status: 'active',
    reasonStart: 'Moved whole period from CLASS/CYCLE-1 during carry-forward.'
  };

  try {
    const eligibility = await classEnrollmentDeleteService.assessEnrollmentDeleteEligibility(
      period,
      { id: C2, title: 'Cycle 2' },
      REQ_USER
    );
    assert.equal(eligibility.canDelete, true);
    assert.equal(eligibility.origin, 'carry_forward');
    assert.equal(eligibility.upstreamSummary.originClassId, C1);
    assert.equal(eligibility.upstreamSummary.upstreamStatus, 'cancelled');
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('assertClassDeleteAllowed blocks class with exam reference blockers but not session cases', async () => {
  const schoolDeletionGuardService = require('../MVC/services/school/schoolDeletionGuardService');
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalSessions = schoolDataService.getClassSessions;
  const originalPreview = schoolDeletionGuardService.previewDelete;

  const classId = 'CLASS/WITH-REFS';
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === classId) {
      return { id: classId, orgId: ORG_ID, title: 'Class With Refs', nextClassId: '' };
    }
    return null;
  };
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'sessionStudentCases') {
      return [{ id: 'SSC/1', classId, orgId: ORG_ID }];
    }
    return [];
  };
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SESSION/1',
    gradebooks: [{ id: 'GB/1' }],
    contentItems: [{ id: 'CNT/1', type: 'html', title: 'Notes' }]
  }]);
  schoolDeletionGuardService.previewDelete = async () => ({
    canDelete: false,
    blockers: [
      { code: 'SESSION_CASE', message: 'Session Student Cases', count: 2 },
      { code: 'EXAM_ALLOCATION', message: 'Exam Allocations', count: 1 }
    ]
  });

  try {
    const plan = await classDeletePreparationService.buildDeletePreparationPlan(classId, REQ_USER);
    const cycle = plan.chain.find((row) => row.id === classId);
    assert.equal(cycle.referenceBlockerCount, 1);
    assert.equal(cycle.cascadeAssets.sessionCaseCount, 1);
    assert.equal(cycle.cascadeAssets.hasCascadeAssets, true);
    assert.equal(cycle.canDeleteClass, false);

    await assert.rejects(
      () => classDeletePreparationService.assertClassDeleteAllowed(classId, REQ_USER),
      (error) => error.name === 'ClassDeleteNotAllowedError'
        && error.code === 'CLASS_REFERENCE_BLOCKERS'
        && error.blockers.length === 1
        && error.blockers[0].code === 'EXAM_ALLOCATION'
    );
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getClassSessions = originalSessions;
    schoolDeletionGuardService.previewDelete = originalPreview;
  }
});

test('assertClassDeleteAllowed blocks middle cycle while downstream exists', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalSessions = schoolDataService.getClassSessions;

  const classes = new Map([
    [C2, { id: C2, orgId: ORG_ID, title: 'Cycle 2', cycleNo: 2, previousClassId: C1, nextClassId: C3 }],
    [C3, { id: C3, orgId: ORG_ID, title: 'Cycle 3', cycleNo: 3, previousClassId: C2, nextClassId: '' }]
  ]);

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') return classes.get(id) || null;
    return null;
  };
  schoolDataService.fetchData = async () => [];
  schoolDataService.getClassSessions = async () => [];

  try {
    await assert.rejects(
      () => classDeletePreparationService.assertClassDeleteAllowed(C2, REQ_USER),
      (error) => error.name === 'ClassDeleteNotAllowedError' && error.code === 'CLASS_DOWNSTREAM_CYCLE'
    );
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('delete preparation view includes cascade delete warning section', () => {
  const view = read('MVC/views/school/class/classDeletePreparation.ejs');
  assert.match(view, /Will be permanently deleted with this class/);
  assert.match(view, /buildCascadeDeleteConfirmMessage/);
  assert.match(view, /cascadeAssets/);
});

test('delete preparation href used in deletion guard samples', () => {
  const row = { id: C1, title: 'EAL Cycle 1' };
  const href = SECTION_HREFS.deletePreparation(C2, C1);
  const [sample] = samplesFromRows([row], null, () => href);
  assert.match(sample.href, /\/school\/classes\/CLASS%2FCYCLE-2\/delete-preparation\?/);
  assert.match(sample.href, /focus=CLASS%2FCYCLE-1/);
});

test('class delete registry includes downstream cycle scanner and delete preparation CTA', () => {
  const source = read('MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(source, /scanClassDownstreamCycle/);
  assert.match(source, /code: 'CLASS_DOWNSTREAM_CYCLE'/);
  assert.doesNotMatch(source, /code: 'CLASS_NEXT'/);
  assert.doesNotMatch(source, /code: 'CLASS_PREVIOUS'/);
  assert.match(source, /Open delete preparation/);
});

test('class routes expose delete preparation endpoints', () => {
  const routes = read('MVC/routes/classRoutes.js');
  assert.match(routes, /delete-preparation/);
  assert.match(routes, /delete-preparation\/enrollments/);
});

test('delete blocked modal renders delete preparation action', () => {
  const mainScript = read('../../public/scripts/main.js');
  assert.match(mainScript, /delete-preparation/);
  assert.match(mainScript, /Open delete preparation/);
  assert.match(mainScript, /CLASS_DOWNSTREAM_CYCLE/);
});

test('resolve-cycle-links route redirects via updated resolver href', () => {
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(controller, /showDeletePreparationPage/);
  assert.match(controller, /buildDeletePreparationHref/);
});
