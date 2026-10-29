'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reportHubView = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'views', 'school', 'reportHub.ejs'),
  'utf8'
);

test('weekly reports board defines attendance pie chart helpers', () => {
  assert.match(reportHubView, /function buildWeeklyReportsTwoSlicePieSvg\(/);
  assert.match(reportHubView, /function renderWeeklyReportsBoardAttendancePieRow\(/);
  assert.match(reportHubView, /function renderWeeklyReportsAttendancePieColumn\(/);
  assert.match(reportHubView, /function refreshWeeklyReportsAbsencePresencePies\(/);
});

test('weekly reports class board attendance section uses pie row with three charts', () => {
  assert.match(reportHubView, /renderWeeklyReportsBoardAttendancePieRow\(classId, m\.attendance\)/);
  assert.match(reportHubView, /hub-wr-deck-metric-section-pie-row/);
  assert.match(reportHubView, /hub-wr-deck-metric-section-pie-cols/);
  assert.match(reportHubView, /renderWeeklyReportsAttendancePieColumn\('Occurrences'/);
  assert.match(reportHubView, /renderWeeklyReportsAttendancePieColumn\('Minutes'/);
  assert.match(reportHubView, /renderWeeklyReportsAbsencePresencePieColumn\(/);
  assert.match(reportHubView, /data-hub-wr-attendance-pie="absence-presence"/);
  assert.match(reportHubView, /Abs vs presence/);
  assert.match(reportHubView, /No late or early leave/);
});
