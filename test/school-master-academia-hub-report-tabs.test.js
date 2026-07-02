const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('master academia hub shows report assignment and instance section buttons', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const reportAssignmentsIndex = viewSource.indexOf('data-hub-workspace-section="report-assignments"');
  const reportInstancesIndex = viewSource.indexOf('data-hub-workspace-section="report-instances"');
  const leaveIndex = viewSource.indexOf('data-hub-workspace-section="leave-requests"');

  assert.notEqual(reportAssignmentsIndex, -1);
  assert.notEqual(reportInstancesIndex, -1);
  assert.notEqual(leaveIndex, -1);
  assert.ok(reportAssignmentsIndex < reportInstancesIndex, 'Report Assignments should appear before Report Instances.');
  assert.ok(reportInstancesIndex < leaveIndex, 'Report Instances should appear before Leave Requests.');
  assert.match(viewSource, /Report Assignments/);
  assert.match(viewSource, /Report Instances/);
  assert.match(viewSource, /bi bi-clipboard2-check-fill/);
  assert.match(viewSource, /bi bi-file-earmark-text-fill/);
});

test('master academia hub client wiring includes report workspace config and render paths', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /'report-assignments':\s*''/);
  assert.match(viewSource, /'report-instances':\s*''/);
  assert.match(viewSource, /endpoint:\s*'\/school\/master-hub\/api\/workspace\/report-assignments'/);
  assert.match(viewSource, /endpoint:\s*'\/school\/master-hub\/api\/workspace\/report-instances'/);
  assert.match(viewSource, /sourceUrl:\s*'\/school\/reports\/assignments'/);
  assert.match(viewSource, /sourceUrl:\s*'\/school\/reports\/instances'/);
  assert.match(viewSource, /renderReportAssignmentWorkspace\(payload\)/);
  assert.match(viewSource, /renderReportInstanceWorkspace\(payload\)/);
  assert.match(viewSource, /function renderReportAssignmentWorkspace\(payload\)/);
  assert.match(viewSource, /function renderReportInstanceWorkspace\(payload\)/);
  assert.match(viewSource, /function appendReportAssignmentWorkspaceQuery\(requestQuery\)/);
  assert.match(viewSource, /function bindReportAssignmentWorkspaceControls\(\)/);
  assert.match(viewSource, /hubReportAssignmentTeacherPersonId/);
  assert.match(viewSource, /hubReportAssignmentClassIds/);
  assert.match(viewSource, /hubReportAssignmentScope/);
  assert.match(viewSource, /reportScope/);
  assert.match(viewSource, /teacherPersonId/);
  assert.match(viewSource, /classIds/);
  assert.match(viewSource, /loadWorkspaceSection\('report-assignments'\)/);
  assert.match(viewSource, /loadWorkspaceSection\('report-instances'\)/);
  assert.match(viewSource, /key:\s*'report-assignments'/);
  assert.match(viewSource, /key:\s*'report-instances'/);
});

test('master academia hub service and routes expose report workspace branches with access gating', () => {
  const routeSource = read('packages/school/MVC/routes/schoolMasterAcademiaHubRoutes.js');
  const serviceSource = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(routeSource, /SECTIONS\.SCHOOL_REPORTS_ASSIGNMENT/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_REPORTS_INSTANCES/);
  assert.match(serviceSource, /key === 'report-assignments'/);
  assert.match(serviceSource, /sectionId:\s*SECTIONS\.SCHOOL_REPORTS_ASSIGNMENT/);
  assert.match(serviceSource, /buildAssignmentListContext/);
  assert.match(serviceSource, /normalizeReportAssignmentRows/);
  assert.match(serviceSource, /teacherPersonId/);
  assert.match(serviceSource, /reportScope/);
  assert.match(serviceSource, /classIds/);
  assert.match(serviceSource, /filters:\s*\{/);
  assert.match(serviceSource, /sourceUrl:\s*'\/school\/reports\/assignments'/);
  assert.match(serviceSource, /key === 'report-instances'/);
  assert.match(serviceSource, /sectionId:\s*SECTIONS\.SCHOOL_REPORTS_INSTANCES/);
  assert.match(serviceSource, /buildInstanceListRows/);
  assert.match(serviceSource, /normalizeReportInstanceRows/);
  assert.match(serviceSource, /sourceUrl:\s*'\/school\/reports\/instances'/);
});
