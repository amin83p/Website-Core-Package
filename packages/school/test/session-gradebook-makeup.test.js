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
  const rows = makeupService.listMakeupPickerRows({ allSessions: sessions, currentSession: SESSION_B });
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
  const rows = makeupService.listMakeupPickerRows({ allSessions: sessions, currentSession: SESSION_B });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gradebookId, 'GB1');
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
    sourceSessionsById: new Map([['SES_A', SESSION_A]])
  });
  assert.equal(normalized.includeInGradeCalculation, false);
  assert.equal(normalized.scores.P1, 8);
  assert.equal(normalized.scores.P2, 6);
});

test('sessionManager includes make-up CTA and picker modal hooks', () => {
  assert.match(sessionManagerSource, /btnOpenGradebookMakeupPicker/);
  assert.match(sessionManagerSource, /session-gradebook-makeup-btn/);
  assert.match(sessionManagerSource, /gradebookMakeupPickerModal/);
  assert.match(sessionManagerSource, /gradebooks\/makeup-sources/);
  assert.match(sessionManagerSource, /gradebooks\/makeup-activities/);
  assert.match(sessionManagerSource, /sessionGradebooksInline/);
  assert.match(sessionManagerSource, /gbLoadMakeupActivitiesIfNeeded/);
});
