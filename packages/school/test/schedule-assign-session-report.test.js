'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const pkgRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(pkgRoot, relativePath), 'utf8');
}

test('admin schedule wires assign-report modals and scripts', () => {
  const adminView = read('MVC/views/school/schedule/personScheduleAdmin.ejs');
  const selfView = read('MVC/views/school/schedule/personScheduleSelf.ejs');
  const menu = read('MVC/views/school/schedule/partials/personScheduleSessionContextMenuAdmin.ejs');
  const scripts = read('MVC/views/school/schedule/partials/personScheduleScriptsAdmin.ejs');
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const assignScript = read('public/scripts/masterScheduleAssignReport.js');

  assert.match(adminView, /sessionReportAssignmentModals/);
  assert.match(scripts, /sessionReportAssignmentClient\.js/);
  assert.match(scripts, /masterScheduleAssignReport\.js/);
  assert.match(menu, /btn_scheduleSessionContextAssignReport/);
  assert.match(viewer, /canAssignSessionReports/);
  assert.match(viewer, /installMasterScheduleAssignReport/);
  assert.match(viewer, /btn_scheduleSessionContextAssignReport/);
  assert.match(assignScript, /applyScheduleSessionChangesInView/);
  assert.match(assignScript, /upsertRefs/);

  assert.doesNotMatch(selfView, /sessionReportAssignmentModals/);
  assert.doesNotMatch(selfView, /masterScheduleAssignReport\.js/);
});

test('sessionReportAssignmentClient normalizes template scopes', () => {
  const {
    normalizeSessionReportTemplateScopes,
    isSessionReportStudentScoped,
    filterActiveReportTemplates,
    buildExistingReportDisplayRows
  } = require('../public/scripts/sessionReportAssignmentClient.js');

  assert.deepEqual(
    normalizeSessionReportTemplateScopes(['each_student', 'class', 'bogus']),
    ['class', 'each_student']
  );
  assert.equal(isSessionReportStudentScoped('each_student'), true);
  assert.equal(isSessionReportStudentScoped('class'), false);
  assert.equal(filterActiveReportTemplates([
    { id: 'A', status: 'active' },
    { id: 'B', status: 'draft' }
  ]).length, 1);
  const rows = buildExistingReportDisplayRows({
    instanceRows: [{ templateTitle: 'Progress', studentName: 'Sam', statusLabel: 'draft' }],
    embeddedReports: [{ title: 'Progress', start: '09:00', end: '10:00' }]
  });
  assert.ok(rows.length >= 1);
});

test('assign report modal uses template dropdown markup', () => {
  const partial = read('MVC/views/school/report/partials/sessionReportAssignmentModals.ejs');
  assert.match(partial, /id="sessionReportTemplateId"/);
  assert.match(partial, /<select[^>]+id="sessionReportTemplateId"/);
  assert.match(partial, /sessionReportExistingReportsSection/);
  assert.doesNotMatch(partial, /btnPickSessionReportTemplate/);
});
