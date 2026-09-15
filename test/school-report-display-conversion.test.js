'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const reportRuleEngineService = require('../packages/school/MVC/services/school/reportRuleEngineService');
const { sanitizeTemplate } = require('../packages/school/MVC/models/school/reportTemplateModel');

describe('report read-only display conversion', () => {
  it('normalizeConversionRule parses applyOnReadOnlyDisplay', () => {
    const rule = reportRuleEngineService.normalizeConversionRule({
      enabled: true,
      expression: 'num(value)',
      applyOnReadOnlyDisplay: true
    });
    assert.equal(rule.applyOnReadOnlyDisplay, true);
  });

  it('finalizeConversionRuleForField clears display flag when not view-only', () => {
    const out = reportRuleEngineService.finalizeConversionRuleForField({
      enabled: true,
      expression: 'num(value)',
      applyOnReadOnlyDisplay: true
    }, { readOnly: false });
    assert.equal(out.applyOnReadOnlyDisplay, false);
  });

  it('finalizeConversionRuleForField keeps display flag when view-only and conversion enabled', () => {
    const out = reportRuleEngineService.finalizeConversionRuleForField({
      enabled: true,
      expression: 'num(value) * 2',
      applyOnReadOnlyDisplay: true
    }, { readOnly: true });
    assert.equal(out.applyOnReadOnlyDisplay, true);
  });

  it('resolveFieldDisplayValue converts read-only field when flag set', () => {
    const field = {
      id: 'effort',
      readOnly: true,
      valueMode: 'manual',
      conversionRule: {
        enabled: true,
        expression: 'num(value) / 10',
        onError: 'use_raw',
        applyOnReadOnlyDisplay: true
      }
    };
    const result = reportRuleEngineService.resolveFieldDisplayValue({
      field,
      value: 80,
      answers: { effort: 80 },
      prefill: {}
    });
    assert.equal(result.value, 8);
  });

  it('resolveFieldDisplayValue leaves editable fields unchanged', () => {
    const field = {
      id: 'effort',
      readOnly: false,
      valueMode: 'manual',
      conversionRule: {
        enabled: true,
        expression: 'num(value) / 10',
        onError: 'use_raw',
        applyOnReadOnlyDisplay: true
      }
    };
    const result = reportRuleEngineService.resolveFieldDisplayValue({
      field,
      value: 80,
      answers: {},
      prefill: {}
    });
    assert.equal(result.value, 80);
  });

  it('applyReadOnlyDisplayConversions only transforms flagged view-only fields', () => {
    const template = {
      schema: {
        fields: [
          {
            id: 'a',
            readOnly: true,
            valueMode: 'manual',
            conversionRule: {
              enabled: true,
              expression: '"X"',
              onError: 'use_raw',
              applyOnReadOnlyDisplay: true
            }
          },
          {
            id: 'b',
            readOnly: true,
            valueMode: 'manual',
            conversionRule: {
              enabled: true,
              expression: '"Y"',
              onError: 'use_raw',
              applyOnReadOnlyDisplay: false
            }
          }
        ]
      }
    };
    const merged = reportRuleEngineService.applyReadOnlyDisplayConversions({
      template,
      mergedAnswers: { a: 1, b: 2 },
      prefill: {}
    });
    assert.equal(merged.a, 'X');
    assert.equal(merged.b, 2);
  });

  it('evaluateFieldValidations skips numeric type check for view-only fields', () => {
    const field = {
      id: 'classEffort',
      label: 'Class Effort',
      type: 'number',
      readOnly: true,
      valueMode: 'manual',
      validationRules: []
    };
    const issues = reportRuleEngineService.evaluateFieldValidations({
      field,
      value: 'Satisfying',
      answers: { classEffort: 'Satisfying' },
      prefill: {}
    });
    assert.equal(issues.some((row) => row.ruleId === 'number'), false);
  });

  it('sanitizeTemplate strips applyOnReadOnlyDisplay when field is editable', () => {
    const template = sanitizeTemplate({
      orgId: 'org_test_1',
      type: 'progress',
      title: 'Test',
      schema: {
        fields: [{
          id: 'rating',
          label: 'Rating',
          type: 'number',
          readOnly: false,
          conversionRule: {
            enabled: true,
            expression: 'num(value)',
            applyOnReadOnlyDisplay: true
          }
        }]
      }
    });
    assert.equal(template.schema.fields[0].conversionRule.applyOnReadOnlyDisplay, false);
  });
});
