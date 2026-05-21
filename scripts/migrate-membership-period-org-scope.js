/* eslint-disable no-console */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { MongoClient } = require('mongodb');
const { normalizeMembershipPayload } = require('../MVC/services/security/entitlementService');

const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');
const JSON_PATH = path.join(ROOT_DIR, 'data', 'userMemberships.json');
const MIGRATION_USER = 'membership_period_org_scope_migration';
const NOW_ISO = new Date().toISOString();

function parseArgs(argv) {
  const out = {
    mode: 'auto',
    uri: '',
    db: '',
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if ((token === '--mode' || token === '-m') && next) {
      out.mode = next.toLowerCase();
      i += 1;
      continue;
    }
    if ((token === '--uri' || token === '-u') && next) {
      out.uri = next;
      i += 1;
      continue;
    }
    if ((token === '--db' || token === '-d') && next) {
      out.db = next;
      i += 1;
      continue;
    }
    if (token === '--dry-run' || token === '--dry') {
      out.dryRun = true;
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
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function normalizeMembershipDocument(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalized = normalizeMembershipPayload({
    userId: source.userId,
    orgId: source.orgId,
    active: source.active !== false,
    periods: source.periods,
    notes: source.notes,
    source: source.source || {}
  });

  const auditIn = source.audit && typeof source.audit === 'object' ? source.audit : {};
  const createUser = String(auditIn.createUser || '').trim() || MIGRATION_USER;
  const createDateTime = String(auditIn.createDateTime || '').trim() || NOW_ISO;

  return {
    ...source,
    ...normalized,
    id: source.id,
    status: normalized.summary?.status || 'no_period',
    audit: {
      ...auditIn,
      createUser,
      createDateTime,
      lastUpdateUser: MIGRATION_USER,
      lastUpdateDateTime: NOW_ISO
    }
  };
}

function isChanged(beforeRow, afterRow) {
  const before = JSON.stringify({
    orgId: beforeRow?.orgId || null,
    periods: Array.isArray(beforeRow?.periods) ? beforeRow.periods : [],
    summary: beforeRow?.summary || {},
    status: beforeRow?.status || ''
  });
  const after = JSON.stringify({
    orgId: afterRow?.orgId || null,
    periods: Array.isArray(afterRow?.periods) ? afterRow.periods : [],
    summary: afterRow?.summary || {},
    status: afterRow?.status || ''
  });
  return before !== after;
}

async function migrateJson({ dryRun = false } = {}) {
  let rows = [];
  try {
    const raw = await fsp.readFile(JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('JSON membership file not found. Skipping JSON migration.');
      return { inspected: 0, changed: 0, applied: false };
    }
    throw error;
  }

  let changed = 0;
  const nextRows = rows.map((row) => {
    const next = normalizeMembershipDocument(row);
    if (isChanged(row, next)) changed += 1;
    return next;
  });

  if (!dryRun && changed > 0) {
    await fsp.writeFile(JSON_PATH, JSON.stringify(nextRows, null, 2));
  }

  return {
    inspected: rows.length,
    changed,
    applied: !dryRun && changed > 0
  };
}

async function migrateMongo({ uri, dbName, dryRun = false } = {}) {
  if (!uri) {
    console.log('Mongo URI unavailable. Skipping Mongo migration.');
    return { inspected: 0, changed: 0, applied: false };
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collection = db.collection('userMemberships');
    const rows = await collection.find({}).toArray();

    let changed = 0;
    for (const row of rows) {
      const next = normalizeMembershipDocument(row);
      if (!isChanged(row, next)) continue;
      changed += 1;
      if (dryRun) continue;
      const { _id, ...toSet } = next;
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: row._id }, { $set: toSet });
    }

    return {
      inspected: rows.length,
      changed,
      applied: !dryRun && changed > 0
    };
  } finally {
    await client.close();
  }
}

function resolveMode(mode, hasMongoUri) {
  const token = String(mode || 'auto').trim().toLowerCase();
  if (token === 'json') return 'json';
  if (token === 'mongo') return 'mongo';
  if (token === 'both') return 'both';
  if (hasMongoUri) return 'both';
  return 'json';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(
    args.uri
    || process.env.MONGODB_URI
    || process.env.MONGO_URI
  ).trim();
  const dbName = String(
    args.db
    || process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbNameFromUri(uri)
    || 'app'
  ).trim();

  const mode = resolveMode(args.mode, Boolean(uri));
  console.log(`Membership period-org migration starting. mode=${mode}, dryRun=${args.dryRun ? 'true' : 'false'}`);

  const results = {};
  if (mode === 'json' || mode === 'both') {
    results.json = await migrateJson({ dryRun: args.dryRun });
  }
  if (mode === 'mongo' || mode === 'both') {
    results.mongo = await migrateMongo({ uri, dbName, dryRun: args.dryRun });
  }

  console.log('Migration summary:', JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(`Membership period-org migration failed: ${error.message}`);
  process.exit(1);
});

