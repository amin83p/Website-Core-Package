/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TARGET_OPS = ['READ', 'READ_ALL', 'UPDATE', 'UPLOAD', 'EXPORT', 'PRINT'];

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

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exitCode = 1;
    return;
  }
  const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || new URL(uri).pathname.replace(/^\//, '').split('/')[0];
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const ops = await db.collection('operations')
    .find({ name: { $in: TARGET_OPS } })
    .project({ id: 1, name: 1 })
    .toArray();
  const opIdToName = new Map(ops.map((row) => [String(row.id), row.name]));

  const section = await db.collection('sections').findOne(
    { name: 'SCHOOL_ATTENDANCES' },
    { projection: { id: 1, name: 1, operations: 1 } }
  );
  const boundIds = new Set((section?.operations || []).map((row) => String(row?.id || '')));

  console.log(`Section ${section?.name} (${section?.id}) — ${boundIds.size} operations bound`);
  TARGET_OPS.forEach((name) => {
    const row = ops.find((op) => op.name === name);
    const id = row ? String(row.id) : '';
    console.log(`  ${name.padEnd(9)} ${id || '(missing op)'.padEnd(12)} bound=${id ? boundIds.has(id) : false}`);
  });

  const accesses = await db.collection('accesses').find({}).project({ id: 1, name: 1, sections: 1 }).toArray();
  const profileHits = [];
  accesses.forEach((access) => {
    const sections = Array.isArray(access.sections) ? access.sections : [];
    sections.forEach((sectionRow) => {
      const sectionId = String(sectionRow?.sectionId || sectionRow?.section?.id || '').trim();
      if (sectionId !== 'SCHOOL_ATTENDANCES' && sectionId !== String(section?.id || '')) return;
      const rows = Array.isArray(sectionRow.operations) ? sectionRow.operations : [];
      rows.forEach((row) => {
        const operationId = String(row?.operationId || row?.operation?.id || row?.id || '').trim();
        const opName = opIdToName.get(operationId) || '';
        if (!['UPLOAD', 'EXPORT', 'PRINT'].includes(opName)) return;
        profileHits.push({
          profile: String(access.name || access.id || ''),
          operation: opName,
          scope: String(row?.scopeId || row?.scope || '')
        });
      });
    });
  });

  console.log(`\nAccess profile grants for SCHOOL_ATTENDANCES UPLOAD/EXPORT/PRINT: ${profileHits.length} row(s)`);
  profileHits.slice(0, 40).forEach((hit) => {
    console.log(`  ${hit.profile} — ${hit.operation} @ ${hit.scope || '(no scope)'}`);
  });
  if (profileHits.length > 40) {
    console.log(`  ... ${profileHits.length - 40} more`);
  }
  if (!profileHits.length) {
    console.log('  WARNING: No access profile rows found for UPLOAD/EXPORT/PRINT on SCHOOL_ATTENDANCES.');
    console.log('  Update access profiles in Mongo or Access Simulator before non-admin users can upload/export/print.');
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
