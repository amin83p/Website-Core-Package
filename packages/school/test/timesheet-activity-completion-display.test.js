'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityService = require('../MVC/services/school/activityService');
const dataService = require('../MVC/services/school/schoolDataService');

const baseActivity = {
  id: 'ACT_1',
  orgId: 'ORG_1',
  status: 'posted',
  paid: true,
  title: 'Reports and Timesheet',
  departmentId: 'DEPT_1',
  visibilityScope: 'school',
  attendees: [{ personId: 'TEACHER_1' }],
  entries: [{
    entryId: 'ENT-1',
    status: 'posted',
    date: '2026-03-10',
    startTime: '12:00',
    endTime: '19:00',
    durationHours: 7,
    assignees: [{
      personId: 'TEACHER_1',
      status: 'attended',
      paid: true,
      paidHours: 7
    }]
  }]
};

function mockActivityFetch(activities) {
  const originalFetchData = dataService.fetchData;
  const originalFetchAll = dataService.fetchAllData;
  dataService.fetchData = async (entityType) => (
    entityType === 'activities' ? activities : []
  );
  dataService.fetchAllData = async () => [];
  return () => {
    dataService.fetchData = originalFetchData;
    dataService.fetchAllData = originalFetchAll;
  };
}

test('buildActivityTimesheetRowStatus uses attended label for attendance evaluation', () => {
  const row = activityService.buildActivityTimesheetRowStatus(
    { evaluationType: 'attendance' },
    { status: 'attended' }
  );
  assert.equal(row.statusCode, 'attended');
  assert.equal(row.statusLabel, 'Attended activity');
  assert.equal(row.isFinalStatus, true);
  assert.equal(row.evaluationType, 'attendance');
});

test('buildActivityTimesheetRowStatus uses completed label for completion evaluation', () => {
  const row = activityService.buildActivityTimesheetRowStatus(
    { evaluationType: 'completion' },
    { completionStatus: 'completed' }
  );
  assert.equal(row.statusCode, 'completed');
  assert.equal(row.statusLabel, 'Completed activity');
  assert.equal(row.isFinalStatus, true);
  assert.equal(row.evaluationType, 'completion');
});

test('getTimesheetEntriesForPerson enriches activity row status fields', async () => {
  const restore = mockActivityFetch([baseActivity]);
  try {
    const rows = await activityService.getTimesheetEntriesForPerson({
      orgId: 'ORG_1',
      personId: 'TEACHER_1',
      periodStartDate: '2026-03-01',
      periodEndDate: '2026-03-31',
      reqUser: { activeOrgId: 'ORG_1' }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'attended');
    assert.equal(rows[0].activityStatusLabel, 'Attended activity');
    assert.equal(rows[0].activityEvaluationType, 'attendance');
    assert.equal(rows[0].isFinalStatus, true);
    assert.equal(rows[0].isSchoolActivity, true);
  } finally {
    restore();
  }
});

test('getIncompleteActivityWorkSessionsForPerson lists non-attended assignee', async () => {
  const activity = {
    ...baseActivity,
    entries: [{
      ...baseActivity.entries[0],
      assignees: [{
        personId: 'TEACHER_1',
        status: 'scheduled',
        paid: true,
        paidHours: 7
      }]
    }]
  };
  const restore = mockActivityFetch([activity]);
  try {
    const rows = await activityService.getIncompleteActivityWorkSessionsForPerson({
      orgId: 'ORG_1',
      personId: 'TEACHER_1',
      periodStartDate: '2026-03-01',
      periodEndDate: '2026-03-31',
      reqUser: { activeOrgId: 'ORG_1' }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionType, 'activity');
    assert.equal(rows[0].activityEntryId, 'ENT-1');
  } finally {
    restore();
  }
});

test('timesheet editor shows green activity completion chip and honors isFinalStatus', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /entry\?\.isSchoolActivity === true && entry\?\.isManual !== true/);
  assert.match(editorSource, /activityStatusLabel/);
  assert.doesNotMatch(
    editorSource,
    /if \(entry\.isSchoolActivity === true \|\| String\(entry\?\.sessionId \|\| ''\)\.startsWith\('act-'\)\) return true;/
  );
});
