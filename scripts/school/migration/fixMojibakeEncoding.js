#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const {
  connectMongo,
  disconnectMongo,
  getMongoCollection
} = require('../../../MVC/infrastructure/mongo/mongoConnection');
const {
  fixMojibakeDeep,
  containsMojibake,
  fixMojibakeText
} = require('../../../packages/school/MVC/utils/mojibakeTextFix');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REPORT_PATH_DEFAULT = path.join(ROOT_DIR, 'data/school/fixMojibakeEncoding.report.json');
const MIGRATION_ID = 'fix-mojibake-encoding-v1';

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = text.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv = []) {
  const output = {
    apply: argv.includes('--apply'),
    uri: '',
    db: '',
    reportPath: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (token === '--apply') continue;
    else if (['--uri', '-u'].includes(token)) output.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) output.db = argv[++index] || '';
    else if (token === '--report') output.reportPath = argv[++index] || '';
    else if (token.startsWith('--uri=')) output.uri = token.slice(6);
    else if (token.startsWith('--db=')) output.db = token.slice(5);
    else if (token.startsWith('--report=')) output.reportPath = token.slice(9);
  }
  return output;
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

async function writeReport(reportPath, report) {
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function fixJsonFiles({ apply, report }) {
  const targets = [
    path.join(ROOT_DIR, 'data/school/subjects.json'),
    path.join(ROOT_DIR, 'data/benchpath/reference/source-fragments.json')
  ];
  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const raw = await fsPromises.readFile(filePath, 'utf8');
    if (!containsMojibake(raw)) continue;
    const fixed = fixMojibakeText(raw);
    report.jsonFiles.push({
      path: filePath,
      action: apply ? 'fixed' : 'would_fix'
    });
    if (apply) await fsPromises.writeFile(filePath, fixed, 'utf8');
  }
}

async function fixMongoCollections({ apply, uri, dbName, report }) {
  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const db = getMongoCollection('schoolPrograms').s.db;
    const collections = await db.listCollections().toArray();
    const names = collections
      .map((row) => String(row?.name || '').trim())
      .filter((name) => name.startsWith('school') || name === 'actionStates')
      .sort();

    for (const collectionName of names) {
      const collection = getMongoCollection(collectionName);
      const cursor = collection.find({});
      // eslint-disable-next-line no-await-in-loop
      for await (const doc of cursor) {
        if (!containsMojibake(doc)) continue;
        const fixed = fixMojibakeDeep(doc);
        const row = {
          collection: collectionName,
          id: String(doc?.id || doc?._id || '').trim(),
          action: apply ? 'fixed' : 'would_fix'
        };
        report.mongoRows.push(row);
        if (apply) {
          const { _id, ...rest } = fixed;
          // eslint-disable-next-line no-await-in-loop
          await collection.replaceOne({ _id: doc._id }, { ...rest, _id: doc._id });
        }
      }
    }
  } finally {
    await disconnectMongo();
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(args.reportPath || REPORT_PATH_DEFAULT);
  const report = {
    migrationId: MIGRATION_ID,
    mode: args.apply ? 'apply' : 'dry-run',
    startedAt: new Date().toISOString(),
    jsonFiles: [],
    mongoRows: [],
    completedAt: null
  };

  await fixJsonFiles({ apply: args.apply, report });

  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (uri) {
    const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
    await fixMongoCollections({ apply: args.apply, uri, dbName, report });
  } else {
    report.mongoSkipped = 'Mongo URI missing; only JSON files were scanned.';
  }

  report.completedAt = new Date().toISOString();
  await writeReport(reportPath, report);

  console.log(`Mojibake fix ${report.mode} complete.`);
  console.log(`JSON files touched: ${report.jsonFiles.length}`);
  console.log(`Mongo documents touched: ${report.mongoRows.length}`);
  console.log(`Report: ${reportPath}`);
  if (!args.apply) console.log('Dry run only. Re-run with --apply to write fixes.');
}

main().catch((error) => {
  console.error(`Mojibake fix failed: ${error.message}`);
  process.exit(1);
});
