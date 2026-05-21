/* eslint-disable no-console */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CANONICAL_ORG_ROLE_TOKEN = 'pte_student';
const CANONICAL_APPLICANT_ROLE_TOKEN = 'PTE_Student';

const OLD_ROLE_KEYS = Object.freeze(['pte_studnet']);
const OLD_ROLE_TOKEN_MAP = Object.freeze({
  pte_studnet: CANONICAL_ORG_ROLE_TOKEN,
  ptestudnet: CANONICAL_ORG_ROLE_TOKEN,
  'pte-studnet': CANONICAL_ORG_ROLE_TOKEN,
  'pte studnet': CANONICAL_ORG_ROLE_TOKEN,
  pte_studnets: CANONICAL_ORG_ROLE_TOKEN,
  ptestudnets: CANONICAL_ORG_ROLE_TOKEN,
  'pte-studnets': CANONICAL_ORG_ROLE_TOKEN
});

const JSON_TARGETS = Object.freeze([
  { fileName: 'roles.json', kind: 'roles' },
  { fileName: 'persons.json', kind: 'memberships' },
  { fileName: 'users.json', kind: 'memberships' },
  { fileName: 'pteApplicants.json', kind: 'pteApplicants' }
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
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function isOldPteRoleKey(value) {
  return OLD_ROLE_KEYS.includes(normalizeRoleToken(value));
}

function isOldPteStudentRoleToken(value) {
  const token = normalizeRoleToken(value);
  return Object.prototype.hasOwnProperty.call(OLD_ROLE_TOKEN_MAP, token);
}

function mapPteOrgRoleToken(value) {
  const trimmed = String(value || '').trim();
  const token = normalizeRoleToken(trimmed);
  return OLD_ROLE_TOKEN_MAP[token] || trimmed;
}

function mapPteApplicantRoleToken(value) {
  const trimmed = String(value || '').trim();
  return isOldPteStudentRoleToken(trimmed) ? CANONICAL_APPLICANT_ROLE_TOKEN : trimmed;
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
  const mapped = dedupePreserveOrder(original.map((value) => mapPteOrgRoleToken(value)));
  const changed = mapped.length !== original.length || mapped.some((value, index) => value !== original[index]);
  const mappedCount = original.filter((value) => isOldPteStudentRoleToken(value)).length;
  return { value: mapped, changed, mappedCount };
}

function migrateRoleAliasRow(row = {}) {
  if (!row || typeof row !== 'object') return { value: row, changed: false, aliasRemovedCount: 0 };
  if (!Array.isArray(row.aliases)) return { value: row, changed: false, aliasRemovedCount: 0 };

  const original = row.aliases;
  const aliases = dedupePreserveOrder(original.filter((alias) => !isOldPteStudentRoleToken(alias)));
  const changed = aliases.length !== original.length || aliases.some((alias, index) => alias !== original[index]);
  if (!changed) return { value: row, changed: false, aliasRemovedCount: 0 };

  return {
    value: { ...row, aliases },
    changed: true,
    aliasRemovedCount: Math.max(0, original.length - aliases.length)
  };
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
    const mappedRole = mapPteOrgRoleToken(originalRole);
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
  let changedCount = 0;
  let aliasRemovedCount = 0;
  const output = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (isOldPteRoleKey(row?.key)) {
      removedCount += 1;
      return;
    }

    const result = migrateRoleAliasRow(row);
    if (result.changed) {
      changedCount += 1;
      aliasRemovedCount += result.aliasRemovedCount;
    }
    output.push(result.value);
  });

  return {
    value: output,
    changed: removedCount > 0 || changedCount > 0,
    removedCount,
    changedCount,
    aliasRemovedCount
  };
}

function migratePteApplicantDocument(doc = {}) {
  if (!doc || typeof doc !== 'object') return { value: doc, changed: false, mappedCount: 0 };
  const originalToken = String(doc.personRoleToken || '').trim();
  if (!isOldPteStudentRoleToken(originalToken)) {
    return { value: doc, changed: false, mappedCount: 0 };
  }
  return {
    value: { ...doc, personRoleToken: mapPteApplicantRoleToken(originalToken) },
    changed: true,
    mappedCount: 1
  };
}

function migrateRowsByKind(rows = [], kind = '') {
  if (kind === 'roles') return migrateRoleRows(rows);

  let changedCount = 0;
  let mappedCount = 0;
  const migrated = (Array.isArray(rows) ? rows : []).map((row) => {
    const result = kind === 'pteApplicants'
      ? migratePteApplicantDocument(row)
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
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array.`);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
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
    aliasRemovedCount: Number(result.aliasRemovedCount || 0),
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
  const rows = await collection.find({}, { projection: { key: 1, aliases: 1 } }).toArray();
  const idsToDelete = rows
    .filter((row) => isOldPteRoleKey(row?.key))
    .map((row) => row._id);
  let changedCount = 0;
  let aliasRemovedCount = 0;

  if (apply && idsToDelete.length) {
    await collection.deleteMany({ _id: { $in: idsToDelete } });
  }

  for (const row of rows) {
    if (isOldPteRoleKey(row?.key)) continue;
    const result = migrateRoleAliasRow(row);
    if (!result.changed) continue;
    changedCount += 1;
    aliasRemovedCount += result.aliasRemovedCount;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: row._id }, { $set: { aliases: result.value.aliases } });
    }
  }

  return {
    target: 'roles',
    kind: 'roles',
    changed: idsToDelete.length > 0 || changedCount > 0,
    removedCount: idsToDelete.length,
    changedCount,
    mappedCount: 0,
    aliasRemovedCount
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

async function migrateMongoPteApplicants(db, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection('pteApplicants');
  const rows = await collection.find({}, { projection: { personRoleToken: 1 } }).toArray();
  let changedCount = 0;
  let mappedCount = 0;

  for (const row of rows) {
    const result = migratePteApplicantDocument(row);
    if (!result.changed) continue;
    changedCount += 1;
    mappedCount += result.mappedCount;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: row._id }, { $set: { personRoleToken: result.value.personRoleToken } });
    }
  }

  return {
    target: 'pteApplicants',
    kind: 'pteApplicants',
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
      await migrateMongoPteApplicants(db, options)
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
  if (report.aliasRemovedCount) parts.push(`removedAliases=${report.aliasRemovedCount}`);
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
  console.log(`[pte-student-role-token-migration] mode=${modeLabel}`);

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
    console.error(`[pte-student-role-token-migration] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICAL_ORG_ROLE_TOKEN,
  CANONICAL_APPLICANT_ROLE_TOKEN,
  OLD_ROLE_KEYS,
  OLD_ROLE_TOKEN_MAP,
  normalizeRoleToken,
  isOldPteRoleKey,
  isOldPteStudentRoleToken,
  mapPteOrgRoleToken,
  mapPteApplicantRoleToken,
  migrateRoleAliasRow,
  migrateRoleTokenArray,
  migrateMembershipRow,
  migrateMembershipsDocument,
  migrateRoleRows,
  migratePteApplicantDocument,
  migrateRowsByKind,
  migrateJsonFiles,
  migrateMongo
};
