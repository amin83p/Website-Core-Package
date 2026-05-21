/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const PARENT_SECTION = {
  id: '340738',
  name: 'SYSTEM_SETTINGS'
};

const UPLOAD_FOLDERS_SECTION_ID = '731284';
const UPLOAD_FOLDERS_SECTION_NAME = 'SYSTEM_UPLOAD_FOLDERS';
const UPLOAD_FOLDERS_SYMBOL_ID = 'SYM_SYSTEM_082';

const OP_BUNDLE = [
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true }, // READ
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true }, // READ_ALL
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true }, // UPDATE
  { id: 'OP1006', sessionAttempts: 5, sessionTime: 15, active: true }  // CONFIGURE
];

const SECTION_DOC = {
  id: UPLOAD_FOLDERS_SECTION_ID,
  name: UPLOAD_FOLDERS_SECTION_NAME,
  category: 'SYSTEM',
  description: 'Configure File Manager-visible upload folder templates and generated asset destinations.',
  homeURL: '/systemSettings/upload-folders',
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
  const order = OP_BUNDLE.map((op) => op.id);
  return Array.from(byId.values()).sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return String(a.id).localeCompare(String(b.id));
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

async function upsertUploadFoldersSection(sections) {
  const existing =
    await sections.findOne({ id: UPLOAD_FOLDERS_SECTION_ID })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(UPLOAD_FOLDERS_SECTION_NAME)}$`, 'i') } });

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
    console.log(`Inserted section ${UPLOAD_FOLDERS_SECTION_NAME} (${next.id}).`);
    return next;
  }

  await sections.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${UPLOAD_FOLDERS_SECTION_NAME} (${next.id}).`);
  return { ...existing, ...next };
}

async function linkUnderSystemSettings(sections, childSection) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });

  if (!parent) {
    console.warn(
      `WARNING: ${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${childSection.id}" }`
    );
    return;
  }

  const childId = String(childSection?.id || '').trim();
  const currentSubsections = Array.isArray(parent.subsections) ? parent.subsections : [];
  const normalizedSubsections = currentSubsections
    .map((row) => ({ id: String(row?.id || row || '').trim() }))
    .filter((row) => row.id && row.id !== childId);
  normalizedSubsections.push({ id: childId });

  await sections.updateOne(
    { _id: parent._id },
    {
      $set: {
        subsections: normalizedSubsections,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );

  console.log(`Linked ${UPLOAD_FOLDERS_SECTION_NAME} (${childId}) under ${PARENT_SECTION.name}.`);
}

function buildSymbolDoc(sectionId) {
  return {
    id: UPLOAD_FOLDERS_SYMBOL_ID,
    name: UPLOAD_FOLDERS_SECTION_NAME,
    type: 'class',
    value: 'bi bi-folder-symlink',
    tags: [
      UPLOAD_FOLDERS_SECTION_NAME,
      'UPLOAD_FOLDERS',
      'UPLOAD_FOLDER_SETTINGS',
      String(sectionId || UPLOAD_FOLDERS_SECTION_ID)
    ],
    orgId: 'SYSTEM'
  };
}

async function upsertUploadFoldersSymbol(symbols, sectionId) {
  const symbolDoc = buildSymbolDoc(sectionId);
  const existing =
    await symbols.findOne({ id: symbolDoc.id })
    || await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(UPLOAD_FOLDERS_SECTION_NAME)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });

  const next = {
    ...symbolDoc,
    id: String(existing?.id || symbolDoc.id),
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${UPLOAD_FOLDERS_SECTION_NAME} (${next.id}).`);
    return next;
  }

  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${UPLOAD_FOLDERS_SECTION_NAME} (${next.id}).`);
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
    const section = await upsertUploadFoldersSection(db.collection('sections'));
    await linkUnderSystemSettings(db.collection('sections'), section);
    await upsertUploadFoldersSymbol(db.collection('symbols'), section.id);
    console.log('System upload folder section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`System upload folder section/symbol seed failed: ${error.message}`);
  process.exit(1);
});
