#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { MongoClient } = require('mongodb');

const SETTINGS_PATH = path.resolve(__dirname, '..', '..', 'data', 'systemSettings.json');
const SYSTEM_SETTINGS_COLLECTION = 'systemSettings';
const LEGACY_APP_KEYS = [
  'mongoUri',
  'mongodbUri',
  'mongoDb',
  'mongoDatabase',
  'dataBackendMode'
];

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > -1) {
      out[token.slice(2, eq).trim()] = token.slice(eq + 1).trim();
      continue;
    }
    const key = token.slice(2).trim();
    const next = String(argv[i + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  try {
    const normalized = raw.startsWith('mongodb://') || raw.startsWith('mongodb+srv://')
      ? raw
      : `mongodb://${raw}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function scrubSettingsObject(settings = {}) {
  const next = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? JSON.parse(JSON.stringify(settings))
    : {};
  const removed = [];
  const app = next.app && typeof next.app === 'object' && !Array.isArray(next.app)
    ? next.app
    : null;
  if (!app) return { next, removed };

  LEGACY_APP_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(app, key)) {
      delete app[key];
      removed.push(`app.${key}`);
    }
  });

  return { next, removed };
}

async function scrubJsonSettings({ apply = false, settingsPath = SETTINGS_PATH } = {}) {
  const result = {
    target: settingsPath,
    exists: false,
    removed: [],
    changed: false,
    applied: false
  };

  let raw = '';
  try {
    raw = await fs.readFile(settingsPath, 'utf8');
    result.exists = true;
  } catch (error) {
    if (error?.code === 'ENOENT') return result;
    throw error;
  }

  const parsed = JSON.parse(raw);
  const scrubbed = scrubSettingsObject(parsed);
  result.removed = scrubbed.removed;
  result.changed = scrubbed.removed.length > 0;

  if (apply && result.changed) {
    await fs.writeFile(settingsPath, `${JSON.stringify(scrubbed.next, null, 2)}\n`, 'utf8');
    result.applied = true;
  }

  return result;
}

function buildLegacyExistsQuery() {
  return {
    $or: LEGACY_APP_KEYS.map((key) => ({ [`app.${key}`]: { $exists: true } }))
  };
}

function buildUnsetPayload() {
  return LEGACY_APP_KEYS.reduce((out, key) => {
    out[`app.${key}`] = '';
    return out;
  }, {});
}

async function scrubMongoSettings({ apply = false, uri = '', dbName = '' } = {}) {
  const result = {
    configured: Boolean(uri),
    dbName: dbName || '',
    matched: 0,
    modified: 0,
    applied: false,
    skippedReason: ''
  };

  if (!uri) {
    result.skippedReason = 'MONGODB_URI is not configured; Mongo scrub skipped.';
    return result;
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000
  });

  await client.connect();
  try {
    const db = client.db(dbName || inferDbNameFromUri(uri) || 'app');
    result.dbName = db.databaseName;
    const collection = db.collection(SYSTEM_SETTINGS_COLLECTION);
    const query = buildLegacyExistsQuery();
    result.matched = await collection.countDocuments(query);
    if (apply && result.matched > 0) {
      const update = await collection.updateMany(query, { $unset: buildUnsetPayload() });
      result.modified = Number(update.modifiedCount || 0);
      result.applied = true;
    }
  } finally {
    await client.close();
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === 'true';
  const settingsPath = path.resolve(String(args.settings || SETTINGS_PATH));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();

  const json = await scrubJsonSettings({ apply, settingsPath });
  const mongo = await scrubMongoSettings({ apply, uri, dbName });

  const report = {
    status: 'success',
    mode: apply ? 'apply' : 'dry-run',
    legacyAppKeys: LEGACY_APP_KEYS.map((key) => `app.${key}`),
    json,
    mongo
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[scrub-mongo-settings-secrets][error] ${error.message}`);
  process.exit(1);
});
