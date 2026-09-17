const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reportRuleEngineService = require('../packages/school/MVC/services/school/reportRuleEngineService');

const ROOT_DIR = path.resolve(__dirname, '..');
const runtimePartial = fs.readFileSync(
  path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/partials/calculatedFieldsRuntime.ejs'),
  'utf8'
);
const runtimeSource = runtimePartial.replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const runtimeSandbox = {};
runtimeSandbox.globalThis = runtimeSandbox;
vm.runInNewContext(runtimeSource, runtimeSandbox);
const calculatedFields = runtimeSandbox.SchoolReportCalculatedFields;

const conductConversion = {
  enabled: true,
  expression: 'caseof(true, num(value) < 85, "Sat", "Sup")',
  onError: 'use_raw',
  applyOnReadOnlyDisplay: true
};

function conductField(id) {
  return {
    id,
    type: 'number',
    readOnly: true,
    valueMode: 'manual',
    conversionRule: conductConversion
  };
}

const averageExpression = 'round((num(answers.Attendance)+num(answers.Punctuality)+num(answers.Respects_The_Teachers)+num(answers.Returns_Assignments)+num(answers.Treats_Other_Students)+num(answers.Writes_Tests)+num(answers.classEffort)+num(answers.Class_Participation))/8.0,0)';

function averageField() {
  return {
    id: 'Average_Class_Mark',
    type: 'number',
    readOnly: true,
    valueMode: 'calculated',
    calculationRule: { enabled: true, expression: averageExpression, onError: 'keep_last' },
    calculationDependencies: [
      'Attendance', 'Punctuality', 'Respects_The_Teachers', 'Returns_Assignments',
      'Treats_Other_Students', 'Writes_Tests', 'classEffort', 'Class_Participation'
    ]
  };
}

const sampleInputs = {
  Attendance: 80.56,
  Punctuality: 71.43,
  Respects_The_Teachers: 80,
  Returns_Assignments: 80,
  Treats_Other_Students: 80,
  Writes_Tests: 80,
  classEffort: 80,
  Class_Participation: 80
};

test('prepareReportAnswersForUI keeps numeric calculationAnswers and label displayAnswers', () => {
  const template = {
    schema: {
      fields: [
        { id: 'Attendance', type: 'number', valueMode: 'manual' },
        { id: 'Punctuality', type: 'number', valueMode: 'manual' },
        conductField('Respects_The_Teachers'),
        { id: 'Returns_Assignments', type: 'number', valueMode: 'manual' },
        conductField('Treats_Other_Students'),
        { id: 'Writes_Tests', type: 'number', valueMode: 'manual' },
        conductField('classEffort'),
        conductField('Class_Participation'),
        averageField()
      ]
    }
  };
  const flatInputs = {
    Attendance: 80,
    Punctuality: 80,
    Respects_The_Teachers: 80,
    Returns_Assignments: 80,
    Treats_Other_Students: 80,
    Writes_Tests: 80,
    classEffort: 80,
    Class_Participation: 80
  };
  const prepared = reportRuleEngineService.prepareReportAnswersForUI({
    template,
    mergedAnswers: flatInputs,
    prefill: {}
  });
  assert.equal(prepared.calculationAnswers.classEffort, 80);
  assert.equal(prepared.displayAnswers.classEffort, 'Sat');
  assert.equal(prepared.calculationAnswers.Average_Class_Mark, 80);
  assert.equal(prepared.displayAnswers.Average_Class_Mark, 80);
});

test('mergeEditableAnswersIntoCalculation ignores read-only and calculated overlays', () => {
  const fields = [
    conductField('classEffort'),
    { id: 'comment', type: 'text', readOnly: false, valueMode: 'manual' },
    averageField()
  ];
  const merged = reportRuleEngineService.mergeEditableAnswersIntoCalculation({
    fields,
    calculationAnswers: { classEffort: 80, comment: 'old' },
    editableAnswers: { classEffort: 'Sat', comment: 'new', Average_Class_Mark: 1 }
  });
  assert.equal(merged.classEffort, 80);
  assert.equal(merged.comment, 'new');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'Average_Class_Mark'), false);
});

test('browser prepareReportAnswersForUI matches server average for conduct fixture', () => {
  const fields = [
    conductField('classEffort'),
    conductField('Class_Participation'),
    conductField('Respects_The_Teachers'),
    conductField('Treats_Other_Students'),
    { id: 'Attendance', type: 'number', valueMode: 'manual' },
    { id: 'Punctuality', type: 'number', valueMode: 'manual' },
    { id: 'Returns_Assignments', type: 'number', valueMode: 'manual' },
    { id: 'Writes_Tests', type: 'number', valueMode: 'manual' },
    averageField()
  ];
  const server = reportRuleEngineService.prepareReportAnswersForUI({
    template: { schema: { fields } },
    mergedAnswers: { ...sampleInputs },
    prefill: {}
  });
  const client = calculatedFields.prepareReportAnswersForUI({
    fields,
    answers: { ...sampleInputs },
    prefill: {}
  });
  assert.equal(client.calculationAnswers.Average_Class_Mark, server.calculationAnswers.Average_Class_Mark);
  assert.equal(client.displayAnswers.classEffort, 'Sat');
  const withDomLabels = calculatedFields.mergeEditableAnswersIntoCalculation({
    fields,
    calculationAnswers: client.calculationAnswers,
    editableAnswers: {
      classEffort: 'Sat',
      Class_Participation: 'Sat',
      Respects_The_Teachers: 'Sat',
      Treats_Other_Students: 'Sat'
    }
  });
  const afterDom = calculatedFields.prepareReportAnswersForUI({
    fields,
    answers: withDomLabels,
    prefill: {}
  });
  assert.equal(afterDom.calculationAnswers.Average_Class_Mark, server.calculationAnswers.Average_Class_Mark);
});
