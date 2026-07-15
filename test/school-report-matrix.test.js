const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const ejs = require('ejs');

const reportService = require('../packages/school/MVC/services/school/reportService');
const reportMatrixService = require('../packages/school/MVC/services/school/reportMatrixService');
const reportInstanceSaveService = require('../packages/school/MVC/services/school/reportInstanceSaveService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const sessionReportInstanceService = require('../packages/school/MVC/services/school/sessionReportInstanceService');

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

test('selected_students scope uses assignment shared answers and partitions shared saves', () => {
  const template = {
    schema: {
      fields: [
        { id: 'shared_note', type: 'text', sharedAcrossStudents: true },
        { id: 'student_note', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = {
    reportScope: 'selected_students',
    sharedAnswers: { shared_note: 'For everyone' }
  };
  const merged = reportService.mergeTemplateData(template, {
    answers: { shared_note: 'stale', student_note: 'Only Alice' },
    prefillSnapshot: {}
  }, assignment);
  assert.equal(merged.shared_note, 'For everyone');
  assert.equal(merged.student_note, 'Only Alice');

  const partitioned = reportService.partitionInstanceSave(template, assignment, {
    shared_note: 'Updated once',
    student_note: 'Only Bob'
  });
  assert.deepEqual(partitioned.sharedAnswers, { shared_note: 'Updated once' });
  assert.deepEqual(partitioned.studentAnswers, { student_note: 'Only Bob' });
});

test('matrix classification omits visual fields and separates shared, common, and varying fields', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section', type: 'section', label: 'Section' },
        { id: 'student_full_name', type: 'text', label: 'Student', readOnly: true, prefillKey: 'student_full_name' },
        { id: 'class_name', type: 'text', label: 'Class', readOnly: true, prefillKey: 'class_name' },
        { id: 'attendance', type: 'number', label: 'Attendance', readOnly: true },
        { id: 'shared_goal', type: 'textarea', label: 'Goal', sharedAcrossStudents: true, required: true, helpText: 'Use one common goal.' },
        { id: 'comment', type: 'textarea', label: 'Comment', required: true }
      ]
    }
  };
  const rows = [
    { answers: { student_full_name: 'Alice', class_name: 'Class A', attendance: 80, shared_goal: 'Goal', comment: '' } },
    { answers: { student_full_name: 'Bob', class_name: 'Class A', attendance: 90, shared_goal: 'Goal', comment: '' } }
  ];
  const groups = reportMatrixService.classifyMatrixFields(template, rows, {
    reportScope: 'each_student',
    sharedAnswers: {}
  });

  assert.deepEqual(groups.studentNameFieldIds, ['student_full_name']);
  assert.deepEqual(groups.commonFields.map((field) => field.id), ['class_name']);
  assert.deepEqual(groups.sharedFields.map((field) => field.id), ['shared_goal']);
  assert.equal(groups.sharedFields[0].value, 'Goal');
  assert.equal(groups.sharedFields[0].helpText, 'Use one common goal.');
  assert.deepEqual(groups.tableFields.map((field) => field.id), ['attendance', 'comment']);
});

test('matrix marks an unsaved shared value as conflicting instead of choosing a student value', () => {
  const template = {
    schema: { fields: [{ id: 'shared_goal', type: 'text', label: 'Goal', sharedAcrossStudents: true }] }
  };
  const groups = reportMatrixService.classifyMatrixFields(template, [
    { answers: { shared_goal: 'A' } },
    { answers: { shared_goal: 'B' } }
  ], { reportScope: 'selected_students', sharedAnswers: {} });
  assert.equal(groups.sharedFields[0].value, '');
  assert.equal(groups.sharedFields[0].hasConflictingInitialValues, true);
});

test('matrix context uses stored instances and synthesizes pending rows without creating records', async () => {
  const assignment = {
    id: 'ASN-1',
    assignmentRowId: 'ROW-1',
    orgId: '900000',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    sessionDate: '2026-07-14',
    reportDueDate: '2026-07-14',
    reportScope: 'selected_students',
    templateId: 'TPL-1',
    templateVersion: 1,
    sharedAnswers: {}
  };
  const template = {
    id: 'TPL-1',
    title: 'Progress',
    schema: {
      version: 1,
      fields: [
        { id: 'student_full_name', type: 'text', readOnly: true, prefillKey: 'student_full_name' },
        { id: 'class_name', type: 'text', readOnly: true, prefillKey: 'class_name' },
        { id: 'comment', type: 'text' }
      ]
    }
  };
  let addCalls = 0;

  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment,
      assignmentRow: { rowId: 'ROW-1' },
      template,
      classData: { id: 'CLS-1', title: 'Class A' },
      teacherId: 'TEACHER-1',
      targetStudentIds: ['STU-1', 'STU-2']
    })
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async (entityType) => {
        assert.equal(entityType, 'reportInstances');
        return [{
          id: 'INS-1',
          assignmentId: 'ASN-1',
          assignmentRowId: 'ROW-1',
          teacherId: 'TEACHER-1',
          studentId: 'STU-1',
          targetKey: 'student:STU-1',
          status: 'draft',
          answers: { comment: 'Saved Alice' },
          prefillSnapshot: { student_full_name: 'Alice', class_name: 'Class A' }
        }];
      },
      addData: async () => { addCalls += 1; }
    }, async () => {
      await withPatched(reportService, {
        buildPrefillSnapshot: async ({ studentId }) => ({
          student_full_name: studentId === 'STU-2' ? 'Bob' : 'Alice',
          class_name: 'Class A'
        })
      }, async () => {
        const matrix = await reportMatrixService.buildMatrixContext({
          assignmentId: 'ASN-1',
          assignmentRowId: 'ROW-1',
          teacherId: 'TEACHER-1',
          reqUser: { id: 'USER-1', personId: 'TEACHER-1', activeOrgId: '900000' }
        });
        assert.equal(addCalls, 0);
        assert.equal(matrix.rows.length, 2);
        assert.equal(matrix.rows.find((row) => row.studentId === 'STU-1').answers.comment, 'Saved Alice');
        assert.equal(matrix.rows.find((row) => row.studentId === 'STU-2').isPending, true);
        assert.deepEqual(matrix.commonFields.map((field) => field.id), ['class_name']);
      });
    });
  });
});

test('shared persistence service updates assignment once for selected_students', async () => {
  const updates = [];
  await withPatched(schoolDataService, {
    updateData: async (entityType, id, payload) => {
      updates.push({ entityType, id, payload });
      return { id, ...payload };
    }
  }, async () => {
    const result = await reportInstanceSaveService.persistInstanceAnswers({
      instance: {
        id: 'INS-1',
        status: 'draft',
        answers: {},
        prefillSnapshot: {},
        audit: {}
      },
      template: {
        schema: {
          fields: [
            { id: 'shared_note', type: 'text', sharedAcrossStudents: true },
            { id: 'student_note', type: 'text', sharedAcrossStudents: false }
          ]
        }
      },
      assignment: { id: 'ASN-1', reportScope: 'selected_students', sharedAnswers: {} },
      body: {
        submitAction: 'save',
        field__shared_note: 'Everyone',
        field__student_note: 'Alice only'
      },
      reqUser: { id: 'USER-1' }
    });
    assert.equal(result.nextStatus, 'draft');
  });

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], {
    entityType: 'reportAssignments',
    id: 'ASN-1',
    payload: { sharedAnswers: { shared_note: 'Everyone' } }
  });
  assert.deepEqual(updates[1].payload.answers, { student_note: 'Alice only' });
});

test('session report DTO exposes one matrix group and link for student-targeted assignments', () => {
  const assignmentMap = new Map([['ASN-1', {
    id: 'ASN-1',
    reportScope: 'selected_students',
    targetStudentIds: ['STU-1']
  }]]);
  const dto = sessionReportInstanceService.mapRowToDto({
    id: 'pending-1',
    isPendingAssignment: true,
    assignmentId: 'ASN-1',
    assignmentRowId: 'ROW-1',
    templateId: 'TPL-1',
    templateTitle: 'Progress',
    teacherId: 'TEACHER-1',
    studentId: 'STU-1'
  }, assignmentMap);
  assert.equal(dto.scope, 'selected_students');
  assert.match(dto.matrixHref, /\/school\/reports\/instances\/matrix\/ASN-1/);
  assert.match(dto.matrixHref, /assignmentRowId=ROW-1/);
  assert.equal(dto.matrixGroupKey, 'ASN-1|ROW-1|TEACHER-1|TPL-1');
});

test('report matrix routes and UI expose row-level save, submit, grouping, and accessible field hints', () => {
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  const matrixView = read('packages/school/MVC/views/school/report/instanceMatrix.ejs');
  const sessionView = read('packages/school/MVC/views/school/class/sessionManager.ejs');

  assert.match(routes, /\/instances\/matrix\/:assignmentId/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/save-row/);
  assert.match(routes, /requireReportMatrixEditorAccess/);
  assert.match(matrixView, /matrix-student-col/);
  assert.match(matrixView, /data-bs-toggle="tooltip"/);
  assert.match(matrixView, /aria-label="Required"/);
  assert.match(matrixView, /data-action="save"/);
  assert.match(matrixView, /data-action="submit"/);
  assert.match(sessionView, /matrixGroupKey/);
  assert.match(sessionView, />Fill Reports</);
});

test('report matrix EJS renders supported controls and locked row state', async () => {
  const matrix = {
    assignmentId: 'ASN-1',
    assignmentRowId: 'ROW-1',
    templateTitle: 'Progress',
    classId: 'CLS-1',
    className: 'Class A',
    sessionId: 'SES-1',
    sessionDate: '2026-07-14',
    reportStartDate: '2026-07-14',
    reportDueDate: '2026-07-14',
    teacherId: 'TEACHER-1',
    teacherName: 'Teacher One',
    progress: { total: 1, submitted: 1, drafts: 0, pending: 0 },
    commonFields: [{ id: 'class_name', label: 'Class', type: 'text', readOnly: true, value: 'Class A', options: [] }],
    sharedFields: [{ id: 'goal', label: 'Goal', type: 'textarea', required: true, sharedAcrossStudents: true, readOnly: false, value: 'Practice', options: [] }],
    tableFields: [
      { id: 'score', label: 'Score', type: 'number', readOnly: false, options: [] },
      { id: 'level', label: 'Level', type: 'select', readOnly: false, options: [{ value: 'good', label: 'Good' }] },
      { id: 'done', label: 'Done', type: 'checkbox', readOnly: false, options: [] },
      { id: 'note', label: 'Note', type: 'text', readOnly: false, options: [] }
    ],
    rows: [{
      studentId: 'STU-1',
      studentName: 'Alice',
      status: 'locked',
      locked: true,
      editHref: '/school/reports/instances/edit-v2/INS-1',
      answers: { score: 88, level: 'good', done: true, note: 'Complete' }
    }]
  };
  const html = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/instanceMatrix.ejs'),
    { matrix, actionStateId: 'ACTION-1' }
  );
  assert.match(html, /Alice/);
  assert.match(html, /textarea class="form-control js-matrix-shared-field"/);
  assert.match(html, /option value="good" selected/);
  assert.match(html, /data-action="submit" disabled/);
});
