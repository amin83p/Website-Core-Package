const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW_PATH = path.join(ROOT, 'packages/school/MVC/views/school/activity/activityWorkSessionManager.ejs');

test('activity work session manager view uses session manager roster table and radio controls', () => {
  const source = fs.readFileSync(VIEW_PATH, 'utf8');

  assert.match(source, /session-manager-page-header/);
  assert.match(source, /id="workSessionAssigneeTable"/);
  assert.match(source, /class="roster-row work-session-assignee-form/);
  assert.match(source, /ws-role-radio/);
  assert.match(source, /ws-completion-radio/);
  assert.match(source, /ws-assignee-lock-icon/);
  assert.match(source, /Locked because timesheet was submitted/);
  assert.match(source, /Work Session Locked/);
  assert.match(source, /allVisibleAssigneesLocked/);
  assert.match(source, /btnWsAllAttended/);
  assert.match(source, /buildAdminAssigneeRow/);
  assert.match(source, /buildRoleRadios/);
  assert.match(source, /buildCompletionRadios/);

  assert.doesNotMatch(source, /ws-role-input/);
  assert.doesNotMatch(source, /ws-completion-status-input/);
  assert.doesNotMatch(source, /Evaluation type is locked/);
  assert.doesNotMatch(source, /btn-ws-pending/);
  assert.doesNotMatch(source, /buildAdminAssigneeCard/);
  assert.doesNotMatch(source, /id="workSessionAssigneeForms"/);
});
