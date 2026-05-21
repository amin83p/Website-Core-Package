/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const SYMBOL_DOCS = [
  {
    id: 'SYM_EMAIL_MANAGEMENT_920200',
    name: 'EMAIL_MANAGEMENT',
    type: 'class',
    value: 'bi bi-envelope-at-fill',
    tags: ['EMAIL_MANAGEMENT', '920200'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_EMAIL_TEMPLATES_920210',
    name: 'EMAIL_TEMPLATES',
    type: 'class',
    value: 'bi bi-envelope-paper-fill',
    tags: ['EMAIL_TEMPLATES', '920210'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_EMAIL_LEDGER_920212',
    name: 'EMAIL_LEDGER',
    type: 'class',
    value: 'bi bi-journal-check',
    tags: ['EMAIL_LEDGER', '920212'],
    orgId: 'SYSTEM'
  }
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = { uri: '', db: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
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

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function normalizeTags(tags = []) {
  const seen = new Set();
  const out = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const clean = String(tag || '').trim();
    if (!clean) continue;
    const key = clean.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function buildGlobalNameFilter(symbolName) {
  return {
    name: { $regex: new RegExp(`^${escapeRegex(symbolName)}$`, 'i') },
    $or: [
      { orgId: 'SYSTEM' },
      { orgId: { $exists: false } },
      { orgId: null },
      { orgId: '' }
    ]
  };
}

async function upsertSymbol(collection, seedDoc) {
  const existingById = await collection.findOne({ id: String(seedDoc.id || '') });
  const existingByName = existingById ? null : await collection.findOne(buildGlobalNameFilter(seedDoc.name));
  const existing = existingById || existingByName;

  if (!existing) {
    const next = {
      ...seedDoc,
      tags: normalizeTags(seedDoc.tags),
      audit: buildAudit(null)
    };
    await collection.insertOne(next);
    console.log(`Inserted symbol ${next.name} (${next.id}).`);
    return next;
  }

  const next = {
    ...seedDoc,
    id: String(existing.id || seedDoc.id),
    orgId: 'SYSTEM',
    tags: normalizeTags(seedDoc.tags),
    audit: buildAudit(existing.audit)
  };

  await collection.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${next.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(
    args.uri
    || process.env.MONGODB_URI
    || process.env.MONGO_URI
  ).trim();

  if (!uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  const dbName = String(
    args.db
    || process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbNameFromUri(uri)
    || 'app'
  ).trim();

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const symbols = db.collection('symbols');
    for (const doc of SYMBOL_DOCS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertSymbol(symbols, doc);
    }
    console.log('Email Management symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Email Management symbol seed failed: ${error.message}`);
  process.exit(1);
});

