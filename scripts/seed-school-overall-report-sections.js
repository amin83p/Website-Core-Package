/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const PARENT = { id: '445571', name: 'SCHOOL_REPORTS' };
const OPERATIONS = Object.freeze({
  template: ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1012'],
  instance: ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1012']
});
const DEFINITIONS = Object.freeze([
  {
    id: '446104',
    name: 'SCHOOL_REPORTS_OVERALL_TEMPLATE',
    description: 'Design overall report templates from completed report sources.',
    homeURL: '/school/reports/overall-templates',
    symbolId: 'SYM_SYSTEM_129',
    icon: 'bi bi-files',
    operationKey: 'template'
  },
  {
    id: '446105',
    name: 'SCHOOL_REPORTS_OVERALL_INSTANCES',
    description: 'Create, edit, submit, lock, and export snapshot-based overall reports.',
    homeURL: '/school/reports/overall-reports',
    symbolId: 'SYM_SYSTEM_130',
    icon: 'bi bi-file-earmark-check',
    operationKey: 'instance'
  }
]);

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

function mergeOperations(existing = [], wanted = []) {
  const rows = new Map((Array.isArray(existing) ? existing : []).map((row) => [String(row?.id || ''), row]));
  wanted.forEach((id) => {
    rows.set(id, {
      id,
      sessionAttempts: 5,
      sessionTime: 15,
      active: rows.get(id)?.active !== false,
      ...(rows.get(id) || {})
    });
  });
  return [...rows.values()].filter((row) => row.id);
}

async function upsertDefinition(db, definition) {
  const sections = db.collection('sections');
  const symbols = db.collection('symbols');
  const sectionMatches = await sections.find({
    $or: [{ id: definition.id }, { name: definition.name }]
  }).toArray();
  const existing = sectionMatches.find((row) => String(row?.id || '') === definition.id)
    || sectionMatches[0]
    || null;
  const section = {
    id: definition.id,
    name: definition.name,
    category: 'SCHOOL',
    description: definition.description,
    active: existing?.active !== false,
    trackState: true,
    minimumAccessRequirement: 5,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL: definition.homeURL,
    inactiveMessage: '',
    message: '',
    operations: mergeOperations(existing?.operations, OPERATIONS[definition.operationKey]),
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : [],
    related: Array.isArray(existing?.related) ? existing.related : [],
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await sections.updateOne({ _id: existing._id }, { $set: section });
  else await sections.insertOne(section);
  const duplicateSectionIds = sectionMatches
    .filter((row) => existing && String(row?._id) !== String(existing._id))
    .map((row) => row._id);
  if (duplicateSectionIds.length) await sections.deleteMany({ _id: { $in: duplicateSectionIds } });

  const symbolMatches = await symbols.find({
    $or: [{ id: definition.symbolId }, { name: definition.name }]
  }).toArray();
  const existingSymbol = symbolMatches.find((row) => String(row?.id || '') === definition.symbolId)
    || symbolMatches[0]
    || null;
  const symbol = {
    id: definition.symbolId,
    name: definition.name,
    type: 'class',
    value: definition.icon,
    tags: [definition.name, definition.id],
    orgId: 'SYSTEM',
    adoptExisting: true,
    audit: audit(existingSymbol?.audit)
  };
  if (existingSymbol) await symbols.updateOne({ _id: existingSymbol._id }, { $set: symbol });
  else await symbols.insertOne(symbol);
  const duplicateSymbolIds = symbolMatches
    .filter((row) => existingSymbol && String(row?._id) !== String(existingSymbol._id))
    .map((row) => row._id);
  if (duplicateSymbolIds.length) await symbols.deleteMany({ _id: { $in: duplicateSymbolIds } });
  return section;
}

async function linkParent(db, children) {
  const sections = db.collection('sections');
  const parent = await sections.findOne({ $or: [{ id: PARENT.id }, { name: PARENT.name }] });
  if (!parent) throw new Error(`${PARENT.name} parent section was not found.`);
  const ids = new Set((parent.subsections || []).map((row) => String(row?.id || row || '')).filter(Boolean));
  children.forEach((child) => ids.add(child.id));
  await sections.updateOne({ _id: parent._id }, {
    $set: {
      subsections: [...ids].map((id) => ({ id })),
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
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const children = [];
    for (const definition of DEFINITIONS) {
      // eslint-disable-next-line no-await-in-loop
      children.push(await upsertDefinition(db, definition));
    }
    await linkParent(db, children);
    console.log('Overall report sections and symbols seeded successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Overall report seed failed: ${error.message}`);
  process.exit(1);
});
