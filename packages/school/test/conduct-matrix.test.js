'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('conductMatrixRoutes mounts under school main routes', () => {
  const src = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(src, /conduct-matrix/);
  assert.match(src, /conductMatrixRoutes/);
});

test('report routes redirect legacy conduct matrix URL', () => {
  const src = read('packages/school/MVC/routes/reportRoutes.js');
  assert.match(src, /\/school\/conduct-matrix/);
  assert.doesNotMatch(src, /require\('\.\/conductMatrixRoutes'\)/);
});

test('conductMatrixRoutes uses SCHOOL_CLASS_CONDUCT_MATRIX access', () => {
  const src = read('packages/school/MVC/routes/conductMatrixRoutes.js');
  assert.match(src, /SECTIONS\.SCHOOL_CLASS_CONDUCT_MATRIX/);
  assert.match(src, /OPERATIONS\.READ_ALL/);
  assert.match(src, /api\/session-visibility/);
  assert.match(src, /OPERATIONS\.UPDATE/);
  assert.match(src, /allowOperationTokenFallback/);
  assert.match(src, /\/assignment-wizard\/preview/);
});

test('conductMatrixService exports buildConductMatrixPayload', () => {
  const service = require('../MVC/services/school/conductMatrixService');
  assert.equal(typeof service.buildConductMatrixPayload, 'function');
  assert.equal(typeof service.buildCellFromRosterRow, 'function');
});

test('buildCellFromRosterRow returns null without rated conduct', () => {
  const service = require('../MVC/services/school/conductMatrixService');
  const empty = service.buildCellFromRosterRow({ personId: 'p1' }, { levels: [] });
  assert.equal(empty, null);
});

test('buildCellFromRosterRow returns summary when percents saved', () => {
  const service = require('../MVC/services/school/conductMatrixService');
  const cell = service.buildCellFromRosterRow({
    personId: 'p1',
    classEffortPercent: 92.5,
    classParticipationPercent: 72,
    respectsTeachersPercent: 92.5,
    respectsStudentsPercent: 54.5,
    conductSavedAt: '2026-01-01T00:00:00.000Z'
  }, {
    levels: [
      { code: 'S', label: 'Superior', displayCode: 'S', minPercent: 85, maxPercent: 100, defaultPercent: 92.5 },
      { code: 'Sat', label: 'Satisfactory', displayCode: 'Sat', minPercent: 60, maxPercent: 84, defaultPercent: 72 },
      { code: 'NI', label: 'Needs Improvement', displayCode: 'NI', minPercent: 50, maxPercent: 59, defaultPercent: 54.5 },
      { code: 'U', label: 'Unsatisfactory', displayCode: 'U', minPercent: 0, maxPercent: 49, defaultPercent: 24.5 }
    ]
  });
  assert.ok(cell);
  assert.match(cell.summary, /\//);
});

test('gradesMatrixController exports loadGradesMatrixSharedContext', () => {
  const ctrl = require('../MVC/controllers/school/gradesMatrixController');
  assert.equal(typeof ctrl.loadGradesMatrixSharedContext, 'function');
});

test('conduct matrix view and client assets exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/report/conductMatrix.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/public/scripts/conductMatrixClient.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/public/scripts/conductRatingCell.js')));
});

test('conduct matrix print button and preview helpers', () => {
  const view = read('packages/school/MVC/views/school/report/conductMatrix.ejs');
  const client = read('packages/school/public/scripts/conductMatrixClient.js');
  const controller = read('packages/school/MVC/controllers/school/conductMatrixController.js');
  assert.match(view, /optionalBtnsBeforePrint/);
  assert.match(view, /btn_printConductMatrix/);
  assert.match(client, /function buildConductPrintDocument/);
  assert.match(client, /function openConductPrint/);
  assert.match(client, /function setConductPrintEnabled/);
  assert.match(client, /conduct-matrix/);
  assert.match(client, /promptLoadConductMatrixFromUrlLink/);
  assert.doesNotMatch(client, /if \(INITIAL\.classId\) loadMatrix\(\)/);
  assert.match(client, /bindConductMatrixDateRangeShortcuts/);
  assert.match(view, /schoolMatrixExpandedView\.js/);
  assert.match(client, /btn_cmExpandMatrixView/);
  assert.match(client, /cmMatrixResultActions/);
  assert.doesNotMatch(client, /cm-range/);
  assert.match(controller, /includePrintManager:\s*true/);
});

test('sessionConductService exposes conduct report step helpers', () => {
  const sessionConductService = require('../MVC/services/school/sessionConductService');
  assert.equal(typeof sessionConductService.parseConductReportStepEnabled, 'function');
  assert.equal(typeof sessionConductService.sessionShowsReportConductStep, 'function');
  assert.equal(sessionConductService.parseConductReportStepEnabled({ conductReportStepEnabled: true }), true);
  assert.equal(
    sessionConductService.sessionShowsReportConductStep({ conductReportStepEnabled: true }, false),
    true
  );
});

test('buildSessionReportConductUiPayload serves opt-in report conduct roster', async () => {
  const sessionConductService = require('../MVC/services/school/sessionConductService');
  const payload = await sessionConductService.buildSessionReportConductUiPayload({
    session: { sessionId: 's1', conductReportStepEnabled: true, roster: [{ personId: 'p1', name: 'Student A' }] },
    sessions: [{ sessionId: 's1', roster: [{ personId: 'p1', name: 'Student A' }] }],
    sessionRoster: [{ personId: 'p1', name: 'Student A' }],
    assignmentMap: [],
    instanceRows: [],
    sessionId: 's1',
    classId: 'c1'
  });
  assert.equal(payload.sessionHasConductRequiredReports, true);
  assert.equal(payload.conductRequiredByAssignment, false);
  assert.equal(payload.conductReportStepEnabled, true);
  assert.equal(payload.reportConductRoster.length, 1);
  assert.equal(payload.reportConductRoster[0].personId, 'p1');
});

test('school dashboard links Class Conduct Matrix under academia URL', () => {
  const src = read('packages/school/MVC/controllers/school/schoolDashboardController.js');
  assert.match(src, /Class Conduct Matrix/);
  assert.match(src, /\/school\/conduct-matrix/);
  assert.match(src, /SCHOOL_CLASS_CONDUCT_MATRIX/);
});
