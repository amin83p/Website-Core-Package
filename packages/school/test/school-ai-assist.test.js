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

function testListPagesIncludeTableModals() {
  const controllerPath = path.join(ROOT, 'packages/school/MVC/controllers/school/schoolAiAssistController.js');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');
  assert.match(controllerSource, /listProviders[\s\S]*includeModal_Table:\s*true/);
  assert.match(controllerSource, /listTokenUsage[\s\S]*includeModal_Table:\s*true/);
  assert.match(controllerSource, /listUsageLimits[\s\S]*includeModal_Table:\s*true/);
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
  testModelsRejectDisplayName();
  testCoerceInputsRequired();
  testListPagesIncludeTableModals();
  console.log('school-ai-assist.test.js: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});