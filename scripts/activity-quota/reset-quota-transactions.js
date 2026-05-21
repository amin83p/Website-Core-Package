#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo } = require('../../MVC/infrastructure/mongo/mongoConnection');
const settingService = require('../../MVC/services/settingService');
const systemSettingsRepository = require('../../MVC/repositories/systemSettingsRepository');
const activityQuotaLedgerRepository = require('../../MVC/repositories/activityQuotaLedgerRepository');
const activityQuotaCreditGroupRepository = require('../../MVC/repositories/activityQuotaCreditGroupRepository');
const quotaCreditLotRepository = require('../../MVC/repositories/quotaCreditLotRepository');
const quotaBalanceSnapshotRepository = require('../../MVC/repositories/quotaBalanceSnapshotRepository');
const activityQuotaLedgerService = require('../../MVC/services/activityQuotaLedgerService');

const DEFAULT_REPORT_PATH = path.join(
  __dirname,
  '../../data/activity-quota/reset-quota-transactions.report.json'
);

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };
  return {
    apply: flags.has('--apply'),
    reportPath: getArgValue('--report') || DEFAULT_REPORT_PATH
  };
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

async function getCurrentCounts(backendMode = 'json') {
  const opts = { backendMode };
  const scope = { canViewAll: true };
  const baseQuery = {};
  const [ledger, groups, lots, snapshots] = await Promise.all([
    activityQuotaLedgerRepository.count({ query: baseQuery, scope, ...opts }),
    activityQuotaCreditGroupRepository.count({ query: baseQuery, scope, ...opts }),
    quotaCreditLotRepository.count({ query: baseQuery, scope, ...opts }),
    quotaBalanceSnapshotRepository.count({ query: baseQuery, scope, ...opts })
  ]);
  return {
    activityQuotaLedger: Number(ledger || 0),
    activityQuotaCreditGroups: Number(groups || 0),
    quotaCreditLots: Number(lots || 0),
    quotaBalanceSnapshots: Number(snapshots || 0)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
  });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();

  if (backend.mode === 'mongo' && mongoUri) {
    await connectMongo({ uri: mongoUri });
  }
  await settingService.init();

  try {
    const countsBefore = await getCurrentCounts(backend.mode);
    let resetResult = null;
    if (args.apply) {
      resetResult = await activityQuotaLedgerService.clearAllQuotaTransactions({
        backendMode: backend.mode
      });
    }
    const countsAfter = args.apply
      ? await getCurrentCounts(backend.mode)
      : countsBefore;

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry_run',
      backendMode: backend.mode,
      countsBefore,
      countsAfter,
      resetResult
    };

    await ensureReportDirectory(args.reportPath);
    await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[activity-quota:reset-transactions] mode=${report.mode} backend=${backend.mode}`);
    console.log(`[activity-quota:reset-transactions] before ledger=${countsBefore.activityQuotaLedger} groups=${countsBefore.activityQuotaCreditGroups} lots=${countsBefore.quotaCreditLots} snapshots=${countsBefore.quotaBalanceSnapshots}`);
    if (args.apply) {
      console.log(`[activity-quota:reset-transactions] after ledger=${countsAfter.activityQuotaLedger} groups=${countsAfter.activityQuotaCreditGroups} lots=${countsAfter.quotaCreditLots} snapshots=${countsAfter.quotaBalanceSnapshots}`);
    }
    console.log(`[activity-quota:reset-transactions] report=${args.reportPath}`);
  } finally {
    if (backend.mode === 'mongo') {
      await disconnectMongo();
    }
  }
}

main().catch((error) => {
  console.error(`[activity-quota:reset-transactions][error] ${error.message}`);
  process.exitCode = 1;
});
