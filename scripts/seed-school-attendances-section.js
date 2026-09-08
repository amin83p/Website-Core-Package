/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const ATTENDANCES_SECTION = Object.freeze({
  id: '778768',
  name: 'SCHOOL_ATTENDANCES'
});

const SESSIONS_SECTION = Object.freeze({
  name: 'SCHOOL_SESSIONS'
});

const ATTENDANCE_OPERATION_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1006', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1010', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }
];

const OPERATION_DEFINITIONS = Object.freeze([
  {
    name: 'UPLOAD',
    fallbackId: 'OP1027',
    doc: {
      active: true,
      trackState: true,
      keepActive: false,
      system: false
    }
  },
  {
    name: 'PRINT',
    fallbackId: 'OP1028',
    doc: {
      active: true,
      trackState: true,
      keepActive: false,
      system: false
    }
  }
]);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function parseArgs(argv) {
  const result = { uri: '', db: '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();
    if (token === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (['--uri', '-u'].includes(token) && next) {
      result.uri = next;
      index += 1;
      continue;
    }
    if (['--db', '-d'].includes(token) && next) {
      result.db = next;
      index += 1;
    }
  }
  return result;
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function audit(existing = {}) {
  return {
    createUser: existing.createUser || ACTOR,
    createDateTime: existing.createDateTime || NOW,
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function mergeOperations(existing = [], wanted = []) {
  const rows = new Map((Array.isArray(existing) ? existing : []).map((row) => [String(row?.id || ''), row]));
  wanted.forEach((row) => {
    const id = String(row?.id || row || '').trim();
    if (!id) return;
    rows.set(id, {
      id,
      sessionAttempts: 5,
      sessionTime: 15,
      active: true,
      ...(rows.get(id) || {}),
      ...(typeof row === 'object' ? row : {})
    });
  });
  return [...rows.values()].filter((row) => row.id);
}

async function findSection(sections, { id, name }) {
  if (id) {
    const byId = await sections.findOne({ id: String(id) });
    if (byId) return byId;
  }
  if (name) {
    return sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } });
  }
  return null;
}

async function resolveOperationId(operations, definition, dryRun) {
  const name = String(definition.name || '').trim();
  const fallbackId = String(definition.fallbackId || '').trim();
  const existing = await operations.findOne({ name });
  if (existing?.id) {
    return {
      id: String(existing.id),
      name,
      created: false,
      source: 'existing-by-name'
    };
  }

  const payload = {
    id: fallbackId,
    name,
    ...definition.doc,
    audit: audit()
  };

  if (dryRun) {
    console.log(`[dry-run] Would upsert operation ${name} (${fallbackId})`);
    return {
      id: fallbackId,
      name,
      created: true,
      source: 'dry-run-create'
    };
  }

  await operations.updateOne({ name }, { $set: payload }, { upsert: true });
  console.log(`Upserted operation ${name} (${fallbackId})`);
  return {
    id: fallbackId,
    name,
    created: true,
    source: 'created-fallback-id'
  };
}

async function bindSectionOperations(sections, sectionLookup, operationIds, dryRun) {
  const existing = await findSection(sections, sectionLookup);
  if (!existing) {
    const label = sectionLookup.id || sectionLookup.name || 'unknown';
    console.warn(`Section ${label} not found in MongoDB; skipping section update.`);
    return null;
  }

  const wantedBindings = operationIds.map((id) => ({
    id: String(id),
    sessionAttempts: 5,
    sessionTime: 15,
    active: true
  }));
  const merged = mergeOperations(existing.operations, wantedBindings);
  const summary = {
    sectionId: String(existing.id || ''),
    sectionName: String(existing.name || ''),
    beforeCount: Array.isArray(existing.operations) ? existing.operations.length : 0,
    afterCount: merged.length,
    addedIds: operationIds.filter((id) => !(existing.operations || []).some((row) => String(row?.id || '') === String(id)))
  };

  if (dryRun) {
    console.log(`[dry-run] Would update ${summary.sectionName} (${summary.sectionId}) operations: ${summary.beforeCount} -> ${summary.afterCount}`);
    if (summary.addedIds.length) {
      console.log(`[dry-run]   add bindings: ${summary.addedIds.join(', ')}`);
    }
    return summary;
  }

  await sections.updateOne(
    { _id: existing._id },
    {
      $set: {
        operations: merged,
        audit: audit(existing.audit)
      }
    }
  );
  console.log(`Updated ${summary.sectionName} (${summary.sectionId}) operations (${summary.afterCount} bound)`);
  if (summary.addedIds.length) {
    console.log(`  added bindings: ${summary.addedIds.join(', ')}`);
  }
  return summary;
}

async function verifyCatalog(db) {
  const operations = db.collection('operations');
  const sections = db.collection('sections');
  const opRows = await operations.find({ name: { $in: ['UPLOAD', 'PRINT'] } }).project({ id: 1, name: 1 }).toArray();
  const attendances = await findSection(sections, ATTENDANCES_SECTION);
  const attendancesIds = new Set((attendances?.operations || []).map((row) => String(row?.id || '')));

  console.log('\nVerification:');
  opRows.forEach((row) => {
    console.log(`  operation ${row.name}: ${row.id}`);
  });

  const uploadId = opRows.find((row) => row.name === 'UPLOAD')?.id || '';
  const printId = opRows.find((row) => row.name === 'PRINT')?.id || '';

  console.log(`  SCHOOL_ATTENDANCES has UPLOAD: ${uploadId ? attendancesIds.has(String(uploadId)) : false}`);
  console.log(`  SCHOOL_ATTENDANCES has PRINT: ${printId ? attendancesIds.has(String(printId)) : false}`);

  return {
    operations: opRows,
    attendancesBound: {
      upload: uploadId ? attendancesIds.has(String(uploadId)) : false,
      print: printId ? attendancesIds.has(String(printId)) : false
    }
  };
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '';
  if (!uri) {
    console.error('MongoDB URI is required. Set MONGODB_URI in .env or pass --uri.');
    process.exitCode = 1;
    return;
  }

  const dbName = args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri);
  if (!dbName) {
    console.error('MongoDB database name could not be resolved. Set MONGODB_DB or pass --db.');
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log('[dry-run] No writes will be performed.');
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const operations = db.collection('operations');
  const sections = db.collection('sections');

  const resolved = [];
  for (const definition of OPERATION_DEFINITIONS) {
    // eslint-disable-next-line no-await-in-loop
    const row = await resolveOperationId(operations, definition, args.dryRun);
    resolved.push(row);
  }

  const uploadId = resolved.find((row) => row.name === 'UPLOAD')?.id;
  const printId = resolved.find((row) => row.name === 'PRINT')?.id;
  const attendanceBindings = mergeOperations(
    ATTENDANCE_OPERATION_BUNDLE,
    [
      { id: uploadId, sessionAttempts: 5, sessionTime: 15, active: true },
      { id: printId, sessionAttempts: 5, sessionTime: 15, active: true }
    ].filter((row) => row.id)
  ).map((row) => row.id);

  await bindSectionOperations(
    sections,
    ATTENDANCES_SECTION,
    attendanceBindings,
    args.dryRun
  );

  if (!args.dryRun) {
    await verifyCatalog(db);
  } else {
    console.log('\n[dry-run] Resolved operation ids:');
    resolved.forEach((row) => {
      console.log(`  ${row.name}: ${row.id} (${row.source})`);
    });
  }

  await client.close();
  console.log(args.dryRun ? 'School attendances catalog dry-run complete.' : 'School attendances catalog seed complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
