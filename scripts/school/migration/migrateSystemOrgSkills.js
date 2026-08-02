#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  connectMongo,
  disconnectMongo,
  getMongoCollection
} = require('../../../MVC/infrastructure/mongo/mongoConnection');
const skillCatalogService = require('../../../packages/school/MVC/services/school/skillCatalogService');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const DEFAULT_ORG_ID = '900000';
const ACTOR = 'SYS_ROOT_001';
const REPORT_PATH_DEFAULT = path.join(ROOT_DIR, 'data/school/migrateSystemOrgSkills.report.json');

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
    orgId: '',
    reportPath: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (['--uri', '-u'].includes(token)) output.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) output.db = argv[++index] || '';
    else if (['--org', '-o'].includes(token)) output.orgId = argv[++index] || '';
    else if (token === '--report') output.reportPath = argv[++index] || '';
    else if (token.startsWith('--uri=')) output.uri = token.slice(6);
    else if (token.startsWith('--db=')) output.db = token.slice(5);
    else if (token.startsWith('--org=')) output.orgId = token.slice(6);
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
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const orgId = String(args.orgId || process.env.SCHOOL_DEFAULT_ORG_ID || DEFAULT_ORG_ID).trim();
  const reportPath = String(args.reportPath || REPORT_PATH_DEFAULT).trim();

  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const collection = getMongoCollection('schoolSkills');
    const systemRows = await collection.find({ orgId: 'SYSTEM' }).toArray();
    const targetBefore = await collection.find({ orgId }).toArray();
    const report = {
      migrationId: 'migrate-system-org-skills-v1',
      apply: args.apply,
      orgId,
      targetCountBefore: targetBefore.length,
      systemCountBefore: systemRows.length,
      systemCodes: systemRows.map((row) => String(row?.code || '').trim()).filter(Boolean),
      targetCountAfter: targetBefore.length,
      removedSystemCount: 0,
      seededTargetCount: 0
    };

    if (args.apply) {
      const seeded = await skillCatalogService.ensureOrgDefaultSkills(orgId, ACTOR);
      report.seededTargetCount = seeded.length;
      const deleteResult = await collection.deleteMany({ orgId: 'SYSTEM' });
      report.removedSystemCount = Number(deleteResult?.deletedCount || 0);
      report.targetCountAfter = await collection.countDocuments({ orgId });
    }

    await writeReport(reportPath, report);
    console.log(`Skill org-scope migration ${args.apply ? 'applied' : 'dry-run'} for org=${orgId}.`);
    console.log(`Target org skills before: ${report.targetCountBefore}`);
    console.log(`SYSTEM org skills found: ${report.systemCountBefore}`);
    if (args.apply) {
      console.log(`Seeded target org skills: ${report.seededTargetCount}`);
      console.log(`Removed SYSTEM org skills: ${report.removedSystemCount}`);
      console.log(`Target org skills after: ${report.targetCountAfter}`);
    } else {
      console.log('Re-run with --apply to seed the target org and remove SYSTEM org skill rows.');
    }
    console.log(`Report: ${reportPath}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`Skill org-scope migration failed: ${error.message}`);
  process.exit(1);
});
