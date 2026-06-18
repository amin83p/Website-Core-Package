const test = require('node:test');
const assert = require('node:assert/strict');

const reportRuleEngineService = require('../packages/school/MVC/services/school/reportRuleEngineService');
const reportService = require('../packages/school/MVC/services/school/reportService');

test('safe expression blocks unknown globals', () => {
  assert.throws(
    () => reportRuleEngineService.evaluateSafeExpression('process.env.NODE_ENV', { value: 1, answers: {}, prefill: {} }),
    /Unknown identifier/
  );
});

test('template validation honors severity and when', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'percent',
          label: 'Percent',
          type: 'number',
          validationRules: [
            {
              id: 'range_error',
              enabled: true,
              severity: 'error',
              when: 'if_has_value',
              expression: 'num(value) >= 0 && num(value) <= 100',
              message: 'Percent must be 0..100.'
            },
            {
              id: 'high_warn',
              enabled: true,
              severity: 'warning',
              when: 'if_has_value',
              expression: 'num(value) <= 95',
              message: 'Percent above 95 should be verified.'
            }
          ]
        }
      ]
    }
  };

  const blocked = reportRuleEngineService.evaluateTemplateValidations({
    template,
    mergedAnswers: { percent: 120 },
    prefill: {}
  });
  assert.equal(blocked.hasBlockingErrors, true);
  assert.equal(blocked.errors.length, 1);
  assert.equal(blocked.warnings.length, 1);

  const skipped = reportRuleEngineService.evaluateTemplateValidations({
    template,
    mergedAnswers: { percent: '' },
    prefill: {}
  });
  assert.equal(skipped.errors.length, 0);
  assert.equal(skipped.warnings.length, 0);
});

test('conversion falls back based on onError policy', () => {
  const useRaw = reportRuleEngineService.convertFieldValueForExport({
    field: {
      id: 'score',
      label: 'Score',
      conversionRule: { enabled: true, expression: 'missing_helper(value)', onError: 'use_raw' }
    },
    value: 80,
    answers: {},
    prefill: {}
  });
  assert.equal(useRaw.value, 80);
  assert.equal(Boolean(useRaw.diagnostic), true);

  const empty = reportRuleEngineService.convertFieldValueForExport({
    field: {
      id: 'score',
      label: 'Score',
      conversionRule: { enabled: true, expression: 'missing_helper(value)', onError: 'empty' }
    },
    value: 80,
    answers: {},
    prefill: {}
  });
  assert.equal(empty.value, '');
  assert.equal(Boolean(empty.diagnostic), true);
});

test('placeholder payload uses converted values while merged/raw answers stay unchanged', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'tuition_percent',
          label: 'Tuition %',
          type: 'number',
          conversionRule: { enabled: true, expression: 'round(num(value) / 100, 3)', onError: 'use_raw' }
        }
      ]
    },
    placeholderMap: {
      tuition_percent: '{{tuition_percent}}'
    }
  };
  const instance = {
    answers: { tuition_percent: 85 },
    prefillSnapshot: {}
  };

  const merged = reportService.mergeTemplateData(template, instance, null);
  const bundle = reportService.buildPlaceholderPayloadDetailed(template, instance, null);

  assert.equal(merged.tuition_percent, 85);
  assert.equal(bundle.placeholders['{{tuition_percent}}'], '0.85');
  assert.deepEqual(bundle.conversionDiagnostics, []);
});

test('conversion supports ifelse and caseof branching', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'score_grade',
          label: 'Score Grade',
          type: 'number',
          conversionRule: {
            enabled: true,
            expression: 'ifelse(num(value) >= 90, "A", ifelse(num(value) >= 80, "B", "C"))',
            onError: 'use_raw'
          }
        },
        {
          id: 'rating_label',
          label: 'Rating Label',
          type: 'text',
          conversionRule: {
            enabled: true,
            expression: 'caseof(value, "excellent", "E", "good", "G", "fair", "F", "U")',
            onError: 'use_raw'
          }
        }
      ]
    },
    placeholderMap: {
      score_grade: '{{score_grade}}',
      rating_label: '{{rating_label}}'
    }
  };
  const instance = {
    answers: {
      score_grade: 86,
      rating_label: 'good'
    },
    prefillSnapshot: {}
  };
  const bundle = reportService.buildPlaceholderPayloadDetailed(template, instance, null);
  assert.equal(bundle.placeholders['{{score_grade}}'], 'B');
  assert.equal(bundle.placeholders['{{rating_label}}'], 'G');
});

test('calculated fields recompute in dependency order', () => {
  const template = {
    schema: {
      fields: [
        { id: 'part_a', label: 'Part A', type: 'number' },
        { id: 'part_b', label: 'Part B', type: 'number' },
        {
          id: 'sum',
          label: 'Sum',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'num(answers.part_a) + num(answers.part_b)', onError: 'keep_last' },
          calculationDependencies: ['part_a', 'part_b']
        },
        {
          id: 'grade',
          label: 'Grade',
          type: 'text',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'ifelse(num(answers.sum) >= 90, "A", "B")', onError: 'keep_last' },
          calculationDependencies: ['sum']
        }
      ]
    }
  };
  const recomputed = reportRuleEngineService.recomputeCalculatedAnswers({
    template,
    mergedAnswers: { part_a: 55, part_b: 40, sum: 0, grade: '' },
    prefill: {}
  });
  assert.equal(recomputed.answers.sum, 95);
  assert.equal(recomputed.answers.grade, 'A');
});

test('calculated field cycle is rejected', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'a',
          label: 'A',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'num(answers.b)', onError: 'keep_last' },
          calculationDependencies: ['b']
        },
        {
          id: 'b',
          label: 'B',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'num(answers.a)', onError: 'keep_last' },
          calculationDependencies: ['a']
        }
      ]
    }
  };
  assert.throws(
    () => reportRuleEngineService.buildCalculatedFieldPlan(template, { strict: true }),
    /cycle/i
  );
});

test('calculation onError policy respects keep_last and empty', () => {
  const templateKeep = {
    schema: {
      fields: [
        { id: 'x', label: 'X', type: 'number' },
        {
          id: 'calc',
          label: 'Calc',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'unknown_func(answers.x)', onError: 'keep_last' },
          calculationDependencies: ['x']
        }
      ]
    }
  };
  const keep = reportRuleEngineService.recomputeCalculatedAnswers({
    template: templateKeep,
    mergedAnswers: { x: 1, calc: 77 },
    prefill: {}
  });
  assert.equal(keep.answers.calc, 77);

  const templateEmpty = {
    schema: {
      fields: [
        { id: 'x', label: 'X', type: 'number' },
        {
          id: 'calc',
          label: 'Calc',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'unknown_func(answers.x)', onError: 'empty' },
          calculationDependencies: ['x']
        }
      ]
    }
  };
  const empty = reportRuleEngineService.recomputeCalculatedAnswers({
    template: templateEmpty,
    mergedAnswers: { x: 1, calc: 77 },
    prefill: {}
  });
  assert.equal(empty.answers.calc, '');
});

test('mergeTemplateData returns recomputed calculated values', () => {
  const template = {
    schema: {
      fields: [
        { id: 'x', label: 'X', type: 'number' },
        { id: 'y', label: 'Y', type: 'number' },
        {
          id: 'sum',
          label: 'Sum',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'num(answers.x) + num(answers.y)', onError: 'keep_last' },
          calculationDependencies: ['x', 'y']
        }
      ]
    },
    placeholderMap: {}
  };
  const instance = { answers: { x: 10, y: 8, sum: 0 }, prefillSnapshot: {} };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.sum, 18);
});
