const test = require('node:test');
const assert = require('node:assert/strict');

const reportGenerationEngineService = require('../packages/school/MVC/services/school/reportGenerationEngineService');
const reportService = require('../packages/school/MVC/services/school/reportService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const reportDocxRenderService = require('../packages/school/MVC/services/school/reportDocxRenderService');
const reportPdfRenderService = require('../packages/school/MVC/services/school/reportPdfRenderService');
const reportFunderDocxService = require('../packages/school/MVC/services/school/reportFunderDocxService');
const reportFunderPdfService = require('../packages/school/MVC/services/school/reportFunderPdfService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');

const reqUser = { id: 'USER-1', activeOrgId: '900000' };

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

const baseTemplate = {
  id: 'TPL-1',
  version: 1,
  title: 'Progress Report',
  schema: {
    fields: [
      { id: 'student_name', label: 'Student Name', type: 'text', prefillKey: 'student_full_name' },
      {
        id: 'student_name_combo',
        label: 'Name Combo',
        type: 'text',
        valueMode: 'derived_editable',
        calculationRule: {
          enabled: true,
          expression: 'concat(prefill.student_first_name, " ", prefill.student_last_name)',
          onError: 'keep_last'
        }
      },
      {
        id: 'calc_total',
        label: 'Calc Total',
        type: 'number',
        valueMode: 'calculated',
        calculationRule: {
          enabled: true,
          expression: 'num(answers.part_a) + num(answers.part_b)',
          onError: 'empty'
        },
        calculationDependencies: ['part_a', 'part_b']
      },
      { id: 'manual_note', label: 'Manual Note', type: 'text' },
      { id: 'part_a', label: 'Part A', type: 'number', prefillKey: 'gradebook_mark' },
      { id: 'part_b', label: 'Part B', type: 'number', prefillKey: 'gradebook_mark_2' }
    ]
  },
  placeholderMap: {
    student_name: '{{student_name}}',
    student_name_combo: '{{student_name_combo}}',
    manual_note: '{{manual_note}}'
  }
};

const basePrefill = {
  student_full_name: 'Sam Olsen',
  student_first_name: 'Sam',
  student_last_name: 'Olsen',
  gradebook_mark: 40,
  gradebook_mark_2: 35
};

test('resolveGenerationContext rejects missing assignment and ad-hoc inputs', async () => {
  await assert.rejects(
    () => reportGenerationEngineService.resolveGenerationContext({}, reqUser),
    /assignmentId or ad-hoc/
  );
});

test('buildSyntheticInstance hydrates derived and calculated fields from prefill', async () => {
  await withPatched(reportService, {
    buildPrefillSnapshot: async () => ({ ...basePrefill })
  }, async () => {
    const instance = await reportGenerationEngineService.buildSyntheticInstance({
      template: baseTemplate,
      assignment: { id: 'ASN-1', classId: 'CLASS-1', reportScope: 'each_student' },
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-PERSON-1',
      reqUser
    });
    assert.equal(instance.status, 'engine');
    assert.equal(instance.prefillSnapshot.student_full_name, 'Sam Olsen');
    assert.equal(instance.answers.student_name_combo, 'Sam Olsen');
    assert.equal(instance.answers.part_a, 40);
    assert.equal(instance.answers.part_b, 35);
    assert.equal(instance.answers.calc_total, 75);
  });
});

test('hydrateAnswersFromPrefill preserves derived_editable overrides when present', () => {
  const instance = {
    answers: { student_name_combo: 'User Override' },
    prefillSnapshot: basePrefill
  };
  const hydrated = reportGenerationEngineService.hydrateAnswersFromPrefill(baseTemplate, instance);
  assert.equal(hydrated.answers.student_name_combo, 'User Override');
});

test('assessGenerationWarnings reports empty manual fields without blocking', () => {
  const instance = {
    answers: {},
    prefillSnapshot: basePrefill
  };
  const assignment = { reportScope: 'each_student', sharedAnswers: {} };
  const warnings = reportGenerationEngineService.assessGenerationWarnings(
    baseTemplate,
    assignment,
    instance
  );
  assert.ok(warnings.some((w) => w.code === 'empty_manual_field' && w.fieldId === 'manual_note'));
});

test('buildStudentPayload returns placeholders and merged answers', async () => {
  const instance = {
    id: 'engine-STUDENT-PERSON-1',
    status: 'engine',
    studentId: 'STUDENT-PERSON-1',
    answers: {
      student_name_combo: 'Sam Olsen',
      part_a: 40,
      part_b: 35,
      calc_total: 75
    },
    prefillSnapshot: basePrefill
  };
  await withPatched(reportService, {
    buildReportDocxCollections: async () => ({ students: [{ name: 'Sam Olsen' }] })
  }, async () => {
    const payload = await reportGenerationEngineService.buildStudentPayload({
      template: baseTemplate,
      assignment: { reportScope: 'each_student', sharedAnswers: {} },
      instance,
      reqUser
    });
    assert.equal(payload.mergedAnswers.calc_total, 75);
    assert.equal(payload.placeholders['{{student_name}}'], 'Sam Olsen');
    assert.ok(Array.isArray(payload.warnings));
    assert.equal(payload.collections.students[0].name, 'Sam Olsen');
  });
});

test('generateReportOutput ad-hoc path builds json payload without persisted instance', async () => {
  await withPatched(reportIntegrityService, {
    assertTemplateAccessible: async (templateId) => ({
      ...baseTemplate,
      id: templateId
    })
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'classes' && id === 'CLASS-1') {
          return { id: 'CLASS-1', orgId: '900000', title: 'Class One' };
        }
        return null;
      },
      getClassSessions: async () => [],
      fetchAllData: async (entityType) => {
        if (entityType === 'students') {
          return [{ id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1' }];
        }
        return [];
      }
    }, async () => {
      await withPatched(reportService, {
        buildPrefillSnapshot: async () => ({ ...basePrefill }),
        buildReportDocxCollections: async () => ({ students: [] })
      }, async () => {
        const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
        await withPatched(classEnrollmentReadService, {
          listActiveStudentIdsForClass: async () => ({ studentIds: new Set(['STU-1']) }),
          getReportRosterStatusesForClass: () => ['active']
        }, async () => {
          const result = await reportGenerationEngineService.generateReportOutput({
            templateId: 'TPL-1',
            classId: 'CLASS-1',
            teacherId: 'TEACHER-1',
            reportScope: 'each_student',
            reportStartDate: '2026-06-01',
            reportDueDate: '2026-06-30',
            dueDate: '2026-06-30',
            format: 'json'
          }, {}, reqUser);

          assert.equal(result.source, 'adhoc');
          assert.equal(result.format, 'json');
          assert.equal(result.rows.length, 1);
          assert.equal(result.rows[0].studentId, 'STUDENT-PERSON-1');
          assert.equal(result.payload.rows[0].mergedAnswers.calc_total, 75);
          assert.ok(result.warnings.some((w) => w.code === 'empty_manual_field'));
        });
      });
    });
  });
});

test('generateReportOutput selected_students uses full report date range for enrollment', async () => {
  let capturedEnrollmentWindow = null;
  await withPatched(reportIntegrityService, {
    assertTemplateAccessible: async (templateId) => ({
      ...baseTemplate,
      id: templateId
    })
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'classes' && id === 'CLASS-1') {
          return { id: 'CLASS-1', orgId: '900000', title: 'Class One' };
        }
        return null;
      },
      getClassSessions: async () => [],
      fetchAllData: async (entityType) => {
        if (entityType === 'students') {
          return [{ id: 'STU-1', orgId: '900000', personId: 'STUDENT-PERSON-1' }];
        }
        return [];
      }
    }, async () => {
      await withPatched(reportService, {
        buildPrefillSnapshot: async () => ({ ...basePrefill }),
        buildReportDocxCollections: async () => ({ students: [] })
      }, async () => {
        const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
        await withPatched(classEnrollmentReadService, {
          listActiveStudentIdsForClass: async (opts) => {
            capturedEnrollmentWindow = {
              startDate: opts.startDate,
              endDate: opts.endDate
            };
            if (opts.startDate === '2026-07-01' && opts.endDate === '2026-07-31') {
              return { studentIds: new Set(['STU-1']) };
            }
            return { studentIds: new Set() };
          },
          getReportRosterStatusesForClass: () => ['active']
        }, async () => {
          const result = await reportGenerationEngineService.generateReportOutput({
            templateId: 'TPL-1',
            classId: 'CLASS-1',
            teacherId: 'TEACHER-1',
            reportScope: 'selected_students',
            targetStudentIds: ['STUDENT-PERSON-1'],
            reportStartDate: '2026-07-01',
            reportDueDate: '2026-07-31',
            format: 'json'
          }, {}, reqUser);

          assert.deepEqual(capturedEnrollmentWindow, {
            startDate: '2026-07-01',
            endDate: '2026-07-31'
          });
          assert.equal(result.rows.length, 1);
          assert.equal(result.rows[0].studentId, 'STUDENT-PERSON-1');
        });
      });
    });
  });
});

test('generateReportOutput assignment path uses resolveStartInstanceContext', async () => {
  const assignment = {
    id: 'ASN-1',
    classId: 'CLASS-1',
    reportScope: 'each_student',
    teacherIds: ['TEACHER-1'],
    reportStartDate: '2026-06-01',
    reportDueDate: '2026-06-30',
    sharedAnswers: {}
  };
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment,
      template: baseTemplate,
      teacherId: 'TEACHER-1',
      targetStudentIds: ['STUDENT-PERSON-1'],
      classData: { id: 'CLASS-1' },
      sessions: []
    })
  }, async () => {
    await withPatched(reportService, {
      buildPrefillSnapshot: async () => ({ ...basePrefill }),
      buildReportDocxCollections: async () => ({ students: [] })
    }, async () => {
      const result = await reportGenerationEngineService.generateReportOutput({
        assignmentId: 'ASN-1',
        format: 'json'
      }, {}, reqUser);
      assert.equal(result.source, 'assignment');
      assert.equal(result.assignmentId, 'ASN-1');
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].payload.mergedAnswers.student_name_combo, 'Sam Olsen');
    });
  });
});

test('generateReportOutput filters students when studentIds provided', async () => {
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment: {
        id: 'ASN-1',
        classId: 'CLASS-1',
        reportScope: 'each_student',
        teacherIds: ['TEACHER-1'],
        sharedAnswers: {}
      },
      template: baseTemplate,
      teacherId: 'TEACHER-1',
      targetStudentIds: ['STUDENT-A', 'STUDENT-B'],
      classData: { id: 'CLASS-1' },
      sessions: []
    })
  }, async () => {
    await withPatched(reportService, {
      buildPrefillSnapshot: async ({ studentId }) => ({
        ...basePrefill,
        student_full_name: studentId === 'STUDENT-A' ? 'Alice' : 'Bob'
      }),
      buildReportDocxCollections: async () => ({ students: [] })
    }, async () => {
      const result = await reportGenerationEngineService.generateReportOutput({
        assignmentId: 'ASN-1',
        studentIds: ['STUDENT-B'],
        format: 'json'
      }, {}, reqUser);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].studentId, 'STUDENT-B');
    });
  });
});

test('generateReportOutput renders docx via render service', async () => {
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment: {
        id: 'ASN-1',
        classId: 'CLASS-1',
        reportScope: 'each_student',
        teacherIds: ['TEACHER-1'],
        sharedAnswers: {}
      },
      template: baseTemplate,
      teacherId: 'TEACHER-1',
      targetStudentIds: ['STUDENT-PERSON-1'],
      classData: { id: 'CLASS-1' },
      sessions: []
    })
  }, async () => {
    await withPatched(reportService, {
      buildPrefillSnapshot: async () => ({ ...basePrefill, student_full_name: 'Sam Olsen' }),
      buildReportDocxCollections: async () => ({ students: [] })
    }, async () => {
      await withPatched(reportFunderDocxService, {
        templateHasAnyDocx: () => true,
        buildExportDocxSuggestions: async () => ({
          rows: [{ studentId: 'STUDENT-PERSON-1', suggestedDocxKey: 'default' }]
        }),
        resolveDocxTemplateForFunder: () => ({
          docxTemplate: { path: '/tmp/template.docx', originalName: 'template.docx' }
        })
      }, async () => {
        await withPatched(reportDocxRenderService, {
          renderReportInstanceDocx: async () => ({
            buffer: Buffer.from('docx'),
            fileName: 'report.docx'
          })
        }, async () => {
          const result = await reportGenerationEngineService.generateReportOutput({
            assignmentId: 'ASN-1',
            format: 'docx'
          }, {}, reqUser);
          assert.equal(result.format, 'docx');
          assert.equal(result.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          assert.ok(result.file?.buffer);
        });
      });
    });
  });
});

test('generateReportOutput renders pdf zip for multiple students', async () => {
  await withPatched(reportIntegrityService, {
    resolveStartInstanceContext: async () => ({
      assignment: {
        id: 'ASN-1',
        classId: 'CLASS-1',
        reportScope: 'each_student',
        teacherIds: ['TEACHER-1'],
        sharedAnswers: {}
      },
      template: baseTemplate,
      teacherId: 'TEACHER-1',
      targetStudentIds: ['STUDENT-A', 'STUDENT-B'],
      classData: { id: 'CLASS-1' },
      sessions: []
    })
  }, async () => {
    await withPatched(reportService, {
      buildPrefillSnapshot: async ({ studentId }) => ({
        ...basePrefill,
        student_full_name: studentId
      }),
      buildReportDocxCollections: async () => ({ students: [] })
    }, async () => {
      await withPatched(reportFunderPdfService, {
        templateHasAnyPdf: () => true,
        buildExportPdfSuggestions: async () => ({
          rows: [
            { studentId: 'STUDENT-A', suggestedPdfKey: 'default' },
            { studentId: 'STUDENT-B', suggestedPdfKey: 'default' }
          ]
        }),
        resolvePdfTemplateForFunder: () => ({
          pdfTemplate: { path: '/tmp/template.pdf', originalName: 'template.pdf' }
        })
      }, async () => {
        await withPatched(reportPdfRenderService, {
          renderReportInstancePdf: async () => ({
            buffer: Buffer.from('pdf'),
            fileName: 'report.pdf'
          }),
          zipReportInstancePdfFiles: async () => Buffer.from('zip')
        }, async () => {
          const result = await reportGenerationEngineService.generateReportOutput({
            assignmentId: 'ASN-1',
            format: 'pdf'
          }, {}, reqUser);
          assert.equal(result.format, 'pdf');
          assert.equal(result.contentType, 'application/zip');
          assert.ok(result.buffer);
        });
      });
    });
  });
});
