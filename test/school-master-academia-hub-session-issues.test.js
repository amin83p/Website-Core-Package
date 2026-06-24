const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('master academia hub exposes session issues between sessions and schedule', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const sessionsIndex = viewSource.indexOf('data-hub-workspace-section="sessions"');
  const issuesIndex = viewSource.indexOf('data-hub-workspace-section="session-issues"');
  const scheduleIndex = viewSource.indexOf('data-hub-workspace-section="schedule"');

  assert.notEqual(sessionsIndex, -1);
  assert.notEqual(issuesIndex, -1);
  assert.notEqual(scheduleIndex, -1);
  assert.ok(sessionsIndex < issuesIndex, 'Session Issues should follow Sessions.');
  assert.ok(issuesIndex < scheduleIndex, 'Session Issues should appear before Schedule.');
  assert.match(viewSource, /Session Issues/);
  assert.match(viewSource, /bi bi-exclamation-triangle-fill/);
});

test('master academia hub session issues workspace has filters and endpoint wiring', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /endpoint:\s*'\/school\/master-hub\/api\/workspace\/session-issues'/);
  assert.match(viewSource, /function appendSessionIssueWorkspaceQuery\(requestQuery\)/);
  assert.match(viewSource, /requestQuery\.set\(key, values\[key\]\)/);
  assert.match(viewSource, /hubSessionIssueSeverity/);
  assert.match(viewSource, /hubSessionIssueCategory/);
  assert.match(viewSource, /hubSessionIssueStatusGroup/);
  assert.match(viewSource, /hubSessionIssueClassId/);
  assert.match(viewSource, /hubSessionIssueTeacherId/);
  assert.match(viewSource, /hubSessionIssueStudentId/);
  assert.match(viewSource, /hubSessionIssueOpenStudentPicker/);
  assert.match(viewSource, /openHubSessionIssueStudentPicker/);
  assert.match(viewSource, /data-hub-session-issue-range="last7"/);
  assert.match(viewSource, /function renderSessionIssueWorkspace\(payload\)/);
  assert.match(viewSource, /renderSessionIssueWorkspace\(payload\)/);
});

test('master academia hub service returns scoped session issue rows', () => {
  const routeSource = read('packages/school/MVC/routes/schoolMasterAcademiaHubRoutes.js');
  const serviceSource = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(routeSource, /SECTIONS\.SCHOOL_SESSIONS/);
  assert.match(serviceSource, /key === 'session-issues'/);
  assert.match(serviceSource, /sectionId:\s*SECTIONS\.SCHOOL_SESSIONS/);
  assert.match(serviceSource, /schoolRepositories\.sessionStudentCases\.list/);
  assert.match(serviceSource, /statusGroup === 'open'[\s\S]*open[\s\S]*in_progress[\s\S]*reopened/);
  assert.match(serviceSource, /statusGroup === 'resolved'[\s\S]*resolved[\s\S]*cancelled/);
  assert.match(serviceSource, /scope:\s*\{ activeOrgId: getHubActiveOrgId\(req\.user\) \}/);
  assert.match(serviceSource, /sessionIssueMatchesFilters/);
  assert.match(serviceSource, /studentIds = splitFilterIds/);
  assert.match(serviceSource, /studentIds\.length[\s\S]*studentPersonId/);
  assert.match(serviceSource, /CASE_SEVERITIES/);
  assert.match(serviceSource, /CASE_CATEGORIES/);
  assert.match(serviceSource, /caseId=\$\{encodeURIComponent\(caseId\)\}/);
});

test('session manager auto-opens requested student case from caseId query', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');

  assert.match(source, /new URLSearchParams\(window\.location\.search \|\| ''\)\.get\('caseId'\)/);
  assert.match(source, /function openRequestedStudentCaseFromUrl\(\)/);
  assert.match(source, /setActivePanel\('student-cases'\)/);
  assert.match(source, /openStudentCaseModal\(\{ caseRow: row \}\)/);
  assert.match(source, /Case Not Found/);
});
