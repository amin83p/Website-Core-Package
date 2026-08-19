const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const classControllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classController.js'),
  'utf8'
);
const sessionManagerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

test('manageSession allows session editors to manage class conduct', () => {
  assert.match(classControllerSource, /canManageClassConduct:\s*Boolean\(canOverride\)\s*\|\|\s*Boolean\(canEditSession\)/);
  assert.match(classControllerSource, /canEditSessionForConduct/);
  assert.doesNotMatch(classControllerSource, /Only class administrators can manage class conduct/);
});

test('manageSession resolves report assignment conduct from matched target rows', () => {
  assert.match(classControllerSource, /sessionMatchedAssignments\.some/);
  assert.match(classControllerSource, /assignmentRowId: targetRow\?\.rowId/);
  assert.match(classControllerSource, /hasSessionReportsAssigned/);
});

test('sessionManager shows optional class conduct panel only for admins', () => {
  assert.match(sessionManagerSource, /canViewClassConductPanelFlag/);
  assert.match(sessionManagerSource, /session-panel-conduct[\s\S]*canViewClassConductPanelFlag/);
});

test('sessionManager keeps report quick-rate conduct for session editors', () => {
  assert.match(sessionManagerSource, /canManageReportClassConductFlag/);
  assert.match(sessionManagerSource, /sessionHasConductRequiredReportsResolved && canManageReportClassConductFlag/);
  assert.match(sessionManagerSource, /btnOpenConductBulkModal/);
});
