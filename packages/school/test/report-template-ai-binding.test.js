const test = require('node:test');
const assert = require('node:assert/strict');

const reportTemplateAiBindingService = require('../MVC/services/school/reportTemplateAiBindingService');

const prefillCatalog = {
  common: [{ key: 'teacher_name' }, { key: 'class_name' }]
};

test('normalizeAiServicesFromBody parses JSON rows', () => {
  const rows = reportTemplateAiBindingService.normalizeAiServicesFromBody({
    aiServicesJson: JSON.stringify([
      {
        id: 'ai_1',
        serviceKey: 'school.report_review',
        isActive: true,
        inputBindings: {
          report_text: { source: 'field', value: 'summary_field' }
        }
      }
    ])
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serviceKey, 'school.report_review');
  assert.equal(rows[0].inputBindings.report_text.source, 'field');
});

test('validateAiServicesForTemplate rejects unknown field id', () => {
  const { errors } = reportTemplateAiBindingService.validateAiServicesForTemplate({
    schema: { fields: [{ id: 'known_field' }] },
    aiServices: [{
      serviceKey: 'school.report_review',
      inputBindings: { report_text: { source: 'field', value: 'missing_field' } }
    }]
  }, { strict: true, prefillCatalog });
  assert.ok(errors.length > 0);
  assert.match(errors[0], /missing_field/);
});

test('resolveInputsForService maps field prefill static and empty', () => {
  const row = {
    inputBindings: {
      a: { source: 'field', value: 'fld' },
      b: { source: 'prefill', value: 'teacher_name' },
      c: { source: 'static', value: 'hello' },
      d: { source: 'empty', value: '' }
    }
  };
  const definition = {
    inputs: [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' }
    ]
  };
  const merged = { fld: 'Field value', teacher_name: 'ignored' };
  const resolved = reportTemplateAiBindingService.resolveInputsForService(row, definition, merged, { teacher_name: 'Prof' });
  assert.equal(resolved.a, 'Field value');
  assert.equal(resolved.b, 'Prof');
  assert.equal(resolved.c, 'hello');
  assert.equal(resolved.d, '');
});

test('analyzeAiAssistContexts blocks matrix when private field binding exists', () => {
  const template = {
    schema: {
      fields: [
        { id: 'shared_note', sharedAcrossStudents: true },
        { id: 'student_goal' }
      ]
    },
    aiServices: [
      {
        id: 'ai_matrix_ok',
        serviceKey: 'school.report_review',
        isActive: true,
        inputBindings: { report_text: { source: 'field', value: 'shared_note' } }
      },
      {
        id: 'ai_private',
        serviceKey: 'school.bimpr_goals_checker',
        isActive: true,
        inputBindings: { goals: { source: 'field', value: 'student_goal' } }
      }
    ]
  };
  const analysis = reportTemplateAiBindingService.analyzeAiAssistContexts(template);
  assert.equal(analysis.instanceAllowed, true);
  assert.equal(analysis.matrixAllowed, false);
  assert.match(analysis.matrixBlockedReason, /private/i);
});

test('analyzeAiAssistContexts allows matrix for read-only common field bindings', () => {
  const template = {
    schema: {
      fields: [
        { id: 'classEffort', readOnly: true },
        { id: 'private_notes' }
      ]
    },
    aiServices: [{
      id: 'ai_1',
      serviceKey: 'school.report_review',
      isActive: true,
      inputBindings: { report_text: { source: 'field', value: 'classEffort' } }
    }]
  };
  const analysis = reportTemplateAiBindingService.analyzeAiAssistContexts(template);
  assert.equal(analysis.matrixAllowed, true);
});

test('analyzeAiAssistContexts allows matrix when only shared field bindings', () => {
  const template = {
    schema: {
      fields: [{ id: 'shared_note', sharedAcrossStudents: true }]
    },
    aiServices: [{
      id: 'ai_1',
      serviceKey: 'school.report_review',
      isActive: true,
      inputBindings: { report_text: { source: 'field', value: 'shared_note' } }
    }]
  };
  const analysis = reportTemplateAiBindingService.analyzeAiAssistContexts(template);
  assert.equal(analysis.matrixAllowed, true);
  assert.equal(analysis.instanceAllowed, true);
});

test('listActiveBindings skips inactive rows', () => {
  const rows = reportTemplateAiBindingService.listActiveBindings({
    aiServices: [
      { serviceKey: 'school.report_review', isActive: true },
      { serviceKey: 'school.bimpr_goals_checker', isActive: false }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serviceKey, 'school.report_review');
});