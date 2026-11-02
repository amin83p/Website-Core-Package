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
  const args = { apply: false, classId: '', reportScope: 'each_student' };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--class-id') args.classId = String(argv[i + 1] || '').trim(), i += 1;
    else if (token === '--report-scope') args.reportScope = String(argv[i + 1] || '').trim(), i += 1;
  }
  return args;
}

async function bootstrapMongoIfNeeded() {
  loadEnv();
  const { resolveDataBackendConfig } = require('../../../config/dataBackend');
  const config = resolveDataBackendConfig();
  if (config.mode !== 'mongo') return;
  const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
  const { connectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  setActiveDataBackendConfig(config);
  await connectMongo();
}

async function main() {
  await bootstrapMongoIfNeeded();
  const args = parseArgs(process.argv);
  const reportAssignmentConsolidationService = require('../MVC/services/school/reportAssignmentConsolidationService');
  const reqUser = {
    id: 'ronReportAssignmentRepair',
    activeOrgId: process.env.SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS || '900000',
    scope: { canViewAll: true },
    isSuperAdmin: true
  };

  let classId = args.classId;
  if (!classId) {
    classId = await reportAssignmentConsolidationService.resolveClassIdByRepairTitle(reqUser);
  }
  if (!classId) {
    throw new Error(`Class not found for title "${reportAssignmentConsolidationService.REPAIR_CLASS_TITLE}". Pass --class-id explicitly.`);
  }

  const audit = await reportAssignmentConsolidationService.auditReportAssignmentDuplicatesForClass({
    classId,
    reportScope: args.reportScope,
    reqUser
  });
  console.log('Audit:');
  console.log(JSON.stringify(audit, null, 2));

  const result = await reportAssignmentConsolidationService.consolidateReportAssignmentsForClass({
    classId,
    reportScope: args.reportScope,
    reqUser,
    dryRun: !args.apply
  });
  console.log(args.apply ? 'Apply result:' : 'Dry run result:');
  console.log(JSON.stringify(result, null, 2));

  const { disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  if (typeof disconnectMongo === 'function') {
    await disconnectMongo().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
