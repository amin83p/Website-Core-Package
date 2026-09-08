/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TARGET_OPS = ['READ', 'READ_ALL', 'CREATE', 'UPDATE', 'RESOLVE', 'DELETE', 'CONFIGURE'];
const SECTION_ID = '778771';
const SECTION_NAME = 'SCHOOL_SESSION_STUDENT_CASES';

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
    { $or: [{ id: SECTION_ID }, { name: SECTION_NAME }] },
    { projection: { id: 1, name: 1, operations: 1 } }
  );
  const boundIds = new Set((section?.operations || []).map((row) => String(row?.id || '')));

  console.log(`Section ${section?.name} (${section?.id}) — ${boundIds.size} operations bound`);
  TARGET_OPS.forEach((name) => {
    const row = ops.find((op) => op.name === name);
    const id = row ? String(row.id) : '';
    console.log(`  ${name.padEnd(10)} ${id || '(missing op)'.padEnd(12)} bound=${id ? boundIds.has(id) : false}`);
  });

  const accesses = await db.collection('accesses').find({}).project({ id: 1, name: 1, sections: 1, sectionGrants: 1 }).toArray();
  const profileHits = [];

  const collectGrantRows = (access, sectionRows = []) => {
    sectionRows.forEach((sectionRow) => {
      const sectionId = String(sectionRow?.sectionId || sectionRow?.section?.id || '').trim();
      if (sectionId !== SECTION_NAME && sectionId !== String(section?.id || '')) return;
      const rows = Array.isArray(sectionRow.operations) ? sectionRow.operations : [];
      rows.forEach((row) => {
        const operationId = String(row?.operationId || row?.operation?.id || row?.id || '').trim();
        const opName = opIdToName.get(operationId) || '';
        if (!TARGET_OPS.includes(opName)) return;
        profileHits.push({
          profile: String(access.name || access.id || ''),
          operation: opName,
          scope: String(row?.scopeId || row?.scope || '')
        });
      });
    });
  };

  accesses.forEach((access) => {
    collectGrantRows(access, Array.isArray(access.sections) ? access.sections : []);
    collectGrantRows(access, Array.isArray(access.sectionGrants) ? access.sectionGrants : []);
  });

  console.log(`\nAccess profile grants for ${SECTION_NAME}: ${profileHits.length} row(s)`);
  profileHits.slice(0, 50).forEach((hit) => {
    console.log(`  ${hit.profile} — ${hit.operation} @ ${hit.scope || '(no scope)'}`);
  });
  if (profileHits.length > 50) {
    console.log(`  ... ${profileHits.length - 50} more`);
  }
  if (!profileHits.length) {
    console.log(`  WARNING: No access profile rows found for ${SECTION_NAME}.`);
    console.log('  Update access profiles in Mongo or Access Simulator before non-admin users can use student cases.');
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
