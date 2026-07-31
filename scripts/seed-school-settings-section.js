/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const PARENT = { id: '122740', name: 'SCHOOL' };
const DEFINITION = Object.freeze({
  id: '446106',
  name: 'SCHOOL_SETTINGS',
  description: 'Manage organization-wide school policies and settings.',
  homeURL: '/school/settings',
  symbolId: 'SYM_SYSTEM_131',
  icon: 'bi bi-gear-wide-connected',
  operations: ['OP1003', 'OP1005']
});

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
  const result = { uri: '', db: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (['--uri', '-u'].includes(argv[index])) result.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(argv[index])) result.db = argv[++index] || '';
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

function mergeOperations(existing = []) {
  const rows = new Map(
    (Array.isArray(existing) ? existing : [])
      .map((row) => [String(row?.id || ''), row])
      .filter(([id]) => id)
  );
  DEFINITION.operations.forEach((id) => {
    const current = rows.get(id) || {};
    rows.set(id, {
      id,
      sessionAttempts: 5,
      sessionTime: 15,
      active: current.active !== false,
      ...current
    });
  });
  return DEFINITION.operations.map((id) => rows.get(id));
}

async function upsertSection(db) {
  const collection = db.collection('sections');
  const matches = await collection.find({
    $or: [{ id: DEFINITION.id }, { name: DEFINITION.name }]
  }).toArray();
  const existing = matches.find((row) => String(row?.id || '') === DEFINITION.id)
    || matches[0]
    || null;
  const section = {
    id: DEFINITION.id,
    name: DEFINITION.name,
    category: 'SCHOOL',
    description: DEFINITION.description,
    active: existing?.active !== false,
    trackState: true,
    minimumAccessRequirement: 5,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL: DEFINITION.homeURL,
    inactiveMessage: '',
    message: '',
    operations: mergeOperations(existing?.operations),
    subsections: [],
    related: Array.isArray(existing?.related) ? existing.related : [],
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await collection.updateOne({ _id: existing._id }, { $set: section });
  else await collection.insertOne(section);

  const duplicateIds = matches
    .filter((row) => existing && String(row?._id) !== String(existing._id))
    .map((row) => row._id);
  if (duplicateIds.length) await collection.deleteMany({ _id: { $in: duplicateIds } });
  return section;
}

async function upsertSymbol(db) {
  const collection = db.collection('symbols');
  const matches = await collection.find({
    $or: [{ id: DEFINITION.symbolId }, { name: DEFINITION.name }]
  }).toArray();
  const existing = matches.find((row) => String(row?.id || '') === DEFINITION.symbolId)
    || matches[0]
    || null;
  const symbol = {
    id: DEFINITION.symbolId,
    name: DEFINITION.name,
    type: 'class',
    value: DEFINITION.icon,
    tags: [DEFINITION.name, DEFINITION.id],
    orgId: 'SYSTEM',
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await collection.updateOne({ _id: existing._id }, { $set: symbol });
  else await collection.insertOne(symbol);

  const duplicateIds = matches
    .filter((row) => existing && String(row?._id) !== String(existing._id))
    .map((row) => row._id);
  if (duplicateIds.length) await collection.deleteMany({ _id: { $in: duplicateIds } });
}

async function linkParent(db) {
  const collection = db.collection('sections');
  const matches = await collection.find({
    $or: [{ id: PARENT.id }, { name: PARENT.name }]
  }).toArray();
  const parent = matches.find((row) => String(row?.id || '') === PARENT.id)
    || matches[0]
    || null;
  if (!parent) throw new Error(`${PARENT.name} parent section was not found.`);

  const subsectionIds = new Set(
    (Array.isArray(parent.subsections) ? parent.subsections : [])
      .map((row) => String(row?.id || row || '').trim())
      .filter(Boolean)
  );
  subsectionIds.add(DEFINITION.id);
  await collection.updateOne({ _id: parent._id }, {
    $set: {
      subsections: [...subsectionIds].map((id) => ({ id })),
      'audit.lastUpdateUser': ACTOR,
      'audit.lastUpdateDateTime': NOW
    }
  });
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(
    args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app'
  ).trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    await upsertSection(db);
    await upsertSymbol(db);
    await linkParent(db);
    console.log('School Settings section and symbol seeded successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School Settings seed failed: ${error.message}`);
  process.exit(1);
});
