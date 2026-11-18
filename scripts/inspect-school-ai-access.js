/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
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

loadEnv();
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
function inferDbName(mongoUri) {
  try {
    return new URL(mongoUri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}
const dbName = String(process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const parent = await db.collection('sections').findOne({ id: '446200' });
  const lim = await db.collection('sections').findOne({ id: '446213' });
  const hits = await db.collection('accesses').find({
    $or: [
      { 'sectionGrants.sectionId': '446212' },
      { 'sectionGrants.sectionId': '446213' },
      { 'sections.sectionId': '446212' },
      { 'sections.sectionId': '446213' }
    ]
  }).project({ id: 1, name: 1 }).toArray();
  console.log(JSON.stringify({
    parentSubsections: (parent?.subsections || []).map((s) => s.id),
    usageLimitsSection: lim ? { id: lim.id, name: lim.name, dashboardDisplay: lim.dashboardDisplay, active: lim.active } : null,
    accessProfilesWithAiUsageOrLimits: hits
  }, null, 2));
  await client.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});