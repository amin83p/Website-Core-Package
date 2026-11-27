'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const { getDefinitionPreset } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
const { getFormBindingProfile } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiFormBindingProfiles'));
const schoolAiOutputCatalogService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiOutputCatalogService'));
const schoolAiOutputBindingService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiOutputBindingService'));
const schoolAiServiceExecutionService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiServiceExecutionService'));
const wordOfDayAiAutofillService = require(path.join(ROOT, 'packages/school/MVC/services/school/wordOfDayAiAutofillService'));

const SERVICE_KEY = 'school.word_of_day_autofill';
const CONSUMER_KEY = 'word_of_day.form';

function testWoDPresetHasFormUi() {
  const preset = getDefinitionPreset(SERVICE_KEY);
  const formUi = preset.output.jsonSchema['x-formUi'];
  assert.ok(formUi && Array.isArray(formUi.fields));
  assert.strictEqual(formUi.fields.length, 5);
  const examplesRow = formUi.fields.find((row) => row.resultKey === 'examples');
  assert.strictEqual(examplesRow.widget, 'stringList');
  assert.strictEqual(examplesRow.minItems, 3);
}

function testBuildOutputCatalog() {
  const preset = getDefinitionPreset(SERVICE_KEY);
  const catalog = schoolAiOutputCatalogService.buildOutputCatalog(preset);
  assert.strictEqual(catalog.outputMode, 'json');
  assert.strictEqual(catalog.fields.length, 5);
  const pronunciation = catalog.fields.find((row) => row.resultKey === 'pronunciation');
  assert.strictEqual(pronunciation.widget, 'text');
  assert.strictEqual(pronunciation.required, true);
}

function testResolveBindingsValidatesKeys() {
  const preset = getDefinitionPreset(SERVICE_KEY);
  const catalog = schoolAiOutputCatalogService.buildOutputCatalog(preset);
  const profile = getFormBindingProfile(CONSUMER_KEY, SERVICE_KEY);
  const check = schoolAiOutputBindingService.resolveBindings(profile, catalog);
  assert.strictEqual(check.ok, true);
  assert.strictEqual(check.bindings.length, 5);
}

function testMapWoDSampleJson() {
  const fields = schoolAiOutputBindingService.mapAiResultToFormValues({
    pronunciation: '/ˈtɛst/',
    meaning: 'A procedure to verify behavior.',
    examples: ['We run a test.', 'The test passed.', 'Tests help us learn.'],
    difficulty: 'hard',
    wordTypes: ['verb', 'noun', 'invalid']
  }, { serviceKey: SERVICE_KEY, consumerKey: CONSUMER_KEY });
  assert.strictEqual(fields.difficulty, 'hard');
  assert.strictEqual(fields.examples.length, 3);
  assert.ok(fields.wordTypes.includes('verb'));
  assert.ok(!fields.wordTypes.includes('invalid'));
}

function testMapRejectsUnknownBindingKey() {
  const catalog = schoolAiOutputCatalogService.buildOutputCatalog(getDefinitionPreset(SERVICE_KEY));
  const badProfile = {
    outputBindings: [{ resultKey: 'notInSchema', target: 'dom', selector: '#x' }]
  };
  const check = schoolAiOutputBindingService.resolveBindings(badProfile, catalog);
  assert.strictEqual(check.ok, false);
  assert.match(check.errors[0], /not in the service output catalog/);
}

function testPromptStripsFormUi() {
  const preset = getDefinitionPreset(SERVICE_KEY);
  const built = schoolAiServiceExecutionService.buildPrompt(preset, {});
  assert.ok(!built.userPrompt.includes('x-formUi'));
  assert.ok(built.userPrompt.includes('pronunciation'));
}

function testMapAutofillPayloadUsesBindingService() {
  const fields = wordOfDayAiAutofillService.mapAutofillPayload({
    pronunciation: 'x',
    meaning: 'y',
    examples: ['a', 'b', 'c'],
    difficulty: 'easy',
    wordTypes: ['noun']
  });
  assert.strictEqual(fields.meaning, 'y');
  assert.strictEqual(fields.examples.length, 3);
}

const tests = [
  ['wod preset x-formUi', testWoDPresetHasFormUi],
  ['build catalog', testBuildOutputCatalog],
  ['resolve bindings', testResolveBindingsValidatesKeys],
  ['map sample json', testMapWoDSampleJson],
  ['reject unknown binding', testMapRejectsUnknownBindingKey],
  ['strip x-formUi prompt', testPromptStripsFormUi],
  ['wod mapAutofillPayload', testMapAutofillPayloadUsesBindingService]
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