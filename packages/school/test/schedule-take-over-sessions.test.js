const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scheduleTakeOverSessionsService = require('../MVC/services/school/scheduleTakeOverSessionsService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const schoolPersonAccessService = require('../MVC/services/school/schoolPersonAccessService');

function sessionRow(overrides = {}) {
  return {
    sessionId: 'SES_1',
    date: '2026-06-02',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    roster: [{ personId: 'STU_1' }],
    delivery: {
      deliveredBy: 'TCH_OLD',
      deliveredByName: 'Ella',
      coTeachers: [{ personId: 'TCH_CO', name: 'Coach', roleLabel: 'Co-Teacher', paid: true, canEdit: false }]
    },
    ...overrides
  };
}

test('take over requires sessions from one class', () => {
  const blockers = scheduleTakeOverSessionsService.collectTakeOverBlockers({
    classIds: ['CLS_A', 'CLS_B'],
    teacherId: 'TCH_NEW',
    rows: [
      { classId: 'CLS_A', session: sessionRow(), hasEnrollment: true, isFinal: false },
      { classId: 'CLS_B', session: sessionRow({ sessionId: 'SES_2' }), hasEnrollment: true, isFinal: false }
    ]
  });
  assert.equal(blockers.some((row) => row.code === 'MULTIPLE_CLASSES'), true);
  assert.match(blockers.find((row) => row.code === 'MULTIPLE_CLASSES').message, /one class/);
});

test('completed sessions and sessions without enrollment cannot be taken over', () => {
  const blockers = scheduleTakeOverSessionsService.collectTakeOverBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    rows: [
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_DONE', status: 'completed' }), hasEnrollment: true, isFinal: true },
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_EMPTY', date: '2026-06-03' }), hasEnrollment: false, isFinal: false }
    ]
  });
  assert.equal(blockers.find((row) => row.code === 'COMPLETED').sessions[0].sessionId, 'SES_DONE');
  assert.equal(blockers.find((row) => row.code === 'NO_ENROLLMENT').sessions[0].sessionId, 'SES_EMPTY');
});

test('selected sessions that overlap each other are blocked', () => {
  const blockers = scheduleTakeOverSessionsService.collectTakeOverBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    rows: [
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_1', startTime: '09:00', endTime: '10:30' }), hasEnrollment: true, isFinal: false },
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_2', startTime: '10:00', endTime: '11:00' }), hasEnrollment: true, isFinal: false }
    ]
  });
  assert.equal(blockers.some((row) => row.code === 'SESSION_OVERLAP'), true);
});

test('a rolling session has enrollment only when a student is expected', () => {
  const classData = { id: 'CLS_A', orgId: 'ORG_1', registrationMode: 'rolling' };
  const session = sessionRow();
  const covered = scheduleTakeOverSessionsService.sessionHasExpectedEnrollment({
    classData,
    session,
    sessions: [session],
    periods: [{
      id: 'ENR_1',
      orgId: 'ORG_1',
      personId: 'STU_1',
      status: 'active',
      startDate: '2026-06-01',
      endDate: '2026-06-30'
    }]
  });
  const empty = scheduleTakeOverSessionsService.sessionHasExpectedEnrollment({
    classData,
    session,
    sessions: [session],
    periods: []
  });
  assert.equal(covered, true);
  assert.equal(empty, false);
});

test('take over makes the new teacher the main teacher and the previous teacher an unpaid co-teacher', () => {
  const updated = scheduleTakeOverSessionsService.applyTakeOverToSession(sessionRow({ status: 'scheduled' }), {
    teacherId: 'TCH_NEW',
    teacherName: 'Noah'
  });
  assert.equal(updated.status, 'scheduled');
  assert.equal(updated.merged, undefined);
  assert.equal(updated.mergedPartner, undefined);
  assert.equal(updated.delivery.deliveredBy, 'TCH_NEW');
  assert.equal(updated.delivery.deliveredByName, 'Noah');
  const previous = updated.delivery.coTeachers.find((row) => row.personId === 'TCH_OLD');
  const coach = updated.delivery.coTeachers.find((row) => row.personId === 'TCH_CO');
  assert.equal(previous.paid, false);
  assert.equal(previous.paidHours, 0);
  assert.equal(previous.canEdit, false);
  assert.equal(previous.roleLabel, 'Previous Teacher');
  assert.ok(coach);
  assert.equal(updated.delivery.coTeachers.some((row) => row.personId === 'TCH_NEW'), false);
});

test('a conflicting teacher schedule blocks take over and a clear schedule is saved without a merge link', async () => {
  const stored = [sessionRow()];
  let saved = null;
  scheduleTakeOverSessionsService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async () => ({ id: 'CLS_A', orgId: 'ORG_1', registrationMode: 'term_based' }),
      getClassSessions: async () => stored,
      getClassEnrollmentPeriodsByClassId: async () => [],
      saveClassSessions: async (_classId, sessions) => {
        saved = sessions;
        return sessions;
      }
    },
    schoolIndexService: { rebuildIndexesForClass: async () => {} },
    schoolPersonAccessService: {
      getPersonById: async () => ({ name: { preferred: 'Noah', first: 'Noah', last: 'Teacher' } }),
      formatPersonName: schoolPersonAccessService.formatPersonName
    },
    sessionStatusPolicyService: {
      ...sessionStatusPolicyService,
      getStatusMap: async () => new Map()
    },
    sessionConflictDetectionService: {
      detectSessionConflicts: async () => ([{
        date: '2026-06-02',
        conflictClass: 'Other class',
        existTime: '09:00 - 10:00',
        conflictType: 'teacher_schedule'
      }])
    }
  });
  try {
    const blocked = await scheduleTakeOverSessionsService.buildTakeOverPreview({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      reqUser: { id: 'USER_1' }
    });
    assert.equal(blocked.canContinue, false);
    assert.equal(blocked.blockers.some((row) => row.code === 'TEACHER_CONFLICT'), true);

    scheduleTakeOverSessionsService.__setDependenciesForTest({
      sessionConflictDetectionService: { detectSessionConflicts: async () => [] }
    });
    const preview = await scheduleTakeOverSessionsService.buildTakeOverPreview({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      reqUser: { id: 'USER_1' }
    });
    assert.equal(preview.canContinue, true);
    await assert.rejects(
      () => scheduleTakeOverSessionsService.applyTakeOverSessions({
        teacherId: 'TCH_NEW',
        sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
        previewHash: 'stale',
        reqUser: { id: 'USER_1' }
      }),
      /Preview is stale/
    );
    const result = await scheduleTakeOverSessionsService.applyTakeOverSessions({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      previewHash: preview.previewHash,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(result.takenOverCount, 1);
    assert.equal(saved[0].delivery.deliveredBy, 'TCH_NEW');
    assert.equal(saved[0].merged, undefined);
    assert.equal(saved[0].status, 'scheduled');
    assert.equal(saved[0].delivery.coTeachers.find((row) => row.personId === 'TCH_OLD').paid, false);
  } finally {
    scheduleTakeOverSessionsService.__resetDependenciesForTest();
  }
});

test('take over is wired beside merge on the schedule rail', () => {
  const view = fs.readFileSync(path.join(__dirname, '../MVC/views/school/schedule/personSchedule.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/scheduleRoutes.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleViewer.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleTakeOverSessions.js'), 'utf8');
  assert.match(view, /data-schedule-admin-action="merge-sessions"/);
  assert.match(view, /Merge Sessions/);
  assert.match(view, /data-schedule-admin-action="take-over-sessions"/);
  assert.match(view, /Take Over/);
  assert.match(view, /masterScheduleTakeOverSessions\.js/);
  assert.match(routes, /\/api\/take-over-sessions\/preview/);
  assert.match(routes, /\/api\/take-over-sessions\/apply/);
  assert.match(viewer, /take-over-sessions/);
  assert.match(viewer, /installMasterScheduleTakeOverSessions/);
  assert.match(script, /row\.sessions/);
  assert.match(script, /<ul/);
});
