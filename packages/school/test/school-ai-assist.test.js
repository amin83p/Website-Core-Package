'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const fs = require('fs');

const schoolAiProviderModel = require(path.join(ROOT, 'packages/school/MVC/models/school/schoolAiProviderModel'));
const schoolAiServiceAssignmentModel = require(path.join(ROOT, 'packages/school/MVC/models/school/schoolAiServiceAssignmentModel'));
const schoolAiRuntimeService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiRuntimeService'));
const schoolAiServiceDefinitionModel = require(path.join(ROOT, 'packages/school/MVC/models/school/schoolAiServiceDefinitionModel'));
const schoolAiServiceExecutionService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiServiceExecutionService'));
const {
  normalizeBannedUserIds,
  normalizeModelsList
} = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiModelUtils'));
const { periodWindowStart } = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiAssistCommon'));

function testModelsNormalize() {
  const rows = normalizeModelsList([
    { modelId: 'gpt-test', label: 'GPT Test' },
    { modelId: 'gpt-test', label: 'dup' }
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].modelId, 'gpt-test');
}

function testBanNormalize() {
  const bans = normalizeBannedUserIds(['USR1', 'USR1', '']);
  assert.deepStrictEqual(bans, ['USR1']);
}

function testProviderSanitize() {
  const sanitized = schoolAiProviderModel.sanitizeProviderForRead({
    id: 'X',
    apiKeyEncrypted: 'secret',
    apiKeyHint: '***1234',
    models: [{ modelId: 'm1' }]
  });
  assert.strictEqual(sanitized.apiKeyEncrypted, undefined);
  assert.strictEqual(sanitized.hasApiKey, true);
  assert.strictEqual(sanitized.modelCount, 1);
}

function testAssignmentRequiresService() {
  assert.throws(() => {
    schoolAiServiceAssignmentModel.normalizeAssignmentRecord({ orgId: 'ORG1', serviceKey: 'unknown.service' }, null, true);
  }, /Unknown AI service key/);
}

function testPeriodWindowMonthly() {
  const start = periodWindowStart('monthly', new Date('2026-03-15T12:00:00.000Z'));
  assert.strictEqual(start.toISOString(), '2026-03-01T00:00:00.000Z');
}

async function testRuntimeBan() {
  const providerDataService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiProviderDataService'));
  assert.throws(() => {
    providerDataService.assertUserNotBanned({ bannedUserIds: ['U1'] }, 'U1');
  }, /blocked/);
}

function testDefinitionRequiresKnownService() {
  assert.throws(() => {
    schoolAiServiceDefinitionModel.normalizeDefinitionRecord({
      orgId: 'ORG1',
      serviceKey: 'unknown.service',
      prompt: { userPromptTemplate: 'Hello {{x}}' },
      inputs: [{ id: 'x', type: 'text', label: 'X' }]
    }, null, true);
  }, /Unknown AI service key/);
}

function testBuildPromptSubstitution() {
  const def = {
    inputs: [{ id: 'name', type: 'text', label: 'Name' }],
    prompt: {
      systemPrompt: 'Sys {{name}}',
      userPromptTemplate: 'User {{name}}'
    },
    output: { mode: 'markdown' }
  };
  const built = schoolAiServiceExecutionService.buildPrompt(def, { name: 'Ada' });
  assert.strictEqual(built.systemPrompt, 'Sys Ada');
  assert.strictEqual(built.userPrompt, 'User Ada');
}

function testFormatOutputJsonFence() {
  const formatted = schoolAiServiceExecutionService.formatOutput(
    { mode: 'json', jsonSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } } },
    '```json\n{"summary":"ok"}\n```',
    'trace-1'
  );
  assert.strictEqual(formatted.ok, true);
  assert.deepStrictEqual(formatted.data, { summary: 'ok' });
}

function testBuildPromptStripsReportUiFromSchema() {
  const built = schoolAiServiceExecutionService.buildPrompt({
    prompt: { userPromptTemplate: 'Revise goals.' },
    output: {
      mode: 'json',
      jsonSchema: {
        type: 'object',
        properties: { goal_1: { type: 'string' } },
        'x-reportUi': { layout: 'sections', sections: [] }
      }
    }
  }, {});
  assert.ok(!built.userPrompt.includes('x-reportUi'));
  assert.ok(built.userPrompt.includes('goal_1'));
}

function testBuildPromptStripsFormUiFromSchema() {
  const built = schoolAiServiceExecutionService.buildPrompt({
    prompt: { userPromptTemplate: 'Fill the form.' },
    output: {
      mode: 'json',
      jsonSchema: {
        type: 'object',
        properties: { meaning: { type: 'string' } },
        'x-formUi': { fields: [{ resultKey: 'meaning', label: 'Meaning', widget: 'textarea' }] }
      }
    }
  }, {});
  assert.ok(!built.userPrompt.includes('x-formUi'));
  assert.ok(built.userPrompt.includes('meaning'));
}

function testFormatOutputPartialGoalsWithReportUi() {
  const formatted = schoolAiServiceExecutionService.formatOutput(
    {
      mode: 'json',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          goal_1: { type: 'string' },
          goal_2: { type: 'string' }
        },
        'x-reportUi': { layout: 'sections', sections: [] }
      }
    },
    '{"goal_1":"revised one"}',
    'trace-2'
  );
  assert.strictEqual(formatted.ok, true);
  assert.deepStrictEqual(formatted.data, { goal_1: 'revised one' });
}

function testModelsRejectDisplayName() {
  assert.throws(() => {
    normalizeModelsList([{ modelId: 'Gemini 3.1 Flash Lite' }], { strict: false });
  }, /valid API model id/);
}

function testCoerceInputsRequired() {
  assert.throws(() => {
    schoolAiServiceExecutionService.coerceInputs(
      [{ id: 'need', type: 'text', label: 'Need', required: true }],
      {}
    );
  }, /required/);
}

function testBimprPresetLoadsFromJsonFile() {
  const { getDefinitionPreset, PRESET_DIR } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  assert.ok(fs.existsSync(path.join(PRESET_DIR, 'school.bimpr_goals_checker.json')));
  const preset = getDefinitionPreset('school.bimpr_goals_checker');
  assert.ok(preset);
  assert.strictEqual(preset.output.mode, 'json');
  assert.strictEqual(preset.output.jsonSchema['x-reportUi'].layout, 'sections');
  assert.strictEqual(preset.inputs.length, 5);
  assert.match(preset.prompt.userPromptTemplate, /at least 4 and up to 5 complete sentences/i);
  assert.match(preset.prompt.userPromptTemplate, /two-week Bi-MPR period/i);
}

function testNimprPresetAndRegistry() {
  const { getDefinitionPreset, PRESET_DIR } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const { listAiServices } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceRegistry'));
  const sync = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiOutputFieldSyncService'));
  assert.ok(fs.existsSync(path.join(PRESET_DIR, 'school.nimpr_goals_suggestions.json')));
  const preset = getDefinitionPreset('school.nimpr_goals_suggestions');
  assert.ok(preset);
  assert.strictEqual(preset.output.mode, 'json');
  assert.strictEqual(preset.inputs.length, 10);
  assert.match(preset.prompt.userPromptTemplate, /at least 4 and up to 5 complete sentences/i);
  assert.match(preset.prompt.userPromptTemplate, /two-week Bi-MPR period/i);
  const inclListen = preset.inputs.find((row) => row.id === 'include_listening');
  assert.strictEqual(inclListen?.type, 'boolean');
  const registry = listAiServices();
  assert.ok(registry.some((row) => row.serviceKey === 'school.nimpr_goals_suggestions'));
  assert.ok(registry.some((row) => row.serviceKey === 'school.holiday_cultural_observances'));
  const outputs = sync.outputsFromFormUiAndReportUi(preset.output.jsonSchema);
  assert.ok(outputs.some((row) => row.resultKey === 'goal_1.suggested'));
  assert.ok(outputs.some((row) => row.resultKey === 'goal_1.rationale'));
  assert.ok(!outputs.some((row) => row.resultKey === 'goal_1.revised'));
  assert.ok(!outputs.some((row) => row.type === 'object'));
  const units = sync.buildAiAssistDisplayUnits({ outputs: sync.sanitizeDefinitionOutputsForClient({ outputs }) }, preset.output.jsonSchema['x-reportUi']);
  const goal1 = units.find((u) => u.mode === 'section' && u.unitKey === 'goal_1');
  assert.strictEqual(goal1.applyBindingKey, 'goal_1.suggested');
}

function testListPagesIncludeTableModals() {
  const controllerPath = path.join(ROOT, 'packages/school/MVC/controllers/school/schoolAiAssistController.js');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');
  assert.match(controllerSource, /listProviders[\s\S]*includeModal_Table:\s*true/);
  assert.match(controllerSource, /listTokenUsage[\s\S]*includeModal_Table:\s*true/);
  assert.match(controllerSource, /listUsageLimits[\s\S]*includeModal_Table:\s*true/);
}

function testReportAiAssistHistoryWiring() {
  const routesSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/reportRoutes.js'), 'utf8');
  assert.match(routesSource, /\/ai-assist\/history/);
  assert.match(routesSource, /reportAiAssistHistory/);

  const tokenUsageDataService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiTokenUsageDataService'));
  assert.strictEqual(typeof tokenUsageDataService.enrichUsageRecord, 'function');
  assert.strictEqual(typeof tokenUsageDataService.listReportAiAssistHistory, 'function');
  assert.strictEqual(typeof tokenUsageDataService.buildReportInputPayloadSnapshot, 'function');
  const inputSnap = tokenUsageDataService.buildReportInputPayloadSnapshot({ goal_1: 'A' }, { goal_1: 'A' });
  assert.ok(inputSnap && inputSnap.resolved && inputSnap.coerced);
  assert.strictEqual(tokenUsageDataService.REPORT_AI_SOURCE, 'report_ai_assist');

  const tokenUsageModel = require(path.join(ROOT, 'packages/school/MVC/models/school/schoolAiTokenUsageModel'));
  assert.match(String(tokenUsageModel.normalizeUsageRecord), /usageSource/);
  assert.match(String(tokenUsageModel.normalizeUsageRecord), /inputPayload/);

  const panelSource = fs.readFileSync(path.join(ROOT, 'packages/school/public/scripts/reportAiAssistPanel.js'), 'utf8');
  assert.match(panelSource, /loadHistoryFromServer/);
  assert.match(panelSource, /runHistory/);
  assert.match(panelSource, /buildReportAiAssistJsonHeaders/);
  assert.doesNotMatch(panelSource, /sessionStorage/);

  const controllerSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/reportController.js'), 'utf8');
  assert.match(controllerSource, /ranByLabel/);
  assert.match(controllerSource, /canClearTray/);
  const adminAccessSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/services/school/schoolAdminAccessService.js'), 'utf8');
  assert.match(adminAccessSource, /canClearReportAiAssistTrayAsync/);
  const modalPartial = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/report/partials/reportAiAssistModal.ejs'), 'utf8');
  assert.match(modalPartial, /canClearReportAiAssistTray/);
  assert.match(controllerSource, /reportAiAssistHistory/);
  assert.match(controllerSource, /enrichReportAiUsageRecord/);
  assert.match(controllerSource, /usageRecordId/);

  const invokeSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiProviderInvokeService.js'), 'utf8');
  assert.match(invokeSource, /usageRecordId/);
}

function testAiAssistPagesUseMessageModalPartial() {
  const controllerPath = path.join(ROOT, 'packages/school/MVC/controllers/school/schoolAiAssistController.js');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');
  const viewsDir = path.join(ROOT, 'packages/school/MVC/views/school/aiAssist');
  const requiredModalRenders = [
    'showCreateProvider',
    'showEditProvider',
    'showServiceAssignments',
    'listServiceDefinitions',
    'showEditServiceDefinition',
    'showTokenUsageDetail'
  ];
  requiredModalRenders.forEach((handler) => {
    const pattern = new RegExp(`${handler}[\\s\\S]*?includeModal:\\s*true`);
    assert.match(controllerSource, pattern, `Expected ${handler} to pass includeModal: true`);
  });

  const providerList = fs.readFileSync(path.join(viewsDir, 'providerList.ejs'), 'utf8');
  const usageLimitList = fs.readFileSync(path.join(viewsDir, 'usageLimitList.ejs'), 'utf8');
  const providerForm = fs.readFileSync(path.join(viewsDir, 'providerForm.ejs'), 'utf8');
  const runnerPartial = fs.readFileSync(path.join(viewsDir, 'partials/schoolAiServiceRunner.ejs'), 'utf8');
  assert.doesNotMatch(providerForm, /include\('partials\/modal'\)/, 'Provider form should rely on layout message modal');
  assert.match(providerList, /aiAssistGuardedDeleteScript/);
  assert.match(usageLimitList, /aiAssistGuardedDeleteScript/);
  const guardedDelete = fs.readFileSync(path.join(viewsDir, 'partials/aiAssistGuardedDeleteScript.ejs'), 'utf8');
  assert.match(guardedDelete, /guardedDeleteBasePath/);
  assert.doesNotMatch(guardedDelete, /const deleteBasePath = typeof deleteBasePath/);
  assert.match(runnerPartial, /SchoolAiAssistMessaging/);
  assert.doesNotMatch(runnerPartial, /window\.alert/);
}

async function run() {
  testModelsNormalize();
  testBanNormalize();
  testProviderSanitize();
  testAssignmentRequiresService();
  testPeriodWindowMonthly();
  await testRuntimeBan();
  testDefinitionRequiresKnownService();
  testBuildPromptSubstitution();
  testFormatOutputJsonFence();
  testBuildPromptStripsReportUiFromSchema();
  testBuildPromptStripsFormUiFromSchema();
  testFormatOutputPartialGoalsWithReportUi();
  testModelsRejectDisplayName();
  testCoerceInputsRequired();
  testBimprPresetLoadsFromJsonFile();
  testNimprPresetAndRegistry();
  testListPagesIncludeTableModals();
  testReportAiAssistHistoryWiring();
  testAiAssistPagesUseMessageModalPartial();
  console.log('school-ai-assist.test.js: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});