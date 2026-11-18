/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const {
  FUTURE_GOAL_LISTENING_FIELD_ID,
  applyFutureGoalListeningFieldPolicy
} = require('../packages/school/config/futureGoalListeningValidation');

const TARGET_TEMPLATE_ID = '130716';
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = text.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function patchTemplateDocument(doc) {
  if (!doc || typeof doc !== 'object') return { doc, changed: false };
  const schema = doc.schema && typeof doc.schema === 'object' ? doc.schema : {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  let changed = false;
  const nextFields = fields.map((field) => {
    if (String(field?.id || '').trim() !== FUTURE_GOAL_LISTENING_FIELD_ID) return field;
    const patched = applyFutureGoalListeningFieldPolicy(field);
    changed = true;
    return patched;
  });
  if (!changed) return { doc, changed: false };
  return {
    doc: {
      ...doc,
      schema: {
        ...schema,
        fields: nextFields
      }
    },
    changed: true
  };
}

async function main() {
  loadEnv();
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Set MONGODB_URI.');
  const dbName = String(process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const collection = client.db(dbName).collection('schoolReportTemplates');
    const row = await collection.findOne({
      $or: [{ id: TARGET_TEMPLATE_ID }, { id: Number(TARGET_TEMPLATE_ID) }]
    });
    if (!row) {
      console.log(`Template ${TARGET_TEMPLATE_ID} not found in reportTemplates; skipped Mongo patch.`);
      return;
    }
    const { doc, changed } = patchTemplateDocument(row);
    if (!changed) {
      console.log(`Template ${TARGET_TEMPLATE_ID} has no field ${FUTURE_GOAL_LISTENING_FIELD_ID}; skipped.`);
      return;
    }
    await collection.updateOne({ _id: row._id }, { $set: { schema: doc.schema } });
    console.log(`Patched ${FUTURE_GOAL_LISTENING_FIELD_ID} on report template ${TARGET_TEMPLATE_ID}.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});