const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const conductRatingScaleService = require('../packages/school/MVC/services/school/conductRatingScaleService');
const sessionConductService = require('../packages/school/MVC/services/school/sessionConductService');

test('conductRatingScaleService maps default bands and midpoints', () => {
  const policy = conductRatingScaleService.resolvePolicy();
  assert.equal(policy.levels.length, 4);
  assert.equal(conductRatingScaleService.percentToLevel(100, policy).code, 'S');
  assert.equal(conductRatingScaleService.percentToLevel(85, policy).code, 'S');
  assert.equal(conductRatingScaleService.percentToLevel(84, policy).code, 'Sat');
  assert.equal(conductRatingScaleService.percentToLevel(72, policy).code, 'Sat');
  assert.equal(conductRatingScaleService.percentToLevel(50, policy).code, 'NI');
  assert.equal(conductRatingScaleService.percentToLevel(49, policy).code, 'U');
  assert.equal(conductRatingScaleService.percentToLevel(null, policy).code, 'NA');
  assert.equal(conductRatingScaleService.levelDefaultPercent('S', policy), 92.5);
  assert.equal(conductRatingScaleService.levelDefaultPercent('Sat', policy), 72);
  assert.equal(conductRatingScaleService.levelDefaultPercent('NI', policy), 54.5);
  assert.equal(conductRatingScaleService.levelDefaultPercent('U', policy), 24.5);
  assert.equal(conductRatingScaleService.levelDefaultPercent('NA', policy), null);
  assert.equal(conductRatingScaleService.NA_LEVEL.displayCode, 'N/A');
  assert.ok(policy.levels.every((level) => level.displayCode));
});

test('conductRatingScaleService validates contiguous ranges and rejects overlaps', () => {
  const valid = conductRatingScaleService.validatePolicyLevels(conductRatingScaleService.DEFAULT_LEVELS);
  assert.equal(valid.valid, true);

  const invalid = conductRatingScaleService.validatePolicyLevels([
    { code: 'S', label: 'Superior', displayCode: 'S', minPercent: 85, maxPercent: 100, defaultPercent: 92.5 },
    { code: 'Sat', label: 'Satisfactory', displayCode: 'Sat', minPercent: 60, maxPercent: 90, defaultPercent: 72 }
  ]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((row) => /overlap/i.test(row)));
});

test('conductRatingScaleService normalizePolicyFromForm throws on invalid ranges', () => {
  assert.throws(() => conductRatingScaleService.normalizePolicyFromForm({
    levels: [{ code: 'S', label: 'Superior', displayCode: 'S', minPercent: 50, maxPercent: 100, defaultPercent: 80 }]
  }), /Lowest level must start at 0%/);
});

test('class routes expose admin conduct rating scale settings endpoint', () => {
  const source = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(source, /requireConductRatingScalePolicyAdmin/);
  assert.match(source, /router\.post\('\/conduct-rating-scale\/settings'/);
  assert.match(source, /classCtrl\.saveConductRatingScaleSettings/);
  assert.match(source, /router\.post\('\/:id\/sessions\/:sessionId\/conduct'/);
  assert.match(source, /classCtrl\.saveSessionConduct/);
});

test('manageSession passes conduct rating scale to session manager view', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /conductRatingScalePolicyModel\.getPolicyForOrg/);
  assert.match(source, /conductRatingScaleResolved/);
  assert.match(source, /canManageConductRatingScale: canOverride/);
  assert.match(source, /async function saveConductRatingScaleSettings/);
  assert.match(source, /async function saveSessionConduct/);
  assert.match(source, /parseConductReadyFlag/);
  assert.match(source, /conductPrefillByPersonId/);
  assert.match(source, /emptyConductPercents\(\)/);
  assert.match(source, /normalizeSessionRatingPercent\(value, fallback = null\)/);
});

test('session manager places optional conduct after attendance and Step 1 only in reports', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /data-session-panel="conduct"/);
  assert.match(source, /id="session-panel-conduct"/);
  assert.match(source, /id="sessionOptionalConductStep"/);
  assert.match(source, /id="optionalConductStudentSelect"/);
  assert.match(source, /id="optionalConductTable"/);
  assert.match(source, /id="btnAddOptionalConductStudents"/);
  assert.doesNotMatch(source, /id="btnSaveOptionalSessionConduct"/);
  assert.match(source, /initOptionalConductTableFromSavedStudents/);
  assert.match(source, /btn-remove-optional-conduct/);
  assert.match(source, /Changes are saved with <strong>Save session<\/strong>/);
  assert.match(source, /id="btnOpenOptionalConductBulkModal"/);

  const attendanceIdx = source.indexOf('id="session-panel-attendance"');
  const conductIdx = source.indexOf('id="session-panel-conduct"');
  const assignmentsIdx = source.indexOf('id="session-panel-assignments"');
  const optionalIdx = source.indexOf('id="sessionOptionalConductStep"');
  assert.ok(attendanceIdx >= 0 && conductIdx > attendanceIdx, 'conduct panel should follow attendance');
  assert.ok(assignmentsIdx > conductIdx, 'assignments should follow conduct panel');
  assert.ok(optionalIdx > attendanceIdx && optionalIdx < assignmentsIdx, 'optional conduct UI should live outside reports tab');

  assert.match(source, /id="sessionReportConductStep"/);
  assert.match(source, /Step 1 — Class Conduct/);
  assert.match(source, /id="btnSaveSessionConduct"/);
  assert.match(source, /conduct-code-btn/);
  assert.match(source, /conduct-rating-cell/);
  assert.match(source, /conduct-percent-input/);
  assert.match(source, /displayCode:\s*'N\/A'/);
  assert.match(source, /code: 'Sat'/);
  assert.match(source, /code: 'NI'/);
  assert.match(source, /code: 'U'/);
  assert.match(source, /js-report-action-requires-conduct/);
  assert.match(source, /Fill Reports<\/a>/);
  assert.match(source, /target="_blank" rel="noopener noreferrer" title="Open Fill Reports in a new tab"/);
  assert.match(source, /id="btnOpenConductBulkModal"/);
  assert.match(source, /id="conductBulkRatingModal"/);
  assert.match(source, /id="btnConductBulkSetAllSuperior"/);
  assert.match(source, /conduct-bulk-set-all-level/);
  assert.match(source, /conduct-bulk-column-emoji-btn/);
  assert.match(source, /conduct-scale-display/);
  assert.doesNotMatch(source, /conduct-scale-emoji/);
  assert.doesNotMatch(source, /conduct-set-all-level/);
  assert.doesNotMatch(source, /conduct-column-emoji-btn/);
  assert.match(source, /setConductColumnToLevel/);
  assert.match(source, /canManageConductRatingScaleFlag/);
  assert.match(source, /id="btnOpenConductScaleSettingsModal"/);
  assert.match(source, /id="conductScaleSettingsModal"/);
  assert.match(source, /window\.__conductRatingScale/);
  assert.match(source, /ready:\s*true/);
  assert.doesNotMatch(source, /saveOptionalSessionConduct/);
  assert.match(source, /resolveConductPrefillValue/);
  assert.match(source, /classEffortPercent !== undefined/);
  assert.match(source, /Assign a report to this session to unlock class conduct and report filling\./);
  assert.doesNotMatch(source, /You can still save optional conduct above anytime/);
});

test('report fill paths gate on session conduct readiness', () => {
  const matrixSource = read('packages/school/MVC/services/school/reportMatrixService.js');
  assert.match(matrixSource, /assertAssignmentSessionConductReadyOrThrow/);

  const reportController = read('packages/school/MVC/controllers/school/reportController.js');
  assert.match(reportController, /assertAssignmentSessionConductReadyOrThrow/);
  assert.match(reportController, /sessionConductService/);
});

test('sessionConductService marks ready on save and blocks until ready', async () => {
  const session = {
    sessionId: 'sess-1',
    roster: [{ personId: 'p1', classEffortPercent: 100 }]
  };
  assert.equal(sessionConductService.isSessionConductReady(session), false);
  assert.throws(
    () => sessionConductService.assertSessionConductReadyForReportsOrThrow(session),
    /Class conduct must be completed/
  );

  sessionConductService.applyConductRosterToSession(session, [{
    personId: 'p1',
    classEffortPercent: null,
    classParticipationPercent: 72,
    respectsTeachersPercent: 'N/A',
    respectsStudentsPercent: 54.5
  }], { ready: true, userId: 'u1' });

  assert.equal(session.conductReadyForReports, true);
  assert.equal(session.roster[0].classEffortPercent, null);
  assert.equal(session.roster[0].respectsTeachersPercent, null);
  assert.equal(session.roster[0].classParticipationPercent, 72);
  assert.ok(session.roster[0].conductSavedAt);
  assert.equal(sessionConductService.isSessionConductReady(session), true);

  const schoolDataService = {
    getClassSessions: async () => [session]
  };
  await assert.rejects(
    () => sessionConductService.assertAssignmentSessionConductReadyOrThrow({
      assignment: { classId: 'c1', sessionId: 'sess-1', targetType: 'session' },
      reqUser: {},
      schoolDataService: {
        getClassSessions: async () => [{ sessionId: 'sess-1', conductReadyForReports: false }]
      }
    }),
    /Class conduct must be completed/
  );
  await sessionConductService.assertAssignmentSessionConductReadyOrThrow({
    assignment: { classId: 'c1', sessionId: 'sess-1', targetType: 'session' },
    reqUser: {},
    schoolDataService
  });
  await sessionConductService.assertAssignmentSessionConductReadyOrThrow({
    assignment: { classId: 'c1', targetType: 'class' },
    reqUser: {},
    schoolDataService: { getClassSessions: async () => { throw new Error('should not load'); } }
  });
});

test('sessionConductService optional save updates selected students without ready flag', () => {
  const session = {
    sessionId: 'sess-1',
    roster: [
      { personId: 'p1', classEffortPercent: null },
      { personId: 'p2', classEffortPercent: null, classParticipationPercent: null }
    ]
  };

  sessionConductService.applyConductRosterToSession(session, [{
    personId: 'p1',
    classEffortPercent: 92.5,
    classParticipationPercent: 72,
    respectsTeachersPercent: null,
    respectsStudentsPercent: 54.5
  }], { ready: false, userId: 'u1' });

  assert.equal(session.conductReadyForReports, undefined);
  assert.equal(session.roster.find((row) => row.personId === 'p1').classEffortPercent, 92.5);
  assert.equal(session.roster.find((row) => row.personId === 'p2').classEffortPercent, null);
  assert.ok(session.roster.find((row) => row.personId === 'p1').conductSavedAt);
  assert.equal(sessionConductService.parseConductReadyFlag('false', true), false);
  assert.equal(sessionConductService.parseConductReadyFlag(undefined, true), true);
});

test('sessionConductService prefills from session or period ratings and defaults to N/A', () => {
  const currentSession = {
    sessionId: 'sess-2',
    date: '2026-02-10',
    roster: [
      { personId: 'p1', classEffortPercent: 92.5, conductSavedAt: '2026-02-10T12:00:00.000Z' },
      { personId: 'p2' },
      { personId: 'p3' }
    ]
  };
  const allSessions = [
    {
      sessionId: 'sess-1',
      date: '2026-02-01',
      roster: [{
        personId: 'p2',
        classEffortPercent: 72,
        classParticipationPercent: 72,
        respectsTeachersPercent: 72,
        respectsStudentsPercent: 72
      }]
    },
    currentSession
  ];

  const forP1 = sessionConductService.resolveConductPrefillForStudent({
    personId: 'p1',
    currentSession,
    allSessions,
    periodStart: '2026-02-01',
    periodDue: '2026-02-28'
  });
  assert.equal(forP1.source, 'session');
  assert.equal(forP1.classEffortPercent, 92.5);

  const forP2 = sessionConductService.resolveConductPrefillForStudent({
    personId: 'p2',
    currentSession,
    allSessions,
    periodStart: '2026-02-01',
    periodDue: '2026-02-28'
  });
  assert.equal(forP2.source, 'period');
  assert.equal(forP2.classEffortPercent, 72);

  const forP3 = sessionConductService.resolveConductPrefillForStudent({
    personId: 'p3',
    currentSession,
    allSessions,
    periodStart: '2026-02-01',
    periodDue: '2026-02-28'
  });
  assert.equal(forP3.source, 'default_na');
  assert.equal(forP3.classEffortPercent, null);
  assert.equal(forP3.classParticipationPercent, null);

  const period = sessionConductService.resolveReportPeriodForSession([{
    sessionId: 'sess-2',
    reportStartDate: '2026-02-01',
    reportDueDate: '2026-02-28'
  }], 'sess-2');
  assert.equal(period.startDate, '2026-02-01');
  assert.equal(period.dueDate, '2026-02-28');
});

test('reportService skips null/empty conduct percents in session rating rollups', () => {
  const source = read('packages/school/MVC/services/school/reportService.js');
  assert.match(source, /function buildStudentSessionRatingSummary/);
  assert.match(source, /normalizeSessionRatingPercent\(raw, null\)/);
  assert.match(source, /if \(value === null\) return;/);
  assert.match(source, /token === 'n\/a' \|\| token === 'na'/);
});

test('package manifest registers conductRatingScalePolicy entity', () => {
  const source = read('packages/school/package.manifest.json');
  assert.match(source, /"entityType": "conductRatingScalePolicy"/);
});
