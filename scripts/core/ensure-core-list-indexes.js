#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { ensureMongoIndexes } = require('../../MVC/infrastructure/mongo/mongoIndexManager');
const { buildMongoClientOptions } = require('../../MVC/infrastructure/mongo/mongoConnection');

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

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
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function resolveConnectionConfig(args = {}) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const settingsPath = path.join(repoRoot, 'data', 'systemSettings.json');
  const settings = readJsonFileSafe(settingsPath) || {};
  const uri = String(
    args.uri
      || process.env.MONGODB_URI
      || process.env.MONGO_URI
      || ''
  ).trim();
  const dbName = String(
    args.db
      || process.env.MONGODB_DB
      || process.env.MONGO_DB
      || inferDbNameFromUri(uri)
      || 'app'
  ).trim();
  return { uri, dbName };
}

const TARGET_COLLECTIONS = new Set([
  'users',
  'persons',
  'organizations',
  'sections',
  'symbols',
  'operations',
  'accesses',
  'accessPolicies',
  'tableSettings',
  'userSettings',
  'scopes',
  'sessions',
  'logs',
  'contracts',
  'orgPolicies',
  'contacts',
  'news',
  'newsletterSubscriptions',
  'subscriptionGroups',
  'tasks',
  'userMemberships',
  'helpArticles'
]);

async function runEnsureCoreListIndexes(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2));
  const env = options.env || process.env;
  const backendConfig = resolveDataBackendConfig(env);
  if (backendConfig.mode !== 'mongo' || !backendConfig.mongo?.ready) {
    console.log('[core:ensure-list-indexes] skipped (DATA_BACKEND is not mongo or Mongo URI is missing).');
    return { skipped: true, reason: 'mongo-not-configured' };
  }

  const config = resolveConnectionConfig(args);
  if (!config.uri) {
    console.log('[core:ensure-list-indexes] skipped (Mongo URI is missing).');
    return { skipped: true, reason: 'missing-uri' };
  }

  const client = new MongoClient(config.uri, {
    ...buildMongoClientOptions({ maxPoolSize: 10, serverSelectionTimeoutMS: 15000 }, config.uri)
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);
    const result = await ensureMongoIndexes(db, { verbose: true });
    const rows = Array.isArray(result?.collections) ? result.collections : [];
    const targetRows = rows.filter((row) => TARGET_COLLECTIONS.has(String(row?.collection || '')));

    console.log('[core:ensure-list-indexes] target summary');
    targetRows.forEach((row) => {
      console.log(`  - ${row.collection}: ok=${row.ok ? 'yes' : 'no'} requested=${row.requested || 0} created=${row.created || 0}${row.error ? ` error=${row.error}` : ''}`);
    });

    return { skipped: false, result, targetRows };
  } finally {
    await client.close();
  }
}

async function main() {
  loadLocalEnvFile();
  await runEnsureCoreListIndexes();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[core:ensure-list-indexes][error] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runEnsureCoreListIndexes,
  TARGET_COLLECTIONS,
  loadLocalEnvFile
};

