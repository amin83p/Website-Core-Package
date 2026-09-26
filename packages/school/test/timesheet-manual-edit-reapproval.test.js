const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../MVC/controllers/school/timesheetController.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');

test('author save dematerializes approved manual rows that return to pending approval', () => {
  assert.match(controllerSource, /dematerializeApprovedManualRowsPendingReapproval/);
  assert.match(controllerSource, /revertMaterializedActivityManualEntry/);
  const saveBlock = controllerSource.slice(
    controllerSource.indexOf('exports.saveTimesheet'),
    controllerSource.indexOf('exports.validateManualTimesheetRow')
  );
  assert.match(saveBlock, /dematerializeApprovedManualRowsPendingReapproval\([\s\S]*?revertMaterializedActivityManualEntry/);
});

test('author pending approval is not overridden by prior approved status', () => {
  assert.match(
    controllerSource,
    /if \(fromEntry === 'pending_approval'\) return 'pending_approval';[\s\S]*if \(fromEntry === 'approved' \|\| fromPrior === 'approved'\) return 'approved';/
  );
});

test('author save preserves materialized activity entry id for approved individual manual rows', () => {
  assert.match(controllerSource, /resolveManualRowActivityEntryId/);
  assert.match(controllerSource, /carryMaterializedManualFields/);
});
