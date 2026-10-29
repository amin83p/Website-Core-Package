const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportHubView = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'views', 'school', 'reportHub.ejs'),
  'utf8'
);

test('student progress print uses dedicated print root and document builder', () => {
  assert.match(reportHubView, /function renderStudentProgressPrintDocument\(/);
  assert.match(reportHubView, /hubStudentProgressPrintRoot/);
  assert.match(reportHubView, /hub-print-student-progress/);
  assert.match(reportHubView, /function printStudentProgressHub\(/);
});

test('student progress print includes punctuality table and period donut', () => {
  assert.match(reportHubView, /function renderStudentProgressPrintClassTable\(/);
  assert.match(reportHubView, /Period punctuality/);
  assert.match(reportHubView, /renderStudentProgressPunctualityWeekBar/);
});

test('student progress analytics includes punctuality chart metric', () => {
  assert.match(reportHubView, /chartCard\('punctuality', 'Punctuality'\)/);
  assert.match(reportHubView, /metric === 'punctuality'/);
});

test('student progress results toolbar matches weekly reports share and view layout', () => {
  assert.match(reportHubView, /function renderStudentProgressResultsToolbar\(/);
  assert.match(reportHubView, /hub-weekly-reports-toolbar/);
  assert.match(reportHubView, /data-hub-student-progress-share/);
  assert.match(reportHubView, /data-hub-student-progress-view="analytics"/);
  assert.match(reportHubView, /let hubStudentProgressViewMode = 'analytics'/);
});

test('student progress results render with each student section collapsed by default', () => {
  assert.match(
    reportHubView,
    /hub-student-progress-student-title[\s\S]*aria-expanded="false"[\s\S]*bi-chevron-down hub-student-progress-chevron[\s\S]*hub-student-progress-student-body d-none/
  );
});
