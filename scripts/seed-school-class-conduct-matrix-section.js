/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SECTION = {
  id: '778772',
  name: 'SCHOOL_CLASS_CONDUCT_MATRIX',
  description: 'Class conduct matrix: view and enter session conduct ratings across students for a class.',
  homeURL: '/school/conduct-matrix',
  symbolId: 'SYM_SYSTEM_137',
  icon: 'bi bi-emoji-smile'
};
const SESSIONS_SECTION_ID = '358609';
const PARENT = { id: '139382', name: 'SCHOOL_ACADEMIA' };
const OPERATIONS = ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1006', 'OP1010', 'OP1012', 'OP1013', 'OP1022'];
const STAFF_PROFILE = 'SCHOOL_STAFF';
const TEACHER_PROFILE = 'SCHOOL_TEACHER';

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
      sessionAttempts: 10,
      sessionTime: 30,
      active: rows.get(id)?.active !== false,
      ...(rows.get(id) || {})
    });
  });
  return [...rows.values()].filter((row) => row.id);
}

async function upsertSection(db) {
  const sections = db.collection('sections');
  const sectionMatches = await sections.find({
    $or: [{ id: SECTION.id }, { name: SECTION.name }]
  }).toArray();
  const existing = sectionMatches.find((row) => String(row?.id || '') === SECTION.id)
    || sectionMatches[0]
    || null;
  const section = {
    id: SECTION.id,
    name: SECTION.name,
    category: 'SCHOOL',
    description: SECTION.description,
    active: existing?.active !== false,
    trackState: true,
    minimumAccessRequirement: 5,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL: SECTION.homeURL,
    inactiveMessage: '',
    message: '',
    operations: mergeOperations(existing?.operations, OPERATIONS),
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : [],
    related: [{ id: SESSIONS_SECTION_ID }],
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await sections.updateOne({ _id: existing._id }, { $set: section });
  else await sections.insertOne(section);
}

async function upsertSymbol(db) {
  const symbols = db.collection('symbols');
  const symbolMatches = await symbols.find({
    $or: [{ id: SECTION.symbolId }, { name: SECTION.name }]
  }).toArray();
  const existing = symbolMatches.find((row) => String(row?.id || '') === SECTION.symbolId)
    || symbolMatches[0]
    || null;
  const symbol = {
    id: SECTION.symbolId,
    name: SECTION.name,
    type: 'class',
    value: SECTION.icon,
    tags: [SECTION.name, SECTION.id],
    orgId: 'SYSTEM',
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await symbols.updateOne({ _id: existing._id }, { $set: symbol });
  else await symbols.insertOne(symbol);
}

async function linkParentSubsection(db) {
  const sections = db.collection('sections');
  const parent = await sections.findOne({ $or: [{ id: PARENT.id }, { name: PARENT.name }] });
  if (!parent) throw new Error(`${PARENT.name} parent section was not found.`);
  const ids = new Set((parent.subsections || []).map((row) => String(row?.id || row || '')).filter(Boolean));
  ids.add(SECTION.id);
  await sections.updateOne({ _id: parent._id }, {
    $set: {
      subsections: [...ids].map((id) => ({ id })),
      'audit.lastUpdateUser': ACTOR,
      'audit.lastUpdateDateTime': NOW
    }
  });
}

function buildOperations(operationIds = [], scopeId = 'SCP_ORG') {
  return operationIds.map((operationId) => ({
    operationId,
    scopeId,
    maxAttemptsPerSession: null,
    maxSessionDurationMinutes: null,
    maxFetchUploadVolumeKB: null
  }));
}

async function grantAccesses(db) {
  const accesses = db.collection('accesses');
  const staffGrant = {
    sectionId: SECTION.id,
    adminAccess: false,
    operations: buildOperations(['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1006'], 'SCP_ORG')
  };
  const teacherGrant = {
    sectionId: SECTION.id,
    adminAccess: false,
    operations: buildOperations(['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005'], 'SCP_DEPT')
  };

  for (const [profileName, grant] of [[STAFF_PROFILE, staffGrant], [TEACHER_PROFILE, teacherGrant]]) {
    const profile = await accesses.findOne({ name: profileName });
    if (!profile) continue;
    const field = Array.isArray(profile.sectionGrants) ? 'sectionGrants' : 'sections';
    const grants = Array.isArray(profile[field]) ? [...profile[field]] : [];
    const index = grants.findIndex((row) => String(row?.sectionId || '') === SECTION.id);
    if (index >= 0) grants[index] = grant;
    else grants.push(grant);
    await accesses.updateOne({ _id: profile._id }, {
      $set: {
        [field]: grants,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    });
  }
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
    await upsertSection(db);
    await upsertSymbol(db);
    await linkParentSubsection(db);
    await grantAccesses(db);
    console.log('Class Conduct Matrix section and symbol seeded successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Class conduct matrix seed failed: ${error.message}`);
  process.exit(1);
});
