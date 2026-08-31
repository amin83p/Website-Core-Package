/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SECTION = {
  id: '778771',
  name: 'SCHOOL_SESSION_STUDENT_CASES',
  description: 'Session student cases saved from Manage Session.',
  homeURL: '/school/session-student-cases',
  symbolId: 'SYM_SYSTEM_134',
  icon: 'bi bi-clipboard2-pulse'
};
const SESSIONS_SECTION_ID = '358609';
const PARENT = { id: '139382', name: 'SCHOOL_ACADEMIA' };
const OPERATIONS = ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1006', 'OP1014'];
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

async function linkSessionsRelated(db) {
  const sections = db.collection('sections');
  const sessionsSection = await sections.findOne({ id: SESSIONS_SECTION_ID });
  if (!sessionsSection) return;
  const relatedIds = new Set((sessionsSection.related || []).map((row) => String(row?.id || row || '')).filter(Boolean));
  relatedIds.add(SECTION.id);
  await sections.updateOne({ _id: sessionsSection._id }, {
    $set: {
      related: [...relatedIds].map((id) => ({ id })),
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
    operations: buildOperations(['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005', 'OP1014'], 'SCP_DEPT')
  };

  const staffProfile = await accesses.findOne({ name: STAFF_PROFILE });
  if (staffProfile) {
    const grants = Array.isArray(staffProfile.sectionGrants) ? [...staffProfile.sectionGrants] : [];
    const index = grants.findIndex((row) => String(row?.sectionId || '') === SECTION.id);
    if (index >= 0) grants[index] = staffGrant;
    else grants.push(staffGrant);
    await accesses.updateOne({ _id: staffProfile._id }, {
      $set: {
        sectionGrants: grants,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    });
  }

  const teacherProfile = await accesses.findOne({ name: TEACHER_PROFILE });
  if (teacherProfile) {
    const grants = Array.isArray(teacherProfile.sectionGrants) ? [...teacherProfile.sectionGrants] : [];
    const index = grants.findIndex((row) => String(row?.sectionId || '') === SECTION.id);
    if (index >= 0) grants[index] = teacherGrant;
    else grants.push(teacherGrant);
    await accesses.updateOne({ _id: teacherProfile._id }, {
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
    await linkSessionsRelated(db);
    await grantAccesses(db);
    console.log('Session Student Cases section and symbol seeded successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Session student cases seed failed: ${error.message}`);
  process.exit(1);
});
