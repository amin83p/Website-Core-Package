const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = require('../MVC/services/school/classConductAssignmentWizardService');
const sessionReportAssignmentService = require('../MVC/services/school/sessionReportAssignmentService');

const ROOT = path.join(__dirname, '..', '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const classes = [
  { id: 'CLS_1', title: 'Morning', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }] },
  { id: 'CLS_2', title: 'Afternoon', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }] }
];

function buildReportGatedAssignment(session) {
  const targetRow = sessionReportAssignmentService.buildSessionTargetRow({
    session,
    reportStartDate: '2026-06-01',
    reportDueDate: '2026-06-05',
    taskStartTime: session.startTime,
    taskEndTime: session.endTime,
    conflictPermitted: true,
    timesheetReflection: true,
    allocatedHours: 1,
    conductRequiredBeforeFill: true,
    teacherId: 'TCH_1',
    reportScope: 'each_student',
    targetStudentIds: ['STU-1'],
    sessionRoster: []
  });
  return {
    id: 'ASG_FROZEN',
    classId: 'CLS_1',
    orgId: 'ORG',
    status: 'active',
    reportScope: 'each_student',
    targetRows: [targetRow]
  };
}

test('CONDUCT_SESSION_LOOKBACK_DAYS is three', () => {
  assert.equal(wizard.CONDUCT_SESSION_LOOKBACK_DAYS, 3);
});

test('pickSessionNearAnchorDate matches within three days before anchor', () => {
  const sessions = [
    { sessionId: 'S_OLD', date: '2026-06-01', startTime: '09:00', endTime: '11:00', status: 'scheduled' },
    { sessionId: 'S_NEAR', date: '2026-06-04', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
  ];
  const pick = wizard.pickSessionNearAnchorDate(sessions, '2026-06-05', 3);
  assert.equal(pick.session.sessionId, 'S_NEAR');
  assert.equal(pick.matchedDate, '2026-06-04');
  assert.equal(pick.daysFromEnd, 1);

  const tooEarly = wizard.pickSessionNearAnchorDate(
    [{ sessionId: 'S1', date: '2026-05-30', startTime: '09:00', endTime: '11:00', status: 'scheduled' }],
    '2026-06-05',
    3
  );
  assert.equal(tooEarly, null);
});

test('previewRows marks report-gated sessions frozen and blocks missing sessions', async (t) => {
  const frozenSession = {
    sessionId: 'S_FROZEN',
    date: '2026-06-05',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    conductReportStepEnabled: true
  };
  const voluntarySession = {
    sessionId: 'S_VOL',
    date: '2026-06-05',
    startTime: '13:00',
    endTime: '15:00',
    status: 'scheduled',
    conductReportStepEnabled: false
  };
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async (classId) => {
        if (classId === 'CLS_1') return [frozenSession];
        if (classId === 'CLS_2') return [voluntarySession];
        return [];
      },
      fetchAllData: async (type) => {
        if (type === 'classes') return classes;
        if (type === 'reportAssignments') return [buildReportGatedAssignment(frozenSession)];
        return [];
      }
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const preview = await wizard.previewRows({
    programIds: ['PRG_1'],
    anchorDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });
  assert.equal(preview.sessionLookbackDays, 3);
  const byId = Object.fromEntries(preview.classes.map((row) => [row.classId, row]));
  assert.equal(byId.CLS_1.frozen, true);
  assert.equal(byId.CLS_1.checkboxDisabled, true);
  assert.equal(byId.CLS_1.conductRequiredForReports, true);
  assert.equal(byId.CLS_2.frozen, false);
  assert.equal(byId.CLS_2.selectable, true);
  assert.equal(byId.CLS_2.defaultChecked, false);
});

test('applySelections enables, disables, and skips frozen rows', async (t) => {
  const sessionEnabled = {
    sessionId: 'S1',
    date: '2026-06-05',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    conductReportStepEnabled: false
  };
  const sessionDisabled = {
    sessionId: 'S2',
    date: '2026-06-05',
    startTime: '13:00',
    endTime: '15:00',
    status: 'scheduled',
    conductReportStepEnabled: true
  };
  const frozenSession = {
    sessionId: 'S_FROZEN',
    date: '2026-06-05',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    conductReportStepEnabled: true
  };
  const updates = [];
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async (classId) => {
        if (classId === 'CLS_1') return [sessionEnabled, frozenSession];
        if (classId === 'CLS_2') return [sessionDisabled];
        return [];
      },
      fetchAllData: async (type) => {
        if (type === 'classes') return classes;
        if (type === 'reportAssignments') return [buildReportGatedAssignment(frozenSession)];
        return [];
      }
    },
    conductMatrixSessionVisibilityService: {
      setSessionConductReportStepEnabled: async (_req, payload) => {
        updates.push(payload);
      }
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const summary = await wizard.applySelections({
    reqUser: { activeOrgId: 'ORG' },
    req: { user: { activeOrgId: 'ORG' } },
    selections: [
      { classId: 'CLS_1', sessionId: 'S1', enabled: true },
      { classId: 'CLS_2', sessionId: 'S2', enabled: false },
      { classId: 'CLS_1', sessionId: 'S_FROZEN', enabled: false }
    ]
  });
  assert.equal(summary.enabled, 1);
  assert.equal(summary.disabled, 1);
  assert.equal(summary.skippedFrozen, 1);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], { classId: 'CLS_1', sessionId: 'S1', enabled: true });
  assert.deepEqual(updates[1], { classId: 'CLS_2', sessionId: 'S2', enabled: false });
});

test('conduct assignment wizard routes and assets are wired', () => {
  const routes = read('packages/school/MVC/routes/conductMatrixRoutes.js');
  assert.match(routes, /\/assignment-wizard\/apply/);
  assert.match(routes, /showConductAssignmentWizard/);
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/report/classConductAssignmentWizard.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/public/scripts/classConductAssignmentWizard.js')));
  const client = read('packages/school/public/scripts/classConductAssignmentWizard.js');
  assert.match(client, /multiselect:\s*true/);
  const matrixView = read('packages/school/MVC/views/school/report/conductMatrix.ejs');
  const reportView = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  assert.match(matrixView, /\/school\/conduct-matrix\/assignment-wizard/);
  assert.match(reportView, /\/school\/conduct-matrix\/assignment-wizard/);
});
