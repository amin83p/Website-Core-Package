/* eslint-disable no-console */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const ROLE_TOKEN_MAP = Object.freeze({
  student: 'school_student',
  teacher: 'school_teacher',
  staff: 'school_staff'
});
const OLD_ROLE_KEYS = Object.freeze(Object.keys(ROLE_TOKEN_MAP));

const JSON_TARGETS = Object.freeze([
  { fileName: 'roles.json', kind: 'roles' },
  { fileName: 'persons.json', kind: 'memberships' },
  { fileName: 'users.json', kind: 'memberships' },
  { fileName: 'helpArticles.json', kind: 'audience' }
]);

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fsSync.existsSync(envPath)) return;
  const raw = fsSync.readFileSync(envPath, 'utf8');
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

function normalizeRoleToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isOldGenericSchoolRole(value) {
  return Object.prototype.hasOwnProperty.call(ROLE_TOKEN_MAP, normalizeRoleToken(value));
}

function mapSchoolRoleToken(value) {
  const trimmed = String(value || '').trim();
  const normalized = normalizeRoleToken(trimmed);
  return ROLE_TOKEN_MAP[normalized] || trimmed;
}

function dedupePreserveOrder(values = []) {
  const output = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const token = String(value || '').trim();
    if (!token) return;
    const key = normalizeRoleToken(token);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(token);
  });
  return output;
}

function migrateRoleTokenArray(values = []) {
  const original = Array.isArray(values) ? values : [];
  const mapped = dedupePreserveOrder(original.map((value) => mapSchoolRoleToken(value)));
  const changed = mapped.length !== original.length || mapped.some((value, index) => value !== original[index]);
  const mappedCount = original.filter((value) => isOldGenericSchoolRole(value)).length;
  return { value: mapped, changed, mappedCount };
}

function migrateMembershipRow(row = {}) {
  if (!row || typeof row !== 'object') return { value: row, changed: false, mappedCount: 0 };

  let changed = false;
  let mappedCount = 0;
  const next = { ...row };

  if (Array.isArray(row.roles)) {
    const result = migrateRoleTokenArray(row.roles);
    if (result.changed) {
      next.roles = result.value;
      changed = true;
    }
    mappedCount += result.mappedCount;
  }

  if (Object.prototype.hasOwnProperty.call(row, 'role')) {
    const originalRole = String(row.role || '').trim();
    const mappedRole = mapSchoolRoleToken(originalRole);
    if (mappedRole !== originalRole) {
      next.role = mappedRole;
      changed = true;
      mappedCount += 1;
    }
  }

  return { value: next, changed, mappedCount };
}

function migrateMembershipsDocument(doc = {}) {
  if (!doc || typeof doc !== 'object') return { value: doc, changed: false, mappedCount: 0 };
  if (!Array.isArray(doc.organizations)) return { value: doc, changed: false, mappedCount: 0 };

  let changed = false;
  let mappedCount = 0;
  const organizations = doc.organizations.map((membership) => {
    const result = migrateMembershipRow(membership);
    if (result.changed) changed = true;
    mappedCount += result.mappedCount;
    return result.value;
  });

  if (!changed) return { value: doc, changed: false, mappedCount: 0 };
  return {
    value: { ...doc, organizations },
    changed: true,
    mappedCount
  };
}

function migrateRoleRows(rows = []) {
  let removedCount = 0;
  const output = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (isOldGenericSchoolRole(row?.key)) {
      removedCount += 1;
      return false;
    }
    return true;
  });
  return {
    value: output,
    changed: removedCount > 0,
    removedCount
  };
}

function migrateAudienceDocument(doc = {}) {
  if (!doc || typeof doc !== 'object') return { value: doc, changed: false, mappedCount: 0 };
  if (!Array.isArray(doc.audience)) return { value: doc, changed: false, mappedCount: 0 };
  const result = migrateRoleTokenArray(doc.audience);
  if (!result.changed) return { value: doc, changed: false, mappedCount: result.mappedCount };
  return {
    value: { ...doc, audience: result.value },
    changed: true,
    mappedCount: result.mappedCount
  };
}

function migrateRowsByKind(rows = [], kind = '') {
  if (kind === 'roles') return migrateRoleRows(rows);

  let changedCount = 0;
  let mappedCount = 0;
  const migrated = (Array.isArray(rows) ? rows : []).map((row) => {
    const result = kind === 'audience'
      ? migrateAudienceDocument(row)
      : migrateMembershipsDocument(row);
    if (result.changed) changedCount += 1;
    mappedCount += Number(result.mappedCount || 0);
    return result.value;
  });

  return {
    value: migrated,
    changed: changedCount > 0,
    changedCount,
    mappedCount
  };
}

async function readJsonArray(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array.`);
  return parsed;
}

async function migrateJsonFile(target, options = {}) {
  const apply = options.apply === true;
  const filePath = path.join(ROOT_DIR, 'data', target.fileName);
  const rows = await readJsonArray(filePath);
  const result = migrateRowsByKind(rows, target.kind);

  if (apply && result.changed) {
    await fs.writeFile(filePath, `${JSON.stringify(result.value, null, 2)}\n`);
  }

  return {
    target: target.fileName,
    kind: target.kind,
    changed: result.changed,
    changedCount: Number(result.changedCount || 0),
    mappedCount: Number(result.mappedCount || 0),
    removedCount: Number(result.removedCount || 0)
  };
}

async function migrateJsonFiles(options = {}) {
  const reports = [];
  for (const target of JSON_TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    reports.push(await migrateJsonFile(target, options));
  }
  return reports;
}

async function migrateMongoRoles(db, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection('roles');
  const rows = await collection.find({}, { projection: { key: 1 } }).toArray();
  const idsToDelete = rows
    .filter((row) => isOldGenericSchoolRole(row?.key))
    .map((row) => row._id);

  if (apply && idsToDelete.length) {
    await collection.deleteMany({ _id: { $in: idsToDelete } });
  }

  return {
    target: 'roles',
    kind: 'roles',
    changed: idsToDelete.length > 0,
    removedCount: idsToDelete.length,
    changedCount: 0,
    mappedCount: 0
  };
}

async function migrateMongoMembershipCollection(db, collectionName, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection(collectionName);
  const rows = await collection.find({}, { projection: { organizations: 1 } }).toArray();
  let changedCount = 0;
  let mappedCount = 0;

  for (const row of rows) {
    const result = migrateMembershipsDocument(row);
    if (!result.changed) continue;
    changedCount += 1;
    mappedCount += result.mappedCount;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: row._id }, { $set: { organizations: result.value.organizations } });
    }
  }

  return {
    target: collectionName,
    kind: 'memberships',
    changed: changedCount > 0,
    changedCount,
    mappedCount,
    removedCount: 0
  };
}

async function migrateMongoAudienceCollection(db, collectionName, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection(collectionName);
  const rows = await collection.find({}, { projection: { audience: 1 } }).toArray();
  let changedCount = 0;
  let mappedCount = 0;

  for (const row of rows) {
    const result = migrateAudienceDocument(row);
    if (!result.changed) continue;
    changedCount += 1;
    mappedCount += result.mappedCount;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: row._id }, { $set: { audience: result.value.audience } });
    }
  }

  return {
    target: collectionName,
    kind: 'audience',
    changed: changedCount > 0,
    changedCount,
    mappedCount,
    removedCount: 0
  };
}

async function migrateMongo(options = {}) {
  loadLocalEnvFile();
  const { connectMongo, disconnectMongo } = require('../MVC/infrastructure/mongo/mongoConnection');
  const db = await connectMongo({
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)
  });

  try {
    return [
      await migrateMongoRoles(db, options),
      await migrateMongoMembershipCollection(db, 'persons', options),
      await migrateMongoMembershipCollection(db, 'users', options),
      await migrateMongoAudienceCollection(db, 'helpArticles', options)
    ];
  } finally {
    await disconnectMongo();
  }
}

function formatReportLine(prefix, report) {
  const parts = [
    `${prefix}${report.target}`,
    `changed=${report.changed ? 'yes' : 'no'}`
  ];
  if (report.removedCount) parts.push(`removed=${report.removedCount}`);
  if (report.changedCount) parts.push(`docs=${report.changedCount}`);
  if (report.mappedCount) parts.push(`mappedTokens=${report.mappedCount}`);
  return parts.join(' ');
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const wantsJson = args.has('--json');
  const wantsMongo = args.has('--mongo');
  return {
    apply: args.has('--apply'),
    includeJson: wantsJson || !wantsMongo,
    includeMongo: wantsMongo || !wantsJson
  };
}

async function runCli() {
  const options = parseCliArgs();
  const modeLabel = options.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[school-role-token-migration] mode=${modeLabel}`);

  if (options.includeJson) {
    const reports = await migrateJsonFiles({ apply: options.apply });
    reports.forEach((report) => console.log(formatReportLine('[json] ', report)));
  }

  if (options.includeMongo) {
    const reports = await migrateMongo({ apply: options.apply });
    reports.forEach((report) => console.log(formatReportLine('[mongo] ', report)));
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`[school-role-token-migration] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ROLE_TOKEN_MAP,
  OLD_ROLE_KEYS,
  normalizeRoleToken,
  mapSchoolRoleToken,
  migrateRoleTokenArray,
  migrateMembershipRow,
  migrateMembershipsDocument,
  migrateRoleRows,
  migrateAudienceDocument,
  migrateRowsByKind,
  migrateJsonFiles,
  migrateMongo
};
