'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetLegacyImportService = require('../MVC/services/school/timesheetLegacyImportService');
const statutoryHolidayDayMappingService = require('../MVC/services/school/statutoryHolidayDayMappingService');
const activityService = require('../MVC/services/school/activityService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const timesheetParametersPolicyModel = require('../MVC/models/school/timesheetParametersPolicyModel');

test('resolvePublicStatHolidayActivity rejects individual-scope activities', async () => {
  const originalGetActivity = activityService.getActivity;
  activityService.getActivity = async () => ({
    id: 'ACT_PRIVATE',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'individual'
  });

  try {
    await assert.rejects(
      () => timesheetLegacyImportService.resolvePublicStatHolidayActivity({
        orgId: 'ORG_1',
        reqUser: {},
        activityId: 'ACT_PRIVATE'
      }),
      /public \(school\) activity/i
    );
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('previewHolidayDayMapping marks holidays as skip when activity already has the date', async () => {
  const originalFetch = schoolDataService.fetchAllData;
  const originalResolve = timesheetLegacyImportService.resolvePublicStatHolidayActivity;

  schoolDataService.fetchAllData = async () => ([
    {
      id: 'H1',
      orgId: 'ORG_1',
      date: '2026-07-01',
      title: 'Canada Day',
      type: 'National Holiday'
    },
    {
      id: 'H2',
      orgId: 'ORG_1',
      date: '2026-12-25',
      title: 'Christmas Day',
      type: 'National Holiday'
    }
  ]);
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async () => ({
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    title: 'Stat Holidays',
    entries: [{
      entryId: 'ENT-1',
      date: '2026-07-01',
      startTime: '08:00',
      endTime: '20:00'
    }]
  });

  try {
    const preview = await statutoryHolidayDayMappingService.previewHolidayDayMapping({
      orgId: 'ORG_1',
      year: '2026',
      activityId: 'ACT_STAT',
      policy: {
        statutoryHolidayPay: {
          payableHolidayTypes: ['National Holiday']
        }
      },
      reqUser: {}
    });

    assert.equal(preview.createCount, 1);
    assert.equal(preview.skipCount, 1);
    assert.equal(preview.rows.find((row) => row.date === '2026-07-01')?.action, 'skip');
    assert.equal(preview.rows.find((row) => row.date === '2026-12-25')?.action, 'create');
  } finally {
    schoolDataService.fetchAllData = originalFetch;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolve;
  }
});

test('mapHolidayDaysToActivity stamps statHolidayId on existing date-only work sessions', async () => {
  const originalFetch = schoolDataService.fetchAllData;
  const originalResolve = timesheetLegacyImportService.resolvePublicStatHolidayActivity;
  const originalPersist = require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates;
  const originalSavePolicy = timesheetParametersPolicyModel.savePolicyForOrg;
  let maintenanceArgs = null;

  schoolDataService.fetchAllData = async () => ([
    {
      id: 'H-WINTER',
      orgId: 'ORG_1',
      date: '2026-01-01',
      title: 'WINTER BREAK',
      type: 'School Break'
    },
    {
      id: 'H2',
      orgId: 'ORG_1',
      date: '2026-12-25',
      title: 'Christmas Day',
      type: 'National Holiday'
    }
  ]);
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async () => ({
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    title: 'STATUTORY HOLIDAY',
    entries: [{
      entryId: 'ENT-1',
      date: '2026-01-01',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12
    }]
  });
  require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates =
    async (activity, entries, reqUser) => {
      maintenanceArgs = { activity, entries, reqUser };
      return activity;
    };
  timesheetParametersPolicyModel.savePolicyForOrg = async () => ({});

  try {
    const outcome = await statutoryHolidayDayMappingService.mapHolidayDaysToActivity({
      orgId: 'ORG_1',
      year: '2026',
      activityId: 'ACT_STAT',
      policy: {
        statutoryHolidayPay: {
          activityId: 'ACT_STAT',
          payableHolidayTypes: ['National Holiday', 'School Break']
        }
      },
      reqUser: { id: 'USER_1' }
    });

    assert.equal(outcome.createdCount, 1);
    assert.equal(maintenanceArgs?.entries?.length, 2);
    const stamped = maintenanceArgs.entries.find((entry) => entry.entryId === 'ENT-1');
    assert.equal(stamped?.statHolidayId, 'H-WINTER');
    assert.equal(stamped?.date, '2026-01-01');
  } finally {
    schoolDataService.fetchAllData = originalFetch;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolve;
    require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates = originalPersist;
    timesheetParametersPolicyModel.savePolicyForOrg = originalSavePolicy;
  }
});

test('mapHolidayDaysToActivity creates 08:00-20:00 shells without assignees', async () => {
  const originalFetch = schoolDataService.fetchAllData;
  const originalResolve = timesheetLegacyImportService.resolvePublicStatHolidayActivity;
  const originalPersist = require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates;
  const originalSavePolicy = timesheetParametersPolicyModel.savePolicyForOrg;
  let maintenanceArgs = null;

  schoolDataService.fetchAllData = async () => ([{
    id: 'H2',
    orgId: 'ORG_1',
    date: '2026-12-25',
    title: 'Christmas Day',
    type: 'National Holiday'
  }]);
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async () => ({
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    title: 'Stat Holidays',
    entries: []
  });
  require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates =
    async (activity, entries, reqUser) => {
      maintenanceArgs = { activity, entries, reqUser };
      return activity;
    };
  timesheetParametersPolicyModel.savePolicyForOrg = async () => ({});

  try {
    const outcome = await statutoryHolidayDayMappingService.mapHolidayDaysToActivity({
      orgId: 'ORG_1',
      year: '2026',
      activityId: 'ACT_STAT',
      policy: {
        statutoryHolidayPay: {
          activityId: '',
          payableHolidayTypes: ['National Holiday']
        }
      },
      reqUser: { id: 'USER_1' }
    });

    assert.equal(outcome.createdCount, 1);
    assert.equal(maintenanceArgs?.entries?.length, 1);
    const entry = maintenanceArgs.entries[0];
    assert.equal(entry.startTime, '08:00');
    assert.equal(entry.endTime, '20:00');
    assert.equal(entry.durationHours, 12);
    assert.equal(entry.statHolidayId, 'H2');
    assert.deepEqual(entry.assignees, []);
  } finally {
    schoolDataService.fetchAllData = originalFetch;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolve;
    require('../MVC/services/school/timesheetImportWorkSessionBuilderService').persistImportActivityEntryUpdates = originalPersist;
    timesheetParametersPolicyModel.savePolicyForOrg = originalSavePolicy;
  }
});
