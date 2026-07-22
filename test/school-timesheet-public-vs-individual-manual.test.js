const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const activityService = require('../packages/school/MVC/services/school/activityService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const materializationService = require('../packages/school/MVC/services/school/timesheetManualMaterializationService');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

test('listManualEntryWorkSessionsForPerson returns only public posted sessions in period', async () => {
  const originalGetById = schoolDataService.getDataById;
  schoolDataService.getDataById = async () => ({
    id: 'ACT-PUB-1',
    orgId: '900000',
    title: 'Public Workshop',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    allowedPersonIds: ['P1'],
    entries: [
      {
        entryId: 'ENTRY-1',
        title: 'Morning',
        date: '2026-07-10',
        startTime: '09:00',
        endTime: '11:00',
        durationHours: 2,
        status: 'posted',
        assignees: [{ personId: 'P1', status: 'attended', paid: true }]
      },
      {
        entryId: 'ENTRY-2',
        title: 'Outside period',
        date: '2026-08-01',
        startTime: '09:00',
        endTime: '10:00',
        durationHours: 1,
        status: 'posted',
        assignees: [{ personId: 'P1', status: 'attended', paid: true }]
      },
      {
        entryId: 'ENTRY-3',
        title: 'Draft',
        date: '2026-07-11',
        startTime: '13:00',
        endTime: '14:00',
        durationHours: 1,
        status: 'draft',
        assignees: [{ personId: 'P1', status: 'attended', paid: true }]
      }
    ]
  });

  try {
    const rows = await activityService.listManualEntryWorkSessionsForPerson({
      orgId: '900000',
      activityId: 'ACT-PUB-1',
      personId: 'P1',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entryId, 'ENTRY-1');
    assert.equal(rows[0].sessionName, 'Morning');
    assert.equal(rows[0].date, '2026-07-10');
    assert.equal(rows[0].startTime, '09:00');
    assert.equal(rows[0].endTime, '11:00');
    assert.equal(rows[0].visibilityScope, 'school');
  } finally {
    schoolDataService.getDataById = originalGetById;
  }
});

test('listManualEntryWorkSessionsForPerson returns empty for individual activities', async () => {
  const originalGetById = schoolDataService.getDataById;
  schoolDataService.getDataById = async () => ({
    id: 'ACT-IND-1',
    orgId: '900000',
    title: 'Private Prep',
    status: 'posted',
    paid: true,
    visibilityScope: 'individual',
    allowedPersonIds: ['P1'],
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-07-10',
      startTime: '09:00',
      endTime: '10:00',
      durationHours: 1,
      status: 'posted',
      assignees: [{ personId: 'P1', status: 'attended', paid: true }]
    }]
  });

  try {
    const rows = await activityService.listManualEntryWorkSessionsForPerson({
      orgId: '900000',
      activityId: 'ACT-IND-1',
      personId: 'P1',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    assert.deepEqual(rows, []);
  } finally {
    schoolDataService.getDataById = originalGetById;
  }
});

test('materializeActivityManualEntry links existing public work session instead of creating', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-PUB-2',
    orgId: '900000',
    title: 'Public Activity',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    allowedPersonIds: ['P9'],
    entries: [{
      entryId: 'ENTRY-9',
      title: 'Existing session',
      date: '2026-07-12',
      startTime: '10:00',
      endTime: '12:00',
      durationHours: 2,
      status: 'posted',
      assignees: [{ personId: 'P9', status: 'scheduled', paid: true, paidHours: 0 }]
    }]
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    const result = await materializationService.materializeActivityManualEntry({
      entry: {
        sessionId: 'MAN_PUBLIC_1',
        activityId: 'ACT-PUB-2',
        activityEntryId: 'ENTRY-9',
        activityPaid: true,
        approvalStatus: 'approved',
        date: '2026-07-12',
        startTime: '10:00',
        endTime: '12:00',
        durationHours: 2,
        comment: 'claimed'
      },
      timesheet: { id: 'TS1', orgId: '900000' },
      teacherId: 'P9',
      reqUser: { id: 'U1' }
    });

    assert.equal(result.linkedExisting, true);
    assert.equal(result.activityEntryId, 'ENTRY-9');
    assert.equal(result.sessionId, 'act-ACT-PUB-2-ENTRY-9-P9');
    assert.equal(savedActivity.entries.length, 1);
    assert.equal(savedActivity.entries[0].entryId, 'ENTRY-9');
    assert.equal(savedActivity.entries[0].assignees[0].status, 'attended');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('materializeActivityManualEntry creates new entry for individual suggest rows', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-IND-2',
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
        sessionId: 'MAN_IND_1',
        activityId: 'ACT-IND-2',
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
    assert.match(String(result.activityEntryId || ''), /^ENTRY-\d+$/);
    assert.ok(Array.isArray(savedActivity.entries) && savedActivity.entries.length >= 1);
    const created = savedActivity.entries.find((row) => String(row?.entryId || '') === String(result.activityEntryId || ''));
    assert.ok(created);
    assert.equal(created.title, 'Suggested prep block');
    assert.equal(created.date, '2026-07-15');
    assert.equal(created.startTime, '14:00');
    assert.equal(created.endTime, '16:00');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('materializeActivityManualEntry rejects public rows without activityEntryId', async () => {
  const originalGetById = schoolDataService.getDataById;
  schoolDataService.getDataById = async () => ({
    id: 'ACT-PUB-3',
    orgId: '900000',
    title: 'Public',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    allowedPersonIds: ['P1'],
    entries: []
  });

  try {
    await assert.rejects(
      () => materializationService.materializeActivityManualEntry({
        entry: {
          sessionId: 'MAN_BAD',
          activityId: 'ACT-PUB-3',
          approvalStatus: 'approved',
          date: '2026-07-01',
          startTime: '09:00',
          endTime: '10:00',
          durationHours: 1
        },
        timesheet: { id: 'TS3' },
        teacherId: 'P1',
        reqUser: { id: 'U1' }
      }),
      /must select an existing work session/i
    );
  } finally {
    schoolDataService.getDataById = originalGetById;
  }
});

test('timesheet model preserves activityEntryId and visibilityScope on manual rows', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_PUB',
    teacherId: 'P_900',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_PUB',
      date: '2026-07-01',
      className: 'Public Workshop: Morning',
      classId: null,
      requestedHours: 2,
      durationHours: 2,
      hours: 0,
      activityId: 'ACT_1',
      activityEntryId: 'ENTRY-1',
      activityName: 'Public Workshop',
      activityPaid: true,
      visibilityScope: 'school',
      startTime: '09:00',
      endTime: '11:00',
      approvalStatus: 'pending_approval',
      excludeFromTotals: true,
      isManual: true
    }]
  });

  assert.equal(payload.entries[0].activityEntryId, 'ENTRY-1');
  assert.equal(payload.entries[0].visibilityScope, 'school');
});

test('materialization and conflict services keep public-link and individual-suggest contracts', () => {
  const materialization = read('packages/school/MVC/services/school/timesheetManualMaterializationService.js');
  assert.match(materialization, /linkedExisting/);
  assert.match(materialization, /Public activity manual rows must select an existing work session/);
  assert.match(materialization, /Individual activity manual rows cannot materialize against an existing work session/);
  assert.match(materialization, /applyActivityMaterializationMarkers/);
  assert.match(materialization, /revertMaterializedActivityManualEntry/);

  const conflict = read('packages/school/MVC/services/school/timesheetManualConflictService.js');
  assert.match(conflict, /detectRoleAwareManualEntryConflicts/);
  assert.match(conflict, /manual_overlap/);
  assert.match(conflict, /listRoleAwareActivityScheduleEvents/);
});

test('applyActivityMaterializationMarkers keeps MAN_* sessionId and stamps materialization fields', () => {
  const marked = materializationService.applyActivityMaterializationMarkers(
    {
      sessionId: 'MAN_KEEP_1',
      activityId: 'ACT-1',
      activityPaid: true,
      requestedHours: 2,
      hours: 0
    },
    {
      activityEntryId: 'ENTRY-9',
      sessionId: 'act-ACT-1-ENTRY-9-P1'
    },
    { id: 'TS-KEEP' }
  );

  assert.equal(marked.sessionId, 'MAN_KEEP_1');
  assert.equal(marked.activityEntryId, 'ENTRY-9');
  assert.equal(marked.materializedSessionId, 'act-ACT-1-ENTRY-9-P1');
  assert.equal(marked.materializedFromTimesheetId, 'TS-KEEP');
  assert.equal(marked.materializedFromTimesheetEntryId, 'MAN_KEEP_1');
  assert.ok(marked.materializedAt);
  assert.equal(marked.approvalStatus, 'approved');
  assert.equal(marked.hours, 2);
  assert.equal(materializationService.isManualMaterializationCandidate(marked), false);
});

test('materializeActivityManualEntry writes completed for completion evaluation type', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-COMP-1',
    orgId: '900000',
    title: 'Completion Activity',
    status: 'posted',
    paid: true,
    evaluationType: 'completion',
    visibilityScope: 'school',
    allowedPersonIds: ['P7'],
    entries: [{
      entryId: 'ENTRY-C1',
      title: 'Session',
      date: '2026-07-12',
      startTime: '10:00',
      endTime: '11:00',
      durationHours: 1,
      status: 'posted',
      assignees: []
    }]
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    await materializationService.materializeActivityManualEntry({
      entry: {
        sessionId: 'MAN_COMP_1',
        activityId: 'ACT-COMP-1',
        activityEntryId: 'ENTRY-C1',
        activityPaid: true,
        approvalStatus: 'approved',
        date: '2026-07-12',
        startTime: '10:00',
        endTime: '11:00',
        durationHours: 1
      },
      timesheet: { id: 'TS-COMP', orgId: '900000' },
      teacherId: 'P7',
      reqUser: { id: 'U1' }
    });

    const assignee = savedActivity.entries[0].assignees[0];
    assert.equal(assignee.status, 'attended');
    assert.equal(assignee.completionStatus, 'completed');
    assert.equal(assignee.materializedFromTimesheetEntryId, 'MAN_COMP_1');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('revertMaterializedActivityManualEntry removes public assignee tagged by manual row', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-REV-1',
    orgId: '900000',
    title: 'Public',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    allowedPersonIds: ['P1', 'P2'],
    entries: [{
      entryId: 'ENTRY-R1',
      status: 'posted',
      assignees: [
        { personId: 'P2', status: 'attended', paid: true },
        {
          personId: 'P1',
          status: 'attended',
          paid: true,
          materializedFromTimesheetId: 'TS-REV',
          materializedFromTimesheetEntryId: 'MAN_REV_1'
        }
      ]
    }]
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    const result = await materializationService.revertMaterializedActivityManualEntry({
      timesheetId: 'TS-REV',
      timesheetEntryId: 'MAN_REV_1',
      activityId: 'ACT-REV-1',
      activityEntryId: 'ENTRY-R1',
      reqUser: { id: 'U1' }
    });
    assert.equal(result.reverted, true);
    assert.equal(result.revertedAssignees, 1);
    assert.equal(savedActivity.entries[0].assignees.length, 1);
    assert.equal(savedActivity.entries[0].assignees[0].personId, 'P2');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('revertMaterializedActivityManualEntry drops individual ENTRY created from the manual row', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  let savedActivity = null;

  schoolDataService.getDataById = async () => ({
    id: 'ACT-REV-2',
    orgId: '900000',
    title: 'Individual',
    status: 'posted',
    paid: true,
    visibilityScope: 'individual',
    allowedPersonIds: ['P1'],
    entries: [{
      entryId: 'ENTRY-99',
      status: 'posted',
      assignees: [{
        personId: 'P1',
        status: 'attended',
        paid: true,
        materializedFromTimesheetId: 'TS-REV-2',
        materializedFromTimesheetEntryId: 'MAN_IND_REV'
      }]
    }]
  });
  schoolDataService.updateData = async (_entity, _id, payload) => {
    savedActivity = payload;
    return payload;
  };

  try {
    const result = await materializationService.revertMaterializedActivityManualEntry({
      timesheetId: 'TS-REV-2',
      timesheetEntryId: 'MAN_IND_REV',
      activityId: 'ACT-REV-2',
      activityEntryId: 'ENTRY-99',
      reqUser: { id: 'U1' }
    });
    assert.equal(result.reverted, true);
    assert.equal(result.removedEntry, true);
    assert.equal(savedActivity.entries.length, 0);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
  }
});

test('materializeApprovedTimesheetManualEntries skips already-materialized activity rows', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  const originalFetch = schoolDataService.fetchData;
  let activityUpdates = 0;

  schoolDataService.getDataById = async () => {
    throw new Error('should not load activity for already-materialized rows');
  };
  schoolDataService.updateData = async () => {
    activityUpdates += 1;
    return {};
  };
  schoolDataService.fetchData = async () => [];

  try {
    const result = await materializationService.materializeApprovedTimesheetManualEntries({
      timesheet: {
        id: 'TS-SKIP',
        orgId: '900000',
        teacherId: 'P1',
        entries: [{
          sessionId: 'MAN_SKIP_1',
          isManual: true,
          activityId: 'ACT-SKIP',
          activityEntryId: 'ENTRY-1',
          activityPaid: true,
          approvalStatus: 'approved',
          materializedAt: '2026-07-20T00:00:00.000Z',
          materializedSessionId: 'act-ACT-SKIP-ENTRY-1-P1',
          date: '2026-07-10',
          startTime: '09:00',
          endTime: '10:00',
          durationHours: 1,
          hours: 1
        }]
      },
      period: { id: 'PER-1', orgId: '900000', startDate: '2026-07-01', endDate: '2026-07-31' },
      reqUser: { id: 'U1' }
    });
    assert.equal(result.summary.activities.length, 0);
    assert.equal(activityUpdates, 0);
    assert.equal(result.timesheet.entries[0].sessionId, 'MAN_SKIP_1');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
    schoolDataService.fetchData = originalFetch;
  }
});

test('decideManualTimesheetRow wires approve-time activity materialization and reject revert', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /materializeActivityManualEntry/);
  assert.match(controller, /applyActivityMaterializationMarkers/);
  assert.match(controller, /revertMaterializedActivityManualEntry/);
  assert.match(controller, /assertManualClassEntryAllowed/);
  assert.match(controller, /assertManualStructuredEntryRequired/);
  assert.match(controller, /Manual entries require selecting an activity/);
  assert.match(controller, /Manual class sessions are temporarily disabled/);
});

test('timesheet editor freezes class manuals and supports individual copy', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(view, /Select activity/);
  assert.doesNotMatch(view, /Other \/ description/);
  assert.match(view, /Manual class sessions are temporarily disabled/);
  assert.match(view, /div_man_classPicker/);
  assert.match(view, /Class Manuals Frozen/);
  assert.match(view, /grandfatheredClass/);
  assert.match(view, /openCopyManualRowModal/);
  assert.match(view, /isIndividualManualActivityRow/);
  assert.match(view, /copyManualRowModal/);
  assert.match(view, /isCopyTargetDayEligible/);
  assert.match(view, /visibilityScope:\s*'individual'/);
  assert.match(view, /activityEntryId:\s*''/);
});
