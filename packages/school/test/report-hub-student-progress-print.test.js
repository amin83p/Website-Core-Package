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
