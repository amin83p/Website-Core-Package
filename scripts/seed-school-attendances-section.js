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

function loadAttendanceOperationBundleFromManifest() {
  const manifestPath = path.join(ROOT_DIR, 'packages', 'school', 'package.manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const section = (Array.isArray(manifest.sections) ? manifest.sections : [])
    .find((row) => String(row?.id || '') === ATTENDANCES_SECTION.id);
  if (!section || !Array.isArray(section.operations) || !section.operations.length) {
    throw new Error(`SCHOOL_ATTENDANCES (${ATTENDANCES_SECTION.id}) operations not found in package.manifest.json`);
  }
  return section.operations.map((row) => ({
    id: String(row.id || '').trim(),
    sessionAttempts: Number(row.sessionAttempts),
    sessionTime: Number(row.sessionTime),
    active: row.active !== false
  })).filter((row) => row.id);
}

const ATTENDANCE_OPERATION_BUNDLE = loadAttendanceOperationBundleFromManifest();

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

function resolveManifestTemplateOperation() {
  return ATTENDANCE_OPERATION_BUNDLE.find((row) => row.id === 'OP1005')
    || ATTENDANCE_OPERATION_BUNDLE.find((row) => row.id === 'OP1002')
    || ATTENDANCE_OPERATION_BUNDLE[0]
    || null;
}

function resolveOperationDefaults(operationId) {
  const id = String(operationId || '').trim();
  const fromManifest = ATTENDANCE_OPERATION_BUNDLE.find((row) => String(row.id) === id);
  if (fromManifest) return { ...fromManifest };
  const template = resolveManifestTemplateOperation();
  if (!template) {
    throw new Error(`No manifest limits available for operation ${id}`);
  }
  return {
    id,
    sessionAttempts: template.sessionAttempts,
    sessionTime: template.sessionTime,
    active: true
  };
}

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
  (Array.isArray(wanted) ? wanted : []).forEach((row) => {
    const id = String(row?.id || row || '').trim();
    if (!id) return;
    const defaults = resolveOperationDefaults(id);
    rows.set(id, {
      ...(rows.get(id) || {}),
      ...defaults,
      ...(typeof row === 'object' ? row : {}),
      id,
      sessionAttempts: defaults.sessionAttempts,
      sessionTime: defaults.sessionTime,
      active: defaults.active
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

  const wantedBindings = operationIds.map((id) => resolveOperationDefaults(id));
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
  const readOp = (attendances?.operations || []).find((row) => String(row?.id || '') === 'OP1002');

  console.log(`  SCHOOL_ATTENDANCES has UPLOAD: ${uploadId ? attendancesIds.has(String(uploadId)) : false}`);
  console.log(`  SCHOOL_ATTENDANCES has PRINT: ${printId ? attendancesIds.has(String(printId)) : false}`);
  console.log(`  SCHOOL_ATTENDANCES OP1002 sessionAttempts: ${readOp?.sessionAttempts ?? 'missing'}`);

  return {
    operations: opRows,
    attendancesBound: {
      upload: uploadId ? attendancesIds.has(String(uploadId)) : false,
      print: printId ? attendancesIds.has(String(printId)) : false
    },
    readSessionAttempts: readOp?.sessionAttempts ?? null
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
      uploadId ? resolveOperationDefaults(uploadId) : null,
      printId ? resolveOperationDefaults(printId) : null
    ].filter(Boolean)
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
    console.log(`[dry-run] Manifest OP1002 sessionAttempts: ${resolveOperationDefaults('OP1002').sessionAttempts}`);
  }

  await client.close();
  console.log(args.dryRun ? 'School attendances catalog dry-run complete.' : 'School attendances catalog seed complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
