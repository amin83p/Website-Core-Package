/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const SECTION_ID = '445572';
const LEGACY_SECTION_NAME = 'SCHOOL_CLASS_ENROLLMENT_PERIODS';
const SECTION_NAME = 'SCHOOL_ROLLING_ENROLLMENT';
const SECTION_HOME_URL = '/school/rolling-enrollment';
const PARENT_SECTION_ID = '139382';
const PARENT_SECTION_NAME = 'SCHOOL_ACADEMIA';
const SYMBOL_ID = 'SYM_SYSTEM_064';
const RELATED_CLASS_SECTION_ID = '442039';
const ROOT_DIR = path.resolve(__dirname, '../..');

const sectionRow = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Rolling Enrollment lifecycle for rolling classes.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: SECTION_HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: [
    'OP1001',
    'OP1002',
    'OP1003',
    'OP1004',
    'OP1005',
    'OP1006',
    'OP1010',
    'OP1012',
    'OP1013',
    'OP1021',
    'OP1022',
    'OP1023'
  ].map((id) => ({
    id,
    sessionAttempts: 10,
    sessionTime: 30,
    active: true
  })),
  subsections: [],
  related: [{ id: RELATED_CLASS_SECTION_ID }],
  packageId: 'school',
  packageName: 'SCHOOL',
  package: {
    packageId: 'school',
    packageName: 'SCHOOL'
  }
};

const symbolRow = {
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-person-check',
  tags: [SECTION_NAME, LEGACY_SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM'
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
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = { uri: '', db: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
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
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

async function upsertSection(sectionsCollection) {
  const legacyNameRegex = new RegExp(`^${escapeRegex(LEGACY_SECTION_NAME)}$`, 'i');
  const nextNameRegex = new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i');
  const result = await sectionsCollection.updateOne(
    { $or: [{ id: SECTION_ID }, { name: legacyNameRegex }, { name: nextNameRegex }] },
    {
      $set: {
        ...sectionRow,
        updatedAt: new Date(),
        updatedBy: 'system'
      },
      $setOnInsert: {
        createdAt: new Date(),
        createdBy: 'system'
      }
    },
    { upsert: true }
  );
  console.log(`Upserted section ${SECTION_ID} ${SECTION_NAME} (matched=${result.matchedCount}, modified=${result.modifiedCount}, upserted=${result.upsertedCount})`);
}

async function upsertSymbol(symbolsCollection) {
  const nameRegex = new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i');
  const result = await symbolsCollection.updateOne(
    { $or: [{ id: SYMBOL_ID }, { name: nameRegex }] },
    {
      $set: {
        ...symbolRow,
        updatedAt: new Date(),
        updatedBy: 'system'
      },
      $setOnInsert: {
        createdAt: new Date(),
        createdBy: 'system'
      }
    },
    { upsert: true }
  );
  console.log(`Upserted SYSTEM symbol ${SYMBOL_ID} (matched=${result.matchedCount}, modified=${result.modifiedCount}, upserted=${result.upsertedCount})`);
}

async function ensureParentSubsection(sectionsCollection) {
  const parent = await sectionsCollection.findOne({
    $or: [
      { id: PARENT_SECTION_ID },
      { name: new RegExp(`^${escapeRegex(PARENT_SECTION_NAME)}$`, 'i') }
    ]
  });
  if (!parent) {
    console.warn(`Parent section ${PARENT_SECTION_NAME} was not found; rolling enrollment section was not attached.`);
    return;
  }

  const subsections = Array.isArray(parent.subsections) ? parent.subsections : [];
  if (subsections.some((row) => String(row && row.id) === SECTION_ID)) {
    console.log(`Parent ${parent.id || parent.name} already contains ${SECTION_ID}`);
    return;
  }

  const next = [];
  let inserted = false;
  subsections.forEach((row) => {
    next.push(row);
    if (!inserted && String(row && row.id) === RELATED_CLASS_SECTION_ID) {
      next.push({ id: SECTION_ID });
      inserted = true;
    }
  });
  if (!inserted) next.push({ id: SECTION_ID });

  await sectionsCollection.updateOne(
    { _id: parent._id },
    { $set: { subsections: next, updatedAt: new Date(), updatedBy: 'system' } }
  );
  console.log(`Attached ${SECTION_ID} under ${parent.id || parent.name}`);
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    await upsertSection(db.collection('sections'));
    await upsertSymbol(db.collection('symbols'));
    await ensureParentSubsection(db.collection('sections'));
    console.log('Rolling enrollment section migration complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Rolling enrollment section migration failed: ${error.message}`);
  process.exit(1);
});
