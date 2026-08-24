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
const { parseLowerClbBandFromText } = require('../../../packages/school/MVC/utils/clbSubjectBandParser');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const DEFAULT_ORG_ID = '900000';
const ACTOR = 'SYS_ROOT_001';
const MIGRATION_ID = 'backfill-subject-clb-config-v1';
const SUBJECTS_JSON_PATH = path.join(ROOT_DIR, 'data/school/subjects.json');
const REPORT_PATH_DEFAULT = path.join(ROOT_DIR, 'data/school/backfillSubjectClbConfig.report.json');
const CLB_SKILLS = ['listening', 'speaking', 'reading', 'writing'];

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
    backend: 'mongo',
    uri: '',
    db: '',
    orgId: '',
    reportPath: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (token === '--apply') continue;
    else if (token === '--json') output.backend = 'json';
    else if (['--uri', '-u'].includes(token)) output.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(token)) output.db = argv[++index] || '';
    else if (['--org', '-o'].includes(token)) output.orgId = argv[++index] || '';
    else if (token === '--report') output.reportPath = argv[++index] || '';
    else if (token.startsWith('--uri=')) output.uri = token.slice(6);
    else if (token.startsWith('--db=')) output.db = token.slice(5);
    else if (token.startsWith('--org=')) output.orgId = token.slice(6);
    else if (token.startsWith('--report=')) output.reportPath = token.slice(9);
    else if (token === '--mongo') output.backend = 'mongo';
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

function hasExistingClbLevel(subject) {
  const level = subject?.configuration?.clb?.level;
  return level !== undefined && level !== null && String(level).trim() !== '';
}

function buildClbConfig(band) {
  const skills = {};
  CLB_SKILLS.forEach((skill) => {
    skills[skill] = band;
  });
  return { level: band, skills };
}

function resolveBand(subject) {
  const code = String(subject?.code || '').trim();
  const title = String(subject?.title || '').trim();
  return parseLowerClbBandFromText(code) ?? parseLowerClbBandFromText(title);
}

async function writeReport(reportPath, report) {
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function backfillJsonSubjects({ apply, reportPath }) {
  const raw = await fsPromises.readFile(SUBJECTS_JSON_PATH, 'utf8');
  const subjects = JSON.parse(raw);
  const report = {
    migrationId: MIGRATION_ID,
    backend: 'json',
    mode: apply ? 'apply' : 'dry-run',
    subjectsPath: SUBJECTS_JSON_PATH,
    processed: 0,
    updated: 0,
    skippedExisting: 0,
    noMatch: 0,
    rows: []
  };

  for (const subject of subjects) {
    report.processed += 1;
    const row = {
      id: String(subject?.id || '').trim(),
      code: String(subject?.code || '').trim(),
      title: String(subject?.title || '').trim(),
      action: 'none'
    };

    if (hasExistingClbLevel(subject)) {
      report.skippedExisting += 1;
      row.action = 'skipped_existing';
      report.rows.push(row);
      continue;
    }

    const band = resolveBand(subject);
    if (band === null) {
      report.noMatch += 1;
      row.action = 'no_match';
      report.rows.push(row);
      continue;
    }

    row.action = apply ? 'backfill' : 'would_backfill';
    row.band = band;
    report.updated += 1;

    if (apply) {
      const configuration = (subject.configuration && typeof subject.configuration === 'object')
        ? { ...subject.configuration }
        : {};
      configuration.clb = buildClbConfig(band);
      subject.configuration = configuration;
    }

    report.rows.push(row);
  }

  if (apply) {
    await fsPromises.writeFile(SUBJECTS_JSON_PATH, `${JSON.stringify(subjects, null, 2)}\n`, 'utf8');
  }

  await writeReport(reportPath, report);
  return report;
}

async function backfillMongoSubjects({ apply, uri, dbName, orgId, reportPath }) {
  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const collection = getMongoCollection('schoolSubjects');
    const subjects = await collection.find({ orgId }).sort({ id: 1 }).toArray();
    const report = {
      migrationId: MIGRATION_ID,
      backend: 'mongo',
      mode: apply ? 'apply' : 'dry-run',
      orgId,
      collection: 'schoolSubjects',
      processed: 0,
      updated: 0,
      skippedExisting: 0,
      noMatch: 0,
      rows: []
    };

    for (const subject of subjects) {
      report.processed += 1;
      const row = {
        id: String(subject?.id || subject?._id || '').trim(),
        code: String(subject?.code || '').trim(),
        title: String(subject?.title || '').trim(),
        action: 'none'
      };

      if (hasExistingClbLevel(subject)) {
        report.skippedExisting += 1;
        row.action = 'skipped_existing';
        report.rows.push(row);
        continue;
      }

      const band = resolveBand(subject);
      if (band === null) {
        report.noMatch += 1;
        row.action = 'no_match';
        report.rows.push(row);
        continue;
      }

      row.action = apply ? 'backfill' : 'would_backfill';
      row.band = band;
      report.updated += 1;

      if (apply) {
        const appliedAt = new Date().toISOString();
        const configuration = (subject.configuration && typeof subject.configuration === 'object')
          ? { ...subject.configuration }
          : {};
        configuration.clb = buildClbConfig(band);
        // eslint-disable-next-line no-await-in-loop
        await collection.updateOne(
          { _id: subject._id, orgId },
          {
            $set: {
              configuration,
              'audit.lastUpdateUser': ACTOR,
              'audit.lastUpdateDateTime': appliedAt,
              clbBackfillAudit: {
                migrationId: MIGRATION_ID,
                appliedAt,
                appliedBy: ACTOR,
                band
              }
            }
          }
        );
      }

      report.rows.push(row);
    }

    await writeReport(reportPath, report);
    return report;
  } finally {
    await disconnectMongo();
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(args.reportPath || REPORT_PATH_DEFAULT);

  if (args.backend === 'json') {
    const report = await backfillJsonSubjects({ apply: args.apply, reportPath });
    console.log(`Subject CLB backfill ${report.mode} complete (json).`);
    console.log(`Processed: ${report.processed}, updated: ${report.updated}, skipped existing: ${report.skippedExisting}, no match: ${report.noMatch}`);
    console.log(`Report: ${reportPath}`);
    if (!args.apply) console.log('Dry run only. Re-run with --apply to write subjects.json.');
    return;
  }

  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const orgId = String(args.orgId || DEFAULT_ORG_ID).trim();

  const report = await backfillMongoSubjects({
    apply: args.apply,
    uri,
    dbName,
    orgId,
    reportPath
  });

  console.log(`Subject CLB backfill ${report.mode} complete (mongo, org=${orgId}).`);
  console.log(`Processed: ${report.processed}, updated: ${report.updated}, skipped existing: ${report.skippedExisting}, no match: ${report.noMatch}`);
  console.log(`Report: ${reportPath}`);
  if (!args.apply) console.log('Dry run only. Re-run with --apply to update schoolSubjects in MongoDB.');
}

main().catch((error) => {
  console.error(`Subject CLB backfill failed: ${error.message}`);
  process.exit(1);
});
