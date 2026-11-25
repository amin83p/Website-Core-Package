const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const makeupService = require('../MVC/services/school/sessionGradebookMakeupService');

const sessionManagerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

const SESSION_A = {
  sessionId: 'SES_A',
  date: '2026-09-01',
  roster: [
    { personId: 'P1', attendance: 'present' },
    { personId: 'P2', attendance: 'absent' },
    { personId: 'P3', attendance: 'not_applicable' }
  ],
  gradebooks: [{
    id: 'GB1',
    name: 'Quiz 1',
    totalScore: 10,
    weight: 10,
    scores: { P1: 8, P2: null, P3: null }
  }]
};

const SESSION_B = {
  sessionId: 'SES_B',
  date: '2026-09-15',
  roster: [
    { personId: 'P1', attendance: 'present' },
    { personId: 'P2', attendance: 'present' },
    { personId: 'P3', attendance: 'absent' }
  ],
  gradebooks: []
};

test('listMakeupPickerRows excludes makeup derivatives and current session', () => {
  const sessions = [
    SESSION_A,
    SESSION_B,
    {
      sessionId: 'SES_DERIV',
      date: '2026-09-10',
      gradebooks: [{
        id: 'GB_DERIV',
        name: 'Copy',
        totalScore: 10,
        makeupSource: { sessionId: 'SES_A', gradebookId: 'GB1' }
      }]
    }
  ];
  const rows = makeupService.listMakeupPickerRows({
    allSessions: sessions,
    currentSession: SESSION_B,
    makeupPolicy: DEFAULT_MAKEUP_POLICY
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB1');
  assert.equal(rows[0].sessionId, 'SES_A');
});

test('partitionGradebooksForSessionManagerClient splits makeup-linked activities', () => {
  const makeup = {
    id: 'GB_MU',
    name: 'Quiz make-up',
    makeupSource: { sessionId: 'SES_A', gradebookId: 'GB1', sessionDate: '2026-09-01' },
    makeupRoles: { P1: 'makeup' }
  };
  const original = { id: 'GB1', name: 'Quiz 1', totalScore: 10 };
  const { inline, makeupLinked } = makeupService.partitionGradebooksForSessionManagerClient([original, makeup]);
  assert.equal(inline.length, 1);
  assert.equal(makeupLinked.length, 1);
  assert.equal(inline[0].id, 'GB1');
  assert.equal(makeupLinked[0].id, 'GB_MU');
});

const DEFAULT_MAKEUP_POLICY = { windowType: 'last_n_days', lookbackDays: 15 };

test('listMakeupPickerRows excludes sessions older than lookback window', () => {
  const sessions = [
    {
      sessionId: 'SES_OLD',
      date: '2026-08-01',
      gradebooks: [{ id: 'GB_OLD', name: 'Old quiz', totalScore: 10, scores: {} }]
    },
    SESSION_A,
    SESSION_B
  ];
  const rows = makeupService.listMakeupPickerRows({
    allSessions: sessions,
    currentSession: SESSION_B,
    makeupPolicy: DEFAULT_MAKEUP_POLICY
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB1');
});

test('listMakeupPickerRows respects this_week window', () => {
  const current = { sessionId: 'SES_CUR', date: '2026-09-17', gradebooks: [] };
  const sessions = [
    { sessionId: 'SES_MON', date: '2026-09-15', gradebooks: [{ id: 'GB_W', name: 'W', totalScore: 10 }] },
    { sessionId: 'SES_PRIOR', date: '2026-09-08', gradebooks: [{ id: 'GB_P', name: 'P', totalScore: 10 }] },
    current
  ];
  const rows = makeupService.listMakeupPickerRows({
    allSessions: sessions,
    currentSession: current,
    makeupPolicy: { windowType: 'this_week', lookbackDays: null }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB_W');
});

test('listMakeupPickerRows respects month_half window', () => {
  const current = { sessionId: 'SES_CUR', date: '2026-09-20', gradebooks: [] };
  const sessions = [
    { sessionId: 'SES_FIRST_HALF', date: '2026-09-10', gradebooks: [{ id: 'GB_1', name: '1', totalScore: 10 }] },
    { sessionId: 'SES_SECOND', date: '2026-09-18', gradebooks: [{ id: 'GB_2', name: '2', totalScore: 10 }] },
    current
  ];
  const rows = makeupService.listMakeupPickerRows({
    allSessions: sessions,
    currentSession: current,
    makeupPolicy: { windowType: 'month_half', lookbackDays: null }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB_2');
});

test('previewMakeupGradebook blocks source outside configured window', () => {
  const preview = makeupService.previewMakeupGradebook({
    allSessions: [
      { sessionId: 'SES_A', date: '2026-08-01', gradebooks: [{ id: 'GB1', name: 'Q', totalScore: 10, scores: { P2: null } }], roster: SESSION_A.roster },
      SESSION_B
    ],
    currentSession: SESSION_B,
    sourceSessionId: 'SES_A',
    sourceGradebookId: 'GB1',
    currentPersonIds: ['P2'],
    makeupPolicy: DEFAULT_MAKEUP_POLICY
  });
  assert.equal(preview.status, 'blocked');
  assert.match(preview.messages.join(' '), /outside the allowed make-up window/i);
});

test('listMakeupPickerRows excludes period performance log activities', () => {
  const sessions = [
    {
      ...SESSION_A,
      gradebooks: [
        SESSION_A.gradebooks[0],
        {
          id: 'GB_LOG',
          name: 'Period log',
          totalScore: 10,
          weight: 10,
          periodPerformanceLog: true,
          scores: {}
        }
      ]
    },
    SESSION_B
  ];
  const rows = makeupService.listMakeupPickerRows({
    allSessions: sessions,
    currentSession: SESSION_B,
    makeupPolicy: DEFAULT_MAKEUP_POLICY
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB1');
  assert.equal(makeupService.isMakeupSourceEligibleActivity({ id: 'GB_LOG', periodPerformanceLog: true }), false);
});

test('preview blocks period performance log source activity', () => {
  const sessionWithLog = {
    ...SESSION_A,
    gradebooks: [{
      id: 'GB_LOG',
      name: 'Period log',
      totalScore: 10,
      weight: 10,
      periodPerformanceLog: true,
      scores: { P2: null }
    }]
  };
  const preview = makeupService.previewMakeupGradebook({
    allSessions: [sessionWithLog, SESSION_B],
    currentSession: SESSION_B,
    sourceSessionId: 'SES_A',
    sourceGradebookId: 'GB_LOG',
    currentPersonIds: ['P2']
  });
  assert.equal(preview.status, 'blocked');
  assert.match(preview.messages.join(' '), /period performance log/i);
});

test('preview blocks when no students missed source session', () => {
  const onlyPresent = {
    ...SESSION_A,
    roster: [{ personId: 'P1', attendance: 'present' }]
  };
  const preview = makeupService.previewMakeupGradebook({
    allSessions: [onlyPresent, SESSION_B],
    currentSession: SESSION_B,
    sourceSessionId: 'SES_A',
    sourceGradebookId: 'GB1',
    currentPersonIds: ['P1']
  });
  assert.equal(preview.status, 'blocked');
});

test('preview warns and allows partial makeup cohort', () => {
  const preview = makeupService.previewMakeupGradebook({
    allSessions: [SESSION_A, SESSION_B],
    currentSession: SESSION_B,
    sourceSessionId: 'SES_A',
    sourceGradebookId: 'GB1',
    currentPersonIds: ['P1', 'P2', 'P3']
  });
  assert.equal(preview.status, 'warn');
  assert.equal(preview.cohort.makeupEligible.includes('P2'), true);
  assert.equal(preview.gradebook.makeupRoles.P2, 'makeup');
  assert.equal(preview.gradebook.makeupRoles.P1, 'done');
  assert.equal(preview.gradebook.scores.P1, 8);
  assert.equal(preview.gradebook.includeInGradeCalculation, false);
});

test('resolveEffectiveGradebookScoreForStudent uses makeup overlay when absent on source', () => {
  const sessions = [
    SESSION_A,
    {
      ...SESSION_B,
      gradebooks: [{
        id: 'GB_MAKEUP',
        makeupSource: { sessionId: 'SES_A', gradebookId: 'GB1' },
        scores: { P2: 7 }
      }]
    }
  ];
  const score = makeupService.resolveEffectiveGradebookScoreForStudent({
    allSessions: sessions,
    sourceSessionId: 'SES_A',
    sourceGradebookId: 'GB1',
    personId: 'P2',
    sourceSessionAttendance: 'absent'
  });
  assert.equal(score, 7);
});

test('normalizeMakeupGradebookOnSave forces done scores from source', () => {
  const normalized = makeupService.normalizeMakeupGradebookOnSave({
    id: 'gbx',
    name: 'Quiz 1',
    totalScore: 10,
    weight: 10,
    includeInGradeCalculation: true,
    makeupSource: { sessionId: 'SES_A', gradebookId: 'GB1' },
    scores: { P1: 99, P2: 6 },
    makeupRoles: { P1: 'done', P2: 'makeup' }
  }, {
    personIds: ['P1', 'P2'],
    attendanceByPerson: new Map([['P1', 'present'], ['P2', 'present']]),
    sourceSessionsById: new Map([['SES_A', SESSION_A]]),
    currentSessionDate: SESSION_B.date,
    gradebookActivityMakeup: DEFAULT_MAKEUP_POLICY
  });
  assert.equal(normalized.includeInGradeCalculation, false);
  assert.equal(normalized.scores.P1, 8);
  assert.equal(normalized.scores.P2, 6);
});

test('sessionManager includes make-up CTA and picker modal hooks', () => {
  assert.match(sessionManagerSource, /btnOpenGradebookMakeupPicker/);
  assert.match(sessionManagerSource, /session-gradebook-makeup-btn/);
  assert.match(sessionManagerSource, /gradebookMakeupPickerModal/);
  assert.match(sessionManagerSource, /gbMakeupPickerWindowDescription/);
  assert.match(sessionManagerSource, /gradebooks\/makeup-sources/);
  assert.match(sessionManagerSource, /gradebooks\/makeup-activities/);
  assert.match(sessionManagerSource, /sessionGradebooksInline/);
  assert.match(sessionManagerSource, /gbLoadMakeupActivitiesIfNeeded/);
});

test('getGradebookMakeupActivities uses session manage access not assignment-only class load', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/classController.js'),
    'utf8'
  );
  const fnBlock = controllerSource.split('async function getGradebookMakeupActivities')[1]?.split('async function postGradebookMakeupFrom')[0] || '';
  assert.match(fnBlock, /assertSessionInstructionalActiveForRequest/);
  assert.doesNotMatch(fnBlock, /getClassByIdWithOrgCheck/);
});
