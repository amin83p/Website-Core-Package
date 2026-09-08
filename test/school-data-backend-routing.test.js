const test = require('node:test');
const assert = require('node:assert/strict');

const sessionUncompletedNotificationService = require('../packages/school/MVC/services/school/sessionUncompletedNotificationService');
const sessionAttendanceEditAccessService = require('../packages/school/MVC/services/school/sessionAttendanceEditAccessService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const classModel = require('../packages/school/MVC/models/school/classModel');
const timesheetPeriodModel = require('../packages/school/MVC/models/school/timesheetPeriodModel');

const originalFetchAllData = schoolDataService.fetchAllData;
const originalGetAllClasses = classModel.getAllClasses;
const originalTimesheetPeriodList = schoolRepositories.timesheetPeriods.list;
const originalGetAllTimesheetPeriods = timesheetPeriodModel.getAllTimesheetPeriods;

test.after(() => {
  schoolDataService.fetchAllData = originalFetchAllData;
  classModel.getAllClasses = originalGetAllClasses;
  schoolRepositories.timesheetPeriods.list = originalTimesheetPeriodList;
  timesheetPeriodModel.getAllTimesheetPeriods = originalGetAllTimesheetPeriods;
});

test('listOrgClasses does not fall back to classModel JSON reads', async () => {
  let classModelCalls = 0;
  schoolDataService.fetchAllData = async () => [];
  classModel.getAllClasses = async () => {
    classModelCalls += 1;
    return [{ id: 'CLASS/1', orgId: 'ORG/1' }];
  };

  const classes = await sessionUncompletedNotificationService.listOrgClasses('ORG/1', { activeOrgId: 'ORG/1' });

  assert.deepEqual(classes, []);
  assert.equal(classModelCalls, 0);
});

test('findTimesheetPeriodForSessionDate loads periods through schoolRepositories', async () => {
  let repositoryCalls = 0;
  let modelCalls = 0;

  schoolRepositories.timesheetPeriods.list = async (query) => {
    repositoryCalls += 1;
    assert.equal(query.orgId__eq, 'ORG/1');
    return [
      {
        id: 'PERIOD/1',
        orgId: 'ORG/1',
        startDate: '2026-01-01',
        endDate: '2026-01-31'
      },
      {
        id: 'PERIOD/2',
        orgId: 'ORG/1',
        startDate: '2026-02-01',
        endDate: '2026-02-28'
      }
    ];
  };
  timesheetPeriodModel.getAllTimesheetPeriods = async () => {
    modelCalls += 1;
    return [];
  };

  const period = await sessionAttendanceEditAccessService.findTimesheetPeriodForSessionDate('ORG/1', '2026-01-15');

  assert.equal(period?.id, 'PERIOD/1');
  assert.equal(repositoryCalls, 1);
  assert.equal(modelCalls, 0);
});
