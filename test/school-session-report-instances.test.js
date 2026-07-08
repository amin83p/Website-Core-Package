const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const reportViewService = require('../packages/school/MVC/services/school/reportViewService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const sessionReportAssignmentService = require('../packages/school/MVC/services/school/sessionReportAssignmentService');
const sessionReportInstanceService = require('../packages/school/MVC/services/school/sessionReportInstanceService');
const classController = require('../packages/school/MVC/controllers/school/classController');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

function buildPendingStudentRow({ studentId, studentName, teacherId = 'TEACHER-1' }) {
  return {
    id: `pending-ASN-1-row_1-${teacherId}-student:${studentId}`,
    isPendingAssignment: true,
    orgId: '900000',
    assignmentId: 'ASN-1',
    assignmentRowId: 'row_1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    sessionDate: '2026-06-23',
    templateId: 'TPL-1',
    templateTitle: 'Progress Report',
    teacherId,
    teacherName: teacherId,
    studentId,
    studentName,
    targetKey: `student:${studentId}`,
    status: 'pending'
  };
}

test('each_student assignment on session yields pending rows per student when no instances exist', async () => {
  const instanceRows = [
    buildPendingStudentRow({ studentId: 'STU-1', studentName: 'Alice' }),
    buildPendingStudentRow({ studentId: 'STU-2', studentName: 'Bob' }),
    buildPendingStudentRow({ studentId: 'STU-3', studentName: 'Carol' })
  ];

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => instanceRows
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async (entityType) => {
        if (entityType === 'students') return [];
        if (entityType === 'reportAssignments') {
          return [{
            id: 'ASN-1',
            orgId: '900000',
            classId: 'CLS-1',
            templateId: 'TPL-1',
            reportScope: 'each_student',
            status: 'active',
            targetRows: [{ rowId: 'row_1', sessionId: 'SES-1', sessionDate: '2026-06-23', teacherId: 'TEACHER-1', status: 'active' }]
          }];
        }
        return [];
      }
    }, async () => {
      const rows = await sessionReportInstanceService.buildSessionReportInstanceRows({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        sessionDate: '2026-06-23',
        reqUser: { id: 'USR-ADMIN', personId: 'ADMIN-1', activeOrgId: '900000' },
        viewerContext: {
          isReportAdminViewer: true,
          currentUserPersonId: 'ADMIN-1',
          ownedStudentIds: new Set(),
          ownedStudentPersonIds: new Set(),
          rosterPersonIds: new Set(['STU-1', 'STU-2', 'STU-3']),
          assignmentMap: new Map([['ASN-1', { id: 'ASN-1', reportScope: 'each_student', status: 'active' }]])
        },
        sessionRoster: [
          { personId: 'STU-1', name: 'Alice' },
          { personId: 'STU-2', name: 'Bob' },
          { personId: 'STU-3', name: 'Carol' }
        ]
      });

      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map((row) => row.studentName).sort(), ['Alice', 'Bob', 'Carol']);
      assert.ok(rows.every((row) => row.isPending));
      assert.ok(rows.every((row) => row.href.includes('/school/reports/instances/start/ASN-1')));
      assert.ok(rows.every((row) => row.href.includes('editor=v2')));
    });
  });
});

test('viewer filter limits rows to assigned teacher', async () => {
  const instanceRows = [
    buildPendingStudentRow({ studentId: 'STU-1', studentName: 'Alice', teacherId: 'TEACHER-1' }),
    buildPendingStudentRow({ studentId: 'STU-2', studentName: 'Bob', teacherId: 'TEACHER-2' })
  ];
  const assignment = {
    id: 'ASN-1',
    orgId: '900000',
    classId: 'CLS-1',
    reportScope: 'each_student',
    status: 'active'
  };
  const viewerContext = {
    isReportAdminViewer: false,
    currentUserPersonId: 'TEACHER-1',
    ownedStudentIds: new Set(),
    ownedStudentPersonIds: new Set(),
    rosterPersonIds: new Set(['STU-1', 'STU-2']),
    assignmentMap: new Map([['ASN-1', assignment]])
  };

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => instanceRows
  }, async () => {
    const rows = await sessionReportInstanceService.buildSessionReportInstanceRows({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-06-23',
      reqUser: { id: 'USR-T1', personId: 'TEACHER-1', activeOrgId: '900000' },
      viewerContext,
      sessionRoster: []
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].studentName, 'Alice');
    assert.equal(rows[0].teacherId, 'TEACHER-1');
  });

  assert.equal(
    sessionReportInstanceService.canViewerSeeSessionReportRow(
      instanceRows[1],
      viewerContext
    ),
    false
  );
});

test('existing instance rows map to edit-v2 href and status badge', async () => {
  const instanceRows = [{
    id: 'INST-1',
    isPendingAssignment: false,
    assignmentId: 'ASN-1',
    assignmentRowId: 'row_1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    sessionDate: '2026-06-23',
    templateTitle: 'Progress Report',
    teacherId: 'TEACHER-1',
    teacherName: 'Teacher One',
    studentId: 'STU-1',
    studentName: 'Alice',
    status: 'submitted'
  }];

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => instanceRows
  }, async () => {
    const rows = await sessionReportInstanceService.buildSessionReportInstanceRows({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-06-23',
      reqUser: { id: 'USR-ADMIN', personId: 'ADMIN-1', activeOrgId: '900000' },
      viewerContext: {
        isReportAdminViewer: true,
        currentUserPersonId: 'ADMIN-1',
        ownedStudentIds: new Set(),
        ownedStudentPersonIds: new Set(),
        rosterPersonIds: new Set(),
        assignmentMap: new Map([['ASN-1', { id: 'ASN-1', reportScope: 'each_student', status: 'active' }]])
      },
      sessionRoster: []
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'submitted');
    assert.match(rows[0].href, /\/school\/reports\/instances\/edit-v2\/INST-1/);
    assert.equal(rows[0].actionLabel, 'Open V2');
    assert.equal(rows[0].statusBadgeClass, 'bg-success');
  });
});

test('session report assignment service builds one locked session target row', async () => {
  const classData = { id: 'CLS-1', orgId: '900000', title: 'Class A' };
  const session = {
    sessionId: 'SES-1',
    date: '2026-06-23',
    startTime: '09:00',
    endTime: '11:00',
    delivery: { deliveredBy: 'TEACHER-1', deliveredByName: 'Teacher One' }
  };
  const reqUser = { id: 'USR-ADMIN', personId: 'ADMIN-1', activeOrgId: '900000' };
  let validatorArgs = null;
  let persistedPayload = null;

  await withPatched(reportIntegrityService, {
    validateAssignmentCrossEntityContext: async (args) => {
      validatorArgs = args;
      return {
        template: { id: 'TPL-1', version: 3, title: 'Progress Report' },
        effectiveTargetRows: args.targetRows,
        persistedTargetStudentIds: args.selectedTargetStudentIds
      };
    }
  }, async () => {
    await withPatched(schoolDataService, {
      addData: async (entityType, payload) => {
        assert.equal(entityType, 'reportAssignments');
        persistedPayload = payload;
        return { ...payload, id: 'ASN-NEW' };
      }
    }, async () => {
      const result = await sessionReportAssignmentService.createAssignmentForSession({
        classData,
        session,
        sessionRoster: [{ personId: 'STU-1', name: 'Alice' }],
        input: {
          templateId: 'TPL-1',
          reportScope: 'selected_students',
          targetStudentIds: 'STU-1',
          reportStartDate: '2026-06-20',
          taskStartTime: '09:15',
          taskEndTime: '10:45',
          timesheetReflection: 'true',
          allocatedHours: '1.5',
          conflictPermitted: 'true',
          notes: 'Session-scoped assignment'
        },
        reqUser
      });

      assert.equal(result.assignment.id, 'ASN-NEW');
      assert.equal(validatorArgs.classId, 'CLS-1');
      assert.equal(validatorArgs.templateId, 'TPL-1');
      assert.equal(validatorArgs.reportScope, 'selected_students');
      assert.deepEqual(validatorArgs.selectedSessionIds, ['SES-1']);
      assert.deepEqual(validatorArgs.teacherIds, ['TEACHER-1']);
      assert.deepEqual(validatorArgs.selectedTargetStudentIds, ['STU-1']);
      assert.equal(validatorArgs.targetRows.length, 1);
      assert.equal(validatorArgs.targetRows[0].targetType, 'session');
      assert.equal(validatorArgs.targetRows[0].sessionId, 'SES-1');
      assert.equal(validatorArgs.targetRows[0].reportDueDate, '2026-06-23');
      assert.equal(validatorArgs.targetRows[0].taskStartTime, '09:15');
      assert.equal(validatorArgs.targetRows[0].taskEndTime, '10:45');
      assert.equal(validatorArgs.targetRows[0].timesheetReflection, true);
      assert.equal(validatorArgs.targetRows[0].allocatedHours, 1.5);
      assert.equal(persistedPayload.classId, 'CLS-1');
      assert.equal(persistedPayload.templateId, 'TPL-1');
      assert.equal(persistedPayload.targetType, 'session');
      assert.equal(persistedPayload.sessionId, 'SES-1');
      assert.equal(persistedPayload.reportDueDate, '2026-06-23');
      assert.deepEqual(persistedPayload.teacherIds, ['TEACHER-1']);
    });
  });
});

test('session report assignment service rejects invalid session modal inputs', async () => {
  const base = {
    classData: { id: 'CLS-1', orgId: '900000', title: 'Class A' },
    session: {
      sessionId: 'SES-1',
      date: '2026-06-23',
      startTime: '09:00',
      endTime: '11:00',
      delivery: { deliveredBy: 'TEACHER-1', deliveredByName: 'Teacher One' }
    },
    sessionRoster: [{ personId: 'STU-1', name: 'Alice' }],
    reqUser: { id: 'USR-ADMIN', activeOrgId: '900000' }
  };

  await assert.rejects(
    () => sessionReportAssignmentService.createAssignmentForSession({
      ...base,
      input: { templateId: 'TPL-1', reportScope: 'class', reportStartDate: '2026-06-23', taskStartTime: '08:59', taskEndTime: '10:00' }
    }),
    /before the session start time/
  );

  await assert.rejects(
    () => sessionReportAssignmentService.createAssignmentForSession({
      ...base,
      input: { templateId: 'TPL-1', reportScope: 'selected_students', targetStudentIds: 'STU-404', reportStartDate: '2026-06-23', taskStartTime: '09:00', taskEndTime: '10:00' }
    }),
    /not in this session roster/
  );
});
test('class routes expose session report endpoints with correct access and action-state guards', () => {
  const src = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(src, /\/:id\/sessions\/:sessionId\/report-instances/);
  assert.match(src, /classCtrl\.listSessionReportInstances/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.READ_ALL\)/);
  assert.match(src, /\/:id\/sessions\/:sessionId\/report-assignments/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_REPORTS_ASSIGNMENT, OPERATIONS\.CREATE\)/);
  assert.match(src, /trackActionState\(SECTIONS\.SCHOOL_REPORTS_ASSIGNMENT, OPERATIONS\.CREATE, sessionReportAssignmentActionState\)/);
  assert.match(src, /allowOperationTokenFallback:\s*true/);
  assert.match(src, /allowInactiveTokenFallback:\s*true/);
  assert.match(src, /allowSectionTokenFallback:\s*true/);
  assert.match(src, /classCtrl\.assignReportToSession/);
});
test('listSessionReportInstances returns JSON rows payload', async () => {
  const classRow = { id: 'CLS-1', orgId: '900000', title: 'Class A' };
  const session = {
    sessionId: 'SES-1',
    date: '2026-06-23',
    roster: [{ personId: 'STU-1', name: 'Alice' }]
  };
  const dtoRows = [{
    id: 'INST-1',
    isPending: false,
    templateTitle: 'Progress Report',
    studentName: 'Alice',
    studentId: 'STU-1',
    teacherName: 'Teacher One',
    teacherId: 'TEACHER-1',
    status: 'draft',
    statusLabel: 'draft',
    href: '/school/reports/instances/edit-v2/INST-1',
    actionLabel: 'Open V2',
    assignmentId: 'ASN-1',
    assignmentRowId: 'row_1',
    statusBadgeClass: 'bg-warning text-dark'
  }];

  await withPatched(schoolDataService, {
    getDataById: async () => classRow,
    getClassSessions: async () => [session]
  }, async () => {
    await withPatched(sessionReportInstanceService, {
      buildSessionReportViewerContext: async () => ({ assignmentMap: new Map() }),
      buildSessionReportInstanceRows: async () => dtoRows
    }, async () => {
      const req = {
        params: { id: 'CLS-1', sessionId: 'SES-1' },
        user: { id: 'USR-1', personId: 'TEACHER-1', activeOrgId: '900000' }
      };
      let payload = null;
      const res = {
        json(body) { payload = body; return this; },
        status() { return this; }
      };

      await classController.listSessionReportInstances(req, res);
      assert.equal(payload.status, 'success');
      assert.deepEqual(payload.rows, dtoRows);
      assert.ok(payload.refreshedAt);
    });
  });
});

test('session manager renders report instances tab, refresh control, and client wiring', () => {
  const src = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(src, /session-manager-nav-label">Reports</);
  assert.match(src, /id="sessionReportInstancesBody"/);
  assert.match(src, /id="btnRefreshSessionReportInstances"/);
  assert.match(src, /renderSessionReportInstances/);
  assert.match(src, /refreshSessionReportInstances/);
  assert.match(src, /\/report-instances/);
  assert.match(src, /Open V2/);
  assert.match(src, /sessionReportInstanceRows/);
  assert.match(src, /target="_blank"/);
  assert.match(src, /id="btnOpenSessionReportAssignmentModal"/);
  assert.match(src, /id="sessionReportAssignmentModal"/);
  assert.match(src, /id="sessionReportTemplateId"/);
  assert.match(src, /id="sessionReportScope"/);
  assert.match(src, /id="sessionReportSpecificStudentsWrap"/);
  assert.match(src, /id="sessionReportTaskStart"/);
  assert.match(src, /id="sessionReportTaskEnd"/);
  assert.match(src, /id="sessionReportTimesheetReflection"/);
  assert.match(src, /id="sessionReportAllocatedHours"/);
  assert.match(src, /sourceMode:\s*'local'/);
  assert.match(src, /\/report-assignments/);
  assert.doesNotMatch(src, /sessionReportAssignmentRows/);
});
