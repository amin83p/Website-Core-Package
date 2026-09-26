const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../MVC/controllers/school/timesheetController.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');

test('returnTimesheet reconciles activity locks after persisting draft status', () => {
  const returnBlock = controllerSource.slice(
    controllerSource.indexOf('exports.returnTimesheet'),
    controllerSource.indexOf('exports.reopenTimesheet')
  );
  const updateIdx = returnBlock.indexOf('await dataService.updateData(\'timesheets\'');
  const reconcileIdx = returnBlock.indexOf('reconcileActivityEntriesForTimesheetRefs');
  assert.ok(updateIdx >= 0 && reconcileIdx > updateIdx, 'reconcile must run after draft save');
  assert.doesNotMatch(
    returnBlock.slice(0, updateIdx),
    /reconcileActivityEntriesForTimesheetRefs[\s\S]*await dataService\.updateData\('timesheets'/
  );
});

test('returnTimesheet drops auto activity rows covered by manual rows', () => {
  assert.match(controllerSource, /dropAutoActivityEntriesCoveredByManualRows\(restoredEntries\)/);
  assert.match(controllerSource, /filterLiveSessionsCoveredByManualTimesheetRows/);
});

test('author submit preserves manager-approved manual activity rows', () => {
  assert.match(controllerSource, /resolveManualActivityPaidApprovalStatus/);
  assert.doesNotMatch(
    controllerSource,
    /activityPaid \? \(reviewerEdit \? \(manualApproval \|\| 'pending_approval'\) : 'pending_approval'\)/
  );
});
