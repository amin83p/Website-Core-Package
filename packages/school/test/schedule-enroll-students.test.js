const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');
const scheduleEnrollStudentsService = require('../MVC/services/school/scheduleEnrollStudentsService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('schedule routes expose schedule viewer session refresh endpoint', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/schedule-viewer\/refresh-sessions/);
  assert.match(routeSource, /postScheduleViewerRefreshSessions/);
});

test('schedule routes expose enroll-students API endpoints', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/enroll-students\/prepare/);
  assert.match(routeSource, /postEnrollStudentsPrepare/);
  assert.match(routeSource, /\/api\/enroll-students\/session-capacity-check/);
  assert.match(routeSource, /\/api\/enroll-students\/student-picker-exclusions/);
  assert.match(routeSource, /\/api\/enroll-students\/program-registrations/);
  assert.match(routeSource, /\/api\/enroll-students\/program-registrations\/finalize/);
  assert.match(
    routeSource,
    /\/api\/enroll-students\/program-registrations'[\s\S]*SCHOOL_PROGRAM_REGISTRATIONS,\s*OPERATIONS\.CREATE[\s\S]*requireToken:\s*false/
  );
  assert.match(
    routeSource,
    /\/api\/enroll-students\/program-registrations\/finalize'[\s\S]*enrollStudentsProgramMutationActionState/
  );
});

test('personSchedule loads enroll students modals and client scripts for admin viewer', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /scheduleEnrollStudentsModals/);
  assert.match(view, /masterScheduleEnrollStudents\.js/);
  assert.match(view, /studentClaimNumbersManager\.js/);
  assert.match(view, /studentClaimNumbersModal/);
  assert.match(view, /rollingEnrollmentGroupClient\.js/);
  assert.match(view, /if \(canSelectAnyPerson\) \{[\s\S]*masterScheduleEnrollStudents\.js/s);
});

test('master schedule viewer wires enroll students rail handler', () => {
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const enroll = read('public/scripts/masterScheduleEnrollStudents.js');
  assert.match(viewer, /installMasterScheduleEnrollStudents/);
  assert.match(viewer, /bindEnrollStudentsRail/);
  assert.match(viewer, /enroll-students[\s\S]*enrollStudentsRailHandler/);
  assert.match(viewer, /bindClaimNumbersRail/);
  assert.match(viewer, /claim-numbers[\s\S]*claimNumbersRailHandler/);
  assert.match(viewer, /pendingEnrollStudentsByClassId/);
  assert.match(enroll, /bindEnrollStudentsRail\?\.\(startEnrollStudentsFlow\)/);
  assert.match(enroll, /resolveScheduleEnrollActionStateId/);
  assert.match(enroll, /rolling-enrollment\/execute[\s\S]*X-Action-State-Id/);
  assert.match(enroll, /bindClaimNumbersRail\?\.\(startClaimNumbersFlow\)/);
  assert.match(enroll, /startClaimNumbersFlow/);
  assert.match(enroll, /StudentClaimNumbersManager/);
  assert.match(enroll, /refreshEnrolledSessionsInView/);
  assert.match(enroll, /applyScheduleSessionChangesInView/);
  assert.match(enroll, /session-capacity-check[\s\S]*sessionMode:\s*ctx\.sessionMode/);
  assert.match(viewer, /applyScheduleSessionChangesInView[\s\S]*installMasterScheduleEnrollStudents/);
});

test('staging save opens draft work selection modal instead of inline commit', () => {
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  assert.match(staging, /MasterScheduleDraftSaveWork\.openSaveDraftWorkModal/);
  assert.doesNotMatch(staging, /pendingEnrollments:\s*pendingEnrollments/);
});

test('staged save orchestration is wired for admin master schedule', () => {
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const personSchedule = read('MVC/views/school/schedule/personSchedule.ejs');
  const draftWork = read('public/scripts/masterScheduleDraftSaveWork.js');
  const orchestrator = read('public/scripts/masterScheduleDraftSaveOrchestrator.js');
  const modal = read('MVC/views/school/schedule/partials/scheduleSaveDraftWorkModal.ejs');
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  const clientConfig = read('MVC/services/school/masterScheduleViewerClientConfig.js');
  assert.match(personSchedule, /scheduleSaveDraftWorkModal/);
  assert.match(personSchedule, /masterScheduleDraftSaveWork\.js/);
  assert.match(personSchedule, /masterScheduleDraftSaveOrchestrator\.js/);
  assert.match(viewer, /MasterScheduleDraftSaveOrchestrator\.install/);
  assert.match(viewer, /MasterScheduleDraftSaveWork\.install/);
  assert.match(viewer, /SCHEDULE_COMMIT_STAGED_PRECHECK_API/);
  assert.match(draftWork, /canSelectEnrollmentRow/);
  assert.match(draftWork, /openSaveDraftWorkModal/);
  assert.match(orchestrator, /runSelectedDraftSave/);
  assert.match(orchestrator, /global\.location\.reload/);
  assert.match(modal, /btn_scheduleSaveDraftWorkApply/);
  assert.match(modal, /schedule-save-draft-work-modal/);
  assert.match(draftWork, /buildStagedSessionsCalendarHtmlFromSessions/);
  assert.match(draftWork, /buildStagedSessionsCalendarHtml/);
  assert.match(draftWork, /h targeted/);
  assert.match(draftWork, /draft-save-cal-grid/);
  assert.match(draftWork, /data-staged-session-ids/);
  assert.doesNotMatch(draftWork, /js-draft-save-session/);
  const pkgAdminCss = read('public/styles/schedule-viewer-admin.css');
  const servedAdminCss = fs.readFileSync(path.join(repoRoot, 'public/styles/schedule-viewer-admin.css'), 'utf8');
  assert.match(pkgAdminCss, /draft-save-cal-grid/);
  assert.match(pkgAdminCss, /rolling-claim-actions/);
  assert.equal(pkgAdminCss, servedAdminCss);
  assert.match(draftWork, /draft-save-enrollment-summary-line1/);
  assert.match(draftWork, /js-draft-save-enrollment-remove/);
  assert.match(draftWork, /draftSaveWorkClassAccordion/);
  assert.match(routeSource, /\/api\/commit-staged-sessions\/precheck/);
  assert.match(routeSource, /postCommitStagedSessionsPrecheck/);
  assert.match(routeSource, /\/api\/enroll-students\/validate-pending-commit/);
  assert.match(routeSource, /\/api\/enroll-students\/execute-pending-commit/);
  assert.match(clientConfig, /commitStagedSessionsPrecheck/);
  assert.match(clientConfig, /validatePendingEnrollmentsCommit/);
});

test('parseSessionsFromBody rejects insufficient sessions', () => {
  const parsed = scheduleEnrollStudentsService.parseSessionsFromBody({
    sessionMode: 'saved',
    sessions: [{ classId: 'C1', sessionId: 'S1', date: '2026-04-01' }]
  });
  assert.equal(parsed.sessionMode, 'saved');
  assert.equal(parsed.sessions.length, 1);
});

test('summarizeSessionWindow returns first and last dates', () => {
  const window = scheduleEnrollStudentsService.summarizeSessionWindow([
    { date: '2026-04-10' },
    { date: '2026-04-02' },
    { date: '2026-04-05' }
  ]);
  assert.equal(window.startDate, '2026-04-02');
  assert.equal(window.endDate, '2026-04-10');
  assert.equal(window.sessionCount, 3);
});

test('sumSelectedSessionDurationHours totals session durations from times', () => {
  const total = scheduleEnrollStudentsService.sumSelectedSessionDurationHours([
    { start: '09:00', end: '10:30' },
    { start: '14:00', end: '15:00' }
  ]);
  assert.equal(total, 2.5);
});

test('resolveFirstSessionDateForPendingEntry falls back to selectedSessions after id rewrite', async () => {
  const originalGetSessions = schoolDataService.getClassSessions;
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-271684-0001', date: '2026-04-01', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'SES-271684-0002', date: '2026-04-02', startTime: '09:00', endTime: '10:00' }
  ]);
  try {
    const date = await scheduleEnrollStudentsService.resolveFirstSessionDateForPendingEntry(
      { id: 'CLASS/1' },
      {
        studentId: 'STU/1',
        selectedSessionIds: ['DRAFT_1', 'DRAFT_2'],
        selectedSessions: [
          { sessionId: 'DRAFT_1', date: '2026-04-01', start: '09:00', end: '10:00' },
          { sessionId: 'DRAFT_2', date: '2026-04-02', start: '09:00', end: '10:00' }
        ]
      },
      { id: 'USER-1' }
    );
    assert.equal(date, '2026-04-01');
    const resolved = await scheduleEnrollStudentsService.resolvePersistedSessionsForPendingEntry(
      { id: 'CLASS/1' },
      {
        selectedSessionIds: ['DRAFT_1', 'DRAFT_2'],
        selectedSessions: [
          { sessionId: 'DRAFT_1', date: '2026-04-01', start: '09:00', end: '10:00' },
          { sessionId: 'DRAFT_2', date: '2026-04-02', start: '09:00', end: '10:00' }
        ]
      },
      { id: 'USER-1' }
    );
    assert.deepEqual(resolved.remappedSessionIds, ['SES-271684-0001', 'SES-271684-0002']);
  } finally {
    schoolDataService.getClassSessions = originalGetSessions;
  }
});

test('checkOneOnOneSessionOccupancy skips persisted lookup for staged sessions', async () => {
  const scheduleSessionContextService = require('../MVC/services/school/scheduleSessionContextService');
  const originalBuild = scheduleSessionContextService.buildSessionEnrollmentList;
  scheduleSessionContextService.buildSessionEnrollmentList = async () => {
    throw new Error('Session not found.');
  };
  try {
    const classData = { id: 'CLASS/1', registrationMode: 'rolling', maxCapacity: 1 };
    const result = await scheduleEnrollStudentsService.checkOneOnOneSessionOccupancy({
      classData,
      sessionMode: 'staged',
      sessions: [
        { sessionId: 'STAGED/1', date: '2026-04-01', start: '09:00', end: '10:00' },
        { sessionId: 'STAGED/2', date: '2026-04-02', start: '09:00', end: '10:00' }
      ],
      reqUser: { id: 'USER-1' }
    });
    assert.equal(result.blocked, false);
    assert.deepEqual(result.conflicts, []);
  } finally {
    scheduleSessionContextService.buildSessionEnrollmentList = originalBuild;
  }
});

test('prepareEnrollStudents rejects non-rolling class', async () => {
  const original = schoolDataService.getDataById;
  schoolDataService.getDataById = async (entityType) => {
    if (entityType === 'classes') {
      return { id: 'CLASS/1', orgId: 'ORG-1', registrationMode: 'term_based', name: 'Term class' };
    }
    return null;
  };
  try {
    await assert.rejects(
      () => scheduleEnrollStudentsService.prepareEnrollStudents({
        sessionMode: 'saved',
        sessions: [
          { classId: 'CLASS/1', sessionId: 'SES/1', date: '2026-04-01' },
          { classId: 'CLASS/1', sessionId: 'SES/2', date: '2026-04-02' }
        ],
        reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' },
        accessContext: {}
      }),
      /rolling enrollment/i
    );
  } finally {
    schoolDataService.getDataById = original;
  }
});

test('prepareEnrollStudents rejects mixed class ids', async () => {
  const original = schoolDataService.getDataById;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes') {
      return { id, orgId: 'ORG-1', registrationMode: 'rolling', name: 'Rolling' };
    }
    return null;
  };
  try {
    await assert.rejects(
      () => scheduleEnrollStudentsService.prepareEnrollStudents({
        sessionMode: 'saved',
        sessions: [
          { classId: 'CLASS/1', sessionId: 'SES/1', date: '2026-04-01' },
          { classId: 'CLASS/2', sessionId: 'SES/2', date: '2026-04-02' }
        ],
        reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' },
        accessContext: {}
      }),
      /one class/i
    );
  } finally {
    schoolDataService.getDataById = original;
  }
});

test('finalizeProgramRegistration rejects registration date after first session', async () => {
  const original = schoolDataService.getDataById;
  schoolDataService.getDataById = async (entityType) => {
    if (entityType === 'classes') {
      return { id: 'CLASS/1', orgId: 'ORG-1', registrationMode: 'rolling', allowedProgramTerms: [] };
    }
    if (entityType === 'students') {
      return { id: 'STU/1', orgId: 'ORG-1', name: 'Student' };
    }
    return null;
  };
  try {
    await assert.rejects(
      () => scheduleEnrollStudentsService.finalizeProgramRegistration({
        classId: 'CLASS/1',
        studentId: 'STU/1',
        programId: 'PROG/1',
        registrationDate: '2026-04-10',
        reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' },
        req: { body: { firstSessionDate: '2026-04-01' } }
      }),
      /cannot be after/i
    );
  } finally {
    schoolDataService.getDataById = original;
  }
});

test('parsePendingEnrollmentsFromBody normalizes student entries', () => {
  const rows = scheduleEnrollStudentsService.parsePendingEnrollmentsFromBody({
    pendingEnrollments: [
      { studentId: 'STU/1', startDate: '2026-04-01' },
      { studentId: '', startDate: '2026-04-02' }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentId, 'STU/1');
});

test('validatePendingEnrollmentsProgramRegistration rejects registration after first session', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalFetch = schoolDataService.fetchData;
  const classData = {
    id: 'CLASS/1',
    orgId: 'ORG-1',
    registrationMode: 'rolling',
    allowedProgramTerms: [{ programId: 'PROG/1', programName: 'Program A' }]
  };
  schoolDataService.getDataById = async (entityType) => {
    if (entityType === 'students') {
      return { id: 'STU/1', orgId: 'ORG-1', name: 'Student One' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES/1', date: '2026-04-01' },
    { sessionId: 'SES/2', date: '2026-04-08' }
  ]);
  schoolDataService.fetchData = async (entityType) => {
    if (entityType !== 'studentProgramRegistrations') return [];
    return [{
      id: 'REG/1',
      orgId: 'ORG-1',
      programId: 'PROG/1',
      status: 'registered',
      registrationDate: '2026-04-10'
    }];
  };
  try {
    const result = await scheduleEnrollStudentsService.validatePendingEnrollmentsProgramRegistration({
      classData,
      pendingEnrollments: [{
        studentId: 'STU/1',
        studentLabel: 'Student One',
        selectedSessionIds: ['SES/1', 'SES/2']
      }],
      reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' },
      accessContext: {}
    });
    assert.equal(result.ok, false);
    assert.match(result.issues[0].message, /after the first selected session/i);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.fetchData = originalFetch;
  }
});

test('validatePendingEnrollmentsProgramRegistration passes when registration is on or before first session', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalFetch = schoolDataService.fetchData;
  const classData = {
    id: 'CLASS/1',
    orgId: 'ORG-1',
    registrationMode: 'rolling',
    allowedProgramTerms: [{ programId: 'PROG/1', programName: 'Program A' }]
  };
  schoolDataService.getDataById = async (entityType) => {
    if (entityType === 'students') {
      return { id: 'STU/1', orgId: 'ORG-1', name: 'Student One' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES/1', date: '2026-04-05' }
  ]);
  schoolDataService.fetchData = async (entityType) => {
    if (entityType !== 'studentProgramRegistrations') return [];
    return [{
      id: 'REG/1',
      orgId: 'ORG-1',
      programId: 'PROG/1',
      status: 'registered',
      registrationDate: '2026-04-01'
    }];
  };
  try {
    const result = await scheduleEnrollStudentsService.validatePendingEnrollmentsProgramRegistration({
      classData,
      pendingEnrollments: [{
        studentId: 'STU/1',
        studentLabel: 'Student One',
        selectedSessionIds: ['SES/1']
      }],
      reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' },
      accessContext: {}
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.fetchData = originalFetch;
  }
});

test('rollingEnrollmentGroupClient builds session_cap payload', () => {
  const client = require('../public/scripts/rollingEnrollmentGroupClient.js');
  const payload = client.buildGroupEnginePayload('CLASS/1', 'STU/1', {
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    targetSessionCount: '3',
    sessionCapacityType: 'group',
    status: 'active',
    funderType: 'self',
    funderId: 'self'
  });
  assert.equal(payload.classId, 'CLASS/1');
  assert.equal(payload.enrollmentMode, 'session_cap');
  assert.equal(payload.targetSessionCount, 3);
  assert.equal(payload.students[0].studentId, 'STU/1');
});

test('rollingEnrollmentGroupClient builds master schedule hour_cap settings from selected sessions', () => {
  const client = require('../public/scripts/rollingEnrollmentGroupClient.js');
  assert.equal(client.sumSelectedSessionHours([
    { start: '09:00', end: '10:00' },
    { start: '11:00', end: '12:30' }
  ]), 2.5);
  const settings = client.buildMasterScheduleEnrollmentSettings({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    sessionCapacityType: 'group',
    sessions: [
      { start: '09:00', end: '10:00' },
      { start: '11:00', end: '12:00' }
    ]
  });
  assert.equal(settings.targetSessionCount, '');
  assert.equal(settings.targetHours, '2');
  assert.equal(settings.minTargetHours, 2);
  const payload = client.buildGroupEnginePayload('CLASS/1', 'STU/1', settings);
  assert.equal(payload.enrollmentMode, 'hour_cap');
  assert.equal(payload.targetHours, 2);
  assert.equal(payload.targetSessionCount, undefined);
  const raised = client.buildMasterScheduleEnrollmentSettings({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    sessions: [{ start: '09:00', end: '10:00' }],
    minTargetHours: 1,
    targetHoursOverride: 3
  });
  assert.equal(raised.targetHours, '3');
});

test('draft enrollment manage UI is wired in viewer, staging, and modals', () => {
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  const enroll = read('public/scripts/masterScheduleEnrollStudents.js');
  const menuPartial = read('MVC/views/school/partials/scheduleDraftSessionContextMenu.ejs');
  const modals = read('MVC/views/school/schedule/partials/scheduleEnrollStudentsModals.ejs');
  const calendar = read('public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(menuPartial, /btn_scheduleDraftContextManagePendingEnrollments/);
  assert.match(menuPartial, /btn_scheduleDraftContextManagePendingEnrollmentsBulk/);
  assert.match(modals, /scheduleEnrollPendingManageModal/);
  assert.match(viewer, /buildScheduleDraftEnrollmentBadge/);
  assert.match(viewer, /stripDraftSessionSoloDisplayForPendingEnrollments/);
  assert.match(viewer, /suppressSoloForPendingDraftEnrollment/);
  assert.match(viewer, /canManagePendingEnrollmentsForDraftContext/);
  assert.match(viewer, /pendingEnrollMetaByClassId/);
  assert.match(staging, /openPendingEnrollmentManageModal/);
  assert.match(staging, /prunePendingEnrollmentsForClass/);
  assert.match(enroll, /openPendingEnrollmentManageModal/);
  assert.match(enroll, /setPendingEnrollMetaForClass/);
  assert.match(enroll, /showCapacityBlockModal/);
  assert.match(enroll, /buildStagedSessionsCalendarHtmlFromSessions/);
  assert.match(enroll, /draft-save-calendar-host/);
  assert.match(enroll, /buildMasterScheduleEnrollmentSettings/);
  assert.match(enroll, /js-schedule-enroll-target-hours/);
  assert.doesNotMatch(enroll, /form-text py-0">Min /);
  assert.match(enroll, /TargetHoursNote/);
  assert.match(modals, /scheduleEnrollQueueTargetHoursNote/);
  assert.match(modals, /btn_scheduleEnrollAll/);
  assert.match(enroll, /runEnrollmentForAll/);
  assert.match(enroll, /validateQueueRowTargetHours/);
  assert.match(modals, /scheduleEnrollCapacityBlockBody/);
  assert.match(modals, /scheduleEnrollQueueMinTargetHours/);
  assert.match(modals, /Target hours/);
  assert.match(enroll, /status === 'draft'/);
  assert.match(enroll, /enrollLocked/);
  assert.match(calendar, /buildScheduleDraftEnrollmentBadge/);
});
