const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const bookCoveringReportService = require('../MVC/services/school/bookCoveringReportService');
const sessionManagementService = require('../MVC/services/school/sessionManagementService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/1';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

function baseSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    date: '2026-03-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    ...overrides
  };
}

function stubActivityDeps({
  assignments = [],
  instances = [],
  cases = [],
  bookCoveringReport = null
} = {}) {
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalFindReport = bookCoveringReportService.findReportForSession;

  schoolDataService.fetchData = async (entityType, query = {}) => {
    if (entityType === 'reportAssignments' && query.classId__eq === CLASS_ID) return assignments;
    if (entityType === 'reportInstances' && query.classId__eq === CLASS_ID) return instances;
    if (entityType === 'sessionStudentCases' && query.classId__eq === CLASS_ID) return cases;
    return originalFetchData(entityType, query);
  };
  schoolDataService.fetchAllData = async (entityType) => {
    if (entityType === 'bookCoveringReports') return bookCoveringReport ? [bookCoveringReport] : [];
    return originalFetchAll(entityType);
  };
  bookCoveringReportService.findReportForSession = async () => bookCoveringReport;

  return () => {
    schoolDataService.fetchData = originalFetchData;
    schoolDataService.fetchAllData = originalFetchAll;
    bookCoveringReportService.findReportForSession = originalFindReport;
  };
}

test('classifyScheduleChanges splits date and time operations', () => {
  const session = baseSession();
  const dateOnly = sessionManagementService.classifyScheduleChanges(session, {
    date: '2026-03-08'
  });
  assert.deepEqual(dateOnly.operations, [sessionManagementService.SESSION_OPERATIONS.CHANGE_DATE]);

  const timeOnly = sessionManagementService.classifyScheduleChanges(session, {
    startTime: '10:00',
    endTime: '11:00'
  });
  assert.deepEqual(timeOnly.operations, [sessionManagementService.SESSION_OPERATIONS.CHANGE_TIME]);

  const both = sessionManagementService.classifyScheduleChanges(session, {
    date: '2026-03-08',
    startTime: '10:00',
    endTime: '11:00'
  });
  assert.equal(both.operations.length, 2);
});

test('evaluateOperationPermissions blocks delete and date move for instructional activity', async () => {
  const restore = stubActivityDeps({
    assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }],
    instances: [{ id: 'RI/1', classId: CLASS_ID, sessionId: SESSION_ID }],
    cases: [{ id: 'CASE/1', classId: CLASS_ID, sessionId: SESSION_ID }]
  });
  try {
    const activity = await sessionManagementService.inspectSessionActivity({
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      session: baseSession({ notes: 'hello', gradebooks: [{ id: 'GB/1' }] }),
      classData: { id: CLASS_ID, orgId: ORG_ID },
      reqUser: REQ_USER,
      prefetched: {
        assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }],
        instances: [{ id: 'RI/1', classId: CLASS_ID, sessionId: SESSION_ID }],
        cases: [{ id: 'CASE/1', classId: CLASS_ID, sessionId: SESSION_ID }],
        bookCoveringReport: { id: 'BCR/1', classId: CLASS_ID, sessionId: SESSION_ID }
      }
    });
    const permissions = sessionManagementService.evaluateOperationPermissions({
      activity,
      structuralLocks: { blockers: [] }
    });
    assert.equal(permissions.operations.delete.allowed, false);
    assert.equal(permissions.operations.change_date.allowed, false);
    assert.ok(permissions.operations.change_date.blockers.some((row) => row.code === 'SESSION_STUDENT_CASE'));
    assert.equal(permissions.operations.change_time.allowed, true);
  } finally {
    restore();
  }
});

test('student cases block change_date but not change_time', async () => {
  const activity = {
    blockers: [{
      code: sessionManagementService.ACTIVITY_BLOCKER_CODES.SESSION_STUDENT_CASE,
      label: 'Session student cases',
      count: 1
    }],
    hasStudentCases: true
  };
  const permissions = sessionManagementService.evaluateOperationPermissions({
    activity,
    structuralLocks: { blockers: [] }
  });
  assert.equal(permissions.operations.change_date.allowed, false);
  assert.equal(permissions.operations.change_time.allowed, true);
});

test('assertSessionOperationAllowed allows same-day time change when date move is blocked', async () => {
  const restore = stubActivityDeps({
    assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }]
  });
  try {
    const session = baseSession();
    const prefetched = {
      assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }],
      instances: [],
      cases: [],
      bookCoveringReport: null
    };
    await assert.rejects(
      () => sessionManagementService.assertSessionOperationAllowed({
        operation: sessionManagementService.SESSION_OPERATIONS.CHANGE_DATE,
        classId: CLASS_ID,
        sessionId: SESSION_ID,
        session,
        classData: { id: CLASS_ID, orgId: ORG_ID },
        reqUser: REQ_USER,
        source: 'master_schedule',
        proposedChanges: { date: '2026-03-08' },
        prefetched,
        skipDeletionGuard: true
      }),
      (error) => error.code === sessionManagementService.ERROR_CODES.DATE_MOVE
    );
    await sessionManagementService.assertSessionOperationAllowed({
      operation: sessionManagementService.SESSION_OPERATIONS.CHANGE_TIME,
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      session,
      classData: { id: CLASS_ID, orgId: ORG_ID },
      reqUser: REQ_USER,
      source: 'master_schedule',
      proposedChanges: { startTime: '10:00', endTime: '11:00' },
      prefetched,
      skipDeletionGuard: true
    });
  } finally {
    restore();
  }
});

test('assertSessionScheduleUpdateAllowed only asserts change_time for time-only updates', async () => {
  const restore = stubActivityDeps({
    assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }]
  });
  try {
    const session = baseSession();
    const prefetched = {
      assignments: [{ id: 'RA/1', classId: CLASS_ID, sessionId: SESSION_ID, status: 'active', targetType: 'session', sessionDate: '2026-03-01' }],
      instances: [],
      cases: [],
      bookCoveringReport: null
    };
    await sessionManagementService.assertSessionScheduleUpdateAllowed({
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      session,
      classData: { id: CLASS_ID, orgId: ORG_ID },
      reqUser: REQ_USER,
      source: 'master_schedule',
      proposedChanges: { startTime: '10:00', endTime: '11:00' },
      prefetched,
      skipDeletionGuard: true
    });
  } finally {
    restore();
  }
});

test('structural lock blocks change_time on administratively locked session', async () => {
  const session = baseSession({ locked: true });
  const structuralLocks = sessionManagementService.inspectStructuralLocks({
    classId: CLASS_ID,
    sessionId: SESSION_ID,
    session,
    allSessions: [session],
    source: 'master_schedule'
  });
  const permissions = sessionManagementService.evaluateOperationPermissions({
    activity: { blockers: [] },
    structuralLocks
  });
  assert.equal(permissions.operations.change_time.allowed, false);
});

test('marked attendance blocks delete', () => {
  const blockers = sessionManagementService.inspectEmbeddedSessionActivity(baseSession({
    roster: [{ personId: 'PERSON/1', attendanceStatus: 'present' }]
  }));
  const permissions = sessionManagementService.evaluateOperationPermissions({
    activity: { blockers },
    structuralLocks: { blockers: [] }
  });
  assert.equal(permissions.operations.delete.allowed, false);
  assert.ok(permissions.operations.delete.blockers.some((row) => (
    row.code === sessionManagementService.ACTIVITY_BLOCKER_CODES.SESSION_ATTENDANCE_MARKED
  )));
});

test('curriculum content and skills block delete', () => {
  const blockers = sessionManagementService.inspectEmbeddedSessionActivity(baseSession({
    contentItems: [{ id: 'CONTENT/1' }],
    skillsCovered: [{ id: 'SKILL/1' }]
  }));
  const permissions = sessionManagementService.evaluateOperationPermissions({
    activity: { blockers },
    structuralLocks: { blockers: [] }
  });
  assert.equal(permissions.operations.delete.allowed, false);
  assert.ok(permissions.operations.delete.blockers.some((row) => (
    row.code === sessionManagementService.ACTIVITY_BLOCKER_CODES.SESSION_CURRICULUM
  )));
});

function stubBulkDeletePlanDeps() {
  const SESSION_2 = 'SESSION/2';
  const originalGetById = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalFindReport = bookCoveringReportService.findReportForSession;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Test Class' };
    }
    return originalGetById(entityType, id);
  };
  schoolDataService.getClassSessions = async () => ([
    baseSession(),
    baseSession({ sessionId: SESSION_2, date: '2026-03-02', notes: 'saved notes' })
  ]);
  schoolDataService.fetchData = async () => [];
  schoolDataService.fetchAllData = async () => [];
  bookCoveringReportService.findReportForSession = async () => null;

  return {
    SESSION_2,
    restore: () => {
      schoolDataService.getDataById = originalGetById;
      schoolDataService.getClassSessions = originalSessions;
      schoolDataService.fetchData = originalFetchData;
      schoolDataService.fetchAllData = originalFetchAll;
      bookCoveringReportService.findReportForSession = originalFindReport;
    }
  };
}

test('buildBulkSessionDeletePlan splits deletable and blocked with shared prefetch', async () => {
  const { SESSION_2, restore } = stubBulkDeletePlanDeps();
  try {
    const plan = await sessionManagementService.buildBulkSessionDeletePlan({
      classId: CLASS_ID,
      targets: [
        { sessionId: SESSION_ID, sessionDate: '2026-03-01' },
        { sessionId: SESSION_2, sessionDate: '2026-03-02' }
      ],
      reqUser: REQ_USER,
      source: 'master_schedule'
    });
    assert.equal(plan.summary.selected, 2);
    assert.equal(plan.summary.deletable, 1);
    assert.equal(plan.summary.blocked, 1);
    assert.equal(plan.deletable[0].sessionId, SESSION_ID);
    assert.equal(plan.blocked[0].sessionId, SESSION_2);
    assert.ok(plan.blocked[0].blockers.some((row) => row.code === 'SESSION_NOTES'));
  } finally {
    restore();
  }
});
