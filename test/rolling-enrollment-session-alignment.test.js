const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const alignmentService = require('../packages/school/MVC/services/school/rollingEnrollmentSessionAlignmentService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const sampleSessions = [
  { sessionId: 'SES-1', date: '2026-07-01', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] },
  { sessionId: 'SES-2', date: '2026-07-08', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] },
  { sessionId: 'SES-3', date: '2026-07-15', startTime: '09:00', endTime: '11:00', status: 'cancelled', roster: [] },
  { sessionId: 'SES-4', date: '2026-08-01', startTime: '09:00', endTime: '11:00', status: 'scheduled', roster: [] }
];

test('listSessionsInWindow filters by date and attendance exclusion', () => {
  const statusMap = {};
  const listed = alignmentService.listSessionsInWindow({
    sessions: sampleSessions,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    statusMap
  });
  assert.equal(listed.sessions.length, 3);
  assert.equal(listed.availableCount, 2);
  assert.equal(listed.countableSessions.map((row) => row.sessionId).join(','), 'SES-1,SES-2');
});

test('evaluateAlignment returns expected statuses', () => {
  const statusMap = {};
  const noEnd = alignmentService.evaluateAlignment({
    sessions: sampleSessions,
    startDate: '2026-07-01',
    endDate: '',
    targetSessionCount: 0,
    statusMap
  });
  assert.equal(noEnd.alignmentStatus, 'no_end_date');

  const ok = alignmentService.evaluateAlignment({
    sessions: sampleSessions,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    targetSessionCount: 2,
    statusMap
  });
  assert.equal(ok.alignmentStatus, 'ok');
  assert.equal(ok.availableCount, 2);

  const insufficient = alignmentService.evaluateAlignment({
    sessions: sampleSessions,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    targetSessionCount: 5,
    statusMap
  });
  assert.equal(insufficient.alignmentStatus, 'insufficient_sessions');
  assert.equal(insufficient.gapCount, 3);

  const overage = alignmentService.evaluateAlignment({
    sessions: sampleSessions,
    startDate: '2026-07-01',
    endDate: '2026-08-31',
    targetSessionCount: 2,
    statusMap
  });
  assert.equal(overage.alignmentStatus, 'overage_requires_na');
  assert.equal(overage.requiredNaCount, 1);
});

test('validatePlannedNaSelection enforces exact N/A count', () => {
  const countableSessions = [
    { sessionId: 'SES-1' },
    { sessionId: 'SES-2' },
    { sessionId: 'SES-4' }
  ];
  const bad = alignmentService.validatePlannedNaSelection({
    countableSessions,
    targetSessionCount: 2,
    plannedNaSessionIds: []
  });
  assert.equal(bad.valid, false);

  const invalidId = alignmentService.validatePlannedNaSelection({
    countableSessions,
    targetSessionCount: 2,
    plannedNaSessionIds: ['SES-OUT']
  });
  assert.equal(invalidId.valid, false);

  const good = alignmentService.validatePlannedNaSelection({
    countableSessions,
    targetSessionCount: 2,
    plannedNaSessionIds: ['SES-4']
  });
  assert.equal(good.valid, true);
  assert.deepEqual(good.plannedNaSessionIds, ['SES-4']);
});

test('materializePlannedNaAttendance writes roster N/A records', async () => {
  const originals = {
    getClassSessions: schoolDataService.getClassSessions,
    saveClassSessions: schoolDataService.saveClassSessions
  };
  const sessions = [
    { sessionId: 'SES-A', date: '2026-07-01', roster: [] },
    { sessionId: 'SES-B', date: '2026-07-08', roster: [{ personId: 'PER-1', attendance: 'present' }] }
  ];
  let saved = null;
  schoolDataService.getClassSessions = async () => sessions.map((row) => ({ ...row, roster: Array.isArray(row.roster) ? row.roster.map((r) => ({ ...r })) : [] }));
  schoolDataService.saveClassSessions = async (_classId, nextSessions) => {
    saved = nextSessions;
    return nextSessions;
  };
  sessionStatusPolicyService.getStatusMap = async () => ({});

  try {
    const result = await alignmentService.materializePlannedNaAttendance({
      classId: 'CLS-1',
      personId: 'PER-1',
      sessionIds: ['SES-A', 'SES-B'],
      reqUser: { id: 'USR-1', activeOrgId: 'ORG-1' }
    });
    assert.equal(result.updatedCount, 2);
    assert.ok(saved);
    const rowA = saved.find((row) => row.sessionId === 'SES-A');
    const rowB = saved.find((row) => row.sessionId === 'SES-B');
    assert.equal(rowA.roster[0].attendance, 'not_applicable');
    assert.equal(rowB.roster[0].attendance, 'not_applicable');
  } finally {
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.saveClassSessions = originals.saveClassSessions;
  }
});

test('materializePlannedNaAttendance resolves schoolDataService after circular module load', async () => {
  const path = require('node:path');
  const base = path.resolve(ROOT_DIR, 'packages/school/MVC/services/school');
  ['schoolDataService.js', 'classEnrollmentPeriodService.js', 'rollingEnrollmentSessionAlignmentService.js'].forEach((file) => {
    delete require.cache[path.join(base, file)];
  });

  const schoolDataServiceAfterCycle = require(path.join(base, 'schoolDataService.js'));
  const alignmentServiceAfterCycle = require(path.join(base, 'rollingEnrollmentSessionAlignmentService.js'));
  const originals = {
    getClassSessions: schoolDataServiceAfterCycle.getClassSessions,
    saveClassSessions: schoolDataServiceAfterCycle.saveClassSessions
  };
  let saved = null;
  schoolDataServiceAfterCycle.getClassSessions = async () => ([
    { sessionId: 'SES-CYCLE', date: '2026-07-01', roster: [] }
  ]);
  schoolDataServiceAfterCycle.saveClassSessions = async (_classId, nextSessions) => {
    saved = nextSessions;
    return nextSessions;
  };

  try {
    const result = await alignmentServiceAfterCycle.materializePlannedNaAttendance({
      classId: 'CLS-CYCLE',
      personId: 'PER-CYCLE',
      sessionIds: ['SES-CYCLE'],
      reqUser: { id: 'USR-1', activeOrgId: 'ORG-1' }
    });
    assert.equal(result.updatedCount, 1);
    assert.ok(saved);
    assert.equal(saved[0].roster[0].attendance, 'not_applicable');
  } finally {
    schoolDataServiceAfterCycle.getClassSessions = originals.getClassSessions;
    schoolDataServiceAfterCycle.saveClassSessions = originals.saveClassSessions;
  }
});

test('rolling enrollment view and routes expose session alignment integration', () => {
  const view = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(view, /enrollmentSessionGapModal/);
  assert.match(view, /enrollmentSessionNaModal/);
  assert.match(view, /ensureEnrollmentSessionAlignment/);
  assert.match(view, /enrollment-session-alignment/);

  const routes = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(routes, /enrollment-session-alignment/);
  assert.match(routes, /sessions\/append-batch/);

  const controller = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /postEnrollmentSessionAlignment/);
  assert.match(controller, /assertEnrollmentSessionAlignmentForCreate/);
  assert.match(controller, /materializeEnrollmentPlannedNa/);
});
