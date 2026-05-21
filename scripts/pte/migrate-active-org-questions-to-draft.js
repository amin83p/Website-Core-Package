#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');
const systemSettingsRepository = require('../../MVC/repositories/systemSettingsRepository');

const DEFAULT_REPORT_PATH = path.join(
  __dirname,
  '../../data/pte/migrate-active-org-questions-to-draft.report.json'
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
    orgId: getArgValue('--org')
      || getArgValue('--active-org')
      || String(process.env.ACTIVE_ORG_ID || '').trim(),
    reportPath: getArgValue('--report') || DEFAULT_REPORT_PATH
  };
}

function normalizeOrgId(value, fallback = '') {
  const token = String(value || '').trim();
  if (token) return token;
  const fallbackToken = String(fallback || '').trim();
  return fallbackToken || '';
}

function toStatusCounts(rows = []) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const status = String(row?.status || '').trim().toLowerCase() || 'unknown';
    out[status] = Number(out[status] || 0) + 1;
  });
  return out;
}

async function ensureReportDirectory(reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const actor = 'system_migration';

  const settings = await systemSettingsRepository.getSettings({ backendMode: 'json' });
  const backend = resolveDataBackendConfig(process.env, {
    preferredMode: 'mongo',
  });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();
  if (backend.mode !== 'mongo' || !mongoUri) {
    throw new Error('This migration requires Mongo mode and a configured Mongo URI.');
  }

  const activeOrgId = normalizeOrgId(args.orgId, settings?.organization?.freeOrgId);
  if (!activeOrgId) {
    throw new Error('Active organization id is required. Pass --org=<ORG_ID> (or set ACTIVE_ORG_ID).');
  }

  await connectMongo({ uri: mongoUri });
  try {
    const questionCollection = getMongoCollection('pteQuestionVersions');
    const orgFilter = { orgId: activeOrgId };
    const nonDraftFilter = { orgId: activeOrgId, status: { $ne: 'draft' } };

    const [allRows, nonDraftRows] = await Promise.all([
      questionCollection.find(orgFilter, { projection: { id: 1, status: 1 } }).toArray(),
      questionCollection.find(nonDraftFilter, { projection: { id: 1, status: 1 } }).toArray()
    ]);

    const statusBefore = toStatusCounts(allRows);
    let modifiedCount = 0;
    let matchedCount = Array.isArray(nonDraftRows) ? nonDraftRows.length : 0;

    if (args.apply && matchedCount > 0) {
      const nowIso = new Date().toISOString();
      const updateResult = await questionCollection.updateMany(
        nonDraftFilter,
        {
          $set: {
            status: 'draft',
            'publishingMeta.unpublishedBy': actor,
            'publishingMeta.unpublishedAt': nowIso,
            'audit.lastUpdateUser': actor,
            'audit.lastUpdateDateTime': nowIso
          }
        }
      );
      matchedCount = Number(updateResult?.matchedCount || 0);
      modifiedCount = Number(updateResult?.modifiedCount || 0);
    }

    const afterRows = await questionCollection.find(orgFilter, { projection: { id: 1, status: 1 } }).toArray();
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry_run',
      activeOrgId,
      totalQuestionsInOrg: Array.isArray(allRows) ? allRows.length : 0,
      nonDraftQuestions: Array.isArray(nonDraftRows) ? nonDraftRows.length : 0,
      matchedCount,
      modifiedCount,
      statusBefore,
      statusAfter: toStatusCounts(afterRows)
    };

    await ensureReportDirectory(args.reportPath);
    await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[pte:migrate-active-org-questions-to-draft] mode=${report.mode} org=${report.activeOrgId}`);
    console.log(`[pte:migrate-active-org-questions-to-draft] total=${report.totalQuestionsInOrg} nonDraft=${report.nonDraftQuestions} matched=${report.matchedCount} modified=${report.modifiedCount}`);
    console.log(`[pte:migrate-active-org-questions-to-draft] report=${args.reportPath}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(`[pte:migrate-active-org-questions-to-draft][error] ${error.message}`);
  process.exitCode = 1;
});

