const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const moveService = require('../MVC/services/school/scheduleMoveSessionsService');

const sourceClass = {
  id: 'CLS_SOURCE',
  orgId: 'ORG_001',
  title: 'Source',
  registrationMode: 'rolling',
  maxCapacity: 8
};

const targetClass = {
  id: 'CLS_TARGET',
  orgId: 'ORG_001',
  title: 'Target',
  registrationMode: 'rolling',
  maxCapacity: 10,
  cycleStartDate: '2026-01-01',
  cycleEndDate: '2026-12-31',
  primaryTeacherId: 'TCH_001'
};

function period(overrides = {}) {
  return {
    id: 'PER_1',
    orgId: 'ORG_001',
    classId: 'CLS_SOURCE',
    studentId: 'STU_1',
    personId: 'PER_1',
    status: 'active',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    funderType: 'self',
    funderId: 'self',
    ...overrides
  };
}

test('capacity 1 requires a capacity 1 target, and larger classes do not need equal capacity', () => {
  const blocked = moveService.evaluateCapacityGate({
    sourceClass: { ...sourceClass, maxCapacity: 1 },
    targetClass: { ...targetClass, maxCapacity: 8 }
  });
  assert.equal(blocked.some((row) => row.code === 'CAPACITY_MISMATCH'), true);

  const allowed = moveService.evaluateCapacityGate({
    sourceClass,
    targetClass
  });
  assert.equal(allowed.length, 0);
});

test('overlapping target sessions with a different start or length block the move', () => {
  const result = moveService.evaluateSessionConflicts({
    selectedSessions: [{ sessionId: 'SES_1', date: '2026-06-01', startTime: '09:00', endTime: '10:00' }],
    targetSessions: [{ sessionId: 'SES_T', date: '2026-06-01', startTime: '09:30', endTime: '11:00' }],
    startTime: '09:00',
    targetCapacity: 8,
    sourcePeriods: [],
    targetPeriods: [],
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.some((row) => row.code === 'TIME_MISMATCH'), true);
  assert.equal(result.plans.length, 0);
});

test('an exact match on a capacity 1 class with an enrollment is a blocker', () => {
  const result = moveService.evaluateSessionConflicts({
    selectedSessions: [{ sessionId: 'SES_1', date: '2026-06-01', startTime: '09:00', endTime: '10:00' }],
    targetSessions: [{ sessionId: 'SES_T', date: '2026-06-01', startTime: '10:00', endTime: '11:00' }],
    startTime: '10:00',
    targetCapacity: 1,
    sourcePeriods: [],
    targetPeriods: [period({ id: 'PER_T', classId: 'CLS_TARGET', studentId: 'STU_EXISTING' })],
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.some((row) => row.code === 'OCCUPIED_ONE_ON_ONE'), true);
});

test('group capacity blocks when current enrollments plus moving enrollments exceed capacity', () => {
  const targetPeriods = [1, 2].map((n) => period({
    id: `PER_T${n}`,
    classId: 'CLS_TARGET',
    studentId: `STU_T${n}`
  }));
  const sourcePeriods = [period({ studentId: 'STU_MOVE' })];
  const result = moveService.evaluateSessionConflicts({
    selectedSessions: [{ sessionId: 'SES_1', date: '2026-06-01', startTime: '09:00', endTime: '10:00' }],
    targetSessions: [{ sessionId: 'SES_T', date: '2026-06-01', startTime: '10:00', endTime: '11:00' }],
    startTime: '10:00',
    targetCapacity: 2,
    sourcePeriods,
    targetPeriods,
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.some((row) => row.code === 'CAPACITY_EXCEEDED'), true);
});

test('session warnings with the same cause are one statement plus each session date', () => {
  const result = moveService.evaluateSessionConflicts({
    selectedSessions: [
      { sessionId: 'SES_1', date: '2026-06-01', startTime: '09:00', endTime: '10:00' },
      { sessionId: 'SES_2', date: '2026-06-08', startTime: '09:00', endTime: '10:00' }
    ],
    targetSessions: [],
    startTime: '09:00',
    targetCapacity: 8,
    sourcePeriods: [],
    targetPeriods: [],
    cycleStartDate: '2026-07-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].code, 'OUT_OF_CYCLE');
  assert.match(result.blockers[0].message, /These sessions are outside the target class cycle/);
  assert.equal(result.blockers[0].message.includes('2026-06-01'), false);
  assert.deepEqual(result.blockers[0].sessions.map((row) => row.date), ['2026-06-01', '2026-06-08']);
  assert.equal(result.blockers[0].sessions[0].startTime, '09:00');
});

test('fewer exact matches than selected sessions only plans the missing sessions', () => {
  const result = moveService.evaluateSessionConflicts({
    selectedSessions: [
      { sessionId: 'SES_1', date: '2026-06-01', startTime: '09:00', endTime: '10:00' },
      { sessionId: 'SES_2', date: '2026-06-08', startTime: '09:00', endTime: '10:00' }
    ],
    targetSessions: [{ sessionId: 'SES_T', date: '2026-06-01', startTime: '10:00', endTime: '11:00' }],
    startTime: '10:00',
    targetCapacity: 8,
    sourcePeriods: [],
    targetPeriods: [],
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.notices.some((row) => row.code === 'PARTIAL_CREATE'), true);
  assert.deepEqual(result.plans.map((row) => row.action), ['reuse', 'create']);
});

test('enrollment that already started is closed, and one that starts on the first session is reassigned', () => {
  const rows = moveService.classifyMoveEnrollments({
    selectedDates: ['2026-06-01', '2026-06-08'],
    sourceSessions: [{
      sessionId: 'SES_OLD',
      date: '2026-05-15',
      startTime: '09:00',
      endTime: '11:00',
      durationHours: 2,
      roster: [{ personId: 'PER_EARLY', attendance: 'present' }]
    }],
    periods: [
      period({ id: 'PER_SAME', studentId: 'STU_SAME', startDate: '2026-06-01' }),
      period({
        id: 'PER_EARLY',
        studentId: 'STU_EARLY',
        personId: 'PER_EARLY',
        startDate: '2026-05-01',
        endDate: '2026-08-31',
        targetHours: 6,
        targetSessionCount: 0
      })
    ]
  });
  const same = rows.find((row) => row.periodId === 'PER_SAME');
  const early = rows.find((row) => row.periodId === 'PER_EARLY');
  assert.equal(same.action, 'reassign');
  assert.equal(early.action, 'close_and_open');
  assert.equal(early.closeDate, '2026-05-31');
  assert.equal(early.newStartDate, '2026-06-01');
  assert.equal(early.targetHours, 4);
  assert.equal(early.endDate, '');
});

test('apply creates only missing sessions, keeps matches, moves enrollments, and removes source sessions', async (t) => {
  const saved = [];
  const updates = [];
  const moves = [];
  const sourceSessions = [
    {
      sessionId: 'SES_1',
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId: 'PER_1', attendance: 'present' }]
    },
    {
      sessionId: 'SES_2',
      date: '2026-06-08',
      startTime: '09:00',
      endTime: '10:00',
      status: 'completed',
      roster: [{ personId: 'PER_1', attendance: '' }]
    },
    { sessionId: 'SES_KEEP', date: '2026-07-01', startTime: '09:00', endTime: '10:00', roster: [] }
  ];
  const targetSessions = [{
    sessionId: 'SES_T',
    date: '2026-06-01',
    startTime: '10:00',
    endTime: '11:00',
    roster: []
  }];
  const sourcePeriods = [
    period({ id: 'PER_SAME', studentId: 'STU_SAME', startDate: '2026-06-01' }),
    period({ id: 'PER_EARLY', studentId: 'STU_EARLY', personId: 'PER_EARLY', startDate: '2026-05-01' })
  ];
  moveService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async (collection, id) => {
        if (collection === 'classes' && id === 'CLS_SOURCE') return sourceClass;
        if (collection === 'classes' && id === 'CLS_TARGET') return targetClass;
        return null;
      },
      getClassSessions: async (id) => (id === 'CLS_SOURCE' ? sourceSessions : targetSessions),
      getClassEnrollmentPeriodsByClassId: async (id) => (id === 'CLS_SOURCE' ? sourcePeriods : []),
      saveClassSessions: async (id, sessions) => {
        saved.push({ id, sessions });
      }
    },
    schoolRepositories: {
      classEnrollmentPeriods: {
        update: async (id, patch, options) => {
          updates.push({ id, patch, options });
          return patch;
        }
      }
    },
    enrollmentMoveService: {
      previewMoveEnrollment: async () => ({ canApply: true, previewHash: 'move-hash', blockers: [] }),
      applyMoveEnrollment: async (args) => {
        moves.push(args);
        return {};
      }
    }
  });
  t.after(() => moveService.__resetDependenciesForTest());

  const preview = await moveService.buildMovePreview({
    classId: 'CLS_SOURCE',
    targetClassId: 'CLS_TARGET',
    startTime: '10:00',
    sessionIds: ['SES_1', 'SES_2'],
    reqUser: { id: 'USER_1' }
  });
  assert.equal(preview.canContinue, true);
  assert.equal(preview.notices.some((row) => row.code === 'PARTIAL_CREATE'), true);

  const result = await moveService.applyMoveSessions({
    classId: 'CLS_SOURCE',
    targetClassId: 'CLS_TARGET',
    startTime: '10:00',
    sessionIds: ['SES_1', 'SES_2'],
    previewHash: preview.previewHash,
    reqUser: { id: 'USER_1' }
  });

  assert.equal(result.createdSessionIds.length, 1);
  assert.equal(result.reusedSessionCount, 1);
  assert.equal(result.removedSessionCount, 2);
  const targetSave = saved.find((row) => row.id === 'CLS_TARGET');
  const reused = targetSave.sessions.find((row) => row.sessionId === 'SES_T');
  assert.equal(reused.startTime, '10:00');
  assert.equal(reused.roster.some((row) => row.personId === 'PER_1'), true);
  const created = targetSave.sessions.find((row) => row.sessionId === result.createdSessionIds[0]);
  assert.ok(created);
  assert.equal(created.status, 'completed');
  assert.equal(created.date, '2026-06-08');
  const sourceSave = saved.find((row) => row.id === 'CLS_SOURCE');
  assert.deepEqual(sourceSave.sessions.map((row) => row.sessionId), ['SES_KEEP']);
  assert.equal(updates.some((row) => row.id === 'PER_SAME' && row.patch.classId === 'CLS_TARGET' && row.options.allowClassChange === true), true);
  assert.equal(moves.some((row) => row.sourcePeriodId === 'PER_EARLY'), true);
  assert.deepEqual(result.removedSessions, [
    { classId: 'CLS_SOURCE', sessionId: 'SES_1', date: '2026-06-01' },
    { classId: 'CLS_SOURCE', sessionId: 'SES_2', date: '2026-06-08' }
  ]);
  assert.deepEqual(result.upsertedSessions, [
    { classId: 'CLS_TARGET', sessionId: 'SES_T', date: '2026-06-01' },
    { classId: 'CLS_TARGET', sessionId: result.createdSessionIds[0], date: '2026-06-08' }
  ]);
});

test('move sessions wizard is wired to the schedule rail', () => {
  const view = fs.readFileSync(path.join(__dirname, '../MVC/views/school/schedule/personSchedule.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/scheduleRoutes.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleViewer.js'), 'utf8');
  assert.match(view, /scheduleMoveSessionsModal/);
  assert.match(view, /masterScheduleMoveSessions\.js/);
  assert.match(routes, /\/api\/move-sessions\/preview/);
  assert.match(routes, /\/api\/move-sessions\/apply/);
  assert.match(viewer, /move-enrollments/);
  assert.match(viewer, /installMasterScheduleMoveSessions/);
  assert.match(viewer, /applyScheduleSessionChangesInView[\s\S]*installMasterScheduleMoveSessions/);
  const moveScript = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleMoveSessions.js'), 'utf8');
  assert.match(moveScript, /applyScheduleSessionChangesInView/);
  assert.match(moveScript, /removedSessions/);
  assert.match(moveScript, /upsertedSessions/);
  assert.match(moveScript, /defaultStartTimeFromSessions/);
  assert.match(moveScript, /setMoveStartTimeInput\(defaultStartTimeFromSessions/);
});
