'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const sync = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiOutputFieldSyncService'));
const binding = require(path.join(ROOT, 'packages/school/MVC/services/school/reportTemplateAiBindingService'));

const SCHEMA = {
  type: 'object',
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
    legacy_field: { type: 'string' }
  }
};

function testInferAndCompare() {
  const inferred = sync.inferFieldsFromJsonSchema(SCHEMA);
  assert.ok(inferred.find((row) => row.resultKey === 'summary'));
  const comparison = sync.compareOutputsToSchema([
    { resultKey: 'legacy_field', label: 'Old', type: 'text', status: 'active' }
  ], SCHEMA);
  assert.strictEqual(comparison.newKeys.length, 1);
  assert.strictEqual(comparison.newKeys[0].resultKey, 'summary');
  assert.strictEqual(comparison.staleKeys.length, 0);
  const staleCompare = sync.compareOutputsToSchema([
    { resultKey: 'orphan', label: 'Orphan', type: 'text', status: 'active' }
  ], SCHEMA);
  assert.strictEqual(staleCompare.staleKeys.length, 1);
}

function testStringListTypeSurvivesNormalize() {
  const rows = sync.normalizeOutputsList([
    { resultKey: 'examples', label: 'Examples', type: 'stringList', status: 'active' }
  ]);
  assert.strictEqual(rows[0].type, 'stringList');
}

function testWoDSyncInSyncAfterApply() {
  const { getDefinitionPreset } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const schema = getDefinitionPreset('school.word_of_day_autofill').output.jsonSchema;
  let outputs = sync.outputsFromFormUiAndReportUi(schema);
  const first = sync.compareOutputsToSchema(outputs, schema);
  const updateKeys = [...first.typeChanges, ...first.requiredChanges].map((r) => r.resultKey);
  outputs = sync.applySyncChoices(outputs, schema, { addKeys: [], markStaleKeys: [], updateKeys });
  const second = sync.compareOutputsToSchema(outputs, schema);
  const drift = second.typeChanges.filter((r) => ['examples', 'wordTypes'].includes(r.resultKey));
  assert.strictEqual(drift.length, 0, `examples/wordTypes should not keep drifting: ${JSON.stringify(drift)}`);
}

function testApplyDoesNotDeleteOrphan() {
  const outputs = [{ resultKey: 'orphan', label: 'Orphan', type: 'text', status: 'active' }];
  const next = sync.applySyncChoices(outputs, SCHEMA, {
    addKeys: ['summary'],
    markStaleKeys: [],
    updateKeys: []
  });
  assert.strictEqual(next.length, 2);
  assert.ok(next.find((row) => row.resultKey === 'orphan'));
  assert.ok(next.find((row) => row.resultKey === 'summary'));
}

function testBuildReportUiFromOutputs() {
  const reportUi = sync.buildReportUiFromOutputs([
    { resultKey: 'goal_1', label: 'Goal 1', type: 'object', valueField: 'revised', status: 'active', actions: ['copy', 'apply'] }
  ]);
  assert.strictEqual(reportUi.layout, 'sections');
  assert.strictEqual(reportUi.sections[0].resultKey, 'goal_1');
}

function testCatalogEntryUsesOutputs() {
  const entry = binding.buildCatalogEntryFromBinding(
    {
      id: 'ai_1',
      serviceKey: 'school.bimpr_goals_checker',
      inputBindings: {},
      outputBindings: { goal_1: { source: 'field', value: 'g1' } }
    },
    {
      isActive: true,
      prompt: { userPromptTemplate: 'go' },
      output: { mode: 'json' },
      outputs: [
        { resultKey: 'goal_1', label: 'Goal 1', type: 'object', valueField: 'revised', status: 'active', actions: ['copy', 'apply'] }
      ]
    }
  );
  assert.ok(entry.reportUi?.sections?.length);
  assert.strictEqual(entry.outputBindings.goal_1.source, 'field');
}

const tests = [
  ['infer compare', testInferAndCompare],
  ['stringList normalize', testStringListTypeSurvivesNormalize],
  ['wod sync in sync', testWoDSyncInSyncAfterApply],
  ['apply no delete', testApplyDoesNotDeleteOrphan],
  ['report ui', testBuildReportUiFromOutputs],
  ['catalog entry', testCatalogEntryUsesOutputs]
];

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (err) {
      console.error(`fail ${name}`, err);
      process.exitCode = 1;
      break;
    }
  }
})();