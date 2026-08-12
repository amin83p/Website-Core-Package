/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SECTION = {
  id: '778770',
  name: 'SCHOOL_ATTENDANCE_REPORT',
  description: 'Student-centric attendance report across enrolled classes for a selected date range.',
  homeURL: '/school/attendances/report',
  symbolId: 'SYM_SYSTEM_133',
  icon: 'bi bi-person-lines-fill'
};
const ATTENDANCE_SECTION_ID = '778768';
const PARENT = { id: '139382', name: 'SCHOOL_ACADEMIA' };
const OPERATIONS = ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1006', 'OP1010', 'OP1012', 'OP1013', 'OP1022'];
const ACCESS_PROFILES = ['SCHOOL_STUDENT', 'SCHOOL_TEACHER', 'SCHOOL_STAFF'];

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
    related: [{ id: ATTENDANCE_SECTION_ID }],
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

async function linkAttendanceRelated(db) {
  const sections = db.collection('sections');
  const attendance = await sections.findOne({ id: ATTENDANCE_SECTION_ID });
  if (!attendance) return;
  const relatedIds = new Set((attendance.related || []).map((row) => String(row?.id || row || '')).filter(Boolean));
  relatedIds.add(SECTION.id);
  await sections.updateOne({ _id: attendance._id }, {
    $set: {
      related: [...relatedIds].map((id) => ({ id })),
      'audit.lastUpdateUser': ACTOR,
      'audit.lastUpdateDateTime': NOW
    }
  });
}

function ownerOperations(operationIds = []) {
  return operationIds.map((operationId) => ({
    operationId,
    scopeId: 'SCP_OWNER',
    maxAttemptsPerSession: null,
    maxSessionDurationMinutes: null,
    maxFetchUploadVolumeKB: null
  }));
}

async function grantAccesses(db) {
  const accesses = db.collection('accesses');
  const profiles = await accesses.find({
    name: { $in: ACCESS_PROFILES }
  }).toArray();
  const sectionGrant = {
    sectionId: SECTION.id,
    adminAccess: false,
    operations: ownerOperations(['OP1003', 'OP1005'])
  };
  for (const profile of profiles) {
    const grants = Array.isArray(profile.sectionGrants) ? [...profile.sectionGrants] : [];
    const index = grants.findIndex((row) => String(row?.sectionId || '') === SECTION.id);
    if (index >= 0) grants[index] = sectionGrant;
    else grants.push(sectionGrant);
    await accesses.updateOne({ _id: profile._id }, {
      $set: {
        sectionGrants: grants,
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
    await linkAttendanceRelated(db);
    await grantAccesses(db);
    console.log('Student Attendance Report section and symbol seeded successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Attendance report seed failed: ${error.message}`);
  process.exit(1);
});
