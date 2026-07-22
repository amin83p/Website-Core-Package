const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet editor manual modal uses activity definitions and freezes class manuals', () => {
  const source = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(source, /manualActivities/);
  assert.match(source, /data-paid=/);
  assert.match(source, /data-visibility-scope=/);
  assert.match(source, /id="man_startTime"/);
  assert.match(source, /id="man_endTime"/);
  assert.match(source, /id="man_activityEntryId"/);
  assert.match(source, /btnPickWorkSession/);
  assert.match(source, /Work Session Required/);
  assert.match(source, /Public activities require selecting an existing work session/);
  assert.match(source, /id="btnViewDaySchedule"/);
  assert.match(source, /buildManualEntryScheduleUrl/);
  assert.match(source, /\/school\/schedules\/my\?/);
  assert.match(source, /showTimesheetWaitingModal/);
  assert.match(source, /hideTimesheetWaitingModal/);
  assert.match(source, /Manual entry validation/);
  assert.match(source, /Pending Approval/);
  assert.match(source, /INCOMPLETE_SESSIONS/);
  assert.match(source, /incomplete-sessions-table/);
  assert.match(source, /incompleteSessionsPanel/);
  assert.match(source, /incompleteSessionsCollapse/);
  assert.match(source, /data-bs-toggle="collapse"/);
  assert.match(source, /Class \/ Activity/);
  assert.match(source, /Manage Work Session/);
  assert.match(source, /Manage Session/);
  assert.match(source, /collapsible <strong>Incomplete Sessions<\/strong> panel below/);
  assert.match(source, /\/school\/classes\/\$\{encodeURIComponent\(classId\)\}\/sessions\//);
  assert.match(source, /modal-dialog modal-lg/);
  assert.match(source, /validateManualRowBeforeSave/);
  assert.match(source, /Select activity/);
  assert.doesNotMatch(source, /Other \/ description/);
  assert.match(source, /Description-only manual entries are no longer allowed/);
  assert.match(source, /Class Manuals Frozen/);
  assert.match(source, /Manual class sessions are temporarily disabled/);
  assert.match(source, /openCopyManualRowModal/);
  assert.match(source, /isIndividualManualActivityRow/);
  assert.match(source, /copyManualRowModal/);
  assert.match(source, /isCopyTargetDayEligible/);
  assert.match(source, /\/school\/timesheets\/api\/manual-entry-work-sessions/);
  assert.match(source, /api\/validate-manual-row/);
});

test('timesheet routes expose manual entry picker and validation APIs', () => {
  const source = read('packages/school/MVC/routes/timesheetRoutes.js');
  assert.match(source, /api\/manual-entry-classes/);
  assert.match(source, /api\/manual-entry-work-sessions/);
  assert.match(source, /api\/validate-manual-row/);
  assert.match(source, /listManualEntryClasses/);
  assert.match(source, /listManualEntryWorkSessions/);
  assert.match(source, /validateManualTimesheetRow/);
});

test('timesheet controller wires activity-based manual options and incomplete warnings', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(source, /listManualEntryActivitiesForPerson/);
  assert.match(source, /listManualEntryWorkSessionsForPerson/);
  assert.match(source, /listManualEntryClasses/);
  assert.match(source, /listManualEntryWorkSessions/);
  assert.match(source, /resolveManualActivityWorkSessionBinding/);
  assert.match(source, /Public activities require selecting an existing work session/);
  assert.match(source, /visibilityScope/);
  assert.match(source, /buildDataServiceQuery\(req\.query\)/);
  assert.match(source, /paginate\(results, query\)/);
  assert.match(source, /searchTerm/);
  assert.match(source, /validateManualTimesheetRow/);
  assert.match(source, /timesheetManualMaterializationService/);
  assert.match(source, /attendanceDuePeriodId/);
  assert.match(source, /materializeApprovedTimesheetManualEntries/);
  assert.match(source, /revertMaterializedRecordsForTimesheet/);
  assert.match(source, /runTimesheetConflictValidation/);
  assert.match(source, /isPersonEligibleForActivity/);
  assert.match(source, /manualActivities/);
  assert.match(source, /incompleteSessions/);
  assert.match(source, /getIncompleteActivityWorkSessionsForPerson/);
  assert.match(source, /sessionType: 'class'/);
  assert.match(source, /sortIncompleteSessions/);
  assert.match(source, /MANUAL_ENTRY_SCHEDULE_CONFLICT/);
  assert.match(source, /detectRoleAwareManualEntryConflicts/);
  assert.match(source, /activityLiveSessions/);
  assert.match(source, /getTimesheetEntriesForPerson/);
  assert.match(source, /activityLiveById/);
  assert.match(source, /isSchoolActivity === true \|\| sessionId\.startsWith\('act-'\)/);
  assert.match(source, /Manual entries with a class or activity require start and end time/);
});

test('timesheet model stores manual approval fields and excludes pending rows from totals', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_RULE_1',
    teacherId: 'P_900',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_1',
      date: '2026-07-01',
      className: 'School Activity - Paid',
      classId: null,
      requestedHours: 2.5,
      durationHours: 2.5,
      hours: 2.5,
      activityId: 'ACT_1',
      activityName: 'Parent Workshop',
      activityPaid: true,
      startTime: '09:00',
      endTime: '11:30',
      approvalStatus: 'pending_approval',
      excludeFromTotals: true,
      comment: 'Awaiting approval',
      isManual: true
    }]
  });

  assert.equal(payload.totalHours, 0);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].requestedHours, 2.5);
  assert.equal(payload.entries[0].approvalStatus, 'pending_approval');
  assert.equal(payload.entries[0].excludeFromTotals, true);
  assert.equal(payload.entries[0].hours, 0);
});

test('timesheet model keeps backward compatibility for legacy manual rows', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_RULE_2',
    teacherId: 'P_901',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_OLD',
      date: '2026-07-02',
      className: 'Legacy manual row',
      hours: 1.5,
      status: 'manual',
      comment: 'legacy',
      isManual: true
    }]
  });

  assert.equal(payload.totalHours, 1.5);
  assert.equal(payload.entries[0].hours, 1.5);
  assert.equal(payload.entries[0].approvalStatus, 'approved');
  assert.equal(payload.entries[0].excludeFromTotals, false);
});

test('activity service returns incomplete paid work sessions for timesheet warnings', async () => {
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalFetchData = schoolDataService.fetchData;

  const activities = [
    {
      id: 'ACT-INC-1',
      orgId: '900000',
      title: 'Completion Activity',
      status: 'posted',
      paid: true,
      evaluationType: 'completion',
      visibilityScope: 'school',
      entries: [{
        entryId: 'ENTRY-1',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '11:00',
        durationHours: 2,
        status: 'posted',
        assignees: [
          { personId: 'P1', personName: 'Alice', status: 'attended', paid: true, completionStatus: 'pending' },
          { personId: 'P2', personName: 'Bob', status: 'attended', paid: true, completionStatus: 'completed' }
        ]
      }]
    },
    {
      id: 'ACT-INC-2',
      orgId: '900000',
      title: 'Attendance Activity',
      status: 'posted',
      paid: true,
      evaluationType: 'attendance',
      visibilityScope: 'school',
      entries: [{
        entryId: 'ENTRY-1',
        date: '2026-07-02',
        startTime: '13:00',
        endTime: '15:00',
        durationHours: 2,
        status: 'posted',
        assignees: [
          { personId: 'P1', personName: 'Alice', status: 'absent', paid: true },
          { personId: 'P3', personName: 'Carol', status: 'attended', paid: true }
        ]
      }]
    }
  ];

  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'activities') return activities;
    return [];
  };

  try {
    const incompleteForP1 = await activityService.getIncompleteActivityWorkSessionsForPerson({
      orgId: '900000',
      personId: 'P1',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    assert.equal(incompleteForP1.length, 2);
    assert.equal(incompleteForP1[0].sessionType, 'activity');
    const completionRow = incompleteForP1.find((row) => row.activityId === 'ACT-INC-1');
    const attendanceRow = incompleteForP1.find((row) => row.activityId === 'ACT-INC-2');
    assert.match(completionRow.statusLabel, /Pending completion/i);
    assert.equal(attendanceRow.statusLabel, 'Absent');

    const eligibleOnly = await activityService.getTimesheetEntriesForPerson({
      orgId: '900000',
      personId: 'P3',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    assert.equal(eligibleOnly.length, 1);
    assert.match(eligibleOnly[0].sessionId, /^act-/);
    assert.equal(eligibleOnly[0].isSchoolActivity, true);
    assert.equal(eligibleOnly[0].isFinalStatus, true);

    const incompleteForP3 = await activityService.getIncompleteActivityWorkSessionsForPerson({
      orgId: '900000',
      personId: 'P3',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    assert.equal(incompleteForP3.length, 0);
  } finally {
    schoolDataService.fetchData = originalFetchData;
  }
});

test('manual conflict service supports activity rows and internal timesheet overlap', () => {
  const source = read('packages/school/MVC/services/school/timesheetManualConflictService.js');
  assert.match(source, /findApprovedLeaveConflicts/);
  assert.match(source, /getScheduleEventsForPerson/);
  assert.match(source, /detectRoleAwareManualEntryConflicts/);
  assert.match(source, /detectTimesheetInternalOverlaps/);
  assert.match(source, /activityId/);
  assert.match(source, /same_day_schedule/);
});

test('listManualEntryActivitiesForPerson includes posted eligible activities only', async () => {
  const activityService = require('../packages/school/MVC/services/school/activityService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const originalFetchData = schoolDataService.fetchData;
  const activities = [
    {
      id: 'ACT-PUB',
      orgId: '900000',
      title: 'School Event',
      status: 'posted',
      paid: true,
      visibilityScope: 'school',
      entries: []
    },
    {
      id: 'ACT-IND',
      orgId: '900000',
      title: 'Private Workshop',
      status: 'posted',
      paid: false,
      visibilityScope: 'individual',
      allowedPersonIds: ['P1'],
      entries: []
    },
    {
      id: 'ACT-EXC',
      orgId: '900000',
      title: 'Excluded',
      status: 'posted',
      paid: true,
      visibilityScope: 'school',
      excludedPersonIds: ['P1'],
      entries: []
    },
    {
      id: 'ACT-DRAFT',
      orgId: '900000',
      title: 'Draft',
      status: 'draft',
      paid: true,
      visibilityScope: 'school',
      entries: []
    }
  ];
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'activities') return activities;
    return [];
  };
  try {
    const rows = await activityService.listManualEntryActivitiesForPerson({
      orgId: '900000',
      personId: 'P1',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });
    const ids = rows.map((row) => row.id);
    assert.ok(ids.includes('ACT-PUB'));
    assert.ok(ids.includes('ACT-IND'));
    assert.equal(ids.includes('ACT-EXC'), false);
    assert.equal(ids.includes('ACT-DRAFT'), false);
  } finally {
    schoolDataService.fetchData = originalFetchData;
  }
});

test('my schedule page supports anchor date deep links from timesheet manual entry', () => {
  const source = read('packages/school/MVC/views/school/schedule/mySchedule.ejs');
  assert.match(source, /urlParams\.get\('anchorDate'\)/);
  assert.match(source, /urlParams\.get\('period'\)/);
});

test('materialization service marks manual candidates and resolves next period', () => {
  const service = require('../packages/school/MVC/services/school/timesheetManualMaterializationService');
  assert.equal(typeof service.materializeApprovedTimesheetManualEntries, 'function');
  assert.equal(typeof service.revertMaterializedRecordsForTimesheet, 'function');
  assert.equal(service.isManualMaterializationCandidate({
    sessionId: 'MAN_1',
    isManual: true,
    classId: 'CLS-1',
    approvalStatus: 'approved',
    date: '2026-07-01'
  }), true);
  assert.equal(service.isManualMaterializationCandidate({
    sessionId: 'SES-001',
    isManual: true,
    classId: 'CLS-1'
  }), false);
});

test('timesheet editor uses stacked header, readable table layout, and no day/week subtotals', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(editor, /ts-page-header/);
  assert.match(editor, /ts-period-name/);
  assert.match(editor, /ts-person-name/);
  assert.match(editor, /personDisplayName/);
  assert.match(editor, /<i class="bi bi-calendar2-week me-2"><\/i>Timesheet<\/h1>/);
  assert.doesNotMatch(editor, /Timesheet: <%= period\.name %>/);
  assert.match(editor, /viewingOtherPerson/);
  assert.match(editor, /buildDateCellHtml/);
  assert.match(editor, /ts-day-name/);
  assert.match(editor, /weekday: 'long'/);
  assert.match(editor, /<th class="ts-col-time"[^>]*>Time<\/th>/);
  assert.match(editor, /table-light border-bottom/);
  assert.doesNotMatch(editor, /Daily Total:/);
  assert.doesNotMatch(editor, /End of Week Total:/);
  assert.doesNotMatch(editor, /ID: \$\{\(ses\.sessionId/);

  assert.match(controller, /personName: teacherContext\.selectedTeacherName/);
  assert.match(controller, /viewingOtherPerson/);
});
