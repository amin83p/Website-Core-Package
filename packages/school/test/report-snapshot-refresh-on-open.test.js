'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');
const reportGenerationEngineService = require('../MVC/services/school/reportGenerationEngineService');
const reportTemplateModel = require('../MVC/models/school/reportTemplateModel');

const blendTemplate = {
  id: 'TPL-BLEND',
  version: 1,
  snapshotKeys: ['student_gradebook_skill_reading_avg_percent', 'teacher_name'],
  snapshotKeyRefreshOnOpen: {
    student_gradebook_skill_reading_avg_percent: true
  },
  schema: {
    fields: [
      {
        id: 'reading_avg',
        type: 'number',
        prefillKey: 'student_gradebook_skill_reading_avg_percent'
      },
      {
        id: 'teacher',
        type: 'text',
        prefillKey: 'teacher_name'
      },
      {
        id: 'reading_doubled',
        type: 'number',
        valueMode: 'calculated',
        calculationDependencies: ['reading_avg'],
        calculationRule: { enabled: true, expression: 'num(answers.reading_avg) * 2', onError: 'keep_last' }
      }
    ]
  }
};

test('pruneTemplateSnapshotKeyRefreshOnOpen drops keys not in snapshotKeys and keeps explicit live keys only', () => {
  const template = {
    snapshotKeys: ['teacher_name', 'student_full_name'],
    snapshotKeyRefreshOnOpen: {
      teacher_name: true,
      student_full_name: false,
      removed_key: true,
      class_name: true
    }
  };
  reportService.pruneTemplateSnapshotKeyRefreshOnOpen(template);
  assert.deepEqual(template.snapshotKeyRefreshOnOpen, { teacher_name: true });
});

test('sanitizeTemplate stores snapshotKeyRefreshOnOpen only for snapshot keys', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    orgId: 'org1',
    type: 'progress_report_v1',
    title: 'Sample',
    snapshotKeys: ['teacher_name', 'student_full_name'],
    snapshotKeyRefreshOnOpen: {
      teacher_name: true,
      student_full_name: false,
      orphan_key: true
    }
  });
  assert.deepEqual(sanitized.snapshotKeyRefreshOnOpen, { teacher_name: true });
});

test('mergeTemplateData keeps saved answers for gradebook skill without template refresh flag', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'reading_avg',
          type: 'text',
          prefillKey: 'student_gradebook_skill_reading_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_reading_avg_percent: 75 },
    answers: { reading_avg: 37.5 },
    derivedOverrides: {}
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.reading_avg, 37.5);
});

test('mergeMergedAnswersWithRenderCache overlays live refresh keys and recalculates dependents', () => {
  const instance = {
    prefillSnapshot: {
      student_gradebook_skill_reading_avg_percent: 80,
      teacher_name: 'Live Teacher'
    },
    answers: { reading_avg: 40, teacher: 'Cached Teacher' },
    derivedOverrides: {}
  };
  const cached = {
    reading_avg: 40,
    teacher: 'Cached Teacher',
    reading_doubled: 80
  };
  const blended = reportService.mergeMergedAnswersWithRenderCache({
    template: blendTemplate,
    instance,
    assignment: null,
    cachedMerged: cached,
    options: { scopeOptions: { respectSnapshotKeys: true } }
  });
  assert.equal(blended.usedPartialCache, true);
  assert.equal(blended.skipRecalculation, false);
  assert.equal(blended.mergedAnswers.reading_avg, 80);
  assert.equal(blended.mergedAnswers.teacher, 'Cached Teacher');
  assert.equal(blended.mergedAnswers.reading_doubled, 160);
});

test('mergeMergedAnswersWithRenderCache uses full cache when no refresh keys configured', () => {
  const template = {
    ...blendTemplate,
    snapshotKeyRefreshOnOpen: {}
  };
  const instance = {
    prefillSnapshot: {
      student_gradebook_skill_reading_avg_percent: 80,
      teacher_name: 'Live Teacher'
    },
    answers: { reading_avg: 40, teacher: 'Cached Teacher' },
    derivedOverrides: {}
  };
  const cached = { reading_avg: 40, teacher: 'Cached Teacher', reading_doubled: 80 };
  const blended = reportService.mergeMergedAnswersWithRenderCache({
    template,
    instance,
    assignment: null,
    cachedMerged: cached,
    options: { scopeOptions: { respectSnapshotKeys: true } }
  });
  assert.equal(blended.skipRecalculation, true);
  assert.equal(blended.usedPartialCache, false);
  assert.equal(blended.mergedAnswers.reading_avg, 40);
  assert.equal(blended.mergedAnswers.teacher, 'Cached Teacher');
});

test('mergeMergedAnswersWithRenderCache overlays shared fields from assignment when cache is frozen', () => {
  const rowId = 'session:SES_1:2026-06-01';
  const template = {
    id: 'TPL-SHARED-CACHE',
    schema: {
      fields: [
        { id: 'student_note', type: 'text', sharedAcrossStudents: false },
        { id: 'shared_note', type: 'textarea', sharedAcrossStudents: true }
      ]
    },
    snapshotKeyRefreshOnOpen: {}
  };
  const assignment = {
    reportScope: 'each_student',
    sharedAnswersByRowId: {
      [rowId]: { shared_note: 'from assignment row' }
    },
    targetRows: [{ rowId, status: 'active' }]
  };
  const instance = {
    assignmentRowId: rowId,
    answers: { student_note: 'per student' },
    prefillSnapshot: {},
    derivedOverrides: {}
  };
  const cached = { student_note: 'per student', shared_note: '' };
  const blended = reportService.mergeMergedAnswersWithRenderCache({
    template,
    instance,
    assignment,
    cachedMerged: cached,
    options: {}
  });
  assert.equal(blended.mergedAnswers.shared_note, 'from assignment row');
  assert.equal(blended.mergedAnswers.student_note, 'per student');
  assert.equal(blended.usedPartialCache, true);
});

test('hydrateAnswersFromPrefill does not overwrite stale gradebook answers without refresh flag', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'writing_avg',
          type: 'number',
          prefillKey: 'student_gradebook_skill_writing_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_writing_avg_percent: 37.5 },
    answers: { writing_avg: 18.75 },
    derivedOverrides: {}
  };
  const hydrated = reportGenerationEngineService.hydrateAnswersFromPrefill(template, instance);
  assert.equal(hydrated.changed, false);
  assert.equal(hydrated.answers.writing_avg, 18.75);
});

test('hydrateAnswersFromPrefill overwrites when template marks refresh on open', () => {
  const template = {
    snapshotKeys: ['student_gradebook_skill_writing_avg_percent'],
    snapshotKeyRefreshOnOpen: { student_gradebook_skill_writing_avg_percent: true },
    schema: {
      fields: [
        {
          id: 'writing_avg',
          type: 'number',
          prefillKey: 'student_gradebook_skill_writing_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_writing_avg_percent: 37.5 },
    answers: { writing_avg: 18.75 },
    derivedOverrides: {}
  };
  const hydrated = reportGenerationEngineService.hydrateAnswersFromPrefill(template, instance);
  assert.equal(hydrated.changed, true);
  assert.equal(hydrated.answers.writing_avg, 37.5);
});