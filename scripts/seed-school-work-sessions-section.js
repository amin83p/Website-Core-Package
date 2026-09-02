/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { seedSchoolWorkSessionsSection } = require('../packages/school/scripts/maintenance/seedSchoolWorkSessionsSection');

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
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
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

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await seedSchoolWorkSessionsSection(client.db(dbName));
    console.log(`Work Session Explorer section seed complete (${result.section.action}).`);
    console.log(result.legacyParent.message);
    console.log(result.parent.message);
    console.log(`Symbol ${result.symbol.action}; SCHOOL_TEACHER profiles updated: ${result.access.teacher.updatedProfiles}; SCHOOL_STAFF profiles updated: ${result.access.staff.updatedProfiles}.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Work Session Explorer section seed failed: ${error.message}`);
  process.exit(1);
});
