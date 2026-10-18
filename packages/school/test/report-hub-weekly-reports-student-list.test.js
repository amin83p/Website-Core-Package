const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportHubView = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'views', 'school', 'reportHub.ejs'),
  'utf8'
);

test('weekly reports student list includes engagement and attendance columns', () => {
  assert.match(reportHubView, /function renderWeeklyReportsStudentEngagementRing\(/);
  assert.match(reportHubView, /hub-wr-attendance-excused/);
  assert.match(reportHubView, /renderWeeklyReportsStudentSkillsVisual/);
  assert.match(reportHubView, /studentClassContext\.showAcfColumn/);
  assert.match(reportHubView, /openWeeklyReportsStudentCasesDrilldown/);
});
