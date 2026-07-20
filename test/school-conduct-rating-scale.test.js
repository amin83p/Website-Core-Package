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
  assert.match(source, /conductReadyForReports:\s*true/);
});

test('session manager places letter conduct in report flow and removes standalone conduct panel', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.doesNotMatch(source, /data-session-panel="conduct"/);
  assert.doesNotMatch(source, /id="session-panel-conduct"/);
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
  assert.match(source, /classEffortPercent: readConductRating\(conductRow, '\.conduct-class-effort'\)/);
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
