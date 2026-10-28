const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportHubView = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'views', 'school', 'reportHub.ejs'),
  'utf8'
);

test('weekly reports print uses dedicated document and teacher pages', () => {
  assert.match(reportHubView, /function renderWeeklyReportsPrintDocument\(/);
  assert.match(reportHubView, /hub-wr-print-teacher-page/);
  assert.match(reportHubView, /hubWeeklyReportsPrintRoot/);
  assert.match(reportHubView, /hub-print-weekly-reports/);
});

test('weekly reports print supports student documents', () => {
  assert.match(reportHubView, /function renderWeeklyReportsPrintStudentDocument\(/);
  assert.match(reportHubView, /hub-wr-print-student-page/);
  assert.match(reportHubView, /Weekly Reports — Students/);
  assert.doesNotMatch(reportHubView, /student print coming later/i);
});

test('weekly reports student print scopes rows by detail and list filters', () => {
  assert.match(reportHubView, /function resolveWeeklyReportsPrintStudentRows\(/);
  assert.match(reportHubView, /hubWeeklyReportsState\.studentDetailId/);
  assert.match(reportHubView, /filterWeeklyReportsStudentsWithSessions/);
  assert.match(reportHubView, /level === 'students'/);
  assert.match(reportHubView, /renderWeeklyReportsPrintStudentDocument\(printRows\)/);
});

test('weekly reports student list print uses summary table with engagement and activity', () => {
  assert.match(reportHubView, /function renderWeeklyReportsPrintStudentListTable\(/);
  assert.match(reportHubView, /hub-wr-print-student-list-table/);
  assert.match(reportHubView, /listCompact: true/);
  assert.match(reportHubView, /printList: true/);
  assert.match(reportHubView, /hub-wr-student-skill-block--print-list/);
  assert.match(reportHubView, /hub-wr-print-student-list-engagement-ring/);
});

test('weekly reports student print includes punctuality column and donut', () => {
  assert.match(reportHubView, /renderWeeklyReportsPunctualityCell/);
  assert.match(reportHubView, /punctuality\.punctualityPercent/);
  assert.match(reportHubView, /hub-wr-print-punctuality-ring/);
});

test('weekly reports student detail print uses card, cases, and horizontal sessions', () => {
  assert.match(reportHubView, /function renderWeeklyReportsPrintStudentDetailCard\(/);
  assert.match(reportHubView, /weeklyReportsPrintStudentDetailMode/);
  assert.match(reportHubView, /renderWeeklyReportsPrintStudentCasesInlineSection/);
  assert.match(reportHubView, /renderWeeklyReportsPrintStudentSessionsHorizontal\(row, \{ detail: true \}\)/);
  assert.match(reportHubView, /renderWeeklyReportsPrintStudentSummaryStats\(row\)/);
  assert.match(reportHubView, /printDetail: true/);
  assert.match(reportHubView, /hub-wr-student-skill-block--print-detail/);
});

test('weekly reports print supports static metric cells', () => {
  assert.match(reportHubView, /renderWeeklyReportsOperationalMetricCells\(row, \{ print: true \}\)/);
  assert.match(reportHubView, /function renderWeeklyReportsClassMetricsTableHead\(/);
});

test('weekly reports print shows wait feedback while engagement loads', () => {
  assert.match(reportHubView, /hubWeeklyReportsPrintInProgress/);
  assert.match(reportHubView, /Please wait while class engagement finishes loading/i);
  assert.match(reportHubView, /setWeeklyReportsPrintButtonsBusy/);
});

test('weekly reports print hides global loading overlay from print output', () => {
  assert.match(reportHubView, /body\.hub-print-weekly-reports > \*:not\(#hubWeeklyReportsPrintRoot\)/);
  assert.match(reportHubView, /window\.scrollTo\(0, 0\)/);
  assert.doesNotMatch(reportHubView, /showLoading\(engagementPending/);
});

test('weekly reports print uses dedicated teacher summary and class title engagement', () => {
  assert.match(reportHubView, /renderWeeklyReportsPrintTeacherSummaryStats/);
  assert.match(reportHubView, /hub-wr-print-stat-card--hero/);
  assert.match(reportHubView, /renderWeeklyReportsPrintClassTitleRow/);
  assert.match(reportHubView, /formatWeeklyReportsPrintInteger/);
  assert.match(reportHubView, /renderWeeklyReportsPrintHeroStatCard\('Classes'/);
  assert.match(reportHubView, /renderWeeklyReportsPrintHeroStatCard\('Sessions'/);
  assert.match(reportHubView, /renderWeeklyReportsPrintHeroStatCard\('Hours'/);
});

test('weekly reports print includes teacher cases appendix page', () => {
  assert.match(reportHubView, /function renderWeeklyReportsPrintTeacherCasesPage\(/);
  assert.match(reportHubView, /hub-wr-print-teacher-cases-page/);
  assert.match(reportHubView, /studentCaseItems/);
  assert.match(reportHubView, /\.hub-wr-print-doc > \*:last-child/);
});
