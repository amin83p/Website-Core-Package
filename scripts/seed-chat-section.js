/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const CHAT_SECTION_ID = '188404';
const CHAT_SECTION_NAME = 'CHATS';
const CHAT_OPERATION_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true }, // CREATE
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true }, // READ
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true }, // READ_ALL
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true }, // DELETE
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true }, // UPDATE
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true }, // EXPORT
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true }, // IMPORT
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }, // DELETE_ALL
  { id: 'OP1023', sessionAttempts: 5, sessionTime: 15, active: true }  // DOWNLOAD_FILE
];

const CHAT_SYMBOL_DOC = {
  id: 'SYM_SYSTEM_019',
  name: CHAT_SECTION_NAME,
  type: 'class',
  value: 'bi bi-chat-fill',
  tags: ['CHAT', 'CHATS', 'CONVERSATIONS', 'CONVERSATION'],
  orgId: 'SYSTEM'
};

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
  for (const op of CHAT_OPERATION_BUNDLE) {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  }
  const order = CHAT_OPERATION_BUNDLE.map((op) => op.id);
  return Array.from(byId.values()).sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return String(a.id).localeCompare(String(b.id));
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

async function upsertChatSection(sections) {
  const existing =
    await sections.findOne({ id: CHAT_SECTION_ID })
    || await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(CHAT_SECTION_NAME)}$`, 'i') } });

  const sectionDoc = {
    id: String(existing?.id || CHAT_SECTION_ID),
    active: existing?.active !== false,
    audit: buildAudit(existing?.audit),
    category: existing?.category || 'GENERAL',
    dashboardDisplay: existing?.dashboardDisplay !== false,
    description: existing?.description || 'This section is for Chat or messaging system in the platform. Users can communicate and share files.',
    homeURL: existing?.homeURL || '/chat/list',
    inactiveMessage: existing?.inactiveMessage || '',
    mainDashboardDisplay: existing?.mainDashboardDisplay === true,
    message: existing?.message || '',
    minimumAccessRequirement: existing?.minimumAccessRequirement || 1,
    name: CHAT_SECTION_NAME,
    navigatorSection: existing?.navigatorSection === true,
    operations: mergeOperations(existing?.operations),
    related: Array.isArray(existing?.related) ? existing.related : [],
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : []
  };

  if (!existing) {
    await sections.insertOne(sectionDoc);
    console.log(`Inserted section ${CHAT_SECTION_NAME} (${sectionDoc.id}).`);
    return;
  }

  await sections.updateOne({ _id: existing._id }, { $set: sectionDoc });
  console.log(`Updated section ${CHAT_SECTION_NAME} (${sectionDoc.id}).`);
}

async function upsertChatSymbol(symbols) {
  const existing =
    await symbols.findOne({ id: CHAT_SYMBOL_DOC.id })
    || await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(CHAT_SECTION_NAME)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });

  const next = {
    ...CHAT_SYMBOL_DOC,
    id: String(existing?.id || CHAT_SYMBOL_DOC.id),
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${CHAT_SECTION_NAME} (${next.id}).`);
    return;
  }

  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${CHAT_SECTION_NAME} (${next.id}).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    await upsertChatSection(db.collection('sections'));
    await upsertChatSymbol(db.collection('symbols'));
    console.log('Chat section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Chat section/symbol seed failed: ${error.message}`);
  process.exit(1);
});
