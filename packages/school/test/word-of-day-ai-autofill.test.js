'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const { getAiServiceByKey } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceRegistry'));
const { getDefinitionPreset, PRESET_DIR } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
const wordOfDayModel = require(path.join(ROOT, 'packages/school/MVC/models/school/wordOfDayModel'));
const wordOfDayAiAutofillService = require(path.join(ROOT, 'packages/school/MVC/services/school/wordOfDayAiAutofillService'));
const schoolAiUsageLimitService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiUsageLimitService'));

const SERVICE_KEY = 'school.word_of_day_autofill';

function testRegistryEntry() {
  const row = getAiServiceByKey(SERVICE_KEY);
  assert.ok(row, 'registry row');
  assert.strictEqual(row.status, 'implemented');
  assert.strictEqual(row.category, 'word_of_day');
}

function testPresetFileAndSchemaEnums() {
  const filePath = path.join(PRESET_DIR, `${SERVICE_KEY}.json`);
  assert.ok(fs.existsSync(filePath));
  const preset = getDefinitionPreset(SERVICE_KEY);
  assert.ok(preset);
  assert.strictEqual(preset.output.mode, 'json');
  const difficultyEnum = preset.output.jsonSchema.properties.difficulty.enum;
  assert.deepStrictEqual([...difficultyEnum].sort(), [...wordOfDayModel.DIFFICULTY_LEVELS].sort());
  const typeEnum = preset.output.jsonSchema.properties.wordTypes.items.enum;
  assert.deepStrictEqual([...typeEnum].sort(), [...wordOfDayModel.WORD_TYPES].sort());
  const formUi = preset.output.jsonSchema['x-formUi'];
  assert.ok(formUi && formUi.fields.length >= 5);
}

function testMapAutofillPayload() {
  const fields = wordOfDayAiAutofillService.mapAutofillPayload({
    pronunciation: '/ˈtɛst/',
    meaning: 'A procedure to verify behavior.',
    examples: ['We run a test.', 'The test passed.', 'Tests help us learn.'],
    difficulty: 'hard',
    wordTypes: ['verb', 'noun', 'invalid']
  });
  assert.strictEqual(fields.difficulty, 'hard');
  assert.strictEqual(fields.examples.length, 3);
  assert.ok(fields.wordTypes.includes('verb'));
  assert.ok(!fields.wordTypes.includes('invalid'));
}

function testMapAutofillRejectsShortExamples() {
  assert.throws(() => {
    wordOfDayAiAutofillService.mapAutofillPayload({
      pronunciation: 'x',
      meaning: 'y',
      examples: ['only one'],
      difficulty: 'easy',
      wordTypes: ['noun']
    });
  }, /3 example sentence/);
}

async function testAutofillUsesExecutionService() {
  const run = async ({ serviceKey, inputs, usageMeta }) => {
    assert.strictEqual(serviceKey, SERVICE_KEY);
    assert.strictEqual(inputs.word, 'persevere');
    assert.strictEqual(usageMeta.usageSource, 'word_of_day_autofill');
    return {
      ok: true,
      data: {
        pronunciation: '/pɜːrsəˈvɪr/',
        meaning: 'Continue despite difficulty.',
        examples: ['She persevered.', 'They persevered through winter.', 'Keep persevering.'],
        difficulty: 'medium',
        wordTypes: ['verb']
      },
      traceId: 'trace-1',
      usageRecordId: 'usage-1'
    };
  };
  wordOfDayAiAutofillService.__setDependenciesForTest({ schoolAiServiceExecutionService: { run } });
  try {
    const out = await wordOfDayAiAutofillService.autofill({ word: '  persevere  ', requestingUser: { id: 'U1' } });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.fields.meaning.includes('difficulty'), true);
    assert.strictEqual(out.traceId, 'trace-1');
  } finally {
    wordOfDayAiAutofillService.__resetDependenciesForTest();
  }
}

async function testZeroCapsBlockRun() {
  const limits = [{ appliesTo: 'school.word_of_day_autofill', periodType: 'weekly', maxTotalTokens: 0, maxRequestCount: 0, isActive: true }];
  const original = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiUserUsageLimitDataService')).listActiveLimitsForUser;
  const limitSvc = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiUserUsageLimitDataService'));
  limitSvc.listActiveLimitsForUser = async () => limits;
  try {
    const gate = await schoolAiUsageLimitService.evaluateServiceAccess({
      orgId: '900000',
      userId: '646044',
      serviceKey: SERVICE_KEY,
      requestingUser: { id: '646044', activeOrgId: '900000' }
    });
    assert.strictEqual(gate.hasAssignedLimit, true);
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.code, 'AI_USAGE_NO_QUOTA');
  } finally {
    limitSvc.listActiveLimitsForUser = original;
  }
}

function testUsageLimitAppliesToService() {
  assert.strictEqual(
    schoolAiUsageLimitService.limitAppliesToService({ appliesTo: 'all_services' }, SERVICE_KEY),
    true
  );
  assert.strictEqual(
    schoolAiUsageLimitService.limitAppliesToService({ appliesTo: SERVICE_KEY }, SERVICE_KEY),
    true
  );
  assert.strictEqual(
    schoolAiUsageLimitService.limitAppliesToService({ appliesTo: 'school.bimpr_goals_checker' }, SERVICE_KEY),
    false
  );
}

function testControllerUsageLimitGate() {
  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/wordOfDayController.js'),
    'utf8'
  );
  assert.match(controllerSource, /evaluateServiceAccess/);
  assert.match(controllerSource, /resolveWordOfDayAiAssistAccess/);
  assert.match(controllerSource, /wordOfDayAiAssistAccess/);

  const formSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/wordOfDay/form.ejs'),
    'utf8'
  );
  assert.match(formSource, /canUseWodAiAutofill/);
  assert.match(formSource, /canShowWodAiAutofill/);
  assert.match(formSource, /aiAutofill:/);
  assert.match(formSource, /blockedMessage/);
  const formJs = fs.readFileSync(path.join(ROOT, 'packages/school/public/scripts/wordOfDayForm.js'), 'utf8');
  assert.match(formJs, /aiAutofillAllowed/);
  assert.match(formJs, /AI credit limit/);
}

function testStaticRouteAndFormScript() {
  const routesSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/routes/wordOfDayRoutes.js'),
    'utf8'
  );
  assert.match(routesSource, /\/api\/ai-autofill/);
  assert.match(routesSource, /postAiAutofill/);

  const formSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/public/scripts/wordOfDayForm.js'),
    'utf8'
  );
  assert.match(formSource, /\/api\/ai-autofill/);
  assert.match(formSource, /btnWodAiAutofill/);
  assert.match(formSource, /applyAiAutofillFields/);
  assert.match(formSource, /beginAiAutofillLoading/);
  assert.match(formSource, /showLoading/);
  assert.match(formSource, /SchoolAiFormAutofill/);

  const formEjs = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/wordOfDay/form.ejs'),
    'utf8'
  );
  assert.match(formEjs, /schoolAiFormAutofill\.js/);
  assert.match(formEjs, /wodAiFormOutputBindings/);
}

function testSyncScriptRequiresMongo() {
  const source = fs.readFileSync(
    path.join(ROOT, 'packages/school/scripts/maintenance/sync-word-of-day-ai-service-definition.js'),
    'utf8'
  );
  assert.match(source, /backend\.mode !== 'mongo'/);
  assert.match(source, /school\.word_of_day_autofill/);
  assert.match(source, /x-formUi/);
}

const tests = [
  ['registry', testRegistryEntry],
  ['preset schema', testPresetFileAndSchemaEnums],
  ['map payload', testMapAutofillPayload],
  ['map rejects examples', testMapAutofillRejectsShortExamples],
  ['autofill run', testAutofillUsesExecutionService],
  ['usage limit applies', testUsageLimitAppliesToService],
  ['zero caps block', testZeroCapsBlockRun],
  ['controller usage gate', testControllerUsageLimitGate],
  ['static wiring', testStaticRouteAndFormScript],
  ['sync script', testSyncScriptRequiresMongo]
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