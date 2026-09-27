'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const manualWorkSessionService = require('../MVC/services/school/timesheetManualWorkSessionService');
const materializationService = require('../MVC/services/school/timesheetManualMaterializationService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

const DEFAULT_TITLE = timesheetParametersPolicyService.DEFAULT_MANUAL_ACTIVITY_WORK_SESSION_TITLE;

test('policy service applies manual activity work session defaults and validation', () => {
  const resolved = timesheetParametersPolicyService.resolvePolicy({});
  assert.equal(resolved.manualActivityWorkSession.defaultTitle, DEFAULT_TITLE);
  assert.equal(resolved.manualActivityWorkSession.defaultStartTime, '08:00');
  assert.equal(resolved.manualActivityWorkSession.defaultEndTime, '20:00');

  const fromForm = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'false',
    manualActivityWorkSessionDefaultTitle: 'Shared manual block',
    manualActivityWorkSessionDefaultStartTime: '07:00',
    manualActivityWorkSessionDefaultEndTime: '21:00'
  });
  assert.equal(fromForm.manualActivityWorkSession.defaultTitle, 'Shared manual block');
  assert.equal(fromForm.manualActivityWorkSession.defaultStartTime, '07:00');
  assert.equal(fromForm.manualActivityWorkSession.defaultEndTime, '21:00');

  assert.throws(
    () => timesheetParametersPolicyService.validatePolicyInput({
      emptyEnrollmentSessions: 'hide',
      statutoryHolidayPayEnabled: 'false',
      manualActivityWorkSessionDefaultStartTime: '20:00',
      manualActivityWorkSessionDefaultEndTime: '08:00'
    }),
    /end time must be later than start time/i
  );
});

test('findGenericWorkSessionForAssignee reuses policy-titled session when assignee fits', () => {
  const entries = [
    {
      entryId: 'ENTRY-1',
      title: DEFAULT_TITLE,
      date: '2026-07-15',
      startTime: '08:00',
      endTime: '20:00',
      status: 'posted'
    },
    {
      entryId: 'ENTRY-2',
      title: 'Other session',
      date: '2026-07-15',
      startTime: '08:00',
      endTime: '20:00',
      status: 'posted'
    }
  ];
  const found = manualWorkSessionService.findGenericWorkSessionForAssignee(entries, {
    date: '2026-07-15',
    defaultTitle: DEFAULT_TITLE,
    assigneeStart: '14:00',
    assigneeEnd: '16:00'
  });
  assert.equal(found, 'ENTRY-1');
});

test('findGenericWorkSessionForAssignee rejects different title and outside window', () => {
  const entries = [
    {
      entryId: 'ENTRY-1',
      title: DEFAULT_TITLE,
      date: '2026-07-15',
      startTime: '08:00',
      endTime: '12:00',
      status: 'posted'
    }
  ];
  assert.equal(
    manualWorkSessionService.findGenericWorkSessionForAssignee(entries, {
      date: '2026-07-15',
      defaultTitle: 'Custom title',
      assigneeStart: '10:00',
      assigneeEnd: '11:00'
    }),
    null
  );
  assert.equal(
    manualWorkSessionService.findGenericWorkSessionForAssignee(entries, {
      date: '2026-07-15',
      defaultTitle: DEFAULT_TITLE,
      assigneeStart: '11:00',
      assigneeEnd: '13:00'
    }),
    null
  );
});

test('resolveAssigneeNotesFromManualEntry prefers comment and description', () => {
  assert.equal(
    manualWorkSessionService.resolveAssigneeNotesFromManualEntry({ comment: 'Note A', description: 'Desc B' }),
    'Note A'
  );
  assert.equal(
    manualWorkSessionService.resolveAssigneeNotesFromManualEntry({
      description: 'Desc only',
      className: DEFAULT_TITLE
    }, { defaultSessionTitle: DEFAULT_TITLE }),
    'Desc only'
  );
});

test('materializeActivityManualEntry creates generic session with policy envelope and assignee notes', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-IND-WS',
    orgId: '900000',
    title: 'Individual Prep',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'individual',
    allowedPersonIds: ['P8'],
    entries: []
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    const result = await materializationService.materializeActivityManualEntry({
      entry: {
        sessionId: 'MAN_IND_WS',
        activityId: 'ACT-IND-WS',
        activityPaid: true,
        approvalStatus: 'approved',
        description: 'Suggested prep block',
        date: '2026-07-15',
        startTime: '14:00',
        endTime: '16:00',
        durationHours: 2
      },
      timesheet: { id: 'TS2', orgId: '900000' },
      teacherId: 'P8',
      reqUser: { id: 'U1' }
    });

    assert.equal(result.linkedExisting, false);
    const created = savedActivity.entries.find((row) => String(row?.entryId || '') === String(result.activityEntryId || ''));
    assert.ok(created);
    assert.equal(created.title, DEFAULT_TITLE);
    assert.equal(created.date, '2026-07-15');
    assert.equal(created.startTime, '08:00');
    assert.equal(created.endTime, '20:00');
    assert.equal(created.assignees[0].startTime, '14:00');
    assert.equal(created.assignees[0].endTime, '16:00');
    assert.equal(created.assignees[0].notes, 'Suggested prep block');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('materializeActivityManualEntry find-or-creates for public rows without activityEntryId', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-PUB-WS',
    orgId: '900000',
    title: 'Public',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    allowedPersonIds: ['P1'],
    entries: []
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    const result = await materializationService.materializeActivityManualEntry({
      entry: {
        sessionId: 'MAN_PUB_WS',
        activityId: 'ACT-PUB-WS',
        activityPaid: true,
        approvalStatus: 'approved',
        description: 'Public note',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '10:00',
        durationHours: 1
      },
      timesheet: { id: 'TS3', orgId: '900000' },
      teacherId: 'P1',
      reqUser: { id: 'U1' }
    });
    assert.ok(result.activityEntryId);
    assert.equal(savedActivity.entries[0].title, DEFAULT_TITLE);
    assert.equal(savedActivity.entries[0].assignees[0].notes, 'Public note');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});
