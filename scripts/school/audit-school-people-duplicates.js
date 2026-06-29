/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');

const ENTITY_DEFINITIONS = Object.freeze([
  { entityType: 'students', label: 'Students', mongoCollection: 'schoolStudents', jsonPath: path.join(ROOT_DIR, 'data', 'school', 'students.json'), statusField: 'academicStatus' },
  { entityType: 'teachers', label: 'Teachers', mongoCollection: 'schoolTeachers', jsonPath: path.join(ROOT_DIR, 'data', 'school', 'teachers.json'), statusField: 'status' },
  { entityType: 'staff', label: 'Staff', mongoCollection: 'schoolStaff', jsonPath: path.join(ROOT_DIR, 'data', 'school', 'staff.json'), statusField: 'status' }
]);

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function parseArgs(argv = []) {
  const args = new Set(argv);
  const orgIdArg = argv.find((value) => String(value || '').startsWith('--org-id='));
  return {
    help: args.has('--help') || args.has('-h'),
    json: args.has('--json'),
    mongo: args.has('--mongo'),
    orgId: orgIdArg ? String(orgIdArg).slice('--org-id='.length).trim() : ''
  };
}

function printHelp() {
  console.log('School people duplicate audit');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/school/audit-school-people-duplicates.js [--mongo|--json] [--org-id=900000]');
  console.log('');
  console.log('This script is dry-run only. It reports duplicate Student/Teacher/Staff rows grouped by entity + orgId + personId.');
}

function cleanId(value) {
  return String(value || '').trim();
}

function normalizeMongoDocument(row = null) {
  if (!row || typeof row !== 'object') return null;
  const { _id, ...rest } = row;
  if (!rest.id && _id) rest.id = String(_id);
  return rest;
}

function isHardDeleted(row) {
  const status = cleanId(row?.status || row?.academicStatus).toLowerCase();
  return row?.deleted === true
    || row?.isDeleted === true
    || !!row?.deletedAt
    || status === 'deleted'
    || status === 'hard_deleted'
    || status === 'hard-deleted';
}

function readJsonRows(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function groupDuplicates(rows = [], definition, orgId = '') {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== 'object' || isHardDeleted(row)) return;
    const rowOrgId = cleanId(row.orgId);
    const personId = cleanId(row.personId);
    if (!rowOrgId || !personId) return;
    if (orgId && rowOrgId !== orgId) return;
    const key = `${definition.entityType}::${rowOrgId}::${personId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        entityType: definition.entityType,
        label: definition.label,
        orgId: rowOrgId,
        personId,
        rows: []
      });
    }
    groups.get(key).rows.push({
      id: cleanId(row.id),
      status: cleanId(row[definition.statusField] || row.status || row.academicStatus || 'Active') || 'Active',
      accountId: cleanId(row.studentAccountId || row.teacherAccountId || row.staffAccountId)
    });
  });
  return Array.from(groups.values()).filter((group) => group.rows.length > 1);
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

async function readMongoRows(definition) {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri);
  if (!uri) throw new Error('Mongo audit requires MONGODB_URI or MONGO_URI.');
  if (!dbName) throw new Error('Mongo audit requires MONGODB_DB/MONGO_DB or a database name in the URI.');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const rows = await client.db(dbName).collection(definition.mongoCollection).find({}).toArray();
    return rows.map(normalizeMongoDocument).filter(Boolean);
  } finally {
    await client.close();
  }
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const backend = args.json ? 'json' : (args.mongo ? 'mongo' : cleanId(process.env.DATA_BACKEND || 'json').toLowerCase());
  if (backend !== 'mongo' && backend !== 'json') throw new Error(`Unsupported backend "${backend}". Use --mongo or --json.`);

  console.log(`[school-people-duplicates] backend=${backend}${args.orgId ? ` orgId=${args.orgId}` : ''}`);
  let totalGroups = 0;
  for (const definition of ENTITY_DEFINITIONS) {
    const rows = backend === 'mongo'
      ? await readMongoRows(definition)
      : readJsonRows(definition.jsonPath);
    const duplicates = groupDuplicates(rows, definition, args.orgId);
    totalGroups += duplicates.length;
    console.log(`\n${definition.label}: ${duplicates.length} duplicate group(s)`);
    duplicates.forEach((group) => {
      console.log(`- ${group.entityType} orgId=${group.orgId} personId=${group.personId}`);
      group.rows.forEach((row) => {
        console.log(`  * id=${row.id || '-'} status=${row.status || '-'} accountId=${row.accountId || '-'}`);
      });
    });
  }
  console.log(`\nDone. duplicateGroups=${totalGroups}`);
}

main().catch((error) => {
  console.error(`[school-people-duplicates][error] ${error.message}`);
  process.exitCode = 1;
});
