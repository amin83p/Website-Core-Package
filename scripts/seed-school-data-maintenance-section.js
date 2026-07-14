/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();

const SECTION_ID = '445582';
const SECTION_NAME = 'SCHOOL_DATA_MAINTENANCE';
const SECTION_HOME_URL = '/school/data-maintenance';
const PARENT_SECTION = { id: '139382', name: 'SCHOOL_ACADEMIA' };
const SAMPLE_DATA_SECTION_ID = '445561';
const SYMBOL_ID = 'SYM_SYSTEM_200';

const OWNER_OPERATIONS = ['OP1001', 'OP1002', 'OP1003'].map((operationId) => ({
  operationId,
  scopeId: 'SCP_OWNER',
  maxAttemptsPerSession: null,
  maxSessionDurationMinutes: null,
  maxFetchUploadVolumeKB: null
}));

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
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
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function buildSectionDoc() {
  return {
    id: SECTION_ID,
    name: SECTION_NAME,
    category: 'SCHOOL',
    description: 'Browse school collections and selectively hard-delete records for test cleanup.',
    active: true,
    trackState: true,
    minimumAccessRequirement: 1,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL: SECTION_HOME_URL,
    inactiveMessage: '',
    message: '',
    operations: ['OP1001', 'OP1002', 'OP1003'].map((id) => ({
      id,
      sessionAttempts: 5,
      sessionTime: 15,
      active: true
    })),
    subsections: [],
    related: [],
    adoptExisting: true
  };
}

function buildSymbolDoc() {
  return {
    id: SYMBOL_ID,
    name: SECTION_NAME,
    type: 'class',
    value: 'bi bi-database-gear',
    tags: [SECTION_NAME, SECTION_ID],
    orgId: 'SYSTEM',
    adoptExisting: true
  };
}

async function upsertSection(sections) {
  const sectionDoc = buildSectionDoc();
  const existing =
    await sections.findOne({ id: SECTION_ID }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') } });
  const next = {
    ...sectionDoc,
    id: String(existing?.id || sectionDoc.id),
    active: existing?.active !== false,
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : [],
    related: Array.isArray(existing?.related) ? existing.related : [],
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await sections.insertOne(next);
    console.log(`Inserted section ${SECTION_NAME} (${next.id}).`);
    return next;
  }
  await sections.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${SECTION_NAME} (${next.id}).`);
  return { ...existing, ...next };
}

async function upsertSymbol(symbols) {
  const symbolDoc = buildSymbolDoc();
  const existing =
    await symbols.findOne({ id: SYMBOL_ID }) ||
    await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
  const next = {
    ...symbolDoc,
    id: SYMBOL_ID,
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${SECTION_NAME} (${next.id}).`);
    return next;
  }
  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${SECTION_NAME} (${next.id}).`);
  return { ...existing, ...next };
}

async function linkUnderParent(sections) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: ${PARENT_SECTION.name} was not found. Attach ${SECTION_ID} manually.`);
    return;
  }
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  if (refs.some((row) => String(row?.id || row || '').trim() === SECTION_ID)) {
    console.log(`${SECTION_NAME} is already linked under ${PARENT_SECTION.name}.`);
    return;
  }
  const next = [...refs];
  const sampleIdx = next.findIndex((row) => String(row?.id || row || '').trim() === SAMPLE_DATA_SECTION_ID);
  if (sampleIdx >= 0) next.splice(sampleIdx + 1, 0, { id: SECTION_ID });
  else next.push({ id: SECTION_ID });
  await sections.updateOne(
    { _id: parent._id },
    {
      $set: {
        subsections: next,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Linked ${SECTION_NAME} (${SECTION_ID}) under ${PARENT_SECTION.name}.`);
}

async function grantAccessFromSampleData(accesses) {
  const cursor = accesses.find({
    'sections.sectionId': SAMPLE_DATA_SECTION_ID
  });
  const profiles = await cursor.toArray();
  let updated = 0;
  for (const profile of profiles) {
    const profileName = String(profile?.name || '').trim();
    if (!profileName) continue;
    const sampleGrant = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === SAMPLE_DATA_SECTION_ID);
    const operations = Array.isArray(sampleGrant?.operations) && sampleGrant.operations.length
      ? sampleGrant.operations
      : OWNER_OPERATIONS;
    const adminAccess = sampleGrant?.adminAccess === true;

    const existing = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === SECTION_ID);
    if (existing) {
      await accesses.updateOne(
        { _id: profile._id, 'sections.sectionId': SECTION_ID },
        {
          $set: {
            'sections.$.adminAccess': adminAccess,
            'sections.$.operations': operations,
            updatedAt: new Date(),
            updatedBy: 'system'
          }
        }
      );
    } else {
      await accesses.updateOne(
        { _id: profile._id },
        {
          $push: {
            sections: {
              sectionId: SECTION_ID,
              adminAccess,
              operations
            }
          },
          $set: { updatedAt: new Date(), updatedBy: 'system' }
        }
      );
    }
    updated += 1;
    console.log(`Granted ${SECTION_ID} on access profile ${profileName}.`);
  }
  if (!updated) {
    console.warn(`WARNING: No access profiles with ${SAMPLE_DATA_SECTION_ID} found. Grant ${SECTION_ID} manually.`);
  }
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    await upsertSection(db.collection('sections'));
    await upsertSymbol(db.collection('symbols'));
    await linkUnderParent(db.collection('sections'));
    await grantAccessFromSampleData(db.collection('accesses'));
    console.log('School data maintenance section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School data maintenance section/symbol seed failed: ${error.message}`);
  process.exit(1);
});
