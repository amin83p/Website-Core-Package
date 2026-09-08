/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');

const STUDENT_CASES_SECTION = Object.freeze({
  id: '778771',
  name: 'SCHOOL_SESSION_STUDENT_CASES'
});

const TARGET_OPERATION_NAMES = Object.freeze([
  'READ',
  'READ_ALL',
  'CREATE',
  'UPDATE',
  'RESOLVE',
  'DELETE',
  'CONFIGURE'
]);

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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function audit(existing = {}) {
  const now = new Date().toISOString();
  return {
    createUser: existing.createUser || 'SYS_ROOT_001',
    createDateTime: existing.createDateTime || now,
    lastUpdateUser: 'SYS_ROOT_001',
    lastUpdateDateTime: now
  };
}

function mergeOperations(existing = [], wanted = []) {
  const rows = new Map((Array.isArray(existing) ? existing : []).map((row) => [String(row?.id || ''), row]));
  wanted.forEach((row) => {
    const id = String(row?.id || row || '').trim();
    if (!id) return;
    rows.set(id, {
      id,
      sessionAttempts: 10,
      sessionTime: 30,
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

async function resolveOperationIds(operations, dryRun) {
  const resolved = [];
  for (const name of TARGET_OPERATION_NAMES) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await operations.findOne({ name });
    if (existing?.id) {
      resolved.push({ id: String(existing.id), name, source: 'existing-by-name' });
      continue;
    }
    if (dryRun) {
      console.warn(`[dry-run] Operation ${name} not found in MongoDB catalog.`);
      continue;
    }
    console.warn(`Operation ${name} not found in MongoDB catalog; skipping bind for this operation.`);
  }
  return resolved;
}

async function bindSectionOperations(sections, operationIds, dryRun) {
  const existing = await findSection(sections, STUDENT_CASES_SECTION);
  if (!existing) {
    console.warn(`Section ${STUDENT_CASES_SECTION.name} (${STUDENT_CASES_SECTION.id}) not found; skipping section update.`);
    return null;
  }

  const wantedBindings = operationIds.map((id) => ({
    id: String(id),
    sessionAttempts: 10,
    sessionTime: 30,
    active: true
  }));
  const merged = mergeOperations(existing.operations, wantedBindings);
  const beforeIds = new Set((existing.operations || []).map((row) => String(row?.id || '')));
  const addedIds = operationIds.filter((id) => !beforeIds.has(String(id)));
  const summary = {
    sectionId: String(existing.id || ''),
    sectionName: String(existing.name || ''),
    beforeCount: Array.isArray(existing.operations) ? existing.operations.length : 0,
    afterCount: merged.length,
    addedIds
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
  const opRows = await operations.find({ name: { $in: [...TARGET_OPERATION_NAMES] } }).project({ id: 1, name: 1 }).toArray();
  const section = await findSection(sections, STUDENT_CASES_SECTION);
  const boundIds = new Set((section?.operations || []).map((row) => String(row?.id || '')));

  console.log('\nVerification:');
  TARGET_OPERATION_NAMES.forEach((name) => {
    const row = opRows.find((op) => op.name === name);
    const id = row ? String(row.id) : '';
    console.log(`  ${name.padEnd(10)} ${id || '(missing op)'.padEnd(12)} bound=${id ? boundIds.has(id) : false}`);
  });

  return { operations: opRows, section, boundIds };
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

  const resolved = await resolveOperationIds(operations, args.dryRun);
  const operationIds = resolved.map((row) => row.id);

  await bindSectionOperations(sections, operationIds, args.dryRun);

  if (args.dryRun) {
    console.log('\n[dry-run] Resolved operation ids:');
    resolved.forEach((row) => {
      console.log(`  ${row.name}: ${row.id} (${row.source})`);
    });
  } else {
    await verifyCatalog(db);
  }

  await client.close();
  console.log(args.dryRun ? 'School student cases catalog dry-run complete.' : 'School student cases catalog seed complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
