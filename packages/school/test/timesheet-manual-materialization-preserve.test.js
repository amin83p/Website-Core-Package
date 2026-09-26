const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const activityService = require('../MVC/services/school/activityService');
const timesheetManualMaterializationService = require('../MVC/services/school/timesheetManualMaterializationService');

test('collectPreservedMaterializedManualEntryIds includes approved manual activity rows', () => {
  const ids = timesheetManualMaterializationService.collectPreservedMaterializedManualEntryIds([
    { isManual: true, activityId: 'ACT/1', sessionId: 'manual-1', approvalStatus: 'approved' },
    { isManual: true, activityId: 'ACT/1', sessionId: 'manual-2', approvalStatus: 'pending_approval' },
    { isManual: true, classId: 'CLS/1', sessionId: 'manual-3', approvalStatus: 'approved' },
    { isManual: true, activityId: 'ACT/1', sessionId: 'act-705736-ENT-1-TEACHER', materializedFromTimesheetEntryId: 'MAN-705736-0004', approvalStatus: 'approved' }
  ]);
  assert.equal(ids.size, 3);
  assert.ok(ids.has('manual-1'));
  assert.ok(ids.has('MAN-705736-0004'));
  assert.ok(ids.has('act-705736-ENT-1-TEACHER'));
});

test('revertMaterializedRecordsForTimesheet preserves activity assignees in preserve set', async () => {
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalUpdate = schoolDataService.updateData;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalSaveSessions = schoolDataService.saveClassSessions;

  const activity = {
    id: 'ACT/1',
    entries: [{
      entryId: 'ENT/1',
      assignees: [
        {
          personId: 'TEACHER/A',
          materializedFromTimesheetId: 'TS/1',
          materializedFromTimesheetEntryId: 'manual-approved'
        },
        {
          personId: 'TEACHER/B',
          materializedFromTimesheetId: 'TS/1',
          materializedFromTimesheetEntryId: 'manual-pending'
        }
      ]
    }]
  };

  schoolDataService.fetchAllData = async (table) => {
    if (table === 'classes') return [];
    if (table === 'activities') return [activity];
    return [];
  };
  schoolDataService.getClassSessions = async () => [];
  schoolDataService.saveClassSessions = async () => {};
  let savedActivity = null;
  schoolDataService.updateData = async (table, id, payload) => {
    if (table === 'activities' && id === 'ACT/1') savedActivity = payload;
    return payload;
  };

  try {
    const summary = await timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet({
      timesheetId: 'TS/1',
      reqUser: {},
      preserveTimesheetEntryIds: ['manual-approved']
    });
    assert.equal(summary.revertedActivityEntries, 1);
    assert.equal(summary.entryRestorations.length, 1);
    assert.equal(summary.entryRestorations[0].originalEntryId, 'manual-pending');

    assert.ok(savedActivity);
    const assignees = savedActivity.entries[0].assignees;
    assert.equal(assignees.length, 1);
    assert.equal(assignees[0].personId, 'TEACHER/A');
    assert.equal(assignees[0].materializedFromTimesheetEntryId, 'manual-approved');
  } finally {
    schoolDataService.fetchAllData = originalFetchAll;
    schoolDataService.updateData = originalUpdate;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.saveClassSessions = originalSaveSessions;
  }
});
