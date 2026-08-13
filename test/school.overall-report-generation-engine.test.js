const test = require('node:test');
const assert = require('node:assert/strict');

const overallReportService = require('../packages/school/MVC/services/school/overallReportService');
const overallReportGenerationEngineService = require('../packages/school/MVC/services/school/overallReportGenerationEngineService');
const reportGenerationEngineService = require('../packages/school/MVC/services/school/reportGenerationEngineService');
const reportService = require('../packages/school/MVC/services/school/reportService');
const reportDocxRenderService = require('../packages/school/MVC/services/school/reportDocxRenderService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');

const reqUser = { id: 'USER-1', activeOrgId: 'ORG-1' };

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

const reportTemplateT1 = {
  id: 'SRC-1',
  orgId: 'ORG-1',
  title: 'Source One',
  version: 1,
  status: 'active',
  schema: {
    fields: [
      { id: 'score', label: 'Score', type: 'number', valueMode: 'manual' },
      { id: 'comments', label: 'Comments', type: 'text', valueMode: 'manual' }
    ]
  },
  placeholderMap: { score: '{{score}}', comments: '{{comments}}' }
};

const reportTemplateT2 = {
  id: 'SRC-2',
  orgId: 'ORG-1',
  title: 'Source Two',
  version: 1,
  status: 'active',
  schema: {
    fields: [
      { id: 'score', label: 'Score', type: 'number', valueMode: 'manual' }
    ]
  },
  placeholderMap: { score: '{{score}}' }
};

const overallTemplate = {
  id: 'OVERALL-1',
  orgId: 'ORG-1',
  title: 'Consolidated Progress',
  version: 1,
  status: 'active',
  sourceSlots: [
    { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1 },
    { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1 }
  ],
  schema: {
    fields: [
      {
        id: 'summary',
        label: 'Summary',
        type: 'text',
        overallValueMode: 'manual',
        defaultValue: 'Initial'
      },
      {
        id: 'average_score',
        label: 'Average score',
        type: 'number',
        overallValueMode: 'derived_locked',
        calculationRule: {
          enabled: true,
          expression: 'round(avg(source("T1", "score"), source("T2", "score")), 2)',
          onError: 'keep_last'
        }
      }
    ]
  },
  placeholderMap: {
    summary: '{{O.summary}}',
    average_score: '{{O.average_score}}'
  },
  docxTemplate: { path: '/tmp/overall.docx', originalName: 'overall.docx' },
  docxTemplatesByFunder: []
};

function mockEngineResultForStudent(studentId, studentName, t1Score, t2Score) {
  return {
    format: 'json',
    rows: [{
      studentId,
      studentName,
      instance: { id: `engine-${studentId}`, status: 'engine', studentId },
      payload: {
        studentId,
        studentName,
        placeholders: {
          '{{score}}': String(t1Score),
          '{{comments}}': `Comments for ${studentName}`
        },
        mergedAnswers: { score: t1Score }
      }
    }],
    warnings: []
  };
}

test('buildSourceValuesFromPlaceholders matches buildSourcePayload value keys', () => {
  const placeholders = {
    '{{score}}': '72',
    '{{comments}}': 'Good work',
    score_alias: '72'
  };
  const fromPlaceholders = overallReportService.buildSourceValuesFromPlaceholders(reportTemplateT1, placeholders);
  assert.equal(fromPlaceholders.score, '72');
  assert.equal(fromPlaceholders.comments, 'Good work');
});

test('buildSourceValuesFromStudentPayload adapts engine student payload', () => {
  const values = overallReportGenerationEngineService.buildSourceValuesFromStudentPayload(
    reportTemplateT1,
    { placeholders: { '{{score}}': '80', '{{comments}}': 'Nice' } }
  );
  assert.equal(values.score, '80');
  assert.equal(values.comments, 'Nice');
});

test('generateSourceBatch runs multiple source runs and unions students', async () => {
  await withPatched(reportGenerationEngineService, {
    generateReportOutput: async (request) => {
      if (request.templateId === 'SRC-1') {
        return mockEngineResultForStudent('STU-1', 'Alice', 80, 0);
      }
      return {
        format: 'json',
        rows: [{
          studentId: 'STU-1',
          studentName: 'Alice',
          instance: { id: 'engine-STU-1' },
          payload: {
            placeholders: { '{{score}}': '90' }
          }
        }],
        warnings: []
      };
    }
  }, async () => {
    const batch = await overallReportGenerationEngineService.generateSourceBatch({
      filterStartDate: '2026-06-01',
      filterEndDate: '2026-06-30',
      sourceRuns: [
        {
          slotKey: 'T1',
          templateId: 'SRC-1',
          classId: 'CLASS-A',
          teacherId: 'TEACHER-1',
          reportStartDate: '2026-06-01',
          reportDueDate: '2026-06-30',
          dueDate: '2026-06-30'
        },
        {
          slotKey: 'T2',
          templateId: 'SRC-2',
          classId: 'CLASS-B',
          teacherId: 'TEACHER-2',
          reportStartDate: '2026-06-01',
          reportDueDate: '2026-06-30',
          dueDate: '2026-06-30'
        }
      ]
    }, reqUser);

    assert.equal(batch.sourceRuns.length, 2);
    assert.equal(batch.students.length, 1);
    assert.equal(batch.students[0].studentId, 'STU-1');
  });
});

test('generateOverallFromSourceBatch computes average from slot source values', async () => {
  const sourceBatch = {
    filterStartDate: '2026-06-01',
    filterEndDate: '2026-06-30',
    sourceRuns: [
      {
        slotKey: 'T1',
        templateId: 'SRC-1',
        engineResult: mockEngineResultForStudent('STU-1', 'Alice', 80, 0)
      },
      {
        slotKey: 'T2',
        templateId: 'SRC-2',
        engineResult: {
          format: 'json',
          rows: [{
            studentId: 'STU-1',
            studentName: 'Alice',
            instance: { id: 'engine-STU-1' },
            payload: { placeholders: { '{{score}}': '90' } }
          }],
          warnings: []
        }
      }
    ],
    students: [{ studentId: 'STU-1', studentName: 'Alice' }],
    warnings: []
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates' && id === 'OVERALL-1') return overallTemplate;
      if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplateT1;
      if (entityType === 'reportTemplates' && id === 'SRC-2') return reportTemplateT2;
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => {}
    }, async () => {
      const result = await overallReportGenerationEngineService.generateOverallFromSourceBatch({
        overallTemplateId: 'OVERALL-1',
        sourceBatch,
        format: 'json'
      }, reqUser);

      assert.equal(result.students.length, 1);
      assert.equal(result.students[0].answers.average_score, 85);
      assert.equal(result.students[0].sourceValues.T1.score, '80');
      assert.equal(result.students[0].sourceValues.T2.score, '90');
      assert.ok(result.students[0].placeholders['O.average_score']);
    });
  });
});

test('generateOverallFromSourceBatch filters students by studentIds', async () => {
  const sourceBatch = {
    sourceRuns: [
      {
        slotKey: 'T1',
        templateId: 'SRC-1',
        engineResult: {
          format: 'json',
          rows: [
            {
              studentId: 'STU-1',
              studentName: 'Alice',
              instance: { id: 'engine-STU-1' },
              payload: { placeholders: { '{{score}}': '80', '{{comments}}': 'A' } }
            },
            {
              studentId: 'STU-2',
              studentName: 'Bob',
              instance: { id: 'engine-STU-2' },
              payload: { placeholders: { '{{score}}': '70', '{{comments}}': 'B' } }
            }
          ],
          warnings: []
        }
      },
      {
        slotKey: 'T2',
        templateId: 'SRC-2',
        engineResult: {
          format: 'json',
          rows: [
            {
              studentId: 'STU-1',
              studentName: 'Alice',
              instance: { id: 'engine-STU-1' },
              payload: { placeholders: { '{{score}}': '90' } }
            },
            {
              studentId: 'STU-2',
              studentName: 'Bob',
              instance: { id: 'engine-STU-2' },
              payload: { placeholders: { '{{score}}': '60' } }
            }
          ],
          warnings: []
        }
      }
    ],
    students: [
      { studentId: 'STU-1', studentName: 'Alice' },
      { studentId: 'STU-2', studentName: 'Bob' }
    ],
    warnings: []
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return overallTemplate;
      if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplateT1;
      if (entityType === 'reportTemplates' && id === 'SRC-2') return reportTemplateT2;
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => {}
    }, async () => {
      const result = await overallReportGenerationEngineService.generateOverallFromSourceBatch({
        overallTemplateId: 'OVERALL-1',
        sourceBatch,
        studentIds: ['STU-2'],
        format: 'json'
      }, reqUser);
      assert.equal(result.students.length, 1);
      assert.equal(result.students[0].studentId, 'STU-2');
      assert.equal(result.students[0].answers.average_score, 65);
    });
  });
});

test('generateOverallFromSourceBatch rejects missing necessary slot template', async () => {
  const sourceBatch = {
    sourceRuns: [{
      slotKey: 'T1',
      templateId: 'SRC-1',
      engineResult: mockEngineResultForStudent('STU-1', 'Alice', 80, 0)
    }],
    students: [{ studentId: 'STU-1', studentName: 'Alice' }],
    warnings: []
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType) => {
      if (entityType === 'overallReportTemplates') return overallTemplate;
      if (entityType === 'reportTemplates') return reportTemplateT1;
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => {}
    }, async () => {
      await assert.rejects(
        () => overallReportGenerationEngineService.generateOverallFromSourceBatch({
          overallTemplateId: 'OVERALL-1',
          sourceBatch,
          format: 'json'
        }, reqUser),
        /Missing source batch for slot T2/
      );
    });
  });
});

test('generateOverallFromSourceBatch accepts missing optional source batch slot', async () => {
  const optionalOverallTemplate = {
    ...overallTemplate,
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1, requirement: 'optional' }
    ]
  };
  const sourceBatch = {
    sourceRuns: [{
      slotKey: 'T1',
      templateId: 'SRC-1',
      engineResult: mockEngineResultForStudent('STU-1', 'Alice', 80, 0)
    }],
    students: [{ studentId: 'STU-1', studentName: 'Alice' }],
    warnings: []
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return optionalOverallTemplate;
      if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplateT1;
      if (entityType === 'reportTemplates' && id === 'SRC-2') return reportTemplateT2;
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => new Map([
        ['T1', reportTemplateT1],
        ['T2', reportTemplateT2]
      ])
    }, async () => {
      const result = await overallReportGenerationEngineService.generateOverallFromSourceBatch({
        overallTemplateId: 'OVERALL-1',
        sourceBatch,
        format: 'json'
      }, reqUser);
      assert.equal(result.students.length, 1);
      assert.equal(result.students[0].answers.average_score, 80);
      assert.equal(result.students[0].sourceValues.T2.score, '');
    });
  });
});

test('generateOverallFromSourceBatch renders docx zip for multiple students', async () => {
  const sourceBatch = {
    sourceRuns: [
      {
        slotKey: 'T1',
        templateId: 'SRC-1',
        engineResult: {
          format: 'json',
          rows: [
            { studentId: 'STU-1', studentName: 'Alice', instance: {}, payload: { placeholders: { '{{score}}': '80', '{{comments}}': 'A' } } },
            { studentId: 'STU-2', studentName: 'Bob', instance: {}, payload: { placeholders: { '{{score}}': '70', '{{comments}}': 'B' } } }
          ],
          warnings: []
        }
      },
      {
        slotKey: 'T2',
        templateId: 'SRC-2',
        engineResult: {
          format: 'json',
          rows: [
            { studentId: 'STU-1', studentName: 'Alice', instance: {}, payload: { placeholders: { '{{score}}': '90' } } },
            { studentId: 'STU-2', studentName: 'Bob', instance: {}, payload: { placeholders: { '{{score}}': '60' } } }
          ],
          warnings: []
        }
      }
    ],
    students: [
      { studentId: 'STU-1', studentName: 'Alice' },
      { studentId: 'STU-2', studentName: 'Bob' }
    ],
    warnings: []
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return overallTemplate;
      if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplateT1;
      if (entityType === 'reportTemplates' && id === 'SRC-2') return reportTemplateT2;
      return null;
    }
  }, async () => {
    await withPatched(overallReportService, {
      validateTemplateReferences: async () => {},
      buildExportPreview: async (instance) => ({
        ready: true,
        docxKey: 'default',
        placeholders: {
          'T1.score': instance.sourceValues?.T1?.score || '',
          'T2.score': instance.sourceValues?.T2?.score || '',
          'O.average_score': instance.answers?.average_score || '',
          'O.summary': instance.answers?.summary || ''
        },
        missingTokens: [],
        validation: { errors: [], warnings: [], hasBlockingErrors: false },
        calculationMismatches: [],
        calculationDiagnostics: [],
        resolved: { docxKey: 'default', docxTemplate: overallTemplate.docxTemplate }
      })
    }, async () => {
      await withPatched(reportDocxRenderService, {
        renderReportInstanceDocx: async () => ({
          buffer: Buffer.from('docx'),
          fileName: 'overall.docx'
        }),
        zipReportInstanceDocxFiles: async (files) => Buffer.from(`zip-${files.length}`)
      }, async () => {
        const result = await overallReportGenerationEngineService.generateOverallFromSourceBatch({
          overallTemplateId: 'OVERALL-1',
          sourceBatch,
          format: 'docx',
          docxMode: 'zip'
        }, reqUser);
        assert.equal(result.contentType, 'application/zip');
        assert.equal(result.buffer.toString(), 'zip-2');
      });
    });
  });
});

test('generateOverallPipeline orchestrates source batch and overall json output', async () => {
  await withPatched(reportGenerationEngineService, {
    generateReportOutput: async (request) => {
      if (request.templateId === 'SRC-1') {
        return mockEngineResultForStudent('STU-1', 'Alice', 80, 0);
      }
      return {
        format: 'json',
        rows: [{
          studentId: 'STU-1',
          studentName: 'Alice',
          instance: { id: 'engine-STU-1' },
          payload: { placeholders: { '{{score}}': '90' } }
        }],
        warnings: []
      };
    }
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'overallReportTemplates') return overallTemplate;
        if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplateT1;
        if (entityType === 'reportTemplates' && id === 'SRC-2') return reportTemplateT2;
        return null;
      }
    }, async () => {
      await withPatched(overallReportService, {
        validateTemplateReferences: async () => {}
      }, async () => {
        const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
          overallTemplateId: 'OVERALL-1',
          filterStartDate: '2026-06-01',
          filterEndDate: '2026-06-30',
          format: 'json',
          sourceRuns: [
            {
              slotKey: 'T1',
              templateId: 'SRC-1',
              classId: 'CLASS-A',
              teacherId: 'TEACHER-1',
              reportStartDate: '2026-06-01',
              reportDueDate: '2026-06-30',
              dueDate: '2026-06-30'
            },
            {
              slotKey: 'T2',
              templateId: 'SRC-2',
              classId: 'CLASS-B',
              teacherId: 'TEACHER-2',
              reportStartDate: '2026-06-01',
              reportDueDate: '2026-06-30',
              dueDate: '2026-06-30'
            }
          ]
        }, reqUser);

        assert.equal(pipeline.sourceBatch.sourceRuns.length, 2);
        assert.equal(pipeline.overall.students[0].answers.average_score, 85);
      });
    });
  });
});

test('calculateAnswers averages only necessary source values when optional slot is empty', () => {
  const template = {
    ...overallTemplate,
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1, requirement: 'optional' }
    ]
  };
  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues: {
      T1: { score: '80', comments: 'Good' },
      T2: { score: '', comments: '' }
    },
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  assert.equal(calculated.answers.average_score, 80);
  assert.equal(calculated.diagnostics.length, 0);
});
