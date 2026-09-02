const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
const activityService = require('../MVC/services/school/activityService');

test('collectTimesheetSourceRefs attributes activity entry refs to the submitting teacher', () => {
  const refs = schoolDependencyService.collectTimesheetSourceRefs({
    id: 'TS/1',
    teacherId: 'TEACHER/A',
    entries: [{
      activityId: 'ACT/1',
      activityEntryId: 'ENT/1',
      personId: ''
    }]
  });
  const activityRef = refs.find((ref) => ref.type === 'activity' && ref.activityEntryId === 'ENT/1');
  assert.ok(activityRef);
  assert.equal(activityRef.personId, 'TEACHER/A');
});

test('findTimesheetsReferencingSource scopes activity locks to timesheet owner when personId missing', async () => {
  const originalFetchAll = schoolDataService.fetchAllData;
  schoolDataService.fetchAllData = async (table) => {
    if (table !== 'timesheets') return [];
    return [{
      id: 'TS/A',
      teacherId: 'TEACHER/A',
      status: 'submitted',
      entries: [{ activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: '' }]
    }];
  };
  try {
    const forTeacherB = await schoolDependencyService.findTimesheetsReferencingSource({
      orgId: '',
      sourceType: 'activity',
      sourceRef: { activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: 'TEACHER/B' },
      minStatus: 'submitted',
      reqUser: {}
    });
    assert.equal(forTeacherB.length, 0);

    const forTeacherA = await schoolDependencyService.findTimesheetsReferencingSource({
      orgId: '',
      sourceType: 'activity',
      sourceRef: { activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: 'TEACHER/A' },
      minStatus: 'submitted',
      reqUser: {}
    });
    assert.equal(forTeacherA.length, 1);
    assert.equal(forTeacherA[0].teacherId, 'TEACHER/A');
  } finally {
    schoolDataService.fetchAllData = originalFetchAll;
  }
});

test('isWorkSessionAssigneeLocked ignores entry-level lock for multi-assignee sessions', () => {
  const entry = {
    locked: true,
    lockReason: 'timesheet_approved',
    lockedTimesheetId: 'TS/1',
    assignees: [
      { personId: 'TEACHER/A', locked: true, lockReason: 'timesheet_approved' },
      { personId: 'TEACHER/B', locked: false }
    ]
  };
  assert.equal(activityService.isWorkSessionAssigneeLocked(entry, entry.assignees[0]), true);
  assert.equal(activityService.isWorkSessionAssigneeLocked(entry, entry.assignees[1]), false);
});
