const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const teacherIdentityService = require('../packages/school/MVC/services/school/teacherIdentityService');
const schoolRecordAccessService = require('../packages/school/MVC/services/school/schoolRecordAccessService');
const personDenormalizedNameSyncService = require('../packages/school/MVC/services/school/personDenormalizedNameSyncService');
const scheduleController = require('../packages/school/MVC/controllers/school/scheduleController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');

test('teacherIdentityService resolves teacher record ids to person ids', () => {
  const map = teacherIdentityService.buildTeacherPersonMap([
    { id: 'TCH_1', personId: 'PER_1' }
  ]);
  assert.equal(teacherIdentityService.resolveTeacherPersonId('TCH_1', map), 'PER_1');
  assert.equal(
    teacherIdentityService.sessionDeliveredByMatchesPerson(
      { delivery: { deliveredBy: 'TCH_1' } },
      'PER_1',
      map
    ),
    true
  );
});

test('isSessionDeliveredByPerson matches teacher record ids when map is provided', () => {
  const map = teacherIdentityService.buildTeacherPersonMap([
    { id: 'TCH_9', personId: 'PER_9' }
  ]);
  assert.equal(
    schoolRecordAccessService.isSessionDeliveredByPerson(
      { delivery: { deliveredBy: 'TCH_9' } },
      'PER_9',
      map
    ),
    true
  );
});

test('matchesPersonRef accepts linked school record aliases', () => {
  const aliasIds = ['PER_1', 'TCH_1'];
  assert.equal(personDenormalizedNameSyncService.matchesPersonRef('TCH_1', 'PER_1', aliasIds), true);
  assert.equal(personDenormalizedNameSyncService.matchesPersonRef('PER_2', 'PER_1', aliasIds), false);
});

test('syncPersonDisplayName updates session deliveredByName and instructor name', async () => {
  const originals = {
    fetchData: schoolDataService.fetchData,
    getClassSessions: schoolDataService.getClassSessions,
    saveClassSessions: schoolDataService.saveClassSessions,
    updateData: schoolDataService.updateData,
    sessionCasesList: schoolRepositories.sessionStudentCases.list,
    sessionCasesUpdate: schoolRepositories.sessionStudentCases.update,
    activitiesList: schoolRepositories.activities.list,
    activitiesUpdate: schoolRepositories.activities.update,
    tasksList: schoolRepositories.tasks.list,
    tasksUpdate: schoolRepositories.tasks.update,
    leaveList: schoolRepositories.leaveRequests.list,
    leaveUpdate: schoolRepositories.leaveRequests.update
  };

  const classId = 'CLS_SYNC_1';
  let savedSessions = [];
  let savedInstructors = null;

  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'classes') {
      return [{
        id: classId,
        orgId: 'ORG_1',
        instructors: [{ personId: 'PER_1', name: 'Amir Peivandzani', status: 'active' }],
        sessions: []
      }];
    }
    if (entityType === 'teachers') {
      return [{ id: 'TCH_1', personId: 'PER_1', orgId: 'ORG_1' }];
    }
    return [];
  };
  schoolDataService.getClassSessions = async () => ([
    {
      sessionId: 'SES_1',
      date: '2026-07-01',
      delivery: { deliveredBy: 'TCH_1', deliveredByName: 'Amir Peivandzani' }
    }
  ]);
  schoolDataService.saveClassSessions = async (_classId, sessions) => {
    savedSessions = sessions;
    return sessions;
  };
  schoolDataService.updateData = async (_entity, _id, payload) => {
    if (payload?.instructors) savedInstructors = payload.instructors;
    return payload;
  };
  schoolRepositories.sessionStudentCases.list = async () => [];
  schoolRepositories.sessionStudentCases.update = async () => null;
  schoolRepositories.activities.list = async () => [];
  schoolRepositories.activities.update = async () => null;
  schoolRepositories.tasks.list = async () => [];
  schoolRepositories.tasks.update = async () => null;
  schoolRepositories.leaveRequests.list = async () => [];
  schoolRepositories.leaveRequests.update = async () => null;

  try {
    const result = await personDenormalizedNameSyncService.syncPersonDisplayName({
      personId: 'PER_1',
      displayName: 'Kyle Mack',
      activeOrgId: 'ORG_1',
      reqUser: null
    });

    assert.equal(result.updated.sessions, 1);
    assert.equal(result.updated.instructors, 1);
    assert.equal(savedSessions[0].delivery.deliveredByName, 'Kyle Mack');
    assert.equal(savedInstructors[0].name, 'Kyle Mack');
  } finally {
    Object.assign(schoolDataService, {
      fetchData: originals.fetchData,
      getClassSessions: originals.getClassSessions,
      saveClassSessions: originals.saveClassSessions,
      updateData: originals.updateData
    });
    schoolRepositories.sessionStudentCases.list = originals.sessionCasesList;
    schoolRepositories.sessionStudentCases.update = originals.sessionCasesUpdate;
    schoolRepositories.activities.list = originals.activitiesList;
    schoolRepositories.activities.update = originals.activitiesUpdate;
    schoolRepositories.tasks.list = originals.tasksList;
    schoolRepositories.tasks.update = originals.tasksUpdate;
    schoolRepositories.leaveRequests.list = originals.leaveList;
    schoolRepositories.leaveRequests.update = originals.leaveUpdate;
  }
});

test('schedule my-schedule uses expanded user person id lookup', () => {
  const source = read('packages/school/MVC/controllers/school/scheduleController.js');
  assert.match(source, /const selfPersonId = getUserPersonId\(req\.user\)/);
});

test('person name sync updates the linked School Account and preserves its role suffix', async () => {
  const originals = {
    fetchData: schoolDataService.fetchData,
    updateData: schoolDataService.updateData,
    sessionCasesList: schoolRepositories.sessionStudentCases.list,
    activitiesList: schoolRepositories.activities.list,
    tasksList: schoolRepositories.tasks.list,
    leaveList: schoolRepositories.leaveRequests.list
  };
  let accountUpdate = null;
  let accountReadUser = null;
  let accountWriteUser = null;
  const reqUser = { id: 'USER_1', activeOrgId: 'ORG_1' };
  schoolDataService.fetchData = async (entityType, _query, requestingUser) => {
    if (entityType === 'students') return [
      { id: 'STU10001', personId: 'PER_1', orgId: 'ORG_1', studentAccountId: 'ACC_1' },
      { id: 'STU20002', personId: 'PER_1', orgId: 'ORG_2', studentAccountId: 'ACC_2' }
    ];
    if (entityType === 'schoolAccounts') {
      accountReadUser = requestingUser;
      return [
        { id: 'ACC_1', orgId: 'ORG_1', name: 'Old Name (Self-Funded Student)' },
        { id: 'ACC_2', orgId: 'ORG_2', name: 'Other Organization (Student)' }
      ];
    }
    return [];
  };
  schoolDataService.updateData = async (entityType, id, payload, requestingUser) => {
    if (entityType === 'schoolAccounts') {
      accountUpdate = { id, ...payload };
      accountWriteUser = requestingUser;
    }
    return payload;
  };
  schoolRepositories.sessionStudentCases.list = async () => [];
  schoolRepositories.activities.list = async () => [];
  schoolRepositories.tasks.list = async () => [];
  schoolRepositories.leaveRequests.list = async () => [];

  try {
    const result = await personDenormalizedNameSyncService.syncPersonDisplayName({
      personId: 'PER_1', displayName: 'New Saved Name', activeOrgId: 'ORG_1', reqUser
    });
    assert.deepEqual(accountUpdate, { id: 'ACC_1', name: 'New Saved Name (Self-Funded Student)' });
    assert.equal(accountReadUser, reqUser);
    assert.equal(accountWriteUser, reqUser);
    assert.equal(result.updated.schoolAccounts, 1);
  } finally {
    schoolDataService.fetchData = originals.fetchData;
    schoolDataService.updateData = originals.updateData;
    schoolRepositories.sessionStudentCases.list = originals.sessionCasesList;
    schoolRepositories.activities.list = originals.activitiesList;
    schoolRepositories.tasks.list = originals.tasksList;
    schoolRepositories.leaveRequests.list = originals.leaveList;
  }
});

test('student, teacher, and staff updates trigger related person name synchronization', () => {
  for (const file of ['studentController.js', 'teacherController.js', 'staffController.js']) {
    const source = read(`packages/school/MVC/controllers/school/${file}`);
    assert.match(source, /if \(id\) \{[\s\S]*?syncPersonDisplayNameForRoleUpdate/);
  }
});

test('name sync updates live task and leave fields without rewriting historical snapshots', async () => {
  const originals = {
    fetchData: schoolDataService.fetchData,
    sessionCasesList: schoolRepositories.sessionStudentCases.list,
    activitiesList: schoolRepositories.activities.list,
    tasksList: schoolRepositories.tasks.list,
    tasksUpdate: schoolRepositories.tasks.update,
    leaveList: schoolRepositories.leaveRequests.list,
    leaveUpdate: schoolRepositories.leaveRequests.update
  };
  let savedTask = null;
  let savedLeave = null;
  schoolDataService.fetchData = async (entityType) => entityType === 'teachers'
    ? [{ id: 'TCH_1', personId: 'PER_1', orgId: 'ORG_1' }]
    : [];
  schoolRepositories.sessionStudentCases.list = async () => [];
  schoolRepositories.activities.list = async () => [];
  schoolRepositories.tasks.list = async () => [{
    id: 'TASK_1', orgId: 'ORG_1', status: 'open', assignedPersonId: 'PER_1', assignedPersonName: 'Old Name',
    lifecycle: [{ personId: 'PER_1', personName: 'Historical Name' }],
    tasks: [
      { id: 'A_1', status: 'open', assignedPersonId: 'PER_1', assignedPersonName: 'Old Name', assignmentHistory: [{ assignedPersonId: 'PER_1', assignedPersonName: 'Historical Name' }] },
      { id: 'A_2', status: 'completed', assignedPersonId: 'PER_1', assignedPersonName: 'Completed Name', assignmentHistory: [] }
    ]
  }];
  schoolRepositories.tasks.update = async (_id, payload) => { savedTask = payload; return payload; };
  schoolRepositories.leaveRequests.list = async () => [{
    id: 'LEAVE_1', orgId: 'ORG_1', requesterPersonId: 'PER_1', requesterName: 'Old Name',
    lastApprovedSnapshot: { requesterPersonId: 'PER_1', requesterName: 'Historical Name' },
    sessionResolutions: [
      { substituteTeacherId: 'TCH_1', substituteTeacherName: 'Old Name', resolvedAt: '' },
      { substituteTeacherId: 'TCH_1', substituteTeacherName: 'Historical Name', resolvedAt: '2026-01-01T00:00:00.000Z' }
    ]
  }];
  schoolRepositories.leaveRequests.update = async (_id, payload) => { savedLeave = payload; return payload; };

  try {
    await personDenormalizedNameSyncService.syncPersonDisplayName({
      personId: 'PER_1', displayName: 'Current Name', activeOrgId: 'ORG_1', reqUser: { id: 'USER_1', activeOrgId: 'ORG_1' }
    });
    assert.equal(savedTask.assignedPersonName, 'Current Name');
    assert.equal(savedTask.tasks[0].assignedPersonName, 'Current Name');
    assert.equal(savedTask.tasks[0].assignmentHistory[0].assignedPersonName, 'Historical Name');
    assert.equal(savedTask.tasks[1].assignedPersonName, 'Completed Name');
    assert.equal(savedTask.lifecycle[0].personName, 'Historical Name');
    assert.equal(savedLeave.requesterName, 'Current Name');
    assert.equal(savedLeave.lastApprovedSnapshot.requesterName, 'Historical Name');
    assert.equal(savedLeave.sessionResolutions[0].substituteTeacherName, 'Current Name');
    assert.equal(savedLeave.sessionResolutions[1].substituteTeacherName, 'Historical Name');
  } finally {
    schoolDataService.fetchData = originals.fetchData;
    schoolRepositories.sessionStudentCases.list = originals.sessionCasesList;
    schoolRepositories.activities.list = originals.activitiesList;
    schoolRepositories.tasks.list = originals.tasksList;
    schoolRepositories.tasks.update = originals.tasksUpdate;
    schoolRepositories.leaveRequests.list = originals.leaveList;
    schoolRepositories.leaveRequests.update = originals.leaveUpdate;
  }
});

test('sync modal reports School Account counts and partial failures', () => {
  const partial = read('packages/school/MVC/views/school/partials/syncDenormalizedNamesManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/schoolLinkedPersonProfileController.js');
  assert.match(partial, /School Accounts updated/);
  assert.match(partial, /Skipped records/);
  assert.match(partial, /Sync completed with warnings/);
  assert.match(partial, /errorDetails/);
  assert.match(controller, /partial: result\.partial === true/);
});

test('integrated bulk sync unions all three sections and deduplicates shared people', async () => {
  const originals = {
    fetchData: schoolDataService.fetchData,
    updateData: schoolDataService.updateData,
    buildPersonByIdMap: schoolPersonAccessService.buildPersonByIdMap,
    sessionCasesList: schoolRepositories.sessionStudentCases.list,
    activitiesList: schoolRepositories.activities.list,
    tasksList: schoolRepositories.tasks.list,
    leaveList: schoolRepositories.leaveRequests.list
  };
  const reqUser = { id: 'USER_1', activeOrgId: 'ORG_1' };
  const rows = {
    teachers: [{ id: 'TCH_1', personId: 'PER_1', orgId: 'ORG_1', teacherAccountId: 'ACC_T' }],
    students: [{ id: 'STU_1', personId: 'PER_1', orgId: 'ORG_1', studentAccountId: 'ACC_S' }],
    staff: [{ id: 'STF_1', personId: 'PER_2', orgId: 'ORG_1', staffAccountId: 'ACC_F' }],
    schoolAccounts: [
      { id: 'ACC_T', orgId: 'ORG_1', name: 'Old Teacher (Teacher)' },
      { id: 'ACC_S', orgId: 'ORG_1', name: 'Old Student (Student)' },
      { id: 'ACC_F', orgId: 'ORG_1', name: 'Old Staff (Staff)' }
    ]
  };
  const accountUpdates = [];
  schoolDataService.fetchData = async (entityType) => rows[entityType] || [];
  schoolDataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'schoolAccounts') accountUpdates.push({ id, name: payload.name });
    return payload;
  };
  schoolPersonAccessService.buildPersonByIdMap = async () => new Map([
    ['PER_1', { id: 'PER_1', name: { preferred: 'Shared Person' } }],
    ['PER_2', { id: 'PER_2', name: { preferred: 'Staff Person' } }]
  ]);
  schoolRepositories.sessionStudentCases.list = async () => [];
  schoolRepositories.activities.list = async () => [];
  schoolRepositories.tasks.list = async () => [];
  schoolRepositories.leaveRequests.list = async () => [];

  try {
    const result = await personDenormalizedNameSyncService.syncAllSchoolPeopleSavedNamesForOrg({ activeOrgId: 'ORG_1', reqUser });
    assert.equal(result.linkType, 'all');
    assert.deepEqual(result.scanned, { teachers: 1, students: 1, staff: 1, linkedAccounts: 3, uniquePeople: 2 });
    assert.equal(result.peopleProcessed, 2);
    assert.equal(result.updated.schoolAccounts, 3);
    assert.deepEqual(accountUpdates.map((row) => row.id).sort(), ['ACC_F', 'ACC_S', 'ACC_T']);
  } finally {
    schoolDataService.fetchData = originals.fetchData;
    schoolDataService.updateData = originals.updateData;
    schoolPersonAccessService.buildPersonByIdMap = originals.buildPersonByIdMap;
    schoolRepositories.sessionStudentCases.list = originals.sessionCasesList;
    schoolRepositories.activities.list = originals.activitiesList;
    schoolRepositories.tasks.list = originals.tasksList;
    schoolRepositories.leaveRequests.list = originals.leaveList;
  }
});

test('integrated sync controller requires all three permissions and uses one organization guard', () => {
  const controller = read('packages/school/MVC/controllers/school/schoolLinkedPersonProfileController.js');
  assert.match(controller, /isIntegratedBulk && !canSync\.every\(Boolean\)/);
  assert.match(controller, /school_people_saved_name_sync/);
  assert.match(controller, /syncAllSchoolPeopleSavedNamesForOrg/);
  assert.match(controller, /idempotencyGuardService\.completeGuard/);
});

test('identity routes expose denormalized name sync endpoint', () => {
  const source = read('packages/school/MVC/routes/schoolIdentityRoutes.js');
  assert.match(source, /\/api\/sync-denormalized-names/);
  assert.match(source, /syncDenormalizedNames/);
});

test('class form allows same-id teacher label refresh', () => {
  const source = read('packages/school/MVC/views/school/class/classForm.ejs');
  assert.match(source, /isLabelRefreshOnly/);
});

test('teacher, staff, and student list pages expose sync saved names button', () => {
  const teacherList = read('packages/school/MVC/views/school/teacher/teacherList.ejs');
  const staffList = read('packages/school/MVC/views/school/staff/staffList.ejs');
  const studentList = read('packages/school/MVC/views/school/student/studentList.ejs');
  const partial = read('packages/school/MVC/views/school/partials/syncDenormalizedNamesManage.ejs');

  assert.match(teacherList, /btnSyncTeacherDenormalizedNames/);
  assert.match(staffList, /btnSyncStaffDenormalizedNames/);
  assert.match(studentList, /btnSyncStudentDenormalizedNames/);
  assert.match(teacherList, /Sync All Saved Names/);
  assert.match(staffList, /Sync All Saved Names/);
  assert.match(studentList, /Sync All Saved Names/);
  assert.match(partial, /Teachers scanned/);
  assert.match(partial, /Students scanned/);
  assert.match(partial, /Staff scanned/);
  assert.match(partial, /\/school\/identity\/api\/sync-denormalized-names/);
  assert.match(partial, /progress-bar-striped progress-bar-animated/);
  assert.match(teacherList, /syncDenormalizedLinkType: 'teacher'/);
  assert.match(staffList, /syncDenormalizedLinkType: 'staff'/);
  assert.match(studentList, /syncDenormalizedLinkType: 'student'/);
});

test('schedule hour categories use one canonical school role label per event', () => {
  assert.deepEqual(
    scheduleController.getScheduleEventHourCategoryLabels({
      roles: ['Teacher'],
      roleLabel: 'Teacher'
    }),
    ['Teacher']
  );
  assert.deepEqual(
    scheduleController.getScheduleEventHourCategoryLabels({
      roles: ['teacher'],
      roleLabel: 'Paid Activity',
      eventType: 'school_activity'
    }),
    ['Teacher']
  );
  assert.deepEqual(
    scheduleController.getScheduleEventHourCategoryLabels({
      roles: ['student'],
      roleLabel: 'Paid Activity',
      eventType: 'school_activity'
    }),
    ['Student']
  );
});
