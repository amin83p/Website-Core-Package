/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const NAV_PARENT_SECTION = {
  id: '883303',
  name: 'SYSTEM_SETTING'
};

const SECTION_ID = '731288';
const SECTION_NAME = 'SYSTEM_PACKAGE_EVOLUTION';
const SYMBOL_ID = 'SYM_SYSTEM_123';

const OP_BUNDLE = [
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true }
];

const SECTION_DOC = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SYSTEM',
  description: 'Import and manage package evolution records tied to git commits.',
  homeURL: '/systemSettings/package-evolution',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: true,
  minimumAccessRequirement: 5,
  navigatorSection: false,
  subsections: [],
  related: [],
  operations: OP_BUNDLE
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
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
    } else if ((token === '--db' || token === '-d') && next) {
      out.db = next;
      i += 1;
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  try {
    const normalized = uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://') ? uri : `mongodb://${uri}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
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

function mergeOperations(existingOps = []) {
  const byId = new Map();
  for (const op of Array.isArray(existingOps) ? existingOps : []) {
    const id = String(op?.id || '').trim();
    if (id) byId.set(id, { ...op, id });
  }
  for (const op of OP_BUNDLE) {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  }
  return Array.from(byId.values());
}

async function upsertSection(sections) {
  const existing =
    await sections.findOne({ id: SECTION_ID })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') } });
  const next = {
    ...SECTION_DOC,
    id: String(existing?.id || SECTION_DOC.id),
    active: existing?.active !== false,
    audit: buildAudit(existing?.audit),
    operations: mergeOperations(existing?.operations)
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

async function linkUnderNavigatorParent(sections, childSection) {
  const parent =
    await sections.findOne({ id: NAV_PARENT_SECTION.id })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(NAV_PARENT_SECTION.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: parent section missing. Add subsection { id: "${childSection.id}" } manually.`);
    return;
  }
  const childId = String(childSection?.id || '').trim();
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const normalized = refs.map((row) => ({ id: String(row?.id || row || '').trim() }))
    .filter((row) => row.id && row.id !== childId);
  normalized.push({ id: childId });
  await sections.updateOne({ _id: parent._id }, {
    $set: { subsections: normalized, 'audit.lastUpdateUser': ACTOR, 'audit.lastUpdateDateTime': NOW }
  });
  console.log(`Linked ${SECTION_NAME} under ${NAV_PARENT_SECTION.name}.`);
}

async function upsertSymbol(symbols, sectionId) {
  const symbolDoc = {
    id: SYMBOL_ID,
    name: SECTION_NAME,
    type: 'class',
    value: 'bi bi-graph-up-arrow',
    tags: [SECTION_NAME, 'PACKAGE_EVOLUTION', String(sectionId || SECTION_ID)],
    orgId: 'SYSTEM'
  };
  const existing = await symbols.findOne({ id: symbolDoc.id });
  const next = { ...symbolDoc, id: String(existing?.id || symbolDoc.id), audit: buildAudit(existing?.audit) };
  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${SECTION_NAME}.`);
    return;
  }
  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${SECTION_NAME}.`);
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const section = await upsertSection(db.collection('sections'));
    await linkUnderNavigatorParent(db.collection('sections'), section);
    await upsertSymbol(db.collection('symbols'), section.id);
    console.log('Package evolution section seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});