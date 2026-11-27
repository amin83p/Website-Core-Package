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

function testBimprFlattenNoObjectType() {
  const { getDefinitionPreset } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const schema = getDefinitionPreset('school.bimpr_goals_checker').output.jsonSchema;
  const { fields } = sync.flattenJsonSchemaToOutputFields(schema);
  assert.ok(fields.some((row) => row.resultKey === 'goal_1.revised'));
  assert.ok(fields.some((row) => row.resultKey === 'goal_1.changeType'));
  assert.strictEqual(fields.some((row) => row.type === 'object'), false);
  const changeType = fields.find((row) => row.resultKey === 'goal_1.changeType');
  assert.strictEqual(changeType.type, 'select');
  assert.ok(changeType.options.length >= 4);
}

function testCleanResultKeyAllowsDots() {
  assert.strictEqual(sync.cleanResultKey('goal_1.revised'), 'goal_1.revised');
}

function testLegacyObjectRowStaleOnSync() {
  const { getDefinitionPreset } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const schema = getDefinitionPreset('school.bimpr_goals_checker').output.jsonSchema;
  const comparison = sync.compareOutputsToSchema([
    { resultKey: 'goal_1', label: 'Goal 1', type: 'object', status: 'active', valueField: 'revised' }
  ], schema);
  assert.ok(comparison.newKeys.some((row) => row.resultKey === 'goal_1.revised'));
  assert.ok(comparison.staleKeys.some((row) => row.resultKey === 'goal_1'));
}

function testBuildReportUiGroupsFlatGoals() {
  const reportUi = sync.buildReportUiFromOutputs([
    { resultKey: 'goal_1.revised', label: 'Goal 1 — Revised', type: 'text', status: 'active', actions: ['copy', 'apply'] },
    { resultKey: 'goal_1.changeType', label: 'Goal 1 — Change type', type: 'select', status: 'active', actions: ['copy'] },
    { resultKey: 'goal_1.changeSummary', label: 'Goal 1 — Summary', type: 'text', status: 'active', actions: ['copy'] }
  ]);
  assert.strictEqual(reportUi.layout, 'sections');
  assert.strictEqual(reportUi.sections[0].resultKey, 'goal_1');
  assert.strictEqual(reportUi.sections[0].valueField, 'revised');
}

function testBuildReportUiFromLegacyCatalog() {
  const { getDefinitionPreset } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const schema = getDefinitionPreset('school.bimpr_goals_checker').output.jsonSchema;
  const reportUi = sync.buildReportUiFromOutputs([], schema);
  assert.ok(reportUi?.sections?.length);
  assert.strictEqual(reportUi.sections[0].resultKey, 'goal_1');
}

function testGetValueAtResultPath() {
  const data = { goal_1: { revised: 'Hello', changeType: 'minor_edit' } };
  assert.strictEqual(sync.getValueAtResultPath(data, 'goal_1.revised'), 'Hello');
  assert.strictEqual(sync.getValueAtResultPath(data, 'notes'), undefined);
}

function testCatalogEntryUsesOutputs() {
  const entry = binding.buildCatalogEntryFromBinding(
    {
      id: 'ai_1',
      serviceKey: 'school.bimpr_goals_checker',
      inputBindings: {},
      outputBindings: { 'goal_1.revised': { source: 'field', value: 'g1' } }
    },
    {
      isActive: true,
      prompt: { userPromptTemplate: 'go' },
      output: { mode: 'json' },
      outputs: [
        { resultKey: 'goal_1.revised', label: 'Goal 1 revised', type: 'text', status: 'active', actions: ['copy', 'apply'] }
      ]
    }
  );
  assert.ok(entry.reportUi?.sections?.length);
  assert.strictEqual(entry.outputBindings['goal_1.revised'].source, 'field');
}

const tests = [
  ['infer compare', testInferAndCompare],
  ['stringList normalize', testStringListTypeSurvivesNormalize],
  ['wod sync in sync', testWoDSyncInSyncAfterApply],
  ['apply no delete', testApplyDoesNotDeleteOrphan],
  ['bimpr flatten', testBimprFlattenNoObjectType],
  ['dot result keys', testCleanResultKeyAllowsDots],
  ['legacy object stale', testLegacyObjectRowStaleOnSync],
  ['report ui group', testBuildReportUiGroupsFlatGoals],
  ['report ui from schema', testBuildReportUiFromLegacyCatalog],
  ['get value path', testGetValueAtResultPath],
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