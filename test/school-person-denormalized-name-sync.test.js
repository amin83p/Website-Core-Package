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
