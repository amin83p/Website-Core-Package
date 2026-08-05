/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../..');

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function resolveDataBackendMode() {
  const mode = String(process.env.DATA_BACKEND || 'json').trim().toLowerCase();
  return mode === 'mongo' ? 'mongo' : 'json';
}

async function bootstrapDataBackend() {
  if (resolveDataBackendMode() !== 'mongo') {
    return { disconnect: async () => {} };
  }
  const { connectMongo, disconnectMongo } = require('../../MVC/infrastructure/mongo/mongoConnection');
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) {
    throw new Error('DATA_BACKEND=mongo but no MONGODB_URI (or legacy MONGO_URI) is configured.');
  }
  const dbName = String(
    process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbName(uri)
    || 'app'
  ).trim();
  await connectMongo({ uri, dbName });
  return {
    disconnect: async () => {
      await disconnectMongo().catch(() => {});
    }
  };
}

function parseArgs(argv = []) {
  const orgIdArg = argv.find((value) => String(value || '').startsWith('--org-id='));
  const classIdArg = argv.find((value) => String(value || '').startsWith('--class-id='));
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    apply: argv.includes('--apply'),
    orgId: orgIdArg ? String(orgIdArg).slice('--org-id='.length).trim() : '',
    classId: classIdArg ? String(classIdArg).slice('--class-id='.length).trim() : ''
  };
}

function printHelp() {
  console.log('Migrate class session IDs to class-scoped format SES-{classId}-{seq}');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/school/migrate-class-session-ids.js --org-id=ORG_ID [--class-id=CLS-...] [--apply] [--json]');
  console.log('');
  console.log('Defaults to dry-run. Pass --apply to persist changes.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.orgId) {
    printHelp();
    throw new Error('--org-id is required.');
  }

  loadLocalEnvFile();
  process.chdir(ROOT_DIR);

  const backend = await bootstrapDataBackend();
  try {
    const sessionIdRemapService = require('../../packages/school/MVC/services/school/sessionIdRemapService');
    const summary = await sessionIdRemapService.migrateClassSessionIdsForOrg(
      args.orgId,
      null,
      {
        dryRun: !args.apply,
        classIds: args.classId ? [args.classId] : []
      }
    );

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(args.apply ? 'Applied class session ID migration.' : 'Dry-run class session ID migration.');
    console.log(`Classes scanned: ${summary.classesScanned}`);
    console.log(`Classes ${args.apply ? 'updated' : 'that would be updated'}: ${summary.classesUpdated}`);
    console.log(`Session ID changes: ${summary.sessionsReassigned}`);
    console.log(`Dependent updates: ${summary.dependentsUpdated}`);
    if (summary.errors.length) {
      console.log('Errors:');
      summary.errors.forEach((row) => {
        console.log(`- ${row.classId} (${row.classTitle}): ${row.message}`);
      });
    }
  } finally {
    await backend.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
