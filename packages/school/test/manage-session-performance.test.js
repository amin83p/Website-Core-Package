const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const reportViewService = require('../MVC/services/school/reportViewService');

const reportViewServiceSource = fs.readFileSync(
  path.join(__dirname, '../MVC/services/school/reportViewService.js'),
  'utf8'
);

const sessionReportInstanceSource = fs.readFileSync(
  path.join(__dirname, '../MVC/services/school/sessionReportInstanceService.js'),
  'utf8'
);
const classControllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classController.js'),
  'utf8'
);
const outlineServiceSource = fs.readFileSync(
  path.join(__dirname, '../MVC/services/school/teachingOutlineSuggestionService.js'),
  'utf8'
);

test('buildSessionReportInstanceRows passes session and class filters to buildInstanceListRows', () => {
  assert.match(sessionReportInstanceSource, /sessionFilter:\s*cleanSessionId/);
  assert.match(sessionReportInstanceSource, /sessionDateFilter:\s*sessionDate/);
  assert.match(sessionReportInstanceSource, /classIds:\s*\[cleanClassId\]/);
  assert.match(sessionReportInstanceSource, /prefetchedStudents/);
  assert.match(sessionReportInstanceSource, /prefetchedClass/);
});

test('buildSessionReportViewerContext accepts prefetched students', () => {
  assert.match(sessionReportInstanceSource, /prefetchedStudents\s*=\s*null/);
  assert.match(
    sessionReportInstanceSource,
    /Array\.isArray\(prefetchedStudents\)\s*\?\s*prefetchedStudents\s*:\s*await schoolDataService\.fetchAllData\('students'/
  );
});

test('buildSessionRosterReconciliation passes scoped filters to buildInstanceListRows', () => {
  assert.match(sessionReportInstanceSource, /buildSessionRosterReconciliation[\s\S]*sessionFilter:\s*cleanSessionId/);
  assert.match(sessionReportInstanceSource, /buildSessionRosterReconciliation[\s\S]*classIds:\s*\[cleanClassId\]/);
});

test('reportViewService uses scoped load when session or class filters are present', () => {
  assert.match(reportViewServiceSource, /function shouldUseScopedReportListLoad/);
  assert.match(reportViewServiceSource, /instanceFilters\.sessionId/);
  assert.match(reportViewServiceSource, /instanceFilters\.classIds/);
  assert.equal(typeof reportViewService.loadReportListSourceData, 'function');
});

test('manageSession prefetches students, sessions, and enrollment periods once', () => {
  assert.match(classControllerSource, /function logManageSessionStep/);
  assert.match(classControllerSource, /enrollmentPeriodRows/);
  assert.match(classControllerSource, /prefetchedSessions:\s*sessions/);
  assert.match(classControllerSource, /prefetchedPeriodRows:\s*enrollmentPeriodRows/);
  assert.match(classControllerSource, /prefetchedStudents:\s*rosterIdentityData\.students/);
});

test('manageSession parallelizes independent context loading', () => {
  assert.match(classControllerSource, /parallel_context/);
  assert.match(classControllerSource, /reports_outline/);
  assert.match(
    classControllerSource,
    /Promise\.all\(\[[\s\S]*buildSessionReportViewerContext[\s\S]*loadSessionSkillPolicy/
  );
});

test('loadSessionOutlineContext accepts prefetched sessions', () => {
  assert.match(outlineServiceSource, /prefetchedSessions\s*=\s*null/);
  assert.match(
    outlineServiceSource,
    /Array\.isArray\(prefetchedSessions\)\s*\?\s*Promise\.resolve\(prefetchedSessions\)/
  );
});
