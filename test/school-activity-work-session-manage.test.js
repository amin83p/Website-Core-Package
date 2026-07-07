const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Activity work session routes, controller, service, and view are wired', () => {
  const activityRoute = readText('packages/school/MVC/routes/activityRoutes.js');
  assert.match(activityRoute, /work-sessions\/manage/);
  assert.match(activityRoute, /work-sessions\/api\/overview/);
  assert.match(activityRoute, /work-sessions\/:entryId\/api\/context/);
  assert.match(activityRoute, /ctrl\.manageWorkSessionsOverview/);
  assert.match(activityRoute, /ctrl\.getWorkSessionContextJson/);
  assert.match(activityRoute, /work-sessions\/:entryId\/manage/);
  assert.match(activityRoute, /work-sessions\/:entryId\/save/);
  assert.match(activityRoute, /work-sessions\/:entryId\/complete/);
  assert.match(activityRoute, /ctrl\.manageWorkSession/);
  assert.match(activityRoute, /ctrl\.saveWorkSessionAssignee/);
  assert.match(activityRoute, /ctrl\.completeWorkSessionAssignee/);
  assert.match(activityRoute, /work-sessions\/manage[\s\S]*OPERATIONS\.UPDATE/);
  assert.match(activityRoute, /work-sessions\/:entryId\/api\/context[\s\S]*OPERATIONS\.UPDATE/);
  assert.match(activityRoute, /work-sessions\/:entryId\/manage[\s\S]*OPERATIONS\.UPDATE/);
  assert.match(activityRoute, /work-sessions\/:entryId\/complete[\s\S]*allowOperationTokenFallback:\s*true/);

  const controller = readText('packages/school/MVC/controllers/school/activityController.js');
  assert.match(controller, /activityWorkSessionService/);
  assert.match(controller, /manageWorkSessionsOverview/);
  assert.match(controller, /getWorkSessionContextJson/);
  assert.match(controller, /getWorkSessionsOverviewJson/);
  assert.match(controller, /manageWorkSession/);
  assert.match(controller, /sessions\.length === 1/);
  assert.match(controller, /activityWorkSessionManager/);
  assert.match(controller, /resolveWorkSessionManageTargetForRequest/);
  assert.doesNotMatch(controller, /siblingSessions\.length > 1/);
  assert.match(controller, /completeWorkSessionAssignee/);

  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/services/school/activityWorkSessionService.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/activity/activityWorkSessionManager.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/activity/activityWorkSessionsOverview.ejs')));

  const form = readText('packages/school/MVC/views/school/activity/activityForm.ejs');
  assert.match(form, /name="evaluationType"/);
  assert.match(form, /activityEvaluationType/);

  const manager = readText('packages/school/MVC/views/school/activity/activityWorkSessionManager.ejs');
  assert.match(manager, /evaluationTypeLabel/);
  assert.match(manager, /Save session/);
  assert.match(manager, /session-info-header/);
  assert.match(manager, /workSessionStatusButton/);
  assert.match(manager, /btnSaveWorkSession/);
  assert.match(manager, /Session status/);
  assert.match(manager, /Complete/);
  assert.match(manager, /Manage Work Session/);
  assert.match(manager, /All Activities/);
  assert.match(manager, /All work sessions/);
  assert.match(manager, /session-manager-toolbar-row/);
  assert.match(manager, /session-manager-shell/);
  assert.match(manager, /session-manager-sidebar/);
  assert.match(manager, /session-manager-main/);
  assert.match(manager, /Session Detail/);
  assert.match(manager, /session-manager-info-card/);
  assert.match(manager, /session-manager-class-nav-toggle/);
  assert.match(manager, /session-summary-card/);
  assert.match(manager, /work-session-assignee-form/);
  assert.match(manager, /ws-assignee-save-form/);
  assert.match(manager, /ws-notes-input/);
  assert.doesNotMatch(manager, /Attendance roster/);
  assert.match(manager, /att-label/);
  assert.match(manager, /btn-check ws-att-radio/);
  assert.match(manager, /btnCloseWorkSessionManager/);
  assert.match(manager, /POST" action="<%= manageUrl %>\/save/);
  assert.match(manager, /POST" action="<%= manageUrl %>\/complete/);
  assert.match(manager, /evaluationTypeLocked/);
  assert.match(manager, /if \(!isCompletion\)/);
  assert.doesNotMatch(manager, /Switch session:/);

  const overview = readText('packages/school/MVC/views/school/activity/activityWorkSessionsOverview.ejs');
  assert.match(overview, /workSessionsTable/);
  assert.match(overview, /activityWorkSessionModal/);
  assert.match(overview, /js-open-work-session/);
  assert.match(overview, /openWorkSessionModal/);
  assert.match(overview, /renderAssigneeTable/);
  assert.match(overview, /context\.evaluationType/);
  assert.match(overview, /rowIsCompletion/);
  assert.match(overview, /!rowIsCompletion\) html \+= '<th>Attendance<\/th>'/);
  assert.match(overview, /payload\.actionStateId/);
  assert.match(controller, /actionStateId: req\.actionStateId/);
  assert.match(controller, /getWorkSessionContextJson[\s\S]*actionStateId: req\.actionStateId/);
});

test('Activity model sanitizes evaluationType and assignee completion fields', () => {
  const activityModel = require('../packages/school/MVC/models/school/activityModel');

  const attendance = activityModel.sanitizeActivityPayload({
    orgId: '900000',
    title: 'Attendance Activity',
    categoryId: 'CAT-1',
    departmentId: 'DEP-1',
    evaluationType: 'attendance',
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-07-01',
      startTime: '09:00',
      endTime: '11:00',
      assignees: [{ personId: 'P1', status: 'attended' }]
    }]
  });
  assert.equal(attendance.evaluationType, 'attendance');
  assert.equal(attendance.entries[0].assignees[0].completionStatus, 'pending');
  assert.equal(attendance.entries[0].assignees[0].locked, false);

  const completion = activityModel.sanitizeActivityPayload({
    orgId: '900000',
    title: 'Completion Activity',
    categoryId: 'CAT-1',
    departmentId: 'DEP-1',
    evaluationType: 'completion',
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-07-02',
      startTime: '10:00',
      endTime: '12:00',
      assignees: [{
        personId: 'P2',
        status: 'attended',
        completionStatus: 'completed',
        completedAt: '2026-07-02T12:00:00.000Z',
        completedBy: 'P2'
      }]
    }]
  });
  assert.equal(completion.evaluationType, 'completion');
  assert.equal(completion.entries[0].assignees[0].completionStatus, 'completed');
});

test('Activity service enforces evaluation type immutability when assignee rows are locked', () => {
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const existing = {
    id: 'ACT-1',
    evaluationType: 'attendance',
    entries: [{
      entryId: 'ENTRY-1',
      assignees: [{
        personId: 'P1',
        status: 'attended',
        locked: true,
        lockReason: 'timesheet_approved'
      }]
    }]
  };
  assert.throws(() => {
    activityService.enforceActivityLockRules(existing, {
      ...existing,
      evaluationType: 'completion',
      entries: existing.entries
    });
  }, /Evaluation type cannot be changed/);
});

test('Activity service timesheet eligibility differs by evaluation type', () => {
  const activityService = require('../packages/school/MVC/services/school/activityService');

  const attendanceActivity = { paid: true, evaluationType: 'attendance' };
  const completionActivity = { paid: true, evaluationType: 'completion' };
  const attendedAssignee = { personId: 'P1', status: 'attended', paid: true, completionStatus: 'pending' };
  const completedAssignee = { personId: 'P1', status: 'attended', paid: true, completionStatus: 'completed' };

  assert.equal(activityService.isAssigneeEligibleForTimesheet(attendanceActivity, attendedAssignee), true);
  assert.equal(activityService.isAssigneeEligibleForTimesheet(completionActivity, attendedAssignee), false);
  assert.equal(activityService.isAssigneeEligibleForTimesheet(completionActivity, completedAssignee), true);
});

test('Complete assignee is rejected for attendance-type activities', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalGet = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;

  const activity = {
    id: 'ACT-TEST-1',
    orgId: '900000',
    title: 'Test',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-07-01',
      startTime: '09:00',
      endTime: '11:00',
      durationHours: 2,
      status: 'posted',
      assignees: [{ personId: 'P1', personName: 'Person 1', status: 'attended', paid: true, paidHours: 2 }]
    }]
  };

  schoolDataService.getDataById = async (type, id) => (type === 'activities' && id === activity.id ? activity : null);
  schoolDataService.updateData = async () => activity;

  const reqUser = { id: 'U1', personId: 'P1', activeOrgId: '900000', orgId: '900000' };

  try {
    await assert.rejects(
      () => activityWorkSessionService.completeAssignee({
        activityId: activity.id,
        entryId: 'ENTRY-1',
        personId: 'P1',
        reqUser,
        accessContext: { scopeId: 'SCP_ORG' }
      }),
      /Completion is only available for completion-type activities/
    );
  } finally {
    schoolDataService.getDataById = originalGet;
    schoolDataService.updateData = originalUpdate;
  }
});

test('School dependency service locks only targeted assignee rows', async () => {
  const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalGet = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;

  let saved = null;
  const activity = {
    id: 'ACT-LOCK-1',
    entries: [{
      entryId: 'ENTRY-1',
      assignees: [
        { personId: 'P1', status: 'attended' },
        { personId: 'P2', status: 'attended' }
      ]
    }]
  };

  schoolDataService.getDataById = async () => activity;
  schoolDataService.updateData = async (_type, _id, payload) => {
    saved = payload;
    return payload;
  };

  try {
    const result = await schoolDependencyService.lockActivityAssignees({
      activityId: activity.id,
      locks: [{ entryId: 'ENTRY-1', personId: 'P1' }],
      timesheetId: 'TS-1',
      reqUser: { id: 'ADMIN-1' }
    });
    assert.equal(result.locked, 1);
    assert.equal(saved.entries[0].assignees[0].locked, true);
    assert.equal(saved.entries[0].assignees[1].locked, undefined);
    assert.notEqual(saved.entries[0].assignees[1].locked, true);
  } finally {
    schoolDataService.getDataById = originalGet;
    schoolDataService.updateData = originalUpdate;
  }
});

test('Timesheet refs include activity personId from act- session ids', () => {
  const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');
  const refs = schoolDependencyService.collectRefsFromEntry({
    sessionId: 'act-ACT-1-ENTRY-1-P9',
    hours: 2
  });
  assert.ok(refs.some((ref) => ref.type === 'activity'
    && ref.activityId === 'ACT-1'
    && ref.activityEntryId === 'ENTRY-1'
    && ref.personId === 'P9'));
});

test('Navigation links point to work sessions overview for posted activities', () => {
  const hubService = readText('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');
  assert.match(hubService, /\/work-sessions\/manage/);
  assert.doesNotMatch(hubService, /postedEntry\.entryId/);

  const activityList = readText('packages/school/MVC/views/school/activity/activityList.ejs');
  assert.match(activityList, /\/work-sessions\/manage/);

  const activityServiceText = readText('packages/school/MVC/services/school/activityService.js');
  assert.match(activityServiceText, /work-sessions\/\$\{encodeURIComponent\(entry\.entryId\)\}\/manage/);

  const calendarService = readText('packages/school/MVC/services/school/schoolCalendarService.js');
  assert.match(calendarService, /work-sessions/);

  const timesheetEditor = readText('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(timesheetEditor, /work-sessions\/\$\{encodeURIComponent\(entryId\)\}\/manage/);
});

test('resolveWorkSessionManageTarget routes single sessions to dedicated page and multi to overview', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const originalGetActivity = activityService.getActivity;

  const singleSessionActivity = {
    id: 'ACT-ONE',
    orgId: '900000',
    title: 'Single Session Activity',
    status: 'posted',
    evaluationType: 'completion',
    entries: [{
      entryId: 'ENTRY-ONLY',
      date: '2026-07-01',
      status: 'posted',
      assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
    }]
  };

  const multiSessionActivity = {
    id: 'ACT-MULTI',
    orgId: '900000',
    title: 'Multi Session Activity',
    status: 'posted',
    evaluationType: 'attendance',
    entries: [
      {
        entryId: 'ENTRY-1',
        date: '2026-07-01',
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      },
      {
        entryId: 'ENTRY-2',
        date: '2026-07-02',
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      }
    ]
  };

  activityService.getActivity = async (activityId) => {
    if (activityId === 'ACT-ONE') return singleSessionActivity;
    if (activityId === 'ACT-MULTI') return multiSessionActivity;
    return null;
  };

  try {
    const singleTarget = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId: 'ACT-ONE',
      entryId: 'ENTRY-ONLY',
      reqUser: { id: 'ADMIN', activeOrgId: '900000' },
      accessContext: { scopeId: 'SCP_ORG' }
    });
    assert.equal(singleTarget.mode, 'dedicated');
    assert.match(singleTarget.url, /\/work-sessions\/ENTRY-ONLY\/manage$/);

    const multiTarget = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId: 'ACT-MULTI',
      entryId: 'ENTRY-2',
      reqUser: { id: 'ADMIN', activeOrgId: '900000' },
      accessContext: { scopeId: 'SCP_ORG' }
    });
    assert.equal(multiTarget.mode, 'dedicated');
    assert.match(multiTarget.url, /\/work-sessions\/ENTRY-2\/manage$/);

    const multiNoEntry = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId: 'ACT-MULTI',
      reqUser: { id: 'ADMIN', activeOrgId: '900000' },
      accessContext: { scopeId: 'SCP_ORG' }
    });
    assert.equal(multiNoEntry.mode, 'overview');
    assert.match(multiNoEntry.url, /\/work-sessions\/manage$/);
    assert.doesNotMatch(multiNoEntry.url, /openEntryId=/);
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('getWorkSessionsOverview returns all posted sessions with assignee names', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const originalGetActivity = activityService.getActivity;

  const activity = {
    id: 'ACT-OVERVIEW-1',
    orgId: '900000',
    title: 'Multi Session Activity',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    entries: [
      {
        entryId: 'ENTRY-1',
        title: 'Morning prep',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '11:00',
        durationHours: 2,
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      },
      {
        entryId: 'ENTRY-2',
        title: 'Afternoon delivery',
        date: '2026-07-02',
        startTime: '13:00',
        endTime: '15:00',
        durationHours: 2,
        status: 'posted',
        assignees: [
          { personId: 'P1', personName: 'Alice', status: 'attended' },
          { personId: 'P2', personName: 'Bob', status: 'absent' }
        ]
      }
    ]
  };

  activityService.getActivity = async () => activity;

  try {
    const context = await activityWorkSessionService.getWorkSessionsOverview(
      activity.id,
      { id: 'ADMIN', activeOrgId: '900000' },
      { scopeId: 'SCP_ORG' }
    );
    assert.equal(context.sessions.length, 2);
    assert.equal(context.sessions[0].title, 'Morning prep');
    assert.match(context.sessions[0].assigneeNames, /Alice/);
    assert.equal(context.sessions[1].assigneeCount, 2);
    assert.match(context.sessions[1].assigneeNames, /Bob/);
    assert.equal(context.redirectToSessionUrl, undefined);
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('getWorkSessionsOverview filters to assignee sessions only', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const originalGetActivity = activityService.getActivity;

  const activity = {
    id: 'ACT-OVERVIEW-2',
    orgId: '900000',
    title: 'Scoped Activity',
    status: 'posted',
    evaluationType: 'attendance',
    entries: [
      {
        entryId: 'ENTRY-1',
        title: 'Session A',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '11:00',
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      },
      {
        entryId: 'ENTRY-2',
        title: 'Session B',
        date: '2026-07-02',
        startTime: '13:00',
        endTime: '15:00',
        status: 'posted',
        assignees: [{ personId: 'P2', personName: 'Bob', status: 'attended' }]
      }
    ]
  };

  activityService.getActivity = async () => activity;

  try {
    const multi = await activityWorkSessionService.getWorkSessionsOverview(
      activity.id,
      { id: 'U1', personId: 'P1', activeOrgId: '900000' },
      { scopeId: 'SCP_DEPT' }
    );
    assert.equal(multi.sessions.length, 1);
    assert.equal(multi.sessions[0].entryId, 'ENTRY-1');

    const singleActivity = {
      ...activity,
      entries: [activity.entries[0]]
    };
    activityService.getActivity = async () => singleActivity;
    const single = await activityWorkSessionService.getWorkSessionsOverview(
      activity.id,
      { id: 'ADMIN', activeOrgId: '900000' },
      { scopeId: 'SCP_ORG' }
    );
    assert.equal(single.sessions.length, 1);
    assert.equal(single.sessions[0].entryId, 'ENTRY-1');
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('getWorkSessionContext includes sibling sessions for switcher', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const originalGetActivity = activityService.getActivity;

  const activity = {
    id: 'ACT-SWITCH-1',
    orgId: '900000',
    title: 'Switcher Activity',
    status: 'posted',
    evaluationType: 'attendance',
    entries: [
      {
        entryId: 'ENTRY-1',
        title: 'First',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '11:00',
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      },
      {
        entryId: 'ENTRY-2',
        title: 'Second',
        date: '2026-07-02',
        startTime: '13:00',
        endTime: '15:00',
        status: 'posted',
        assignees: [{ personId: 'P1', personName: 'Alice', status: 'attended' }]
      }
    ]
  };

  activityService.getActivity = async () => activity;

  try {
    const context = await activityWorkSessionService.getWorkSessionContext(
      activity.id,
      'ENTRY-1',
      { id: 'ADMIN', activeOrgId: '900000' },
      { scopeId: 'SCP_ORG' }
    );
    assert.equal(context.siblingSessions.length, 2);
    assert.equal(context.siblingSessions.filter((row) => row.isCurrent).length, 1);
    assert.match(context.overviewUrl, /work-sessions\/manage/);
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('Completion save rejects attendance status changes and complete auto-attends paid rows', async () => {
  const activityWorkSessionService = require('../packages/school/MVC/services/school/activityWorkSessionService');
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalGetActivity = activityService.getActivity;
  const originalGet = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;

  const activity = {
    id: 'ACT-COMPLETE-UX',
    orgId: '900000',
    title: 'Completion UX',
    status: 'posted',
    paid: true,
    evaluationType: 'completion',
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-07-01',
      startTime: '09:00',
      endTime: '11:00',
      durationHours: 2,
      status: 'posted',
      assignees: [{ personId: 'P1', personName: 'Person 1', status: 'absent', paid: true, paidHours: 2, completionStatus: 'pending' }]
    }]
  };

  let savedAssignee = null;
  activityService.getActivity = async () => activity;
  schoolDataService.getDataById = async (type, id) => (type === 'activities' && id === activity.id ? activity : null);
  schoolDataService.updateData = async (_type, _id, payload) => {
    savedAssignee = payload.entries[0].assignees[0];
    Object.assign(activity.entries[0].assignees[0], savedAssignee);
    return payload;
  };

  const reqUser = { id: 'U1', personId: 'P1', activeOrgId: '900000', orgId: '900000' };

  try {
    await assert.rejects(
      () => activityWorkSessionService.saveAssigneeRow({
        activityId: activity.id,
        entryId: 'ENTRY-1',
        personId: 'P1',
        reqUser,
        input: { status: 'attended' },
        accessContext: { scopeId: 'SCP_ORG' }
      }),
      /Attendance cannot be changed/
    );

    const result = await activityWorkSessionService.completeAssignee({
      activityId: activity.id,
      entryId: 'ENTRY-1',
      personId: 'P1',
      reqUser,
      input: { notes: 'Done' },
      accessContext: { scopeId: 'SCP_ORG' }
    });
    assert.equal(result.context.entry.assignees[0].completionStatus, 'completed');
    assert.equal(savedAssignee.status, 'attended');
    assert.ok(result.sessionSummary);
    assert.equal(result.sessionSummary.readyCount, 1);
  } finally {
    activityService.getActivity = originalGetActivity;
    schoolDataService.getDataById = originalGet;
    schoolDataService.updateData = originalUpdate;
  }
});

test('School record access service exposes activity work session assert helper', () => {
  const accessService = require('../packages/school/MVC/services/school/schoolRecordAccessService');
  assert.equal(typeof accessService.assertActivityWorkSessionAccessible, 'function');

  const activity = { id: 'ACT-1' };
  const entry = { entryId: 'ENTRY-1', assignees: [{ personId: 'P1' }] };

  assert.doesNotThrow(() => {
    accessService.assertActivityWorkSessionAccessible({
      activity,
      entry,
      access: { scopeMode: 'ORG_WIDE', canViewAll: true },
      context: 'manageWorkSession'
    });
  });

  assert.throws(() => {
    accessService.assertActivityWorkSessionAccessible({
      activity,
      entry,
      access: { scopeMode: 'ASSIGNMENT', personId: 'P9' },
      context: 'manageWorkSession'
    });
  }, /work session/i);
});
