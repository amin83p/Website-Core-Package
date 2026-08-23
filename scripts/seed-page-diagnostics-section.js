/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const PARENT_SECTION = {
  id: '454697',
  name: 'SYSTEM_LOGGING'
};

const SECTION_ID = '862452';
const SECTION_NAME = 'PAGE_DIAGNOSTICS';
const SYMBOL_ID = 'SYM_SYSTEM_090';

const SECTION_DOC = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'LOGGING',
  description: 'Inspect page load, client console, fetch activity, and current-page active users.',
  homeURL: '',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: true,
  minimumAccessRequirement: 8,
  navigatorSection: false,
  subsections: [],
  related: [],
  operations: [
    { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true }
  ]
};

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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

function parseArgs(argv = []) {
  const out = { apply: false, uri: '', db: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--apply') {
      out.apply = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      out.help = true;
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

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function sameMongoId(a, b) {
  return String(a?._id || '') === String(b?._id || '');
}

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function buildSymbolDoc() {
  return {
    id: SYMBOL_ID,
    name: SECTION_NAME,
    type: 'class',
    value: 'bi bi-speedometer2',
    tags: [
      SECTION_NAME,
      SECTION_ID
    ],
    orgId: 'SYSTEM'
  };
}

async function findByName(collection, name) {
  return collection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

async function upsertSection(sections, { apply = false } = {}) {
  const existingById = await sections.findOne({ id: SECTION_ID });
  const existingByName = await findByName(sections, SECTION_NAME);

  if (
    existingById &&
    normalize(existingById.name) !== SECTION_NAME &&
    (!existingByName || !sameMongoId(existingById, existingByName))
  ) {
    throw new Error(`Section id ${SECTION_ID} is already used by ${existingById.name || 'another section'}.`);
  }

  if (existingById && existingByName && !sameMongoId(existingById, existingByName)) {
    throw new Error(`Duplicate PAGE_DIAGNOSTICS sections found (${existingById._id}, ${existingByName._id}). Resolve before seeding.`);
  }

  const existing = existingByName || existingById;
  const next = {
    ...SECTION_DOC,
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    if (apply) await sections.insertOne(next);
    return { action: apply ? 'inserted' : 'would_insert', id: next.id, name: next.name };
  }

  if (apply) await sections.updateOne({ _id: existing._id }, { $set: next });
  return { action: apply ? 'updated' : 'would_update', id: next.id, name: next.name };
}

async function linkUnderSystemLogging(sections, { apply = false } = {}) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id })
    || await findByName(sections, PARENT_SECTION.name);

  if (!parent) {
    return {
      action: 'warning',
      message: `${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${SECTION_ID}" }.`
    };
  }

  const current = Array.isArray(parent.subsections) ? parent.subsections : [];
  const normalized = [];
  const seen = new Set();
  for (const row of current) {
    const id = String(row?.id || row || '').trim();
    if (!id || id === SECTION_ID || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id });
  }
  normalized.push({ id: SECTION_ID });

  if (apply) {
    await sections.updateOne(
      { _id: parent._id },
      {
        $set: {
          subsections: normalized,
          'audit.lastUpdateUser': ACTOR,
          'audit.lastUpdateDateTime': NOW
        }
      }
    );
  }

  return {
    action: apply ? 'linked' : 'would_link',
    parentId: String(parent.id || ''),
    childId: SECTION_ID,
    subsections: normalized
  };
}

async function upsertSymbol(symbols, { apply = false } = {}) {
  const symbolDoc = buildSymbolDoc();
  const existingById = await symbols.findOne({ id: SYMBOL_ID });
  const existingByName = await symbols.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') },
    $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
  });

  if (
    existingById &&
    normalize(existingById.name) !== SECTION_NAME &&
    (!existingByName || !sameMongoId(existingById, existingByName))
  ) {
    throw new Error(`Symbol id ${SYMBOL_ID} is already used by ${existingById.name || 'another symbol'}.`);
  }

  if (existingById && existingByName && !sameMongoId(existingById, existingByName)) {
    throw new Error(`Duplicate PAGE_DIAGNOSTICS symbols found (${existingById._id}, ${existingByName._id}). Resolve before seeding.`);
  }

  const existing = existingByName || existingById;
  const next = {
    ...symbolDoc,
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    if (apply) await symbols.insertOne(next);
    return { action: apply ? 'inserted' : 'would_insert', id: next.id, name: next.name };
  }

  if (apply) await symbols.updateOne({ _id: existing._id }, { $set: next });
  return { action: apply ? 'updated' : 'would_update', id: next.id, name: next.name };
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/seed-page-diagnostics-section.js [--apply] [--uri <mongo-uri>] [--db <db-name>]');
    console.log('Default mode is dry-run. Use --apply to write changes.');
    return;
  }

  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');
    const symbols = db.collection('symbols');
    const report = {
      mode: args.apply ? 'apply' : 'dry-run',
      section: await upsertSection(sections, { apply: args.apply }),
      parent: await linkUnderSystemLogging(sections, { apply: args.apply }),
      symbol: await upsertSymbol(symbols, { apply: args.apply })
    };
    console.log(JSON.stringify(report, null, 2));
    if (!args.apply) console.log('Dry-run only. Re-run with --apply to write changes.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Page diagnostics section seed failed: ${error.message}`);
  process.exit(1);
});
