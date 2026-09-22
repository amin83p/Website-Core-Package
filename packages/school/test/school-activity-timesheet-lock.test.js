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

function buildLockedEntryFixture() {
  return {
    entryId: 'ENT/1',
    title: 'Original',
    location: 'Room 1',
    notes: 'Note',
    date: '2026-07-01',
    startTime: '09:00',
    endTime: '10:00',
    durationHours: 1,
    status: 'posted',
    locked: false,
    assignees: [
      {
        personId: 'TEACHER/A',
        role: 'participant',
        status: 'attended',
        paid: true,
        paidHours: 1,
        completionStatus: 'pending',
        locked: true,
        lockReason: 'timesheet_approved'
      },
      {
        personId: 'TEACHER/B',
        role: 'participant',
        status: 'attended',
        paid: true,
        paidHours: 1,
        completionStatus: 'pending',
        locked: false
      }
    ]
  };
}

test('entryHasTimesheetLockedAssignee detects locked assignee rows', () => {
  const entry = buildLockedEntryFixture();
  assert.equal(activityService.entryHasTimesheetLockedAssignee(entry), true);
  assert.deepEqual([...activityService.getEntryLockedAssigneeIds(entry)], ['TEACHER/A']);
});

test('enforceActivityLockRules allows title location and notes when assignee is locked', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    title: 'Parent',
    categoryId: 'CAT/1',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    title: 'Parent Updated',
    categoryId: 'CAT/2',
    entries: [{
      ...buildLockedEntryFixture(),
      title: 'Updated title',
      location: 'Room 2',
      notes: 'Updated notes'
    }]
  };
  activityService.enforceActivityLockRules(existing, nextData);
});

test('enforceActivityLockRules blocks date change when assignee is locked', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    entries: [{
      ...buildLockedEntryFixture(),
      date: '2026-07-02'
    }]
  };
  assert.throws(
    () => activityService.enforceActivityLockRules(existing, nextData),
    /locked by an approved timesheet/i
  );
});

test('enforceActivityLockRules allows adding assignee and removing unlocked assignee', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    entries: [{
      ...buildLockedEntryFixture(),
      assignees: [
        existing.entries[0].assignees[0],
        { personId: 'TEACHER/C', status: 'attended', paid: true, paidHours: 1 }
      ]
    }]
  };
  activityService.enforceActivityLockRules(existing, nextData);
});

test('enforceActivityLockRules blocks removing locked assignee', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    entries: [{
      ...buildLockedEntryFixture(),
      assignees: [existing.entries[0].assignees[1]]
    }]
  };
  assert.throws(
    () => activityService.enforceActivityLockRules(existing, nextData),
    /cannot be removed/i
  );
});

test('enforceActivityLockRules blocks visibilityScope change when work sessions exist', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    visibilityScope: 'school',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    visibilityScope: 'individual'
  };
  assert.throws(
    () => activityService.enforceActivityLockRules(existing, nextData),
    /Calendar scope cannot be changed after work sessions have been added/i
  );
});

test('enforceActivityLockRules allows visibilityScope unchanged when work sessions exist', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    visibilityScope: 'individual',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    title: 'Updated parent title'
  };
  activityService.enforceActivityLockRules(existing, nextData);
});

test('parent activity fields remain editable when assignee rows are locked', () => {
  const existing = {
    id: 'ACT/1',
    evaluationType: 'attendance',
    title: 'Before',
    categoryId: 'CAT/1',
    departmentId: 'DEP/1',
    paid: true,
    status: 'posted',
    entries: [buildLockedEntryFixture()]
  };
  const nextData = {
    ...existing,
    title: 'After',
    categoryId: 'CAT/2',
    departmentId: 'DEP/2',
    paid: false,
    status: 'draft',
    notes: 'Parent notes updated'
  };
  activityService.enforceActivityLockRules(existing, nextData);
});

function buildScopePersonActivityFixture() {
  return {
    id: 'ACT_SCOPE',
    visibilityScope: 'individual',
    allowedPersonIds: ['TEACHER_A', 'TEACHER_B'],
    excludedPersonIds: [],
    hiddenPersonIds: [],
    entries: [{
      entryId: 'ENT_1',
      assignees: [{ personId: 'TEACHER_A', status: 'attended' }]
    }]
  };
}

test('collectActivityAssigneePersonIds returns assignees across work sessions', () => {
  const activity = buildScopePersonActivityFixture();
  assert.deepEqual(activityService.collectActivityAssigneePersonIds(activity), ['TEACHER_A']);
  assert.equal(activityService.isActivityWorkSessionAssignee(activity, 'TEACHER_A'), true);
  assert.equal(activityService.isActivityWorkSessionAssignee(activity, 'TEACHER_B'), false);
});

test('enforceScopePersonRules blocks removing allowed work session assignee', () => {
  const existing = buildScopePersonActivityFixture();
  const nextData = {
    ...existing,
    allowedPersonIds: ['TEACHER_B']
  };
  assert.throws(
    () => activityService.enforceScopePersonRules(existing, nextData),
    /cannot be removed/i
  );
});

test('enforceScopePersonRules blocks excluding work session assignee', () => {
  const existing = buildScopePersonActivityFixture();
  const nextData = {
    ...existing,
    excludedPersonIds: ['TEACHER_A']
  };
  assert.throws(
    () => activityService.enforceScopePersonRules(existing, nextData),
    /cannot be excluded/i
  );
});

test('isPersonHiddenFromTimesheetSelection blocks hidden allowed persons only', () => {
  const activity = {
    ...buildScopePersonActivityFixture(),
    hiddenPersonIds: ['TEACHER_A']
  };
  assert.equal(activityService.isPersonHiddenFromTimesheetSelection(activity, 'TEACHER_A'), true);
  assert.equal(activityService.isPersonHiddenFromTimesheetSelection(activity, 'TEACHER_B'), false);
  assert.equal(activityService.isPersonEligibleForActivity(activity, 'TEACHER_A'), true);
});

test('isPersonEligibleForManualTimesheetActivity respects showInTimesheetActivities and hidden persons', () => {
  const activity = {
    ...buildScopePersonActivityFixture(),
    showInTimesheetActivities: false
  };
  assert.equal(activityService.isPersonEligibleForManualTimesheetActivity(activity, 'TEACHER_A'), false);

  const hiddenActivity = {
    ...buildScopePersonActivityFixture(),
    hiddenPersonIds: ['TEACHER_A']
  };
  assert.equal(activityService.isPersonEligibleForManualTimesheetActivity(hiddenActivity, 'TEACHER_A'), false);
  assert.equal(activityService.isPersonEligibleForManualTimesheetActivity(hiddenActivity, 'TEACHER_B'), true);
});

test('listManualEntryActivitiesForPerson excludes activities hidden from manual timesheet selection', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAllCategories = schoolDataService.fetchAllData;
  schoolDataService.fetchData = async () => [{
    id: 'ACT_INTERNAL',
    orgId: 'ORG_1',
    status: 'posted',
    visibilityScope: 'school',
    showInTimesheetActivities: false,
    entries: []
  }, {
    id: 'ACT_VISIBLE',
    orgId: 'ORG_1',
    status: 'posted',
    visibilityScope: 'school',
    entries: []
  }];
  schoolDataService.fetchAllData = async (table) => (table === 'activityCategories' || table === 'departments' ? [] : []);
  try {
    const rows = await activityService.listManualEntryActivitiesForPerson({
      orgId: 'ORG_1',
      personId: 'TEACHER_A',
      reqUser: {}
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'ACT_VISIBLE');
  } finally {
    schoolDataService.fetchData = originalFetchData;
    schoolDataService.fetchAllData = originalFetchAllCategories;
  }
});

test('activity sanitize defaults showInTimesheetActivities to true', () => {
  const activityModel = require('../MVC/models/school/activityModel');
  const defaults = activityModel.sanitizeActivityPayload({
    orgId: 'ORG_1',
    title: 'Test',
    categoryId: 'CAT_1',
    departmentId: 'DEPT_1',
    allowEmptyEntries: true,
    entries: []
  });
  assert.equal(defaults.showInTimesheetActivities, true);

  const hidden = activityModel.sanitizeActivityPayload({
    orgId: 'ORG_1',
    title: 'Internal',
    categoryId: 'CAT_1',
    departmentId: 'DEPT_1',
    showInTimesheetActivities: 'false',
    allowEmptyEntries: true,
    entries: []
  });
  assert.equal(hidden.showInTimesheetActivities, false);
});

test('sumAssigneeHoursOnTimesheet totals matching activity entry hours', () => {
  const hours = activityService.sumAssigneeHoursOnTimesheet({
    teacherId: 'TEACHER/A',
    entries: [
      { activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: '', hours: 4, isDeleted: false },
      { activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: 'TEACHER/B', hours: 2, isDeleted: false },
      { activityId: 'ACT/1', activityEntryId: 'ENT/2', personId: '', hours: 1, isDeleted: false }
    ]
  }, {
    activityId: 'ACT/1',
    entryId: 'ENT/1',
    personId: 'TEACHER/A'
  });
  assert.equal(hours, 4);
});

test('buildActivityAssigneeLockDisplays returns editor link for linked timesheet lock', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalGetById = schoolDataService.getDataById;
  const originalListExisting = schoolDependencyService.listExistingTimesheetIds;
  schoolDependencyService.listExistingTimesheetIds = async () => ['TS/1'];
  schoolDataService.fetchAllData = async (table) => {
    if (table !== 'timesheets') return [];
    return [{
      id: 'TS/1',
      orgId: 'ORG_1',
      periodId: 'PER/1',
      teacherId: 'TEACHER/A',
      status: 'submitted',
      entries: [{ activityId: 'ACT/1', activityEntryId: 'ENT/1', personId: '', hours: 6 }]
    }];
  };
  schoolDataService.getDataById = async (table, id) => {
    if (table === 'timesheetPeriods' && id === 'PER/1') {
      return { id: 'PER/1', name: 'March 2026' };
    }
    return null;
  };
  try {
    const displays = await activityService.buildActivityAssigneeLockDisplays({
      id: 'ACT/1',
      orgId: 'ORG_1',
      entries: [{
        entryId: 'ENT/1',
        assignees: [{
          personId: 'TEACHER/A',
          locked: true,
          lockReason: 'timesheet_approved',
          lockedTimesheetId: 'TS/1'
        }]
      }]
    }, {});
    const display = displays['ENT/1::TEACHER/A'];
    assert.ok(display);
    assert.equal(display.isOrphan, false);
    assert.equal(display.timesheetStatus, 'submitted');
    assert.equal(display.periodLabel, 'March 2026');
    assert.equal(display.hours, 6);
    assert.match(display.editorUrl, /\/school\/timesheets\/editor\/PER%2F1\?teacherId=TEACHER%2FA/);
  } finally {
    schoolDataService.fetchAllData = originalFetchAll;
    schoolDataService.getDataById = originalGetById;
    schoolDependencyService.listExistingTimesheetIds = originalListExisting;
  }
});

test('buildActivityAssigneeLockDisplays marks missing timesheet as orphan without editor link', async () => {
  const originalListExisting = schoolDependencyService.listExistingTimesheetIds;
  schoolDependencyService.listExistingTimesheetIds = async () => [];
  try {
    const displays = await activityService.buildActivityAssigneeLockDisplays({
      id: 'ACT/1',
      orgId: 'ORG_1',
      entries: [{
        entryId: 'ENT/1',
        assignees: [{
          personId: 'TEACHER/A',
          locked: true,
          lockReason: 'timesheet_approved',
          lockedTimesheetId: 'TS/MISSING'
        }]
      }]
    }, {});
    const display = displays['ENT/1::TEACHER/A'];
    assert.ok(display);
    assert.equal(display.isOrphan, true);
    assert.equal(display.editorUrl, '');
    assert.equal(display.timesheetId, 'TS/MISSING');
  } finally {
    schoolDependencyService.listExistingTimesheetIds = originalListExisting;
  }
});

test('buildActivityAssigneeLockDisplays omits unlocked assignees', async () => {
  const displays = await activityService.buildActivityAssigneeLockDisplays({
    id: 'ACT/1',
    orgId: 'ORG_1',
    entries: [{
      entryId: 'ENT/1',
      assignees: [{ personId: 'TEACHER/A', locked: false }]
    }]
  }, {});
  assert.deepEqual(displays, {});
});

test('listManualEntryActivitiesForPerson excludes hidden activities for person', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAllCategories = schoolDataService.fetchAllData;
  schoolDataService.fetchData = async () => [{
    id: 'ACT_HIDDEN',
    orgId: 'ORG_1',
    status: 'posted',
    visibilityScope: 'individual',
    allowedPersonIds: ['TEACHER_A'],
    hiddenPersonIds: ['TEACHER_A'],
    entries: []
  }, {
    id: 'ACT_VISIBLE',
    orgId: 'ORG_1',
    status: 'posted',
    visibilityScope: 'individual',
    allowedPersonIds: ['TEACHER_A'],
    hiddenPersonIds: [],
    entries: []
  }];
  schoolDataService.fetchAllData = async (table) => (table === 'activityCategories' || table === 'departments' ? [] : []);
  try {
    const rows = await activityService.listManualEntryActivitiesForPerson({
      orgId: 'ORG_1',
      personId: 'TEACHER_A',
      reqUser: {}
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'ACT_VISIBLE');
  } finally {
    schoolDataService.fetchData = originalFetchData;
    schoolDataService.fetchAllData = originalFetchAllCategories;
  }
});
