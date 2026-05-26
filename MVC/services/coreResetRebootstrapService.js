const dataService = require('./dataService');
const dataBackendRuntimeService = require('./dataBackendRuntimeService');
const coreBootstrapBaselineService = require('./coreBootstrapBaselineService');
const coreBootstrapRunRepository = require('../repositories/coreBootstrapRunRepository');
const { SYSTEM_CONTEXT } = require('../../config/constants');

const CONFIRM_TOKEN = 'RESET CORE';
const ALLOWED_PURGE_ENTITIES = Object.freeze([
  'sections',
  'operations',
  'roles',
  'scopes',
  'symbols',
  'accesses',
  'accessPolicies'
]);
const PURGE_ORDER = Object.freeze([
  'accessPolicies',
  'accesses',
  'symbols',
  'roles',
  'scopes',
  'sections',
  'operations'
]);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function resolveBackendMode(options = {}) {
  const explicit = cleanText(options.backendMode, 40).toLowerCase();
  if (explicit) return explicit;
  const status = dataBackendRuntimeService.getPublicBackendStatus() || {};
  return cleanText(status.mode || 'json', 40).toLowerCase() || 'json';
}

function resolveActor(options = {}) {
  const actor = options.actor;
  if (!actor || typeof actor !== 'object') return { id: 'SYSTEM', raw: null };
  const id = cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  return { id, raw: actor };
}

function normalizePurgeEntities(bundle = {}) {
  const manifestEntities = Array.isArray(bundle.entities) ? bundle.entities : [];
  const seen = new Set();
  const candidates = [];
  for (const entity of manifestEntities) {
    const entityType = cleanText(entity?.entityType, 120);
    if (!entityType) continue;
    if (!ALLOWED_PURGE_ENTITIES.includes(entityType)) continue;
    if (seen.has(entityType)) continue;
    seen.add(entityType);
    candidates.push(entityType);
  }
  return PURGE_ORDER.filter((entityType) => candidates.includes(entityType));
}

async function preflightReset(options = {}) {
  const backendMode = resolveBackendMode(options);
  const actor = resolveActor(options);
  const bundle = await coreBootstrapBaselineService.loadBaselineBundle(options);
  const purgeEntities = normalizePurgeEntities(bundle);

  const entities = [];
  let totalRows = 0;
  for (const entityType of purgeEntities) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, { backendMode });
    const rowCount = Array.isArray(rows) ? rows.length : 0;
    totalRows += rowCount;
    entities.push({ entityType, rowCount });
  }

  const report = {
    action: 'reset-preflight',
    backendMode,
    baseline: {
      id: bundle.baselineId,
      version: bundle.baselineVersion,
      manifestHash: bundle.manifestHash,
      sourceRoot: bundle.sourceRoot
    },
    entities,
    summary: {
      entityCount: entities.length,
      totalRows
    },
    warnings: []
  };

  const runRow = await coreBootstrapRunRepository.create({
    action: 'reset-preflight',
    baselineId: bundle.baselineId,
    baselineVersion: bundle.baselineVersion,
    manifestHash: bundle.manifestHash,
    backendMode,
    status: 'preview',
    actor: { id: actor.id },
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    summary: report.summary,
    report,
    warnings: report.warnings
  }, { backendMode, actor: actor.raw || null });

  return {
    ...report,
    run: {
      id: runRow.id,
      status: runRow.status,
      startedAt: runRow.startedAt,
      finishedAt: runRow.finishedAt
    }
  };
}

function assertConfirmToken(confirmToken = '') {
  const token = cleanText(confirmToken, 120).toUpperCase();
  if (token !== CONFIRM_TOKEN) {
    const error = new Error(`Confirmation token mismatch. Type "${CONFIRM_TOKEN}" to continue.`);
    error.code = 'confirm_token_invalid';
    throw error;
  }
}

async function applyResetAndBootstrap(options = {}) {
  assertConfirmToken(options.confirmToken);
  const backendMode = resolveBackendMode(options);
  const actor = resolveActor(options);
  const startedAt = Date.now();
  const preflightReport = await preflightReset({ ...options, backendMode });

  const warnings = [];
  const entityReports = [];
  let deletedTotal = 0;
  let failedTotal = 0;
  let skippedNoIdTotal = 0;

  for (const entity of preflightReport.entities) {
    const entityType = entity.entityType;
    // eslint-disable-next-line no-await-in-loop
    const rows = await dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, { backendMode });
    const list = Array.isArray(rows) ? rows : [];

    const rowReport = {
      entityType,
      baselineCount: list.length,
      deleted: 0,
      failed: 0,
      skippedNoId: 0,
      warnings: []
    };

    for (const row of list) {
      const rowId = cleanText(row?.id, 200);
      if (!rowId) {
        rowReport.skippedNoId += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await dataService.deleteData(entityType, rowId, actor.raw || { id: actor.id }, { backendMode });
        rowReport.deleted += 1;
      } catch (error) {
        rowReport.failed += 1;
        const warning = `${entityType} ${rowId}: ${error.message}`;
        rowReport.warnings.push(warning);
        warnings.push(warning);
      }
    }

    deletedTotal += rowReport.deleted;
    failedTotal += rowReport.failed;
    skippedNoIdTotal += rowReport.skippedNoId;
    entityReports.push(rowReport);
  }

  const bootstrapSummary = await coreBootstrapBaselineService.apply({
    actor: actor.raw || { id: actor.id },
    backendMode,
    dryRun: false
  });

  const bootstrapFailed = Number(bootstrapSummary?.summary?.failed || 0);
  const durationMs = Date.now() - startedAt;
  const overallStatus = (failedTotal > 0 || bootstrapFailed > 0) ? 'partial_success' : 'success';

  const report = {
    action: 'reset-apply',
    backendMode,
    resetSummary: {
      entities: entityReports,
      summary: {
        deleted: deletedTotal,
        failed: failedTotal,
        skippedNoId: skippedNoIdTotal,
        durationMs
      },
      preflightRunId: preflightReport?.run?.id || ''
    },
    bootstrapSummary,
    overallStatus,
    warnings,
    runIds: {
      resetPreflightRunId: preflightReport?.run?.id || '',
      bootstrapRunId: bootstrapSummary?.run?.id || ''
    },
    durationMs
  };

  const runRow = await coreBootstrapRunRepository.create({
    action: 'reset-apply',
    baselineId: bootstrapSummary?.baseline?.id || '',
    baselineVersion: bootstrapSummary?.baseline?.version || '',
    manifestHash: bootstrapSummary?.baseline?.manifestHash || '',
    backendMode,
    status: overallStatus,
    actor: { id: actor.id },
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    summary: {
      resetDeleted: deletedTotal,
      resetFailed: failedTotal,
      bootstrapFailed,
      durationMs
    },
    report,
    warnings
  }, { backendMode, actor: actor.raw || null });

  return {
    ...report,
    runIds: {
      ...report.runIds,
      resetApplyRunId: runRow.id
    }
  };
}

module.exports = {
  CONFIRM_TOKEN,
  ALLOWED_PURGE_ENTITIES,
  PURGE_ORDER,
  preflightReset,
  applyResetAndBootstrap
};
