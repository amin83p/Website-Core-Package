/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ROOT_DIR = path.join(__dirname, '../../..');

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

const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = require('../../../MVC/repositories/backend/mongoRepositoryUtils');

(async () => {
  loadEnv();
  const cfg = resolveDataBackendConfig(process.env);
  await connectMongo({ uri: cfg.mongo.uri });
  const col = getMongoCollection('schoolActivities');
  const rows = await col.find({ title: { $regex: /statutory holiday/i } }).limit(10).toArray();
  for (const row of rows) {
    const doc = normalizeMongoDocument(row);
    let assigneeCount = 0;
    (doc.entries || []).forEach((e) => { assigneeCount += (e.assignees || []).length; });
    console.log(JSON.stringify({
      id: doc.id,
      orgId: doc.orgId,
      title: doc.title,
      entryCount: (doc.entries || []).length,
      assigneeCount
    }));
    (doc.entries || []).forEach((e) => {
      (e.assignees || []).forEach((a) => {
        console.log(`  ${e.date} | ${a.personName || ''} | ${a.personId || ''} | ${a.paidHours || 0}h`);
      });
    });
  }
  await disconnectMongo();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
