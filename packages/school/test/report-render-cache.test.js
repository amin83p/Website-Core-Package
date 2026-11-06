const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');
const reportRuleEngineService = require('../MVC/services/school/reportRuleEngineService');
const reportInstanceModel = require('../MVC/models/school/reportInstanceModel');

const simpleTemplate = {
  id: 'TPL-RRC-1',
  version: 3,
  schema: {
    fields: [
      {
        id: 'name',
        label: 'Name',
        type: 'text',
        valueMode: 'manual'
      },
      {
        id: 'doubled',
        label: 'Doubled',
        type: 'number',
        valueMode: 'calculated',
        calculationDependencies: ['name'],
        calculationRule: { enabled: true, expression: '2 * num(answers.name)', onError: 'keep_last' }
      }
    ]
  }
};

test('isInstanceRenderCacheValid requires firstSavedAt, matching template id/version, mergedAnswers', () => {
  assert.equal(reportService.isInstanceRenderCacheValid(simpleTemplate, { audit: {} }), false);
  assert.equal(reportService.isInstanceRenderCacheValid(simpleTemplate, {
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: null
  }), false);
  assert.equal(reportService.isInstanceRenderCacheValid(simpleTemplate, {
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: { templateId: 'wrong', templateVersion: 3, mergedAnswers: { name: 'a' } }
  }), false);
  assert.equal(reportService.isInstanceRenderCacheValid(simpleTemplate, {
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    templateVersion: 3,
    renderCache: {
      templateId: 'TPL-RRC-1',
      templateVersion: 3,
      mergedAnswers: { name: 'a', doubled: 2 }
    }
  }), true);
});

test('resolveInstanceMergedAnswersForDisplay uses renderCache when valid', () => {
  const instance = {
    status: 'draft',
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    templateVersion: 3,
    renderCache: {
      templateId: 'TPL-RRC-1',
      templateVersion: 3,
      mergedAnswers: { name: 'cached', doubled: 999 }
    }
  };
  const merged = reportService.resolveInstanceMergedAnswersForDisplay({
    template: simpleTemplate,
    instance,
    assignment: null,
    lockSnapshot: null
  });
  assert.equal(merged.name, 'cached');
  assert.equal(merged.doubled, 999);
});

test('prepareReportAnswersForUI skipRecalculation avoids changing merged answers', () => {
  const merged = { name: 10, doubled: 'should_stay' };
  const prepared = reportRuleEngineService.prepareReportAnswersForUI({
    template: simpleTemplate,
    mergedAnswers: merged,
    prefill: {},
    skipRecalculation: true
  });
  assert.equal(prepared.calculationAnswers.doubled, 'should_stay');
});

test('evaluateTemplateValidations skipRecalculation uses provided merged answers', () => {
  const merged = { name: 'x', doubled: 'plain' };
  const summary = reportRuleEngineService.evaluateTemplateValidations({
    template: simpleTemplate,
    mergedAnswers: merged,
    prefill: {},
    skipRecalculation: true
  });
  assert.equal(summary.recalculatedAnswers.doubled, 'plain');
});

test('sanitizeInstance preserves renderCache and audit.firstSavedAt', () => {
  const row = reportInstanceModel.sanitizeInstance({
    orgId: 'org1',
    assignmentId: 'asg1',
    classId: 'cls1',
    templateId: 'tpl1',
    templateVersion: 1,
    sessionDate: '2025-01-01',
    teacherId: 't1',
    status: 'draft',
    answers: {},
    audit: {
      createUser: 'u1',
      createDateTime: '2025-01-01T00:00:00.000Z',
      firstSavedAt: '2025-02-01T00:00:00.000Z'
    },
    renderCache: {
      templateId: 'tpl1',
      templateVersion: 1,
      capturedAt: '2025-02-02T00:00:00.000Z',
      mergedAnswers: { a: 1 }
    }
  });
  assert.equal(row.audit.firstSavedAt, '2025-02-01T00:00:00.000Z');
  assert.equal(row.renderCache.mergedAnswers.a, 1);
});

test('buildReportInstanceExportPayload uses renderCache mergedAnswers when valid with reqUser', async () => {
  const assignment = { reportScope: 'class' };
  const instance = {
    status: 'submitted',
    templateVersion: 3,
    answers: { name: 'from-answers' },
    prefillSnapshot: { foo: 'bar' },
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL-RRC-1',
      templateVersion: 3,
      mergedAnswers: { name: 'export-cached', doubled: 404 }
    }
  };
  const payload = await reportService.buildReportInstanceExportPayload({
    template: simpleTemplate,
    instance,
    assignment,
    format: 'json',
    reqUser: { id: 'user-1' },
    options: { buildCollections: false }
  });
  assert.equal(payload.mergedAnswers.name, 'export-cached');
  assert.equal(payload.mergedAnswers.doubled, 404);
});
