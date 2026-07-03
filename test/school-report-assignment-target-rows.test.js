const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const reportAssignmentModel = require('../packages/school/MVC/models/school/reportAssignmentModel');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const reportViewService = require('../packages/school/MVC/services/school/reportViewService');
const reportController = require('../packages/school/MVC/controllers/school/reportController');

const ROOT_DIR = path.resolve(__dirname, '..');
const reqUser = { id: 'USER-1', personId: 'PERSON-1', activeOrgId: '900000' };

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

function buildTargetRow(overrides = {}) {
  return {
    rowId: 'row_1',
    targetType: 'session',
    sessionId: 'S1',
    sessionDate: '2026-06-10',
    reportStartDate: '2026-06-10',
    reportDueDate: '2026-06-20',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    conflictPermitted: true,
    timesheetReflection: false,
    allocatedHours: 0,
    teacherId: 'TEACHER-1',
    status: 'active',
    ...overrides
  };
}

async function withAssignmentValidationFixtures(callback) {
  const classRow = { id: 'CLASS-1', orgId: '900000', title: 'Class 1' };
  const sessions = [
    { sessionId: 'S1', date: '2026-06-10', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'S2', date: '2026-06-20', startTime: '09:00', endTime: '10:00' }
  ];
  const template = { id: 'TPL-1', orgId: '900000', title: 'Template 1' };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => (entityType === 'classes' && id === 'CLASS-1' ? classRow : null),
    getClassSessions: async () => sessions,
    fetchData: async (entityType) => (entityType === 'classes' ? [classRow] : [])
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async (id) => (id === 'TPL-1' ? template : null)
    }, callback);
  });
}

test('assignment save request parses targetRowsJson for multi-row assignments', () => {
  const parsed = reportViewService.parseAssignmentSaveRequest({
    classId: 'CLASS-1',
    templateId: 'TPL-1',
    teacherIds: ['TEACHER-1'],
    reportScope: 'class',
    targetRowsJson: JSON.stringify([
      buildTargetRow({ rowId: 'row_a', sessionId: 'S1' }),
      buildTargetRow({ rowId: 'row_b', sessionId: 'S2', sessionDate: '2026-06-20' })
    ])
  });

  assert.equal(parsed.targetRows.length, 2);
  assert.deepEqual(parsed.targetRows.map((row) => row.rowId), ['row_a', 'row_b']);
  assert.equal(parsed.targetRows[1].sessionId, 'S2');
  assert.equal(parsed.targetRows[0].teacherId, 'TEACHER-1');
});

test('assignment target-row validation enforces class date bounds, task time, and allocated hours', async () => {
  await withAssignmentValidationFixtures(async () => {
    const base = {
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'class',
      hasSessionTargets: true,
      selectedSessionIds: ['S1'],
      selectedDateTargets: [],
      teacherIds: ['TEACHER-1'],
      requestedTaskStartTime: '09:00',
      requestedTaskEndTime: '10:00',
      conflictPermitted: true,
      requestedReportStartDate: '2026-06-10',
      requestedReportDueDate: '2026-06-20',
      selectedTargetStudentIds: []
    };

    await assert.rejects(
      reportIntegrityService.validateAssignmentCrossEntityContext({
        ...base,
        targetRows: [buildTargetRow({ reportStartDate: '2026-06-09' })]
      }),
      /before the first class session/
    );

    await assert.rejects(
      reportIntegrityService.validateAssignmentCrossEntityContext({
        ...base,
        targetRows: [buildTargetRow({ taskStartTime: '10:00', taskEndTime: '09:00' })]
      }),
      /task end time must be later/
    );

    await assert.rejects(
      reportIntegrityService.validateAssignmentCrossEntityContext({
        ...base,
        targetRows: [buildTargetRow({ timesheetReflection: true, allocatedHours: 0 })]
      }),
      /allocated hours must be greater than zero/
    );
  });
});

test('assignment target-row validation accepts no-session date rows with teacher', async () => {
  await withAssignmentValidationFixtures(async () => {
    const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'class',
      hasSessionTargets: false,
      selectedSessionIds: [],
      selectedDateTargets: [],
      teacherIds: [],
      requestedTaskStartTime: '',
      requestedTaskEndTime: '',
      conflictPermitted: true,
      requestedReportStartDate: '',
      requestedReportDueDate: '',
      selectedTargetStudentIds: [],
      targetRows: [buildTargetRow({
        targetType: 'date',
        sessionId: '',
        sessionDate: '',
        dueDate: '2026-06-20',
        teacherId: 'TEACHER-1'
      })]
    });

    assert.equal(result.effectiveTargetRows.length, 1);
    assert.equal(result.effectiveTargetRows[0].targetType, 'date');
    assert.equal(result.effectiveDateTargets[0], '2026-06-20');
  });
});

test('legacy flat assignments normalize to one effective target row', () => {
  const rows = reportAssignmentModel.getEffectiveTargetRows({
    id: 'ASN-LEGACY',
    targetType: 'session',
    sessionId: 'S1',
    sessionDate: '2026-06-10',
    reportStartDate: '2026-06-10',
    reportDueDate: '2026-06-20',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    teacherIds: ['TEACHER-1'],
    status: 'active'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'S1');
  assert.equal(rows[0].teacherId, 'TEACHER-1');
  assert.equal(rows[0].status, 'active');
});

test('pending instance rows are created per target row teacher without parent cross-product', async () => {
  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return [];
      if (entityType === 'reportAssignments') {
        return [{
          id: 'ASN-1',
          orgId: '900000',
          classId: 'CLASS-1',
          templateId: 'TPL-1',
          teacherIds: ['TEACHER-1', 'TEACHER-2', 'TEACHER-3'],
          reportScope: 'class',
          status: 'active',
          targetRows: [
            buildTargetRow({ rowId: 'row_a', sessionId: 'S1' }),
            buildTargetRow({ rowId: 'row_b', sessionId: 'S2', sessionDate: '2026-06-20', teacherId: 'TEACHER-2' })
          ],
          audit: { createDateTime: '2026-06-01T00:00:00.000Z' }
        }];
      }
      if (entityType === 'reportTemplates') return [{ id: 'TPL-1', orgId: '900000', title: 'Template 1' }];
      if (entityType === 'classes') return [{ id: 'CLASS-1', orgId: '900000', title: 'Class 1' }];
      if (entityType === 'students') return [];
      return [];
    }
  }, async () => {
    const rows = await reportViewService.buildInstanceListRows({ reqUser });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.assignmentRowId).sort(), ['row_a', 'row_b']);
    assert.deepEqual(rows.map((row) => row.teacherId).sort(), ['TEACHER-1', 'TEACHER-2']);
    assert.ok(rows.every((row) => row.isPendingAssignment));
  });
});

test('instance list filters can narrow by assignment row and legacy session target', async () => {
  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') {
        return [{
          id: 'INST-ROW-A',
          orgId: '900000',
          assignmentId: 'ASN-1',
          assignmentRowId: 'row_a',
          classId: 'CLASS-1',
          sessionId: 'S1',
          sessionDate: '2026-06-10',
          templateId: 'TPL-1',
          teacherId: 'TEACHER-1',
          targetKey: 'class',
          status: 'draft',
          audit: { createDateTime: '2026-06-11T00:00:00.000Z' }
        }];
      }
      if (entityType === 'reportAssignments') {
        return [{
          id: 'ASN-1',
          orgId: '900000',
          classId: 'CLASS-1',
          templateId: 'TPL-1',
          teacherIds: ['TEACHER-1', 'TEACHER-2'],
          reportScope: 'class',
          status: 'active',
          targetRows: [
            buildTargetRow({ rowId: 'row_a', sessionId: 'S1' }),
            buildTargetRow({ rowId: 'row_b', sessionId: 'S2', sessionDate: '2026-06-20', teacherId: 'TEACHER-2' })
          ],
          audit: { createDateTime: '2026-06-01T00:00:00.000Z' }
        }];
      }
      if (entityType === 'reportTemplates') return [{ id: 'TPL-1', orgId: '900000', title: 'Template 1' }];
      if (entityType === 'classes') return [{ id: 'CLASS-1', orgId: '900000', title: 'Class 1' }];
      if (entityType === 'students') return [];
      return [];
    }
  }, async () => {
    const assignmentRows = await reportViewService.buildInstanceListRows({ reqUser, assignmentFilter: 'ASN-1' });
    assert.equal(assignmentRows.length, 2);

    const rowA = await reportViewService.buildInstanceListRows({ reqUser, assignmentFilter: 'ASN-1', assignmentRowFilter: 'row_a' });
    assert.deepEqual(rowA.map((row) => row.id), ['INST-ROW-A']);

    const rowB = await reportViewService.buildInstanceListRows({ reqUser, assignmentFilter: 'ASN-1', assignmentRowFilter: 'row_b' });
    assert.equal(rowB.length, 1);
    assert.equal(rowB[0].isPendingAssignment, true);
    assert.equal(rowB[0].assignmentRowId, 'row_b');

    const legacySession = await reportViewService.buildInstanceListRows({ reqUser, assignmentFilter: 'ASN-1', sessionFilter: 'S2' });
    assert.deepEqual(legacySession.map((row) => row.assignmentRowId), ['row_b']);

    const legacyDate = await reportViewService.buildInstanceListRows({ reqUser, assignmentFilter: 'ASN-1', sessionDateFilter: '2026-06-20' });
    assert.deepEqual(legacyDate.map((row) => row.assignmentRowId), ['row_b']);
  });
});

test('report instance list auto-opens single filtered rows through V2', async () => {
  await withPatched(reportViewService, {
    buildInstanceListRows: async () => [{
      id: 'INST-1',
      isPendingAssignment: false,
      assignmentId: 'ASN-1'
    }]
  }, async () => {
    const res = {
      redirectedTo: '',
      redirect(url) { this.redirectedTo = url; return this; },
      json() { throw new Error('Expected redirect, not json.'); },
      render() { throw new Error('Expected redirect, not render.'); },
      status() { return this; }
    };
    await reportController.listInstances({
      query: { assignmentId: 'ASN-1', assignmentRowId: 'row_a', autoOpenSingle: '1' },
      user: reqUser,
      headers: {}
    }, res);
    assert.equal(res.redirectedTo, '/school/reports/instances/edit-v2/INST-1');
  });

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => [{
      id: 'pending-ASN-1-row-a-TEACHER-1-class',
      isPendingAssignment: true,
      assignmentId: 'ASN-1',
      assignmentRowId: 'row_a',
      teacherId: 'TEACHER-1',
      studentId: ''
    }]
  }, async () => {
    const res = {
      redirectedTo: '',
      redirect(url) { this.redirectedTo = url; return this; },
      json() { throw new Error('Expected redirect, not json.'); },
      render() { throw new Error('Expected redirect, not render.'); },
      status() { return this; }
    };
    await reportController.listInstances({
      query: { assignmentId: 'ASN-1', assignmentRowId: 'row_a', autoOpenSingle: '1' },
      user: reqUser,
      headers: {}
    }, res);
    assert.match(res.redirectedTo, /^\/school\/reports\/instances\/start\/ASN-1\?/);
    assert.match(res.redirectedTo, /rowId=row_a/);
    assert.match(res.redirectedTo, /teacherId=TEACHER-1/);
    assert.match(res.redirectedTo, /editor=v2/);
  });

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => [
      { id: 'INST-1', isPendingAssignment: false, assignmentId: 'ASN-1' },
      { id: 'INST-2', isPendingAssignment: false, assignmentId: 'ASN-1' }
    ]
  }, async () => {
    const res = {
      renderedView: '',
      redirectedTo: '',
      redirect(url) { this.redirectedTo = url; return this; },
      render(view) { this.renderedView = view; return this; },
      json() { return this; },
      status() { return this; }
    };
    await reportController.listInstances({
      query: { assignmentId: 'ASN-1', autoOpenSingle: '1' },
      user: reqUser,
      headers: {}
    }, res);
    assert.equal(res.redirectedTo, '');
    assert.equal(res.renderedView, 'school/report/instanceList');
  });
});

test('assignment form uses row modal and removes top-level session/date/teacher controls', () => {
  const viewSource = read('packages/school/MVC/views/school/report/assignmentForm.ejs');

  assert.match(viewSource, /id="targetRowModal"/);
  assert.match(viewSource, /id="btnAddTargetRow"/);
  assert.match(viewSource, /id="btnPickRowSession"/);
  assert.match(viewSource, /id="btnPickRowTeacher"/);
  assert.match(viewSource, /rowModalTeacherWarning/);
  assert.match(viewSource, /bi-three-dots-vertical/);
  assert.match(viewSource, /data-floating-row-actions="true"/);
  assert.match(viewSource, /btn-row-actions-toggle/);
  assert.match(viewSource, /row-actions-menu/);
  assert.match(viewSource, /function showTargetRowModal/);
  assert.match(viewSource, /multiselect:\s*false/);
  assert.match(viewSource, /targetRowsJson/);
  assert.match(viewSource, /const teacherId = String\(row\.teacherId/);
  assert.match(viewSource, /title:\s*'Save Failed'[\s\S]*icon:\s*'error'/);
  assert.match(viewSource, /buttonClass:\s*'btn-danger'/);
  assert.doesNotMatch(viewSource, /btn-group btn-group-sm/);
  assert.doesNotMatch(viewSource, /data-bs-toggle="dropdown"/);
  assert.doesNotMatch(viewSource, /id="btnOpenSessionPicker"/);
  assert.doesNotMatch(viewSource, /id="dateTargetSection"/);
  assert.doesNotMatch(viewSource, /Assigned Teachers/);
  assert.doesNotMatch(viewSource, /class="form-select form-select-sm js-target-session"/);
});

test('assignment save routes recover from stale form action-state tokens', () => {
  const routeSource = read('packages/school/MVC/routes/reportRoutes.js');

  assert.match(routeSource, /const reportAssignmentMutationActionState = \{[\s\S]*requireToken:\s*true[\s\S]*allowOperationTokenFallback:\s*true[\s\S]*allowInactiveTokenFallback:\s*true[\s\S]*\}/);
  assert.match(routeSource, /router\.post\('\/assignments\/new'[\s\S]*trackActionState\(REPORT_ASSIGNMENT_SECTION,\s*OPERATIONS\.CREATE,\s*reportAssignmentMutationActionState\)/);
  assert.match(routeSource, /router\.post\('\/assignments\/edit\/:id'[\s\S]*trackActionState\(REPORT_ASSIGNMENT_SECTION,\s*OPERATIONS\.UPDATE,\s*reportAssignmentMutationActionState\)/);
});

test('instance uniqueness and start links include assignmentRowId', () => {
  const instanceModelSource = read('packages/school/MVC/models/school/reportInstanceModel.js');
  const controllerSource = read('packages/school/MVC/controllers/school/reportController.js');
  const instanceListSource = read('packages/school/MVC/views/school/report/instanceList.ejs');

  assert.match(instanceModelSource, /assignmentRowId:\s*cleanId/);
  assert.match(instanceModelSource, /idsEqual\(row\.assignmentRowId \|\| '', candidate\.assignmentRowId \|\| ''\)/);
  assert.match(controllerSource, /assignmentRowId:\s*req\.query\.rowId \|\| req\.query\.assignmentRowId/);
  assert.match(controllerSource, /const preferV2Editor = String\(req\.query\.editor/);
  assert.match(controllerSource, /const editorPath = preferV2Editor \? 'edit-v2' : 'edit'/);
  assert.match(instanceListSource, /row\.assignmentRowId[\s\S]*rowId=/);
});
