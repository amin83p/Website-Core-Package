/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const SECTION_ID = '445583';
const SECTION_NAME = 'SCHOOL_REPORT_HUB';
const LEGACY_SECTION_NAME = 'SCHOOL_REPORT_HUB';
const SECTION_HOME_URL = '/school/report-hub';
const SYMBOL_ID = 'SYM_SYSTEM_128';
const PARENT_SECTION = { id: '122740', name: 'SCHOOL' };
const LEGACY_PARENT_SECTION = { id: '332224', name: 'SCHOOL_PEOPLE' };

const OP_BUNDLE = Object.freeze([
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true }
]);

const SECTION_DOC = Object.freeze({
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SCHOOL',
  description: 'Full-width Report Hub for reviewing reports from one workspace.',
  active: true,
  trackState: true,
  minimumAccessRequirement: 5,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  navigatorSection: false,
  homeURL: SECTION_HOME_URL,
  inactiveMessage: '',
  message: '',
  operations: OP_BUNDLE,
  subsections: [],
  related: [],
  adoptExisting: true
});

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
        || (value.startsWith('\'') && value.endsWith('\''))
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

function hubNamePattern() {
  return new RegExp(`^(${escapeRegex(SECTION_NAME)}|${escapeRegex(LEGACY_SECTION_NAME)})$`, 'i');
}

async function dedupeHubSections(sections) {
  const matches = await sections.find({ name: { $regex: hubNamePattern() } }).toArray();
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  const keeper = matches.find((row) => String(row?.id || '').trim() === SECTION_ID)
    || matches.find((row) => String(row?.name || '').trim().toUpperCase() === SECTION_NAME)
    || matches[0];
  const duplicateIds = matches
    .filter((row) => String(row?._id || '') !== String(keeper?._id || ''))
    .map((row) => row._id);

  if (duplicateIds.length) {
    await sections.deleteMany({ _id: { $in: duplicateIds } });
    console.log(`Removed ${duplicateIds.length} duplicate ${SECTION_NAME} section document(s).`);
  }
  return keeper;
}

async function upsertSection(sections) {
  await dedupeHubSections(sections);
  const existing =
    await sections.findOne({ id: SECTION_ID })
    || await sections.findOne({ name: { $regex: hubNamePattern() } });
  const next = {
    ...SECTION_DOC,
    id: String(existing?.id || SECTION_DOC.id),
    active: existing?.active !== false,
    audit: buildAudit(existing?.audit),
    operations: mergeOperations(existing?.operations),
    related: Array.isArray(existing?.related) ? existing.related : SECTION_DOC.related,
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : SECTION_DOC.subsections
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

async function removeFromLegacyParent(sections, childSection) {
  const legacyParent =
    await sections.findOne({ id: LEGACY_PARENT_SECTION.id })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(LEGACY_PARENT_SECTION.name)}$`, 'i') } });
  if (!legacyParent) return;
  const childId = String(childSection?.id || '').trim();
  const refs = Array.isArray(legacyParent.subsections) ? legacyParent.subsections : [];
  const normalized = refs
    .map((row) => ({ id: String(row?.id || row || '').trim() }))
    .filter((row) => row.id && row.id !== childId);
  if (normalized.length === refs.length) return;
  await sections.updateOne(
    { _id: legacyParent._id },
    {
      $set: {
        subsections: normalized,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Removed ${SECTION_NAME} (${childId}) from ${LEGACY_PARENT_SECTION.name}.`);
}

async function linkUnderParent(sections, childSection) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: ${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${childSection.id}" }`);
    return;
  }
  const childId = String(childSection?.id || '').trim();
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const alreadyLinked = refs.some((row) => String(row?.id || row || '').trim() === childId);
  if (alreadyLinked) {
    console.log(`${SECTION_NAME} (${childId}) is already linked under ${PARENT_SECTION.name}.`);
    return;
  }
  await sections.updateOne(
    { _id: parent._id },
    {
      $push: { subsections: { id: childId } },
      $set: {
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Linked ${SECTION_NAME} (${childId}) under ${PARENT_SECTION.name}.`);
}

function buildSymbolDoc(sectionId) {
  return {
    id: SYMBOL_ID,
    name: SECTION_NAME,
    type: 'class',
    value: 'bi bi-grid-1x2-fill',
    tags: [
      SECTION_NAME,
      LEGACY_SECTION_NAME,
      'SCHOOL_PEOPLE',
      String(sectionId || SECTION_ID)
    ],
    orgId: 'SYSTEM',
    adoptExisting: true
  };
}

async function upsertSymbol(symbols, sectionId) {
  const symbolDoc = buildSymbolDoc(sectionId);
  const existing =
    await symbols.findOne({ id: symbolDoc.id })
    || await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    })
    || await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(LEGACY_SECTION_NAME)}$`, 'i') },
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

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const section = await upsertSection(db.collection('sections'));
    await removeFromLegacyParent(db.collection('sections'), section);
    await linkUnderParent(db.collection('sections'), section);
    await upsertSymbol(db.collection('symbols'), section.id);
    console.log('Report Hub section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Report Hub section/symbol seed failed: ${error.message}`);
  process.exit(1);
});
