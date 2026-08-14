const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const overallReportTemplateModel = require('../../packages/school/MVC/models/school/overallReportTemplateModel');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

const LEGACY_BY_FIELD_ID = {
  report_date: ['afdr'],
  day01_yn: ['b6tq'],
  day01_note: ['iqoz']
};

async function main() {
  loadEnv();
  const templateId = String(process.argv[2] || '495502').trim();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured.');

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || 'app').collection('schoolOverallReportTemplates');
  const existing = await col.findOne({ id: templateId });
  if (!existing) throw new Error(`Overall report template "${templateId}" was not found.`);

  const fields = (existing.schema?.fields || []).map((field) => {
    const legacy = LEGACY_BY_FIELD_ID[field.id];
    if (!legacy?.length) return field;
    const merged = new Set([...(Array.isArray(field.legacyDocxAliases) ? field.legacyDocxAliases : []), ...legacy]);
    return { ...field, legacyDocxAliases: [...merged] };
  });

  const sanitized = overallReportTemplateModel.sanitizeTemplate({
    ...existing,
    schema: { ...(existing.schema || {}), fields }
  }, { existing, isUpdate: true });

  const result = await col.updateOne(
    { id: existing.id },
    {
      $set: {
        schema: sanitized.schema,
        placeholderMap: sanitized.placeholderMap,
        'audit.lastUpdateDateTime': new Date().toISOString()
      }
    }
  );

  const touched = sanitized.schema.fields
    .filter((field) => Array.isArray(field.legacyDocxAliases) && field.legacyDocxAliases.length)
    .map((field) => ({
      id: field.id,
      docxAlias: field.docxAlias,
      legacyDocxAliases: field.legacyDocxAliases
    }));

  console.log(JSON.stringify({
    templateId: existing.id,
    title: existing.title,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    legacyFields: touched
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
