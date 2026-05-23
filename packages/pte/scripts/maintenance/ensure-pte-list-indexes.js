#!/usr/bin/env node

const { MongoClient } = require('mongodb');
const { ensureMongoIndexes } = require('../../../../MVC/infrastructure/mongo/mongoIndexManager');

const SCRIPT_ID = 'packages/pte/scripts/maintenance/ensure-pte-list-indexes.js';

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

function printHelp() {
  console.log('Usage: node packages/pte/scripts/maintenance/ensure-pte-list-indexes.js [--uri <mongoUri>] [--db <dbName>]');
  console.log('Ensures key list indexes for PTE list/picker collections and prints a target summary.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true' || args.h === 'true') {
    printHelp();
    return;
  }

  const config = resolveConnectionConfig(args);
  if (!config.uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);
    const result = await ensureMongoIndexes(db, { verbose: true });
    const rows = Array.isArray(result?.collections) ? result.collections : [];
    const targets = new Set(['pteApplicants', 'pteTeachers', 'pteCourses']);
    const targetRows = rows.filter((row) => targets.has(String(row?.collection || '')));

    console.log(`[${SCRIPT_ID}] target summary`);
    targetRows.forEach((row) => {
      console.log(`  - ${row.collection}: ok=${row.ok ? 'yes' : 'no'} requested=${row.requested || 0} created=${row.created || 0}${row.error ? ` error=${row.error}` : ''}`);
    });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[pte:ensure-list-indexes][error] ${error.message}`);
  process.exitCode = 1;
});
