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

const SERVICE_KEY = 'school.holiday_cultural_observances';

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

  if (backend.mode !== 'mongo') {
    console.error(
      'This sync script only writes to MongoDB (schoolAiServiceDefinitions). Set DATA_BACKEND=mongo and retry.'
    );
    process.exit(1);
  }

  const preset = loadPresetFile(SERVICE_KEY);
  if (!preset) throw new Error(`Preset file missing for ${SERVICE_KEY}`);

  let orgId = '900000';
  const col = getMongoCollection('schoolAiServiceDefinitions');
  const existing = await col.find({ serviceKey: SERVICE_KEY }).toArray();
  if (existing.length && existing[0].orgId) {
    orgId = String(existing[0].orgId);
  } else {
    const peer = await col.findOne({
      serviceKey: {
        $in: [
          'school.bimpr_goals_checker',
          'school.nimpr_goals_suggestions',
          'school.word_of_day_autofill'
        ]
      }
    });
    if (peer?.orgId) orgId = String(peer.orgId);
  }
  console.log(`existing mongo rows: ${existing.length}; target orgId=${orgId}`);

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
    notes: 'Synced from preset JSON (school.holiday_cultural_observances.json).'
  };

  const row = await schoolAiServiceDefinitionDataService.upsertDefinition(
    SERVICE_KEY,
    payload,
    user,
    {}
  );
  console.log(`upserted id=${row.id} orgId=${row.orgId} mode=${row.output?.mode} outputs=${Array.isArray(row.outputs) ? row.outputs.length : 0}`);

  const doc = await col.findOne({ orgId: row.orgId, serviceKey: SERVICE_KEY });
  console.log(`mongo verify id=${doc?.id} mode=${doc?.output?.mode}`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});