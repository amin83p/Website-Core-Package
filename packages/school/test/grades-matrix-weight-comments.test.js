const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  collectColumns,
  buildGradesMatrixCell,
  formatColumnWeightLabel
} = require('../MVC/controllers/school/gradesMatrixController');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');
const matrixWindowService = require('../MVC/services/school/matrixWindowService');
const matrixRollupService = require('../MVC/services/school/matrixRollupService');

const gradesMatrixSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/grades/gradesMatrix.ejs'),
  'utf8'
);

function makeSession(overrides = {}) {
  return {
    sessionId: 's1',
    date: '2026-01-15',
    roster: [{ personId: 'p1', attendance: 'present' }],
    gradebooks: [],
    quizzes: [],
    assignments: [],
    ...overrides
  };
}

function makeCtx(sessions) {
  const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
  return {
    classData: {},
    orgPolicyCatalog: {},
    attendancePolicy: { scheduledMinutes: 60 },
    enabledAttendanceStatuses: attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses({}),
    forceNotApplicableSessionKeys: new Set(),
    sessionById,
    getApplicabilityForSession: () => ({ expected: true, reason: 'date_window' })
  };
}

test('collectColumns includes resolved weight for gradebook, quiz, and assignment', () => {
  const session = makeSession({
    gradebooks: [{ id: 'gb1', name: 'Activity', weight: 10, totalScore: 20 }],
    quizzes: [{ id: 'q1', name: 'Quiz 1', totalScore: 15 }],
    assignments: [{ id: 'a1', name: 'HW', totalScore: 5 }]
  });
  const { columns } = collectColumns([session]);

  assert.equal(columns.length, 3);
  assert.equal(columns[0].kind, 'gradebook');
  assert.equal(columns[0].weight, 10);
  assert.equal(columns[0]._explicitWeight, 10);
  assert.equal(columns[1].kind, 'quiz');
  assert.equal(columns[1].weight, 15);
  assert.equal(columns[2].kind, 'assignment');
  assert.equal(columns[2].weight, 5);
});

test('formatColumnWeightLabel shows percent for explicit gradebook weight', () => {
  const label = formatColumnWeightLabel({
    kind: 'gradebook',
    _explicitWeight: 10,
    weight: 10,
    totalScore: 20
  });
  assert.equal(label.text, 'W 10%');
  assert.match(label.title, /final grade/i);
});

test('formatColumnWeightLabel shows points for quiz without explicit weight', () => {
  const label = formatColumnWeightLabel({
    kind: 'quiz',
    weight: 15,
    totalScore: 15
  });
  assert.equal(label.text, '15 pts');
});

test('buildGradesMatrixCell includes trimmed comment for present gradebook student', () => {
  const session = makeSession({
    gradebooks: [{
      id: 'gb1',
      name: 'Quiz',
      weight: 10,
      totalScore: 20,
      scores: { p1: 16 },
      scoreComments: { p1: '  Great work  ' }
    }]
  });
  const { columns } = collectColumns([session]);
  const ctx = makeCtx([session]);
  const rosterMaps = matrixWindowService.buildRosterLookupMaps([session]);
  const cell = buildGradesMatrixCell(
    { personId: 'p1', name: 'Student One' },
    columns[0],
    ctx,
    rosterMaps
  );

  assert.equal(cell.comment, 'Great work');
  assert.equal(cell.score, 16);
});

test('buildGradesMatrixCell clears comment for absent students', () => {
  const session = makeSession({
    roster: [{ personId: 'p1', attendance: 'absent' }],
    gradebooks: [{
      id: 'gb1',
      name: 'Quiz',
      totalScore: 20,
      scores: { p1: null },
      scoreComments: { p1: 'Should not appear' }
    }]
  });
  const { columns } = collectColumns([session]);
  const ctx = makeCtx([session]);
  const rosterMaps = matrixWindowService.buildRosterLookupMaps([session]);
  const cell = buildGradesMatrixCell(
    { personId: 'p1', name: 'Student One' },
    columns[0],
    ctx,
    rosterMaps
  );

  assert.equal(cell.absent, true);
  assert.equal(cell.comment, undefined);
});

test('buildGradesMatrixCell omits comment for quiz cells', () => {
  const session = makeSession({
    quizzes: [{
      id: 'q1',
      name: 'Pop Quiz',
      totalScore: 10,
      scores: { p1: 8 }
    }]
  });
  const { columns } = collectColumns([session]);
  const ctx = makeCtx([session]);
  const rosterMaps = matrixWindowService.buildRosterLookupMaps([session]);
  const cell = buildGradesMatrixCell(
    { personId: 'p1', name: 'Student One' },
    columns[0],
    ctx,
    rosterMaps
  );

  assert.equal(cell.score, 8);
  assert.equal(cell.comment, undefined);
});

test('computeFinalPercent excludes attendance by default', () => {
  const evaluation = { weights: { attendance: 50, assignments: 50 } };
  const excluded = matrixRollupService.computeFinalPercent(evaluation, 40, 80, null, null);
  assert.equal(excluded.finalPercent, 80);
  const included = matrixRollupService.computeFinalPercent(evaluation, 40, 80, null, null, { includeAttendanceInFinal: true });
  assert.equal(included.finalPercent, 60);
});

test('gradesMatrix view supports attendance include toggle', () => {
  assert.match(gradesMatrixSource, /gmCommentModal/);
  assert.match(gradesMatrixSource, /gm-comment-btn/);
  assert.match(gradesMatrixSource, /formatGmColumnWeightLabel/);
  assert.match(gradesMatrixSource, /gmOpenCommentModal/);
  assert.match(gradesMatrixSource, /gm_includeAttendance/);
  assert.match(gradesMatrixSource, /updateGmMatrixBlurb/);
});
