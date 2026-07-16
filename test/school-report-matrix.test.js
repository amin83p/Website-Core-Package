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
        { id: 'average_class_mark', type: 'number', label: 'Average Class Mark (Auto Calculation)', readOnly: true, calculated: true, valueMode: 'calculated', sharedAcrossStudents: true },
        { id: 'shared_goal', type: 'textarea', label: 'Goal', sharedAcrossStudents: true, required: true, helpText: 'Use one common goal.' },
        { id: 'comment', type: 'textarea', label: 'Comment', required: true }
      ]
    }
  };
  const rows = [
    { answers: { student_full_name: 'Alice', class_name: 'Class A', attendance: 80, average_class_mark: 85, shared_goal: 'Goal', comment: '' } },
    { answers: { student_full_name: 'Bob', class_name: 'Class A', attendance: 90, average_class_mark: 85, shared_goal: 'Goal', comment: '' } }
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
  assert.deepEqual(groups.tableFields.map((field) => field.id), ['attendance', 'average_class_mark', 'comment']);
  assert.equal(groups.tableFields[1].id, 'average_class_mark');
  assert.equal(groups.tableFields[1].calculated, true);
  assert.equal(groups.sharedFields.some((field) => field.id === 'average_class_mark'), false);
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
        assert.equal(matrix.rows.find((row) => row.studentId === 'STU-2').answers.class_name, 'Class A');
        assert.deepEqual(matrix.commonFields.map((field) => field.id), ['class_name']);
      });
    });
  });
});

test('matrix rows expose calculated read-only values', async () => {
  const assignment = { id: 'ASN-CALC', assignmentRowId: 'ROW-CALC', classId: 'CLS-1', reportScope: 'selected_students', templateId: 'TPL-CALC', sharedAnswers: {} };
  const template = { id: 'TPL-CALC', schema: { fields: [
    { id: 'score_a', type: 'number' }, { id: 'score_b', type: 'number' },
    { id: 'average', label: 'Average Class Mark (Auto Calculation)', type: 'number', readOnly: true, valueMode: 'calculated', calculationRule: { enabled: true, expression: '(num(answers.score_a)+num(answers.score_b))/2', onError: 'keep_last' }, calculationDependencies: ['score_a', 'score_b'] }
  ] } };
  await withPatched(reportIntegrityService, { resolveStartInstanceContext: async () => ({ assignment, assignmentRow: { rowId: 'ROW-CALC' }, template, classData: { id: 'CLS-1', title: 'Class A' }, teacherId: 'TEACHER-1', targetStudentIds: ['STU-1'] }) }, async () => {
    await withPatched(schoolDataService, { fetchData: async () => [{ id: 'INS-CALC', assignmentId: 'ASN-CALC', assignmentRowId: 'ROW-CALC', teacherId: 'TEACHER-1', studentId: 'STU-1', targetKey: 'student:STU-1', status: 'draft', answers: { score_a: 80, score_b: 90 }, prefillSnapshot: {} }] }, async () => {
      const matrix = await reportMatrixService.buildMatrixContext({ assignmentId: 'ASN-CALC', assignmentRowId: 'ROW-CALC', teacherId: 'TEACHER-1', reqUser: { id: 'USER-1', personId: 'TEACHER-1', activeOrgId: '900000' } });
      assert.equal(matrix.rows[0].answers.average, 85);
      assert.equal(matrix.tableFields.find((field) => field.id === 'average').calculated, true);
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

test('matrix prefill precedence matches Report Instance behavior', () => {
  const template = {
    schema: {
      fields: [
        { id: 'editable', type: 'text', prefillKey: 'editable_prefill' },
        { id: 'read_only', type: 'text', readOnly: true, prefillKey: 'readonly_prefill' },
        { id: 'shared', type: 'text', sharedAcrossStudents: true, prefillKey: 'shared_prefill' }
      ]
    }
  };
  const merged = reportService.mergeTemplateData(template, {
    prefillSnapshot: { editable_prefill: 'Prefilled', readonly_prefill: 'Read-only prefill', shared_prefill: 'Shared prefill' },
    answers: { editable: 'Saved answer', read_only: 'Stale answer', shared: 'Stale shared answer' }
  }, {
    reportScope: 'each_student',
    sharedAnswers: { shared: 'Assignment shared value' }
  });
  assert.equal(merged.editable, 'Saved answer');
  assert.equal(merged.read_only, 'Read-only prefill');
  assert.equal(merged.shared, 'Assignment shared value');
});

test('matrix groups shared fields by configured sections and preserves full-width metadata', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section_a', type: 'section', label: 'Overview' },
        { id: 'shared_a', type: 'text', sharedAcrossStudents: true, fullPageWidth: true },
        { id: '__sub_a', type: 'subheader', label: 'Notes' },
        { id: 'shared_b', type: 'textarea', sharedAcrossStudents: true },
        { id: '__row_break', type: 'row_break' },
        { id: 'student_value', type: 'text' }
      ]
    }
  };
  const groups = reportMatrixService.classifyMatrixFields(template, [
    { answers: { shared_a: 'A', shared_b: 'B', student_value: 'X' } }
  ], { reportScope: 'each_student', sharedAnswers: {} });
  assert.deepEqual(groups.sharedGroups.map((group) => group.label), ['Overview', 'Overview / Notes']);
  assert.equal(groups.sharedGroups[0].fields[0].fullPageWidth, true);
  assert.equal(groups.sharedGroups[1].fields[0].id, 'shared_b');
});

test('saving a pending matrix row stores its Report Instance prefill snapshot', async () => {
  const assignment = {
    id: 'ASN-1', assignmentRowId: 'ROW-1', orgId: '900000', classId: 'CLS-1', sessionId: 'SES-1',
    sessionDate: '2026-07-14', reportScope: 'selected_students', templateId: 'TPL-1', sharedAnswers: {}
  };
  const template = {
    id: 'TPL-1', schema: { fields: [
      { id: 'student_full_name', type: 'text', readOnly: true, prefillKey: 'student_full_name' },
      { id: 'comment', type: 'text' }
    ] }
  };
  let created = null;
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment, assignmentRow: { rowId: 'ROW-1' }, template, classData: { id: 'CLS-1', title: 'Class A' },
      teacherId: 'TEACHER-1', targetStudentIds: ['STU-1']
    })
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async () => [],
      addData: async (entityType, payload) => {
        assert.equal(entityType, 'reportInstances');
        created = payload;
        return { id: 'INS-1', ...payload };
      }
    }, async () => {
      await withPatched(reportService, {
        buildPrefillSnapshot: async () => ({ student_full_name: 'Alice', student_email: 'alice@example.com' })
      }, async () => {
        await withPatched(reportInstanceSaveService, {
          persistInstanceAnswers: async () => ({ updatedInstance: { id: 'INS-1' }, nextStatus: 'draft', validationSummary: {} })
        }, async () => {
          await reportMatrixService.saveMatrixRow({
            assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'TEACHER-1', studentId: 'STU-1',
            answers: { comment: 'Draft' }, sharedAnswers: {}, reqUser: { id: 'USER-1' }
          });
        });
      });
    });
  });
  assert.deepEqual(created.prefillSnapshot, { student_full_name: 'Alice', student_email: 'alice@example.com' });
});

test('bulk matrix save processes editable rows, skips locked rows, and summarizes failures', async () => {
  const assignment = {
    id: 'ASN-1', assignmentRowId: 'ROW-1', orgId: '900000', classId: 'CLS-1', sessionId: 'SES-1',
    sessionDate: '2026-07-14', reportScope: 'selected_students', templateId: 'TPL-1', sharedAnswers: {}
  };
  const template = {
    id: 'TPL-1', title: 'Progress', schema: { fields: [
      { id: 'student_full_name', type: 'text', readOnly: true, prefillKey: 'student_full_name' },
      { id: 'comment', type: 'text' }
    ] }
  };
  const instances = [
    { id: 'INS-1', assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'TEACHER-1', targetKey: 'student:STU-1', studentId: 'STU-1', status: 'draft', answers: {}, prefillSnapshot: { student_full_name: 'Alice' } },
    { id: 'INS-2', assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'TEACHER-1', targetKey: 'student:STU-2', studentId: 'STU-2', status: 'locked', answers: {}, prefillSnapshot: { student_full_name: 'Bob' } },
    { id: 'INS-3', assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'TEACHER-1', targetKey: 'student:STU-3', studentId: 'STU-3', status: 'draft', answers: {}, prefillSnapshot: { student_full_name: 'Cara' } }
  ];
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment, assignmentRow: { rowId: 'ROW-1' }, template, classData: { id: 'CLS-1', title: 'Class A' },
      teacherId: 'TEACHER-1', targetStudentIds: ['STU-1', 'STU-2', 'STU-3']
    })
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async (entityType) => {
        assert.equal(entityType, 'reportInstances');
        return instances;
      }
    }, async () => {
      await withPatched(reportInstanceSaveService, {
        persistInstanceAnswers: async ({ body }) => {
          if (body.field__comment === 'bad') {
            const error = new Error('Comment is invalid.');
            error.validationSummary = { hasBlockingErrors: true };
            throw error;
          }
          return { updatedInstance: { id: 'INS-1' }, nextStatus: 'submitted', validationSummary: { hasBlockingErrors: false } };
        }
      }, async () => {
        const result = await reportMatrixService.saveMatrixRows({
          assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'TEACHER-1', submitAction: 'submit',
          rows: [
            { studentId: 'STU-1', answers: { comment: 'good' } },
            { studentId: 'STU-2', answers: { comment: 'locked' } },
            { studentId: 'STU-3', answers: { comment: 'bad' } }
          ],
          sharedAnswers: {}, reqUser: { id: 'USER-1', activeOrgId: '900000' }
        });
        assert.deepEqual(result.summary, { total: 3, succeeded: 1, failed: 1, skipped: 1 });
        assert.equal(result.results.find((row) => row.studentId === 'STU-2').status, 'skipped');
        assert.equal(result.results.find((row) => row.studentId === 'STU-3').status, 'error');
      });
    });
  });
});

test('report matrix routes and UI expose bulk actions, grouping, and accessible field hints', () => {
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  const matrixView = read('packages/school/MVC/views/school/report/instanceMatrix.ejs');
  const sessionView = read('packages/school/MVC/views/school/class/sessionManager.ejs');

  assert.match(routes, /\/instances\/matrix\/:assignmentId/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/save-row/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/save-all/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/prefill-preview/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/prefill-apply/);
  assert.match(routes, /\/instances\/matrix\/:assignmentId\/export/);
  assert.match(routes, /requireReportMatrixEditorAccess/);
  assert.match(matrixView, /matrix-student-col/);
  assert.match(matrixView, /matrix-student-name[\s\S]*js-matrix-status/);
  assert.doesNotMatch(matrixView, /matrix-actions-col/);
  assert.match(matrixView, /data-bs-toggle="tooltip"/);
  assert.match(matrixView, /aria-label="Required"/);
  assert.match(matrixView, /matrix-header-label/);
  assert.match(matrixView, /reportMatrixSharedSections/);
  assert.match(matrixView, /js-matrix-bulk-action/);
  assert.match(matrixView, /Save All Drafts/);
  assert.match(matrixView, /Preview Prefill Updates/);
  assert.match(matrixView, /Export DOCX/);
  assert.match(matrixView, /Export Payload/);
  assert.match(matrixView, /reportMatrixPrefillModal/);
  assert.match(matrixView, /Submit All Reports/);
  assert.doesNotMatch(matrixView, /js-matrix-save/);
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
    sharedFields: [{ id: 'goal', label: 'Goal', type: 'textarea', required: true, sharedAcrossStudents: true, readOnly: false, fullPageWidth: true, value: 'Practice', options: [] }],
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
  assert.doesNotMatch(html, /font-monospace/);
  assert.match(html, /textarea class="form-control js-matrix-shared-field"/);
  assert.match(html, /option value="good" selected/);
  assert.match(html, /Save All Drafts/);
  assert.match(html, /Submit All Reports/);
  assert.match(html, /accordion-collapse collapse show/);
  assert.match(html, /class="col-12"/);
  assert.match(html, /data-prefill-key/);
  assert.doesNotMatch(html, /js-matrix-save/);
});
