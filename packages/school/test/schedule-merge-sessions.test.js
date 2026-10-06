const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sessionMergeService = require('../MVC/services/school/sessionMergeService');
const scheduleMergeSessionsService = require('../MVC/services/school/scheduleMergeSessionsService');

function source(overrides = {}) {
  return {
    classId: 'CLS_SOURCE',
    sessionId: 'SES_1',
    date: '2026-06-01',
    startTime: '09:00',
    endTime: '10:00',
    mainTeacherId: 'TCH_OLD',
    alreadyMerged: false,
    timesheetLocked: false,
    partners: [],
    ...overrides
  };
}

function partner(overrides = {}) {
  return {
    classId: 'CLS_TARGET',
    sessionId: 'SES_P',
    classTitle: 'Target',
    date: '2026-06-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    statusLabel: 'Scheduled',
    ...overrides
  };
}

function partnerSession(overrides = {}) {
  return {
    sessionId: 'SES_P',
    date: '2026-06-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    delivery: { deliveredBy: 'TCH_NEW', deliveredByName: 'New' },
    ...overrides
  };
}

test('a partner session covers a selected session when it contains that window, including an exact match', () => {
  const exact = sessionMergeService.evaluatePartnerSessionCandidate({
    classId: 'CLS_TARGET',
    session: partnerSession(),
    sourceClassId: 'CLS_SOURCE',
    sourceSessionId: 'SES_1',
    sourceStart: '09:00',
    sourceEnd: '10:00',
    resolvedMergingId: 'TCH_NEW'
  });
  assert.equal(exact.sessionId, 'SES_P');

  const wider = sessionMergeService.evaluatePartnerSessionCandidate({
    classId: 'CLS_TARGET',
    session: partnerSession({ startTime: '08:30', endTime: '11:00' }),
    sourceClassId: 'CLS_SOURCE',
    sourceSessionId: 'SES_1',
    sourceStart: '09:00',
    sourceEnd: '10:30',
    resolvedMergingId: 'TCH_NEW'
  });
  assert.equal(wider.sessionId, 'SES_P');
});

test('a selected session that extends past the partner session is not covered', () => {
  const result = sessionMergeService.evaluatePartnerSessionCandidate({
    classId: 'CLS_TARGET',
    session: partnerSession({ endTime: '10:00' }),
    sourceClassId: 'CLS_SOURCE',
    sourceSessionId: 'SES_1',
    sourceStart: '09:00',
    sourceEnd: '10:30',
    resolvedMergingId: 'TCH_NEW'
  });
  assert.equal(result, null);

  const plan = sessionMergeService.planSessionMergeAssignments({
    mergingTeacherId: 'TCH_NEW',
    sources: [source({ endTime: '10:30', partners: [] })]
  });
  assert.equal(plan.canContinue, false);
  assert.equal(plan.blockers.length, 1);
  assert.equal(plan.blockers[0].code, 'NO_PARTNER');
  assert.match(plan.blockers[0].message, /no session that fully covers this session/);
  assert.deepEqual(plan.blockers[0].sessions.map((row) => row.date), ['2026-06-01']);
});

test('each selected session is assigned its own partner, preferring an exact time match', () => {
  const plan = sessionMergeService.planSessionMergeAssignments({
    mergingTeacherId: 'TCH_NEW',
    sources: [
      source({
        sessionId: 'SES_1',
        partners: [
          partner({ sessionId: 'SES_WIDE', startTime: '08:00', endTime: '12:00', classTitle: 'Wide' }),
          partner({ sessionId: 'SES_EXACT', classTitle: 'Exact' })
        ]
      }),
      source({
        sessionId: 'SES_2',
        date: '2026-06-08',
        startTime: '10:00',
        endTime: '11:00',
        partners: [
          partner({
            sessionId: 'SES_WIDE_2',
            classId: 'CLS_OTHER',
            date: '2026-06-08',
            startTime: '10:00',
            endTime: '11:00',
            classTitle: 'Other'
          })
        ]
      })
    ]
  });
  assert.equal(plan.canContinue, true);
  assert.equal(plan.blockers.length, 0);
  const first = plan.matches.find((row) => row.sourceSessionId === 'SES_1');
  const second = plan.matches.find((row) => row.sourceSessionId === 'SES_2');
  assert.equal(first.partner.sessionId, 'SES_EXACT');
  assert.equal(second.partner.sessionId, 'SES_WIDE_2');
});

test('two selected sessions that only fit inside one partner session are blocked together', () => {
  const shared = partner({ sessionId: 'SES_ONLY', startTime: '08:00', endTime: '12:00' });
  const plan = sessionMergeService.planSessionMergeAssignments({
    mergingTeacherId: 'TCH_NEW',
    sources: [
      source({ sessionId: 'SES_1', startTime: '09:00', endTime: '10:00', partners: [shared] }),
      source({ sessionId: 'SES_2', startTime: '10:00', endTime: '11:00', partners: [shared] })
    ]
  });
  assert.equal(plan.canContinue, false);
  assert.equal(plan.matches.length, 0);
  assert.equal(plan.blockers.length, 1);
  assert.equal(plan.blockers[0].code, 'SHARED_PARTNER');
  assert.match(plan.blockers[0].message, /own covering session/);
  assert.deepEqual(plan.blockers[0].sessions.map((row) => row.sessionId), ['SES_1', 'SES_2']);
});

test('a partner that already has a takeover link is not available', () => {
  assert.equal(sessionMergeService.partnerHasTakeoverLink({
    mergedPartner: { linkedClassId: 'CLS_A', linkedSessionId: 'SES_OLD' }
  }), true);
  assert.equal(sessionMergeService.partnerHasTakeoverLink({ mergedPartner: {} }), false);
});

test('writeSessionMergeLink records the same takeover fields as a single session merge', () => {
  const sourceSession = {
    sessionId: 'SES_1',
    status: 'scheduled',
    delivery: { deliveredBy: 'TCH_OLD', deliveredByName: 'Old', coTeachers: [] }
  };
  const partnerSession = {
    sessionId: 'SES_P',
    status: 'scheduled',
    delivery: { deliveredBy: 'TCH_NEW', deliveredByName: 'New' }
  };
  sessionMergeService.writeSessionMergeLink({
    sourceSession,
    partnerSession,
    sourceClassId: 'CLS_SOURCE',
    sourceSessionId: 'SES_1',
    partnerClassId: 'CLS_TARGET',
    partnerSessionId: 'SES_P',
    resolvedMergingId: 'TCH_NEW',
    mergingTeacherName: 'New',
    resolvedPreviousId: 'TCH_OLD',
    previousTeacherName: 'Old',
    mergedCode: 'merged_session',
    now: '2026-06-01T12:00:00.000Z',
    actorId: 'USER_1',
    actorPersonId: 'PER_1'
  });
  assert.equal(sourceSession.status, 'merged_session');
  assert.equal(sourceSession.delivery.deliveredBy, 'TCH_NEW');
  assert.equal(sourceSession.merged.isMergedSession, true);
  assert.equal(sourceSession.merged.partnerClassId, 'CLS_TARGET');
  assert.equal(sourceSession.merged.partnerSessionId, 'SES_P');
  assert.equal(sourceSession.merged.previousTeacherId, 'TCH_OLD');
  assert.equal(sourceSession.delivery.coTeachers.some((row) => row.personId === 'TCH_OLD' && row.roleLabel === 'Previous Teacher' && row.paid === false), true);
  assert.equal(partnerSession.mergedPartner.linkedClassId, 'CLS_SOURCE');
  assert.equal(partnerSession.mergedPartner.linkedSessionId, 'SES_1');
  assert.equal(partnerSession.mergedPartner.ignoreScheduleConflict, true);
});

test('apply rejects a stale merge preview', async () => {
  scheduleMergeSessionsService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async () => ({ id: 'CLS_SOURCE', orgId: 'ORG_1' }),
      getClassSessions: async () => [{
        sessionId: 'SES_1',
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '10:00'
      }]
    },
    sessionMergeService: {
      previewSessionMergeBatch: async () => ({
        canContinue: true,
        blockers: [],
        matches: [{
          sourceClassId: 'CLS_SOURCE',
          sourceSessionId: 'SES_1',
          partner: { classId: 'CLS_TARGET', sessionId: 'SES_P' }
        }],
        mergingTeacherId: 'TCH_NEW',
        mergingTeacherName: 'New'
      }),
      executeSessionMergeBatch: async () => {
        throw new Error('should not apply');
      }
    }
  });
  try {
    await assert.rejects(
      () => scheduleMergeSessionsService.applyMergeSessions({
        mergingTeacherId: 'TCH_NEW',
        sessions: [{ classId: 'CLS_SOURCE', sessionId: 'SES_1' }],
        previewHash: 'stale'
      }),
      /Preview is stale/
    );
  } finally {
    scheduleMergeSessionsService.__resetDependenciesForTest();
  }
});

test('merge session takeover is wired to the schedule rail', () => {
  const view = fs.readFileSync(path.join(__dirname, '../MVC/views/school/schedule/personSchedule.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/scheduleRoutes.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleViewer.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleMergeSessions.js'), 'utf8');
  assert.match(view, /data-schedule-admin-action="merge-sessions"/);
  assert.match(view, /Merge Sessions/);
  assert.match(view, /data-schedule-admin-action="take-over-sessions"/);
  assert.match(view, /Take Over/);
  assert.match(view, /scheduleMergeSessionsModal/);
  assert.match(view, /masterScheduleMergeSessions\.js/);
  assert.match(routes, /\/api\/merge-sessions\/preview/);
  assert.match(routes, /\/api\/merge-sessions\/apply/);
  assert.match(routes, /SCHOOL_SESSIONS, OPERATIONS\.UPDATE/);
  assert.match(viewer, /merge-sessions/);
  assert.match(viewer, /installMasterScheduleMergeSessions/);
  assert.match(script, /row\.sessions/);
  assert.match(script, /<ul/);
});
