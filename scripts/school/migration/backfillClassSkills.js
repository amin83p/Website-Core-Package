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
const { CLB_SKILL_CODES } = require('../../../packages/school/config/skillDefinitions');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const DEFAULT_ORG_ID = '900000';
const ACTOR = 'SYS_ROOT_001';
const MIGRATION_ID = 'backfill-class-skills-v1';
const REPORT_PATH_DEFAULT = path.join(ROOT_DIR, 'data/school/backfillClassSkills.report.json');

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

function hasSkillIdsField(row) {
  return Object.prototype.hasOwnProperty.call(row || {}, 'skillIds');
}

function buildClassReportRows(classes = []) {
  return (Array.isArray(classes) ? classes : []).map((row) => ({
    classId: String(row?.id || row?._id || '').trim(),
    title: String(row?.title || '').trim(),
    before: hasSkillIdsField(row) ? row.skillIds : null,
    after: hasSkillIdsField(row) ? row.skillIds : [...CLB_SKILL_CODES],
    action: hasSkillIdsField(row) ? 'skipped_existing_field' : 'backfill'
  }));
}

async function writeReport(reportPath, report) {
  await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const orgId = String(args.orgId || DEFAULT_ORG_ID).trim();
  const reportPath = path.resolve(args.reportPath || REPORT_PATH_DEFAULT);
  const startedAt = new Date().toISOString();

  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;

  await connectMongo({ uri, dbName });
  try {
    const classesCollection = getMongoCollection('schoolClasses');
    const skillsCollection = getMongoCollection('schoolSkills');
    const classes = await classesCollection.find({ orgId }).sort({ id: 1 }).toArray();
    const classRows = buildClassReportRows(classes);
    let updatedCount = 0;
    const updateResults = [];

    if (args.apply) {
      for (const row of classes.filter((classRow) => !hasSkillIdsField(classRow))) {
        const appliedAt = new Date().toISOString();
        // The $exists condition makes the migration safe if another process assigns skills mid-run.
        // eslint-disable-next-line no-await-in-loop
        const result = await classesCollection.updateOne(
          { _id: row._id, orgId, skillIds: { $exists: false } },
          {
            $set: {
              skillIds: [...CLB_SKILL_CODES],
              'audit.lastUpdateUser': ACTOR,
              'audit.lastUpdateDateTime': appliedAt,
              skillBackfillAudit: {
                migrationId: MIGRATION_ID,
                appliedAt,
                appliedBy: ACTOR,
                before: null,
                after: [...CLB_SKILL_CODES]
              }
            }
          }
        );
        updatedCount += Number(result?.modifiedCount || 0);
        updateResults.push({
          classId: String(row?.id || row?._id || ''),
          matched: Number(result?.matchedCount || 0),
          modified: Number(result?.modifiedCount || 0)
        });
      }
    }

    const verifiedClasses = args.apply
      ? await classesCollection.find({ orgId }).sort({ id: 1 }).toArray()
      : classes;
    const missingAssignments = verifiedClasses
      .filter((row) => !Array.isArray(row?.skillIds) || row.skillIds.length === 0)
      .map((row) => String(row?.id || row?._id || ''));
    const requiredCatalogRows = await skillsCollection
      .find({ orgId, code: { $in: [...CLB_SKILL_CODES] } })
      .project({ _id: 0, code: 1, active: 1 })
      .toArray();
    const catalogCodes = new Set(requiredCatalogRows.map((row) => String(row?.code || '').trim()));
    const missingCatalogCodes = CLB_SKILL_CODES.filter((code) => !catalogCodes.has(code));

    const report = {
      migrationId: MIGRATION_ID,
      mode: args.apply ? 'apply' : 'dry-run',
      orgId,
      startedAt,
      completedAt: new Date().toISOString(),
      defaultSkillIds: [...CLB_SKILL_CODES],
      totalClasses: classes.length,
      plannedCount: classRows.filter((row) => row.action === 'backfill').length,
      updatedCount,
      skippedCount: classRows.filter((row) => row.action === 'skipped_existing_field').length,
      classes: classRows,
      updateResults,
      verification: {
        allClassesHaveAssignments: missingAssignments.length === 0,
        missingAssignmentClassIds: missingAssignments,
        requiredCatalogRowsExist: missingCatalogCodes.length === 0,
        missingCatalogCodes
      }
    };
    await writeReport(reportPath, report);
    console.log(`Class skill backfill ${report.mode} complete for org=${orgId}.`);
    console.log(`Classes: ${report.totalClasses}; planned: ${report.plannedCount}; updated: ${updatedCount}; skipped: ${report.skippedCount}.`);
    console.log(`Verification: assignments=${report.verification.allClassesHaveAssignments ? 'ok' : 'missing'}, catalog=${report.verification.requiredCatalogRowsExist ? 'ok' : 'missing'}.`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await disconnectMongo();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Class skill backfill failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ORG_ID,
  MIGRATION_ID,
  hasSkillIdsField,
  buildClassReportRows,
  parseArgs
};
