const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SERVICE_PATH = path.join(ROOT, 'packages/school/MVC/services/school/workSessionExplorerService.js');
const activityService = require('../MVC/services/school/activityService');
const schoolAdminAccessService = require('../MVC/services/school/schoolAdminAccessService');
const workSessionExplorerService = require('../MVC/services/school/workSessionExplorerService');

const originalListActivities = activityService.listActivities;
const originalIsWorkSessionsAdminViewer = schoolAdminAccessService.isWorkSessionsAdminViewer;
const originalIsActivitiesAdminViewer = schoolAdminAccessService.isActivitiesAdminViewer;

test.afterEach(() => {
  activityService.listActivities = originalListActivities;
  schoolAdminAccessService.isWorkSessionsAdminViewer = originalIsWorkSessionsAdminViewer;
  schoolAdminAccessService.isActivitiesAdminViewer = originalIsActivitiesAdminViewer;
});

test('normalizeFilters validates date range', () => {
  assert.throws(
    () => workSessionExplorerService.normalizeFilters({ startDate: '2026-02-10', endDate: '2026-02-01' }),
    /startDate cannot be after endDate/
  );
});

test('applyViewerPersonFilters locks scoped teachers to their person id', () => {
  const filters = workSessionExplorerService.applyViewerPersonFilters(
    { personIds: [], personId: '' },
    { isAdminViewer: false, lockedPersonId: 'PER-TEACHER-1' }
  );

  assert.deepEqual(filters.personIds, ['PER-TEACHER-1']);
  assert.equal(filters.personId, 'PER-TEACHER-1');
});

test('listWorkSessions returns one scoped row per assignee and hides other assignees', async () => {
  schoolAdminAccessService.isWorkSessionsAdminViewer = () => false;
  schoolAdminAccessService.isActivitiesAdminViewer = () => false;

  activityService.listActivities = async () => ([
    {
      id: 'ACT-1',
      title: 'PD Day',
      status: 'posted',
      evaluationType: 'completion',
      entries: [
        {
          entryId: 'ENT-1',
          status: 'posted',
          date: '2026-03-01',
          startTime: '09:00',
          endTime: '12:00',
          assignees: [
            { personId: 'PER-TEACHER-1', personName: 'Teacher One', completionStatus: 'pending' },
            { personId: 'PER-TEACHER-2', personName: 'Teacher Two', completionStatus: 'completed' }
          ]
        }
      ]
    }
  ]);

  const req = {
    user: {
      activeOrgId: 'ORG-1',
      personId: 'PER-TEACHER-1'
    },
    accessScope: 'SCP_DEPT'
  };

  const result = await workSessionExplorerService.listWorkSessions(req, {});

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].personId, 'PER-TEACHER-1');
  assert.equal(result.rows[0].activityTitle, 'PD Day');
  assert.equal(result.rows[0].canQuickComplete, true);
  assert.match(result.rows[0].manageUrl, /\/school\/activities\/ACT-1\/work-sessions\/ENT-1\/manage/);
});

test('listWorkSessions returns all assignee rows for admin viewers', async () => {
  schoolAdminAccessService.isWorkSessionsAdminViewer = () => true;
  schoolAdminAccessService.isActivitiesAdminViewer = () => false;

  activityService.listActivities = async () => ([
    {
      id: 'ACT-2',
      title: 'Staff Meeting',
      status: 'posted',
      evaluationType: 'attendance',
      entries: [
        {
          entryId: 'ENT-2',
          status: 'posted',
          date: '2026-03-02',
          startTime: '13:00',
          endTime: '14:00',
          assignees: [
            { personId: 'PER-A', personName: 'Person A', status: 'attended' },
            { personId: 'PER-B', personName: 'Person B', status: '' }
          ]
        }
      ]
    }
  ]);

  const req = {
    user: {
      activeOrgId: 'ORG-1',
      personId: 'PER-ADMIN'
    },
    accessScope: 'SCP_ORG'
  };

  const result = await workSessionExplorerService.listWorkSessions(req, {});

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.personId).sort(), ['PER-A', 'PER-B']);
  assert.equal(result.viewer.isAdminViewer, true);
});

test('listWorkSessions ignores draft activities and non-posted entries', async () => {
  schoolAdminAccessService.isWorkSessionsAdminViewer = () => true;
  schoolAdminAccessService.isActivitiesAdminViewer = () => false;

  activityService.listActivities = async () => ([
    {
      id: 'ACT-DRAFT',
      title: 'Draft Activity',
      status: 'draft',
      evaluationType: 'completion',
      entries: [
        {
          entryId: 'ENT-DRAFT',
          status: 'posted',
          date: '2026-03-03',
          assignees: [{ personId: 'PER-X', personName: 'Hidden' }]
        }
      ]
    },
    {
      id: 'ACT-3',
      title: 'Posted Activity',
      status: 'posted',
      evaluationType: 'completion',
      entries: [
        {
          entryId: 'ENT-DRAFT-ENTRY',
          status: 'draft',
          date: '2026-03-04',
          assignees: [{ personId: 'PER-Y', personName: 'Also Hidden' }]
        },
        {
          entryId: 'ENT-3',
          status: 'posted',
          date: '2026-03-05',
          startTime: '10:00',
          endTime: '11:00',
          assignees: [{ personId: 'PER-Z', personName: 'Visible', completionStatus: 'pending' }]
        }
      ]
    }
  ]);

  const req = {
    user: { activeOrgId: 'ORG-1', personId: 'PER-ADMIN' },
    accessScope: 'SCP_ORG'
  };

  const result = await workSessionExplorerService.listWorkSessions(req, {});

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].personId, 'PER-Z');
});

test('work session explorer service file exports list API helpers', () => {
  const source = fs.readFileSync(SERVICE_PATH, 'utf8');
  assert.match(source, /buildWorkSessionExplorerViewer/);
  assert.match(source, /listWorkSessions/);
  assert.match(source, /isWorkSessionAdminViewer/);
});
