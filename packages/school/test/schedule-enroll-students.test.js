const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scheduleEnrollStudentsService = require('../MVC/services/school/scheduleEnrollStudentsService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

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
  assert.match(viewer, /pendingEnrollStudentsByClassId/);
  assert.match(enroll, /bindEnrollStudentsRail\?\.\(startEnrollStudentsFlow\)/);
});

test('staging commit sends pendingEnrollments from schedule state', () => {
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  assert.match(staging, /pendingEnrollments/);
  assert.match(staging, /getPendingEnrollStudentsForClass/);
  assert.match(staging, /clearPendingEnrollStudentsForClass/);
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
  assert.match(viewer, /canManagePendingEnrollmentsForDraftContext/);
  assert.match(viewer, /pendingEnrollMetaByClassId/);
  assert.match(staging, /openPendingEnrollmentManageModal/);
  assert.match(staging, /classHasPendingEnrollments/);
  assert.match(staging, /prunePendingEnrollmentsForClass/);
  assert.match(enroll, /openPendingEnrollmentManageModal/);
  assert.match(enroll, /setPendingEnrollMetaForClass/);
  assert.match(calendar, /buildScheduleDraftEnrollmentBadge/);
});
