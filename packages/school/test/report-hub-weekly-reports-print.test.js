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

test('weekly reports print guards student level', () => {
  assert.match(reportHubView, /hubWeeklyReportsState\.level !== 'classes'/);
  assert.match(reportHubView, /student print coming later/i);
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
  assert.match(reportHubView, /hub-print-weekly-reports #globalLoadingModal/);
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
