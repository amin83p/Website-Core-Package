const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function calculatedField(id, expression, dependencies) {
  return {
    id,
    type: 'number',
    valueMode: 'calculated',
    calculationRule: { enabled: true, expression, onError: 'keep_last' },
    calculationDependencies: dependencies
  };
}

test('browser report calculator recomputes linked fields in dependency order', () => {
  const fields = [
    { id: 'score_a', type: 'number', valueMode: 'manual' },
    { id: 'score_b', type: 'number', valueMode: 'manual' },
    calculatedField('average', '(num(answers.score_a) + num(answers.score_b)) / 2', ['score_a', 'score_b']),
    calculatedField('rounded_average', 'round(answers.average, 1)', ['average'])
  ];

  const first = calculatedFields.recomputeCalculatedAnswers({ fields, answers: { score_a: 70, score_b: 90 } });
  assert.equal(first.answers.average, 80);
  assert.equal(first.answers.rounded_average, 80);

  const changed = calculatedFields.recomputeCalculatedAnswers({ fields, answers: { ...first.answers, score_b: 100 } });
  assert.equal(changed.answers.average, 85);
  assert.equal(changed.answers.rounded_average, 85);
  assert.equal(changed.diagnostics.length, 0);
});

test('browser report calculator supports decimal literals and prefill dependencies', () => {
  const fields = [calculatedField('weighted', 'num(prefill.base_score) * .5', ['base_score'])];
  const result = calculatedFields.recomputeCalculatedAnswers({ fields, answers: {}, prefill: { base_score: 86 } });
  assert.equal(result.answers.weighted, 43);
});

test('Average Class Mark formula returns 54 for report instance 542136 values', () => {
  const expression = 'round((num(answers.Attendance)+num(answers.Punctuality)+num(answers.Respects_The_Teachers)+num(answers.Returns_Assignments)+num(answers.Treats_Other_Students)+num(answers.Writes_Tests)+num(answers.classEffort)+num(answers.Class_Participation))/8.0,0)';
  const fields = [calculatedField('Average_Class_Mark', expression, [
    'Attendance', 'Punctuality', 'Respects_The_Teachers', 'Returns_Assignments',
    'Treats_Other_Students', 'Writes_Tests', 'classEffort', 'Class_Participation'
  ])];
  const result = calculatedFields.recomputeCalculatedAnswers({
    fields,
    answers: {
      Attendance: 31.48,
      Punctuality: 0,
      Respects_The_Teachers: 100,
      Treats_Other_Students: 100,
      classEffort: 100,
      Class_Participation: 100
    }
  });
  assert.equal(result.answers.Average_Class_Mark, 54);
});

test('report pages load and wire the shared live calculation runtime', () => {
  const instanceEditor = fs.readFileSync(path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/instanceEditor.ejs'), 'utf8');
  const matrixEditor = fs.readFileSync(path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/instanceMatrix.ejs'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT_DIR, 'packages/school/MVC/controllers/school/reportController.js'), 'utf8');
  const templateModel = fs.readFileSync(path.join(ROOT_DIR, 'packages/school/MVC/models/school/reportTemplateModel.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/school/package.manifest.json'), 'utf8'));

  assert.match(instanceEditor, /include\('partials\/calculatedFieldsRuntime'\)/);
  assert.match(instanceEditor, /SchoolReportCalculatedFields\?\.recomputeCalculatedAnswers/);
  assert.match(matrixEditor, /include\('partials\/calculatedFieldsRuntime'\)/);
  assert.match(matrixEditor, /function recalculateRow\(row\)/);
  assert.match(matrixEditor, /function recalculateAllRows\(\)/);
  assert.match(matrixEditor, /control\.addEventListener\('input',[\s\S]*recalculateRow\(row\)/);
  assert.match(matrixEditor, /js-matrix-shared-field'[\s\S]*recalculateAllRows\(\)/);
  assert.match(controller, /const calculatedForRender = reportService\.recomputeCalculatedAnswers/);
  assert.match(controller, /const mergedData = calculatedForRender\.answers/);
  assert.match(controller, /validateCalculatedFieldExpressions\(payload,\s*\{ strict: true \}\)/);
  assert.match(templateModel, /validateCalculatedFieldExpressions\(\{ schema: \{ fields \} \},\s*\{ strict: true \}\)/);
  assert.equal(manifest.assets.publicPath, '/scripts');
  assert.equal(manifest.assets.metadataOnly, true);
});
