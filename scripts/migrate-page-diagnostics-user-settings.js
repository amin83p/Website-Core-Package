#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const ROOT_DIR = path.resolve(__dirname, '..');

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
  const out = { apply: false, uri: '', db: '', backend: 'auto', help: false };
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
      continue;
    }
    if (token === '--backend' && next) {
      out.backend = next.toLowerCase();
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

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonArray(filePath, rows) {
  fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeUserId(value = '') {
  return String(value || '').trim();
}

function getLegacyPageDiagnosticsEnabled(user = {}) {
  const enabled = user?.preferences?.pageDiagnostics?.enabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

function hasStoredPageDiagnosticsEnabled(settings = {}) {
  return typeof settings?.pageDiagnostics?.enabled === 'boolean';
}

function buildMigratedRecord(existing = null, userId = '', enabled = true) {
  const now = new Date().toISOString();
  const existingSettings = clonePlainObject(existing?.settings);
  const existingAudit = isPlainObject(existing?.audit) ? existing.audit : {};
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    id: userId,
    userId,
    settings: {
      ...existingSettings,
      pageDiagnostics: {
        ...(isPlainObject(existingSettings.pageDiagnostics) ? existingSettings.pageDiagnostics : {}),
        enabled
      }
    },
    audit: {
      createUser: String(existingAudit.createUser || ACTOR),
      createDateTime: String(existingAudit.createDateTime || now),
      lastUpdateUser: ACTOR,
      lastUpdateDateTime: now
    }
  };
}

function planJsonMigration(users = [], userSettings = []) {
  const rows = Array.isArray(userSettings) ? userSettings.map((row) => ({ ...row })) : [];
  const report = {
    scannedUsers: 0,
    candidates: 0,
    inserted: 0,
    updated: 0,
    skippedExisting: 0,
    skippedMissingUserId: 0
  };

  for (const user of Array.isArray(users) ? users : []) {
    report.scannedUsers += 1;
    const enabled = getLegacyPageDiagnosticsEnabled(user);
    if (enabled === undefined) continue;
    report.candidates += 1;

    const userId = normalizeUserId(user.id || user.userId);
    if (!userId) {
      report.skippedMissingUserId += 1;
      continue;
    }

    const index = rows.findIndex((row) => normalizeUserId(row.userId || row.id) === userId);
    const existing = index >= 0 ? rows[index] : null;
    if (hasStoredPageDiagnosticsEnabled(existing?.settings)) {
      report.skippedExisting += 1;
      continue;
    }

    const next = buildMigratedRecord(existing, userId, enabled);
    if (index >= 0) {
      rows[index] = next;
      report.updated += 1;
    } else {
      rows.push(next);
      report.inserted += 1;
    }
  }

  return { rows, report };
}

async function migrateJson({ apply = false } = {}) {
  const usersPath = path.join(ROOT_DIR, 'data', 'users.json');
  const userSettingsPath = path.join(ROOT_DIR, 'data', 'userSettings.json');
  const users = readJsonArray(usersPath);
  const userSettings = readJsonArray(userSettingsPath);
  const { rows, report } = planJsonMigration(users, userSettings);
  if (apply) writeJsonArray(userSettingsPath, rows);
  return { backend: 'json', mode: apply ? 'apply' : 'dry-run', ...report };
}

async function migrateMongo({ uri = '', dbName = '', apply = false } = {}) {
  if (!uri) throw new Error('Mongo URI is missing for Mongo migration.');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName || inferDbNameFromUri(uri) || 'app');
    const users = db.collection('users');
    const userSettings = db.collection('userSettings');
    const report = {
      backend: 'mongo',
      mode: apply ? 'apply' : 'dry-run',
      scannedUsers: 0,
      candidates: 0,
      inserted: 0,
      updated: 0,
      skippedExisting: 0,
      skippedMissingUserId: 0
    };

    const candidates = await users.find({
      'preferences.pageDiagnostics.enabled': { $type: 'bool' }
    }).toArray();

    for (const user of candidates) {
      report.scannedUsers += 1;
      const enabled = getLegacyPageDiagnosticsEnabled(user);
      if (enabled === undefined) continue;
      report.candidates += 1;

      const userId = normalizeUserId(user.id || user.userId);
      if (!userId) {
        report.skippedMissingUserId += 1;
        continue;
      }

      const existing = await userSettings.findOne({
        $or: [{ id: userId }, { userId }]
      });
      if (hasStoredPageDiagnosticsEnabled(existing?.settings)) {
        report.skippedExisting += 1;
        continue;
      }

      const next = buildMigratedRecord(existing, userId, enabled);
      if (!apply) {
        if (existing) report.updated += 1;
        else report.inserted += 1;
        continue;
      }

      if (existing) {
        const { _id, ...toSet } = next;
        await userSettings.updateOne({ _id: existing._id }, { $set: toSet });
        report.updated += 1;
      } else {
        await userSettings.insertOne(next);
        report.inserted += 1;
      }
    }

    return report;
  } finally {
    await client.close();
  }
}

function resolveBackends(args = {}, uri = '') {
  const backend = String(args.backend || 'auto').toLowerCase();
  if (backend === 'json' || backend === 'mongo' || backend === 'both') return backend;
  return uri ? 'mongo' : 'json';
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/migrate-page-diagnostics-user-settings.js [--apply] [--backend json|mongo|both] [--uri <mongo-uri>] [--db <db-name>]');
    console.log('Default mode is dry-run. Legacy users.preferences are not deleted.');
    return;
  }

  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const backend = resolveBackends(args, uri);
  const reports = [];

  if (backend === 'json' || backend === 'both') {
    reports.push(await migrateJson({ apply: args.apply }));
  }
  if (backend === 'mongo' || backend === 'both') {
    reports.push(await migrateMongo({ uri, dbName, apply: args.apply }));
  }

  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', reports }, null, 2));
  if (!args.apply) console.log('Dry-run only. Re-run with --apply to write changes.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Page diagnostics user settings migration failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  getLegacyPageDiagnosticsEnabled,
  hasStoredPageDiagnosticsEnabled,
  buildMigratedRecord,
  planJsonMigration,
  migrateJson,
  migrateMongo
};
