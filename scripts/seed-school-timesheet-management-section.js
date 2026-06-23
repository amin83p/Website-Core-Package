/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();

const SECTION_ID = '445579';
const SECTION_NAME = 'SCHOOL_TIMESHEET_MANAGEMENT';
const SECTION_HOME_URL = '/school/timesheets/manage';
const SYMBOL_ID = 'SYM_SYSTEM_061';
const PARENT_SECTION = { id: '225382', name: 'SCHOOL_ACCOUNTING' };
const INSERT_AFTER_SECTION_ID = '445568';

const SECTION_OPERATIONS = Object.freeze([
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true }
]);

const SECTION_DOC = Object.freeze({
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Manage period-level timesheet rosters and review department hour summaries for teacher and staff timesheets.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 1,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: SECTION_HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: SECTION_OPERATIONS,
  subsections: [],
  related: [],
  adoptExisting: true
});

const SYMBOL_DOC = Object.freeze({
  id: SYMBOL_ID,
  name: SECTION_NAME,
  type: 'class',
  value: 'bi bi-table',
  tags: [SECTION_NAME, SECTION_ID],
  orgId: 'SYSTEM',
  adoptExisting: true
});

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

function mergeOperations(existingOps = []) {
  const byId = new Map();
  (Array.isArray(existingOps) ? existingOps : []).forEach((op) => {
    const id = String(op?.id || '').trim();
    if (id) byId.set(id, { ...op, id });
  });
  SECTION_OPERATIONS.forEach((op) => {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  });
  return [...byId.values()];
}

async function upsertSection(sections) {
  const existing =
    await sections.findOne({ id: SECTION_ID }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') } });
  const next = {
    ...SECTION_DOC,
    id: String(existing?.id || SECTION_DOC.id),
    active: existing?.active !== false,
    operations: mergeOperations(existing?.operations),
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

async function upsertSymbol(symbols, sectionId) {
  const symbolDoc = {
    ...SYMBOL_DOC,
    tags: [SECTION_NAME, String(sectionId || SECTION_ID)]
  };
  const existing =
    await symbols.findOne({ id: SYMBOL_ID }) ||
    await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
  const next = {
    ...symbolDoc,
    id: String(existing?.id || symbolDoc.id),
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

async function linkUnderSchoolAccounting(sections, childSection) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: ${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${childSection.id}" }`);
    return;
  }

  const childId = String(childSection?.id || '').trim();
  const normalized = [];
  let inserted = false;
  (Array.isArray(parent.subsections) ? parent.subsections : []).forEach((row) => {
    const id = String(row?.id || row || '').trim();
    if (!id || id === childId) return;
    normalized.push({ id });
    if (!inserted && id === INSERT_AFTER_SECTION_ID) {
      normalized.push({ id: childId });
      inserted = true;
    }
  });
  if (!inserted) normalized.push({ id: childId });

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
  console.log(`Linked ${SECTION_NAME} (${childId}) under ${PARENT_SECTION.name}.`);
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const section = await upsertSection(db.collection('sections'));
    await linkUnderSchoolAccounting(db.collection('sections'), section);
    await upsertSymbol(db.collection('symbols'), section.id);
    console.log('School Timesheet Management section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School Timesheet Management section/symbol seed failed: ${error.message}`);
  process.exit(1);
});
