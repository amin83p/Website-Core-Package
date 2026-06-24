const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('master academia hub exposes timesheet periods near attendance', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const attendanceIndex = viewSource.indexOf('data-hub-workspace-section="attendance"');
  const timesheetIndex = viewSource.indexOf('data-hub-workspace-section="timesheet-periods"');
  const leaveIndex = viewSource.indexOf('data-hub-workspace-section="leave-requests"');

  assert.notEqual(attendanceIndex, -1);
  assert.notEqual(timesheetIndex, -1);
  assert.notEqual(leaveIndex, -1);
  assert.ok(attendanceIndex < timesheetIndex, 'Timesheet Periods should follow Attendance.');
  assert.ok(timesheetIndex < leaveIndex, 'Timesheet Periods should appear before Leave Requests.');
  assert.match(viewSource, /Timesheet Periods/);
  assert.match(viewSource, /bi bi-calendar-week-fill/);
});

test('master academia hub timesheet periods workspace has filters and endpoint wiring', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /endpoint:\s*'\/school\/master-hub\/api\/workspace\/timesheet-periods'/);
  assert.match(viewSource, /function appendTimesheetPeriodWorkspaceQuery\(requestQuery\)/);
  assert.match(viewSource, /renderTimesheetPeriodWorkspace\(payload\)/);
  assert.match(viewSource, /function renderTimesheetPeriodRows\(rows,\s*notLoaded\)/);
  assert.match(viewSource, /workspaceToolbarHtml\('timesheet-periods',\s*\{ label: 'timesheet periods' \}\)/);
  assert.match(viewSource, /hubTimesheetPeriodStatus/);
  assert.match(viewSource, /hubTimesheetPeriodStartDate/);
  assert.match(viewSource, /hubTimesheetPeriodEndDate/);
  assert.match(viewSource, /hubTimesheetPeriodDeadlineStartDate/);
  assert.match(viewSource, /hubTimesheetPeriodDeadlineEndDate/);
  assert.match(viewSource, /data-hub-timesheet-period-range=\"activeToday\"/);
  assert.match(viewSource, /data-hub-timesheet-period-range=\"thisMonth\"/);
  assert.match(viewSource, /data-hub-timesheet-period-range=\"upcoming\"/);
  assert.match(viewSource, /data-hub-timesheet-period-range=\"allTime\"/);
  assert.match(viewSource, /\/school\/timesheetPeriods\/new/);
  assert.match(viewSource, /formatHubTimesheetDeadline/);
});

test('master academia hub timesheet periods workspace is access scoped and data backed', () => {
  const routeSource = read('packages/school/MVC/routes/schoolMasterAcademiaHubRoutes.js');
  const serviceSource = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(routeSource, /SECTIONS\.SCHOOL_TIMESHEET_PERIODS/);
  assert.match(serviceSource, /key === 'timesheet-periods'/);
  assert.match(serviceSource, /sectionId:\s*SECTIONS\.SCHOOL_TIMESHEET_PERIODS/);
  assert.match(serviceSource, /dataService\.fetchData\('timesheetPeriods'/);
  assert.match(serviceSource, /normalizeTimesheetPeriodRows\(rows\)/);
  assert.match(serviceSource, /timesheetPeriodMatchesFilters/);
  assert.match(serviceSource, /submissionDeadlineTime/);
  assert.match(serviceSource, /\/school\/timesheetPeriods\/edit\/\$\{encodedId\}/);
  assert.match(serviceSource, /\/school\/timesheetPeriods\/delete\/\$\{encodedId\}/);
});