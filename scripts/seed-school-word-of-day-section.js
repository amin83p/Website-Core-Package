/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { seedSchoolWordOfDaySection } = require('../packages/school/scripts/maintenance/seedSchoolWordOfDaySection');

const ROOT_DIR = path.resolve(__dirname, '..');
const WORD_OF_DAY_SECTION = Object.freeze({ id: '445588', name: 'SCHOOL_WORD_OF_DAY' });
const TARGET_OPERATION_NAMES = Object.freeze([
  'READ',
  'READ_ALL',
  'CREATE',
  'UPDATE',
  'RESOLVE',
  'DELETE',
  'CONFIGURE'
]);

function loadLocalEnvFile() {
  try {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

function parseArgs(argv) {
  const out = { uri: '', db: '', dryRun: false, skipPackageSeed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (token === '--skip-package-seed') {
      out.skipPackageSeed = true;
      continue;
    }
    if ((token === '--uri' || token === '-u') && next) {
      out.uri = next;
      i += 1;
      continue;
    }
    if ((token === '--db' || token === '-d') && next) {
      out.db = next;
      i += 1;
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://')
      ? safe
      : `mongodb://${safe}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    if (dryRun) console.warn(`[dry-run] Operation ${name} not found in MongoDB catalog.`);
    else console.warn(`Operation ${name} not found in MongoDB catalog; skipping bind for this operation.`);
  }
  return resolved;
}

async function bindSectionOperations(sections, operationIds, dryRun) {
  const existing = await findSection(sections, WORD_OF_DAY_SECTION);
  if (!existing) {
    console.warn(`Section ${WORD_OF_DAY_SECTION.name} (${WORD_OF_DAY_SECTION.id}) not found; skipping operation bind.`);
    return null;
  }
  const wantedBindings = operationIds.map((id) => ({
    id: String(id),
    sessionAttempts: 10,
    sessionTime: 30,
    active: true
  }));
  const merged = mergeOperations(existing.operations, wantedBindings);
  if (dryRun) {
    console.log(`[dry-run] Would update ${existing.name} operations: ${(existing.operations || []).length} -> ${merged.length}`);
    return null;
  }
  await sections.updateOne(
    { _id: existing._id },
    {
      $set: {
        operations: merged,
        minimumAccessRequirement: Math.max(7, Number(existing.minimumAccessRequirement || 0))
      }
    }
  );
  console.log(`Bound ${merged.length} operations on ${existing.name} (${existing.id}).`);
  return merged.length;
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const resolved = await resolveOperationIds(db.collection('operations'), args.dryRun);
    await bindSectionOperations(db.collection('sections'), resolved.map((row) => row.id), args.dryRun);
    if (!args.skipPackageSeed && !args.dryRun) {
      const result = await seedSchoolWordOfDaySection(db);
      console.log(`Package seeder: section ${result.section.action}, staff profiles ${result.access.staff.updatedProfiles}.`);
    }
    if (args.dryRun) {
      resolved.forEach((row) => console.log(`  ${row.name}: ${row.id}`));
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Word of Day section seed failed: ${error.message}`);
  process.exit(1);
});