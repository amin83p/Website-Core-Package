#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '../../..');

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1].trim())) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}

function parseArgs(argv = []) {
  const out = { dryRun: true, orgId: '' };
  argv.forEach((arg) => {
    if (arg === '--apply') out.dryRun = false;
    else if (arg.startsWith('--org=')) out.orgId = arg.slice('--org='.length).trim();
  });
  return out;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const { resolveDataBackendConfig } = require('../../../config/dataBackend');
  const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
  const { connectMongo, disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  setActiveDataBackendConfig(resolveDataBackendConfig());
  await connectMongo();

  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const reportAssignmentModel = require('../MVC/models/school/reportAssignmentModel');
  const reqUser = { id: 'backfill-shared-by-row', scope: { canViewAll: true }, isSuperAdmin: true };

  const assignments = await schoolDataService.fetchAllData('reportAssignments', {}, reqUser);
  const scoped = args.orgId
    ? assignments.filter((row) => String(row?.orgId || '') === args.orgId)
    : assignments;

  let candidateCount = 0;
  let updatedCount = 0;

  for (const assignment of scoped) {
    const rows = reportAssignmentModel.getEffectiveTargetRows(assignment);
    if (rows.length <= 1) continue;
    const flat = assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object'
      ? assignment.sharedAnswers
      : {};
    if (!Object.keys(flat).length) continue;
    const existingMap = reportAssignmentModel.getSharedAnswersByRowMap(assignment);
    if (Object.keys(existingMap).length) continue;

    candidateCount += 1;
    const sharedAnswersByRowId = {};
    rows.forEach((row) => {
      const rowId = String(row?.rowId || '').trim();
      if (!rowId) return;
      sharedAnswersByRowId[rowId] = { ...flat };
    });

    console.log(`[${args.dryRun ? 'dry-run' : 'apply'}] ${assignment.id} rows=${rows.length}`);
    if (args.dryRun) continue;

    await schoolDataService.updateData('reportAssignments', assignment.id, {
      sharedAnswersByRowId,
      sharedAnswers: {}
    }, reqUser, { skipDeletionGuard: true });
    updatedCount += 1;
  }

  console.log(JSON.stringify({
    dryRun: args.dryRun,
    orgId: args.orgId || null,
    candidateCount,
    updatedCount
  }, null, 2));

  await disconnectMongo();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
