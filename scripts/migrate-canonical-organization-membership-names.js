/* eslint-disable no-console */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const {
  buildOrganizationDisplayMap,
  canonicalizeMembershipOrganizationName,
  canonicalizeMembershipOrganizationNames
} = require('../MVC/utils/organizationDisplay');

const ROOT_DIR = path.resolve(__dirname, '..');
const JSON_TARGETS = Object.freeze(['persons.json', 'users.json']);

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

async function readJsonArray(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array.`);
  return parsed;
}

function filterOrganizationMap(organizationMap = new Map(), orgId = '') {
  const target = String(orgId || '').trim();
  if (!target) return organizationMap;
  const filtered = new Map();
  const row = organizationMap.get(target);
  if (row) filtered.set(target, row);
  return filtered;
}

function migrateMembershipDocument(doc = {}, organizationMap = new Map()) {
  if (!doc || typeof doc !== 'object') return { value: doc, changed: false, changedCount: 0 };
  if (!Array.isArray(doc.organizations)) return { value: doc, changed: false, changedCount: 0 };

  const result = canonicalizeMembershipOrganizationNames(doc.organizations, organizationMap);
  if (!result.changed) return { value: doc, changed: false, changedCount: 0 };

  return {
    value: {
      ...doc,
      organizations: result.value
    },
    changed: true,
    changedCount: result.changedCount
  };
}

function migrateUserOrganizationSnapshots(user = {}, organizationMap = new Map()) {
  if (!user || typeof user !== 'object') return { value: user, changed: false, changedCount: 0 };

  let next = user;
  let changed = false;
  let changedCount = 0;

  const applyArrayResult = (field, result) => {
    if (!result.changed) return;
    if (next === user) next = { ...user };
    next[field] = result.value;
    changed = true;
    changedCount += Number(result.changedCount || 0);
  };

  applyArrayResult('organizations', canonicalizeMembershipOrganizationNames(user.organizations, organizationMap));
  applyArrayResult('allowedOrgs', canonicalizeMembershipOrganizationNames(user.allowedOrgs, organizationMap));

  if (user.activeOrganization && typeof user.activeOrganization === 'object') {
    const activeResult = canonicalizeMembershipOrganizationName(user.activeOrganization, organizationMap);
    if (activeResult.changed) {
      if (next === user) next = { ...user };
      next.activeOrganization = activeResult.value;
      changed = true;
      changedCount += 1;
    }
  }

  const directOrgId = String(user.orgId || user.organizationId || user.activeOrgId || user.primaryOrgId || '').trim();
  const canonicalName = String(organizationMap.get(directOrgId)?.name || '').trim();
  if (canonicalName) {
    ['orgName', 'organizationName'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(user, field) && String(user[field] || '') !== canonicalName) {
        if (next === user) next = { ...user };
        next[field] = canonicalName;
        changed = true;
        changedCount += 1;
      }
    });
  }

  return { value: next, changed, changedCount };
}

function migrateMembershipRows(rows = [], organizationRows = [], options = {}) {
  const baseMap = organizationRows instanceof Map
    ? organizationRows
    : buildOrganizationDisplayMap(organizationRows);
  const organizationMap = filterOrganizationMap(baseMap, options.orgId);
  let changedCount = 0;
  let membershipChangedCount = 0;

  const value = (Array.isArray(rows) ? rows : []).map((row) => {
    const result = migrateMembershipDocument(row, organizationMap);
    if (result.changed) {
      changedCount += 1;
      membershipChangedCount += Number(result.changedCount || 0);
    }
    return result.value;
  });

  return {
    value,
    changed: changedCount > 0,
    changedCount,
    membershipChangedCount
  };
}

function migrateUserRows(rows = [], organizationRows = [], options = {}) {
  const baseMap = organizationRows instanceof Map
    ? organizationRows
    : buildOrganizationDisplayMap(organizationRows);
  const organizationMap = filterOrganizationMap(baseMap, options.orgId);
  let changedCount = 0;
  let membershipChangedCount = 0;

  const value = (Array.isArray(rows) ? rows : []).map((row) => {
    const result = migrateUserOrganizationSnapshots(row, organizationMap);
    if (result.changed) {
      changedCount += 1;
      membershipChangedCount += Number(result.changedCount || 0);
    }
    return result.value;
  });

  return {
    value,
    changed: changedCount > 0,
    changedCount,
    membershipChangedCount
  };
}

async function migrateJsonFile(fileName, organizationRows, options = {}) {
  const apply = options.apply === true;
  const filePath = path.join(ROOT_DIR, 'data', fileName);
  const rows = await readJsonArray(filePath);
  const result = fileName === 'users.json'
    ? migrateUserRows(rows, organizationRows, options)
    : migrateMembershipRows(rows, organizationRows, options);

  if (apply && result.changed) {
    await fs.writeFile(filePath, `${JSON.stringify(result.value, null, 2)}\n`);
  }

  return {
    target: fileName,
    changed: result.changed,
    changedCount: result.changedCount,
    membershipChangedCount: result.membershipChangedCount
  };
}

async function migrateJsonFiles(options = {}) {
  const organizationRows = await readJsonArray(path.join(ROOT_DIR, 'data', 'organizations.json'));
  const reports = [];
  for (const fileName of JSON_TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    reports.push(await migrateJsonFile(fileName, organizationRows, options));
  }
  return reports;
}

async function migrateMongoMembershipCollection(db, collectionName, organizationMap, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection(collectionName);
  const rows = await collection.find({}, { projection: { organizations: 1 } }).toArray();
  let changedCount = 0;
  let membershipChangedCount = 0;

  for (const row of rows) {
    const result = migrateMembershipDocument(row, organizationMap);
    if (!result.changed) continue;
    changedCount += 1;
    membershipChangedCount += Number(result.changedCount || 0);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne(
        { _id: row._id },
        { $set: { organizations: result.value.organizations } }
      );
    }
  }

  return {
    target: collectionName,
    changed: changedCount > 0,
    changedCount,
    membershipChangedCount
  };
}

async function migrateMongoUsers(db, organizationMap, options = {}) {
  const apply = options.apply === true;
  const collection = db.collection('users');
  const rows = await collection.find({}, {
    projection: {
      organizations: 1,
      allowedOrgs: 1,
      activeOrganization: 1,
      orgName: 1,
      organizationName: 1,
      orgId: 1,
      organizationId: 1,
      activeOrgId: 1,
      primaryOrgId: 1,
      id: 1
    }
  }).toArray();
  let changedCount = 0;
  let membershipChangedCount = 0;

  for (const row of rows) {
    const result = migrateUserOrganizationSnapshots(row, organizationMap);
    if (!result.changed) continue;
    changedCount += 1;
    membershipChangedCount += Number(result.changedCount || 0);
    if (apply) {
      const patch = {};
      ['organizations', 'allowedOrgs', 'activeOrganization', 'orgName', 'organizationName'].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(result.value, field)) patch[field] = result.value[field];
      });
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne(
        { _id: row._id },
        { $set: patch }
      );
    }
  }

  return {
    target: 'users',
    changed: changedCount > 0,
    changedCount,
    membershipChangedCount
  };
}

async function migrateMongo(options = {}) {
  loadLocalEnvFile();
  const { connectMongo, disconnectMongo } = require('../MVC/infrastructure/mongo/mongoConnection');
  const db = await connectMongo({
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)
  });

  try {
    const organizationRows = await db.collection('organizations').find({}).toArray();
    const organizationMap = filterOrganizationMap(buildOrganizationDisplayMap(organizationRows), options.orgId);
    return [
      await migrateMongoMembershipCollection(db, 'persons', organizationMap, options),
      await migrateMongoUsers(db, organizationMap, options)
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
  if (report.changedCount) parts.push(`docs=${report.changedCount}`);
  if (report.membershipChangedCount) parts.push(`memberships=${report.membershipChangedCount}`);
  return parts.join(' ');
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const wantsJson = args.has('--json');
  const wantsMongo = args.has('--mongo');
  const orgIdIndex = argv.findIndex((item) => item === '--org-id');
  return {
    apply: args.has('--apply'),
    includeJson: wantsJson || !wantsMongo,
    includeMongo: wantsMongo || !wantsJson,
    orgId: orgIdIndex >= 0 ? String(argv[orgIdIndex + 1] || '').trim() : ''
  };
}

async function runCli() {
  const options = parseCliArgs();
  const modeLabel = options.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[canonical-org-membership-name-migration] mode=${modeLabel}${options.orgId ? ` orgId=${options.orgId}` : ''}`);

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
    console.error(`[canonical-org-membership-name-migration] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  migrateMembershipDocument,
  migrateMembershipRows,
  migrateUserOrganizationSnapshots,
  migrateUserRows,
  migrateJsonFiles,
  migrateMongo
};
