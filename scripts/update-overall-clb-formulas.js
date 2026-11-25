/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const reportRuleEngineService = require('../packages/school/MVC/services/school/reportRuleEngineService');
const overallReportTemplateModel = require('../packages/school/MVC/models/school/overallReportTemplateModel');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCX_ALIASES = Object.freeze({
  clbl: { result: 'CLB_result_listening', current: 'CLB_current_listening' },
  clbs: { result: 'CLB_result_speaking', current: 'CLB_current_speaking' },
  clbr: { result: 'CLB_result_reading', current: 'CLB_current_reading' },
  clbw: { result: 'CLB_result_writing', current: 'CLB_current_writing' }
});

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const token of argv) {
    if (token === '--dry-run') out.dryRun = true;
  }
  return out;
}

function detectPrimarySlot(expression = '') {
  const matches = [...String(expression).matchAll(/source\s*\(\s*"([^"]+)"/g)];
  if (!matches.length) return '';
  const counts = new Map();
  matches.forEach((match) => {
    const slot = String(match[1] || '').trim().toUpperCase();
    if (!slot) return;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  });
  let best = '';
  let bestCount = 0;
  counts.forEach((count, slot) => {
    if (count > bestCount) {
      best = slot;
      bestCount = count;
    }
  });
  return best;
}

function buildClbEffectiveExpression(slot, resultKey, currentKey) {
  const s = String(slot || 'T1').trim().toUpperCase();
  return [
    'ifelse(',
    `  str(source("${s}", "${resultKey}")) != ""`,
    `  && source("${s}", "${resultKey}") != "-"`,
    `  && str(source("${s}", "CLB_latest_result_recorded_at")) != ""`,
    `  && source("${s}", "CLB_latest_result_recorded_at") <= source("${s}", "report_period_due_date"),`,
    `  source("${s}", "${resultKey}"),`,
    `  source("${s}", "${currentKey}")`,
    ')'
  ].join('\n');
}

function collectClbFields(template = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const out = [];
  fields.forEach((field) => {
    const alias = String(field?.docxAlias || '').trim().toLowerCase();
    const keys = DOCX_ALIASES[alias];
    if (!keys) return;
    const expression = String(field?.calculationRule?.expression || '').trim();
    const slot = detectPrimarySlot(expression) || 'T1';
    out.push({
      fieldId: field.id,
      docxAlias: alias,
      slot,
      priorExpression: expression,
      nextExpression: buildClbEffectiveExpression(slot, keys.result, keys.current)
    });
  });
  return out;
}

function applyExpressionUpdates(template, updates) {
  const next = JSON.parse(JSON.stringify(template));
  const byId = new Map(updates.map((row) => [row.fieldId, row.nextExpression]));
  next.schema.fields = (next.schema?.fields || []).map((field) => {
    if (!byId.has(field.id)) return field;
    return {
      ...field,
      calculationRule: {
        ...(field.calculationRule && typeof field.calculationRule === 'object' ? field.calculationRule : {}),
        enabled: true,
        expression: byId.get(field.id),
        onError: field?.calculationRule?.onError === 'empty' ? 'empty' : 'keep_last'
      }
    };
  });
  return next;
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is missing.');
  const dbName = String(process.env.MONGODB_DB || process.env.MONGO_DB || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(dbName).collection('schoolOverallReportTemplates');
  try {
    const templates = await col.find({}).toArray();
    const affected = [];
    for (const template of templates) {
      const updates = collectClbFields(template);
      if (!updates.length) continue;
      affected.push({ id: template.id, title: template.title, updates });
    }
    if (!affected.length) {
      console.log('No overall templates with O.clbl/clbs/clbr/clbw fields found.');
      return;
    }
    const backupDir = path.join(ROOT_DIR, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `overall-clb-formulas-backup-${stamp}.json`);
    const backupPayload = templates.filter((row) => affected.some((item) => item.id === row.id));
    fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2));

    for (const entry of affected) {
      const template = templates.find((row) => row.id === entry.id);
      const nextTemplate = applyExpressionUpdates(template, entry.updates);
      overallReportTemplateModel.sanitizeTemplate(nextTemplate, { existing: template, isUpdate: true });
      console.log(`\n${entry.title} (${entry.id})`);
      entry.updates.forEach((row) => {
        console.log(`  ${row.docxAlias} slot=${row.slot}`);
        console.log(`    before: ${row.priorExpression.replace(/\s+/g, ' ').slice(0, 120)}...`);
        reportRuleEngineService.validateExpressionSyntax(row.nextExpression);
        reportRuleEngineService.validateExpressionSymbols(row.nextExpression, {
          additionalHelpers: ['source', 'sourceSlotPopulated'],
          allowedRoots: ['value', 'answers']
        });
      });
      if (!args.dryRun) {
        const now = new Date().toISOString();
        // eslint-disable-next-line no-await-in-loop
        await col.updateOne(
          { id: entry.id },
          {
            $set: {
              schema: nextTemplate.schema,
              placeholderMap: nextTemplate.placeholderMap || template.placeholderMap,
              'audit.lastUpdateDateTime': now
            }
          }
        );
        console.log('  updated.');
      } else {
        console.log('  dry-run (no write).');
      }
    }
    console.log(`\nBackup written: ${backupPath}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});