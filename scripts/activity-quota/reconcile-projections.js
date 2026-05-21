#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { toPublicId } = require('../../MVC/utils/idAdapter');
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo } = require('../../MVC/infrastructure/mongo/mongoConnection');
const settingService = require('../../MVC/services/settingService');
const systemSettingsRepository = require('../../MVC/repositories/systemSettingsRepository');
const activityQuotaLedgerRepository = require('../../MVC/repositories/activityQuotaLedgerRepository');
const activityQuotaLedgerService = require('../../MVC/services/activityQuotaLedgerService');

const DEFAULT_REPORT_PATH = path.join(
  __dirname,
  '../../data/activity-quota/reconcile-projections.report.json'
);

function cleanString(value, { max = 120, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function parseArgs(argv = []) {
  const getArgValue = (prefix) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${prefix}=`));
    if (!token) return '';
    return String(token.slice(prefix.length + 1)).trim();
  };
  const hasFlag = (name) => argv.some((arg) => String(arg || '').trim() === name);
  return {
    orgId: toPublicId(getArgValue('--org')),
    userId: toPublicId(getArgValue('--user')),
    section: cleanString(getArgValue('--section'), { max: 120, allowEmpty: true }) || '',
    operation: cleanString(getArgValue('--operation'), { max: 120, allowEmpty: true }) || '',
    reportPath: getArgValue('--report') || DEFAULT_REPORT_PATH,
    allOrgKeys: hasFlag('--all-org-keys')
  };
}

function dedupeKeys(rows = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = {
      orgId: toPublicId(row?.orgId || ''),
      userId: toPublicId(row?.userId || ''),
      section: cleanString(row?.section, { max: 120, allowEmpty: true }) || '',
      operation: cleanString(row?.operation, { max: 120, allowEmpty: true }) || ''
    };
    if (!key.orgId || !key.userId || !key.section || !key.operation) return;
    const token = `${key.orgId}::${key.userId}::${key.section}::${key.operation}`;
    if (seen.has(token)) return;
    seen.add(token);
    out.push(key);
  });
  return out;
}

function buildLedgerQuery(filters = {}) {
  const query = {
    page: 1,
    limit: 250000
  };
  if (filters.orgId) query.orgId__eq = filters.orgId;
  if (filters.userId) query.userId__eq = filters.userId;
  if (filters.section) query.section__eq = filters.section;
  if (filters.operation) query.operation__eq = filters.operation;
  return query;
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
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
    const hasSingleKey = Boolean(args.orgId && args.userId && args.section && args.operation);
    let keysToRebuild = [];

    if (hasSingleKey) {
      keysToRebuild = [{
        orgId: args.orgId,
        userId: args.userId,
        section: args.section,
        operation: args.operation
      }];
    } else {
      if (!args.orgId && !args.allOrgKeys) {
        throw new Error('Provide --org=<ORG_ID> (or a full key) or use --all-org-keys.');
      }
      const filters = {
        orgId: args.orgId || '',
        userId: args.userId || '',
        section: args.section || '',
        operation: args.operation || ''
      };
      const rows = await activityQuotaLedgerRepository.list({
        query: buildLedgerQuery(filters),
        scope: { canViewAll: true },
        sort: { dateTime: -1, id: -1 },
        backendMode: backend.mode
      });
      keysToRebuild = dedupeKeys(rows);
    }

    if (!keysToRebuild.length) {
      console.log('[activity-quota:reconcile-projections] no matching keys were found.');
    }

    const rebuilt = await activityQuotaLedgerService.rebuildProjectionForKeys(keysToRebuild, {
      backendMode: backend.mode
    });

    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      backendMode: backend.mode,
      input: {
        orgId: args.orgId || '',
        userId: args.userId || '',
        section: args.section || '',
        operation: args.operation || '',
        allOrgKeys: args.allOrgKeys
      },
      rebuiltKeyCount: Number(Array.isArray(rebuilt) ? rebuilt.length : 0),
      rebuilt
    };

    await ensureReportDirectory(args.reportPath);
    await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[activity-quota:reconcile-projections] backend=${backend.mode} rebuilt=${report.rebuiltKeyCount}`);
    console.log(`[activity-quota:reconcile-projections] report=${args.reportPath}`);
  } finally {
    if (backend.mode === 'mongo') await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`[activity-quota:reconcile-projections][error] ${error.message}`);
  process.exitCode = 1;
});
