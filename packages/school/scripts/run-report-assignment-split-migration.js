#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '../../..');

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

function parseArgs(argv) {
  const args = { orgId: '', apply: false, allOrgs: false, assignmentId: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--all-orgs') args.allOrgs = true;
    else if (token === '--org') args.orgId = String(argv[i + 1] || '').trim(), i += 1;
    else if (token === '--assignment') args.assignmentId = String(argv[i + 1] || '').trim(), i += 1;
  }
  return args;
}

async function bootstrapMongo() {
  loadEnv();
  const { resolveDataBackendConfig } = require('../../../config/dataBackend');
  const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
  const { connectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  const config = resolveDataBackendConfig();
  if (config.mode !== 'mongo') {
    throw new Error('This migration script requires DATA_BACKEND=mongo.');
  }
  setActiveDataBackendConfig(config);
  await connectMongo();
}

async function main() {
  await bootstrapMongo();
  const args = parseArgs(process.argv);
  const reportAssignmentSplitMigrationService = require('../MVC/services/school/reportAssignmentSplitMigrationService');
  const { disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');

  const orgId = args.allOrgs ? '' : (args.orgId || process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS || '900000');
  const reqUser = {
    id: 'reportAssignmentSplitMigration',
    activeOrgId: orgId,
    scope: { canViewAll: true },
    isSuperAdmin: true
  };

  try {
    if (args.apply) {
      const result = await reportAssignmentSplitMigrationService.runReportAssignmentSplitMigration({
        reqUser,
        orgId,
        dryRun: false,
        assignmentIds: args.assignmentId ? [args.assignmentId] : []
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const preview = await reportAssignmentSplitMigrationService.listReportAssignmentSplitCandidates({
      reqUser,
      orgId
    });
    if (args.assignmentId) {
      preview.candidates = preview.candidates.filter((row) => row.assignmentId === args.assignmentId);
      preview.candidateCount = preview.candidates.length;
    }
    console.log(JSON.stringify(preview, null, 2));
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
