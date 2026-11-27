'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');

function loadLocalEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

const SERVICE_KEY = 'school.nimpr_goals_suggestions';

async function main() {
  loadLocalEnvFile();
  const dataBackendRuntimeService = require(path.join(ROOT, 'MVC/services/dataBackendRuntimeService'));
  const { registerCoreEntityQueryExecutors } = require(path.join(ROOT, 'MVC/models/queryExecutorBootstrap'));
  const { getMongoCollection, disconnectMongo } = require(path.join(ROOT, 'MVC/infrastructure/mongo/mongoConnection'));
  const schoolAiServiceDefinitionDataService = require(path.join(
    ROOT,
    'packages/school/MVC/services/school/schoolAiServiceDefinitionDataService'
  ));
  const { loadPresetFile } = require(path.join(ROOT, 'packages/school/MVC/config/schoolAiServiceDefinitionPresets'));
  const { outputsFromFormUiAndReportUi } = require(path.join(
    ROOT,
    'packages/school/MVC/services/school/schoolAiOutputFieldSyncService'
  ));

  const backend = await dataBackendRuntimeService.initializeDataBackend(process.env);
  registerCoreEntityQueryExecutors({ backendMode: backend.mode });
  console.log(`data backend: ${backend.mode}`);

  const preset = loadPresetFile(SERVICE_KEY);
  if (!preset) throw new Error(`Preset file missing for ${SERVICE_KEY}`);

  let orgId = '900000';
  if (backend.mode === 'mongo') {
    const col = getMongoCollection('schoolAiServiceDefinitions');
    const existing = await col.find({ serviceKey: SERVICE_KEY }).toArray();
    if (existing.length && existing[0].orgId) {
      orgId = String(existing[0].orgId);
    } else {
      const bimpr = await col.findOne({ serviceKey: 'school.bimpr_goals_checker' });
      if (bimpr?.orgId) orgId = String(bimpr.orgId);
    }
    console.log(`existing mongo rows: ${existing.length}`);
  }

  const outputs = Array.isArray(preset.outputs) && preset.outputs.length
    ? preset.outputs
    : outputsFromFormUiAndReportUi(preset.output?.jsonSchema || {});
  const user = { id: 'CURSOR_AGENT', activeOrgId: orgId };
  const payload = {
    inputs: preset.inputs,
    outputsJson: JSON.stringify(outputs),
    systemPrompt: preset.prompt.systemPrompt,
    userPromptTemplate: preset.prompt.userPromptTemplate,
    outputMode: 'json',
    jsonInstructions: preset.output.jsonInstructions,
    jsonSchema: preset.output.jsonSchema,
    isActive: true,
    notes: 'Synced from preset JSON (school.nimpr_goals_suggestions.json).'
  };

  const row = await schoolAiServiceDefinitionDataService.upsertDefinition(
    SERVICE_KEY,
    payload,
    user,
    {}
  );
  const hasUi = Boolean(row?.output?.jsonSchema?.['x-reportUi']);
  console.log(`upserted id=${row.id} orgId=${row.orgId} mode=${row.output?.mode} x-reportUi=${hasUi} outputs=${outputs.length}`);

  if (backend.mode === 'mongo') {
    const col = getMongoCollection('schoolAiServiceDefinitions');
    const doc = await col.findOne({ orgId: row.orgId, serviceKey: SERVICE_KEY });
    console.log(`mongo verify id=${doc?.id} mode=${doc?.output?.mode}`);
    await disconnectMongo();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});