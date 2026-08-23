#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const PARENT_SECTION = {
  id: '883303',
  name: 'SYSTEM_SETTING'
};
const AFTER_SUBSECTION_ID = '100102';

const SECTION_ID = '862453';
const SECTION_NAME = 'USER_SETTINGS';
const SYMBOL_ID = 'SYM_SYSTEM_091';

const SECTION_DOC = {
  id: SECTION_ID,
  name: SECTION_NAME,
  category: 'SYSTEM',
  description: 'Manage saved per-user application settings.',
  homeURL: '/userSettings/',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: true,
  minimumAccessRequirement: 7,
  navigatorSection: false,
  subsections: [],
  related: [],
  operations: [
    { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true }
  ]
};

const USER_SETTINGS_INDEXES = Object.freeze([
  { key: { id: 1 }, options: { name: 'idx_user_settings_id', unique: true } },
  { key: { userId: 1 }, options: { name: 'idx_user_settings_userId', unique: true } },
  { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_user_settings_last_update_dt' } }
]);

function loadLocalEnvFile() {
  try {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

function parseArgs(argv = []) {
  const out = { apply: false, uri: '', db: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--apply') {
      out.apply = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      out.help = true;
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
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function sameMongoId(a, b) {
  return String(a?._id || '') === String(b?._id || '');
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

function buildSymbolDoc() {
  return {
    id: SYMBOL_ID,
    name: SECTION_NAME,
    type: 'class',
    value: 'bi bi-person-gear',
    tags: [
      SECTION_NAME,
      'USER_SETTING',
      SECTION_ID
    ],
    orgId: 'SYSTEM'
  };
}

async function findByName(collection, name) {
  return collection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

async function upsertSection(sections, { apply = false } = {}) {
  const existingById = await sections.findOne({ id: SECTION_ID });
  const existingByName = await findByName(sections, SECTION_NAME);

  if (
    existingById &&
    normalize(existingById.name) !== SECTION_NAME &&
    (!existingByName || !sameMongoId(existingById, existingByName))
  ) {
    throw new Error(`Section id ${SECTION_ID} is already used by ${existingById.name || 'another section'}.`);
  }

  if (existingById && existingByName && !sameMongoId(existingById, existingByName)) {
    throw new Error(`Duplicate USER_SETTINGS sections found (${existingById._id}, ${existingByName._id}). Resolve before seeding.`);
  }

  const existing = existingByName || existingById;
  const next = {
    ...SECTION_DOC,
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    if (apply) await sections.insertOne(next);
    return { action: apply ? 'inserted' : 'would_insert', id: next.id, name: next.name };
  }

  if (apply) await sections.updateOne({ _id: existing._id }, { $set: next });
  return { action: apply ? 'updated' : 'would_update', id: next.id, name: next.name };
}

function insertSubsectionAfter(rows = [], targetId = '', afterId = '') {
  const normalized = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || row || '').trim();
    if (!id || id === targetId || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id });
  }

  const afterIndex = normalized.findIndex((row) => row.id === afterId);
  if (afterIndex >= 0) normalized.splice(afterIndex + 1, 0, { id: targetId });
  else normalized.push({ id: targetId });
  return normalized;
}

async function linkUnderSystemSetting(sections, { apply = false } = {}) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id })
    || await findByName(sections, PARENT_SECTION.name);

  if (!parent) {
    return {
      action: 'warning',
      message: `${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${SECTION_ID}" }.`
    };
  }

  const normalized = insertSubsectionAfter(parent.subsections, SECTION_ID, AFTER_SUBSECTION_ID);

  if (apply) {
    await sections.updateOne(
      { _id: parent._id },
      {
        $set: {
          subsections: normalized,
          'audit.lastUpdateUser': ACTOR,
          'audit.lastUpdateDateTime': NOW
        }
      }
    );
  }

  return {
    action: apply ? 'linked' : 'would_link',
    parentId: String(parent.id || ''),
    childId: SECTION_ID,
    subsections: normalized
  };
}

async function upsertSymbol(symbols, { apply = false } = {}) {
  const symbolDoc = buildSymbolDoc();
  const existingById = await symbols.findOne({ id: SYMBOL_ID });
  const existingByName = await symbols.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(SECTION_NAME)}$`, 'i') },
    $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
  });

  if (
    existingById &&
    normalize(existingById.name) !== SECTION_NAME &&
    (!existingByName || !sameMongoId(existingById, existingByName))
  ) {
    throw new Error(`Symbol id ${SYMBOL_ID} is already used by ${existingById.name || 'another symbol'}.`);
  }

  if (existingById && existingByName && !sameMongoId(existingById, existingByName)) {
    throw new Error(`Duplicate USER_SETTINGS symbols found (${existingById._id}, ${existingByName._id}). Resolve before seeding.`);
  }

  const existing = existingByName || existingById;
  const next = {
    ...symbolDoc,
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    if (apply) await symbols.insertOne(next);
    return { action: apply ? 'inserted' : 'would_insert', id: next.id, name: next.name };
  }

  if (apply) await symbols.updateOne({ _id: existing._id }, { $set: next });
  return { action: apply ? 'updated' : 'would_update', id: next.id, name: next.name };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function indexOptionsMatch(existing, desired) {
  return Boolean(existing)
    && Boolean(desired)
    && stableStringify(existing.key) === stableStringify(desired.key)
    && Boolean(existing.unique) === Boolean(desired.options?.unique);
}

function firstIndexKey(indexSpec = {}) {
  const key = indexSpec?.key && typeof indexSpec.key === 'object' ? Object.keys(indexSpec.key)[0] : '';
  return String(key || '').trim();
}

async function assertUniqueIndexRepairSafe(collection, desired) {
  if (!desired?.options?.unique) return;
  const field = firstIndexKey(desired);
  if (!field) throw new Error(`Cannot verify duplicate keys for index ${desired.options?.name || ''}; index key is empty.`);
  const duplicateSamples = await collection.aggregate([
    {
      $group: {
        _id: { $ifNull: [`$${field}`, null] },
        count: { $sum: 1 },
        examples: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 }
  ], { allowDiskUse: false }).toArray();

  if (duplicateSamples.length > 0) {
    const summary = duplicateSamples
      .map((row) => `${field}=${JSON.stringify(row._id)} count=${row.count}`)
      .join('; ');
    throw new Error(`Cannot repair ${desired.options.name} as a unique index because duplicate keys exist: ${summary}`);
  }
}

async function repairUserSettingsIndexes(collection, { apply = false } = {}) {
  const existingIndexes = await collection.listIndexes().toArray();
  const report = [];

  for (const desired of USER_SETTINGS_INDEXES) {
    const name = desired.options.name;
    const existing = existingIndexes.find((row) => row.name === name);
    const matches = indexOptionsMatch(existing, desired);
    if (matches) {
      report.push({ name, action: 'unchanged' });
      continue;
    }

    await assertUniqueIndexRepairSafe(collection, desired);

    if (!apply) {
      report.push({ name, action: existing ? 'would_drop_recreate' : 'would_create' });
      continue;
    }

    if (existing) await collection.dropIndex(name);
    await collection.createIndex(desired.key, desired.options);
    report.push({ name, action: existing ? 'dropped_recreated' : 'created' });
  }

  return report;
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/seed-user-settings-section.js [--apply] [--uri <mongo-uri>] [--db <db-name>]');
    console.log('Default mode is dry-run. Use --apply to write changes.');
    return;
  }

  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');
    const symbols = db.collection('symbols');
    const userSettings = db.collection('userSettings');
    const report = {
      mode: args.apply ? 'apply' : 'dry-run',
      section: await upsertSection(sections, { apply: args.apply }),
      parent: await linkUnderSystemSetting(sections, { apply: args.apply }),
      symbol: await upsertSymbol(symbols, { apply: args.apply }),
      indexes: await repairUserSettingsIndexes(userSettings, { apply: args.apply })
    };
    console.log(JSON.stringify(report, null, 2));
    if (!args.apply) console.log('Dry-run only. Re-run with --apply to write changes.');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`User settings section seed failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  SECTION_ID,
  SECTION_NAME,
  SYMBOL_ID,
  SECTION_DOC,
  USER_SETTINGS_INDEXES,
  insertSubsectionAfter,
  repairUserSettingsIndexes
};
