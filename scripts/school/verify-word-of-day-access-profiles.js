/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '../..');
const TARGET_OPS = ['READ', 'READ_ALL', 'CREATE', 'UPDATE', 'RESOLVE', 'DELETE', 'CONFIGURE'];
const SECTION_ID = '445588';
const SECTION_NAME = 'SCHOOL_WORD_OF_DAY';

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
    { projection: { id: 1, name: 1, operations: 1, minimumAccessRequirement: 1 } }
  );
  const boundIds = new Set((section?.operations || []).map((row) => String(row?.id || '')));

  console.log(`Section ${section?.name} (${section?.id}) — ${boundIds.size} operations bound (minAccess=${section?.minimumAccessRequirement})`);
  TARGET_OPS.forEach((name) => {
    const row = ops.find((op) => op.name === name);
    const id = row ? String(row.id) : '';
    console.log(`  ${name.padEnd(10)} ${id || '(missing op)'.padEnd(12)} bound=${id ? boundIds.has(id) : false}`);
  });

  const accesses = await db.collection('accesses').find({}).project({ id: 1, name: 1, sections: 1 }).toArray();
  const profileHits = [];

  accesses.forEach((access) => {
    (access.sections || []).forEach((sectionRow) => {
      const sid = String(sectionRow?.sectionId || '').trim();
      if (sid !== SECTION_NAME && sid !== String(section?.id || '')) return;
      (sectionRow.operations || []).forEach((row) => {
        const operationId = String(row?.operationId || '').trim();
        const opName = opIdToName.get(operationId) || '';
        if (!TARGET_OPS.includes(opName)) return;
        profileHits.push({
          profile: String(access.name || access.id || ''),
          operation: opName,
          scope: String(row?.scopeId || '')
        });
      });
    });
  });

  if (!profileHits.length) {
    console.log('\nNo access profile rows found for this section.');
  } else {
    console.log(`\nSample profile grants (${profileHits.length} rows):`);
    profileHits.slice(0, 40).forEach((row) => {
      console.log(`  ${row.profile.padEnd(24)} ${row.operation.padEnd(10)} ${row.scope}`);
    });
    if (profileHits.length > 40) console.log(`  ... and ${profileHits.length - 40} more`);
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});