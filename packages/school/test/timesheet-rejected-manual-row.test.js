const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetManualMaterializationService = require('../MVC/services/school/timesheetManualMaterializationService');
const timesheetManualConflictService = require('../MVC/services/school/timesheetManualConflictService');

const controllerPath = path.join(__dirname, '../MVC/controllers/school/timesheetController.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const editorPath = path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs');
const editorSource = fs.readFileSync(editorPath, 'utf8');

test('isPersistedRejectedManualActivityRow identifies rejected paid activity manual rows', () => {
  assert.equal(timesheetManualMaterializationService.isPersistedRejectedManualActivityRow({
    isManual: true,
    activityPaid: true,
    activityId: 'ACT/1',
    approvalStatus: 'rejected'
  }), true);
  assert.equal(timesheetManualMaterializationService.isPersistedRejectedManualActivityRow({
    isManual: true,
    activityPaid: true,
    activityId: 'ACT/1',
    approvalStatus: 'pending_approval'
  }), false);
});

test('returnTimesheet preserves rejected manual rows with decision metadata', () => {
  const returnBlock = controllerSource.slice(
    controllerSource.indexOf('exports.returnTimesheet'),
    controllerSource.indexOf('exports.reopenTimesheet')
  );
  assert.match(returnBlock, /isPersistedRejectedManualActivityRow\(entry\)/);
  const rejectedBranch = returnBlock.slice(returnBlock.indexOf('isPersistedRejectedManualActivityRow(entry)'));
  assert.match(rejectedBranch, /approvalStatus: 'rejected'/);
  assert.match(rejectedBranch, /\.\.\.entry,/);
  assert.doesNotMatch(rejectedBranch.split("status: 'rejected'")[0], /decisionNote: ''/);
});

test('saveTimesheet blocks author delete of rejected manual rows without DELETE admin', () => {
  assert.match(controllerSource, /Manager-rejected manual rows cannot be removed/);
  assert.match(controllerSource, /canDeleteRejectedManualRow/);
});

test('editor exposes rejected-row detail modal and admin-only delete flag', () => {
  assert.match(editorSource, /manualRowRejectDetailModal/);
  assert.match(editorSource, /openManualRowRejectDetailModal/);
  assert.match(editorSource, /CAN_DELETE_REJECTED_MANUAL_ROW/);
  assert.match(editorSource, /ts-manual-reject-status-trigger/);
});

test('detectTimesheetInternalOverlaps marks overlap with rejected manual row', () => {
  const conflicts = timesheetManualConflictService.detectTimesheetInternalOverlaps([
    {
      sessionId: 'MAN-NEW',
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '12:00',
      classId: '',
      activityId: 'ACT/1',
      approvalStatus: 'pending_approval'
    },
    {
      sessionId: 'MAN-REJ',
      date: '2026-08-04',
      startTime: '09:30',
      endTime: '12:30',
      classId: '',
      activityId: 'ACT/1',
      approvalStatus: 'rejected',
      isManual: true,
      activityPaid: true
    }
  ]);
  assert.ok(conflicts.length >= 1);
  const rejectedConflict = conflicts.find((row) => row.sourceApprovalStatus === 'rejected');
  assert.ok(rejectedConflict);
  assert.match(rejectedConflict.userMessage, /manager-rejected manual row/i);
});
