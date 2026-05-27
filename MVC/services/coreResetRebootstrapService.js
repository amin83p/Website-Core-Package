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
const CORE_PACKAGE_ID = 'core';

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeToken(value = '', max = 800) {
  return cleanText(value, max).toLowerCase();
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function buildIdentityValue(row = {}, identityFields = []) {
  const fields = Array.isArray(identityFields) ? identityFields : [];
  if (!fields.length) return '';
  const parts = [];
  for (const field of fields) {
    const raw = row && typeof row === 'object' ? row[field] : undefined;
    const token = cleanText(raw, 500);
    if (!token) return '';
    parts.push(`${field}:${token}`);
  }
  return parts.join('|').toLowerCase();
}

function mapExistingRows(rows = [], identityFields = []) {
  const idMap = new Map();
  const identityMap = new Map();
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row) => {
    const idToken = normalizeToken(row?.id, 300);
    if (idToken && !idMap.has(idToken)) idMap.set(idToken, row);
    const identityValue = buildIdentityValue(row, identityFields);
    if (identityValue && !identityMap.has(identityValue)) identityMap.set(identityValue, row);
  });
  return { idMap, identityMap };
}

function getPackageOwnerId(row = {}) {
  return normalizePackageId(row?.packageId || row?.package?.id || row?.metadata?.packageId || '');
}

function isPackageProtected(row = {}) {
  const ownerPackageId = getPackageOwnerId(row);
  return Boolean(ownerPackageId && ownerPackageId !== CORE_PACKAGE_ID);
}

function buildEntityPurgeCandidates(entityType = '', baselineRows = [], existingRows = [], identityFields = []) {
  const baselineList = Array.isArray(baselineRows) ? baselineRows : [];
  const existingList = Array.isArray(existingRows) ? existingRows : [];
  const { idMap, identityMap } = mapExistingRows(existingList, identityFields);
  const matched = [];
  const seenRowIds = new Set();

  baselineList.forEach((baselineRow) => {
    const baselineIdToken = normalizeToken(baselineRow?.id, 300);
    const identityValue = buildIdentityValue(baselineRow, identityFields);
    const existingRow =
      (baselineIdToken && idMap.get(baselineIdToken))
      || (identityValue && identityMap.get(identityValue))
      || null;
    if (!existingRow) return;

    const rowId = cleanText(existingRow?.id, 220);
    if (rowId && seenRowIds.has(rowId)) return;
    if (rowId) seenRowIds.add(rowId);

    matched.push({
      entityType,
      rowId,
      matchBy: baselineIdToken ? 'id' : 'identityFields',
      identityKey: baselineIdToken ? `id:${baselineIdToken}` : (identityValue || ''),
      ownerPackageId: getPackageOwnerId(existingRow),
      protectedByPackageOwnership: isPackageProtected(existingRow),
      existingRow
    });
  });

  const deleteCandidates = matched.filter((row) => row.rowId && !row.protectedByPackageOwnership);
  const protectedRows = matched.filter((row) => row.rowId && row.protectedByPackageOwnership);
  const skippedNoIdRows = matched.filter((row) => !row.rowId);

  return {
    entityType,
    collectionRowCount: existingList.length,
    baselineRowCount: baselineList.length,
    matchedRowCount: matched.length,
    deleteCandidateCount: deleteCandidates.length,
    protectedCount: protectedRows.length,
    skippedNoIdCount: skippedNoIdRows.length,
    deleteCandidates,
    protectedRows,
    skippedNoIdRows
  };
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
  const purgeEntities = normalizePurgeEntities(bundle).map((entityType) => {
    const spec = (Array.isArray(bundle.entities) ? bundle.entities : []).find((row) => row?.entityType === entityType) || {};
    return {
      entityType,
      baselineRows: Array.isArray(spec?.rows) ? spec.rows : [],
      identityFields: Array.isArray(spec?.identityFields) ? spec.identityFields : []
    };
  });

  const entities = [];
  let totalCollectionRows = 0;
  let totalMatchedRows = 0;
  let totalDeleteCandidates = 0;
  let totalProtected = 0;
  let totalSkippedNoId = 0;

  for (const entitySpec of purgeEntities) {
    const entityType = entitySpec.entityType;
    // eslint-disable-next-line no-await-in-loop
    const rows = await dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, { backendMode });
    const existingRows = Array.isArray(rows) ? rows : [];
    const report = buildEntityPurgeCandidates(
      entityType,
      entitySpec.baselineRows,
      existingRows,
      entitySpec.identityFields
    );
    totalCollectionRows += report.collectionRowCount;
    totalMatchedRows += report.matchedRowCount;
    totalDeleteCandidates += report.deleteCandidateCount;
    totalProtected += report.protectedCount;
    totalSkippedNoId += report.skippedNoIdCount;
    entities.push({
      entityType: report.entityType,
      collectionRowCount: report.collectionRowCount,
      baselineRowCount: report.baselineRowCount,
      matchedRowCount: report.matchedRowCount,
      deleteCandidateCount: report.deleteCandidateCount,
      protectedCount: report.protectedCount,
      skippedNoIdCount: report.skippedNoIdCount,
      deleteCandidates: report.deleteCandidates.map((row) => ({
        rowId: row.rowId,
        matchBy: row.matchBy,
        identityKey: row.identityKey
      })),
      protectedRows: report.protectedRows.map((row) => ({
        rowId: row.rowId,
        ownerPackageId: row.ownerPackageId,
        identityKey: row.identityKey
      }))
    });
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
      totalCollectionRows,
      totalMatchedRows,
      totalDeleteCandidates,
      totalProtected,
      totalSkippedNoId
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

async function applyCoreReset(options = {}) {
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
    const candidates = Array.isArray(entity?.deleteCandidates) ? entity.deleteCandidates : [];
    const protectedRows = Array.isArray(entity?.protectedRows) ? entity.protectedRows : [];

    const rowReport = {
      entityType,
      baselineMatched: Number(entity?.matchedRowCount || 0),
      deleteCandidateCount: Number(entity?.deleteCandidateCount || 0),
      protectedCount: Number(entity?.protectedCount || protectedRows.length || 0),
      deleted: 0,
      failed: 0,
      skippedNoId: Number(entity?.skippedNoIdCount || 0),
      warnings: []
    };

    for (const candidate of candidates) {
      const rowId = cleanText(candidate?.rowId, 200);
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
    if (protectedRows.length) {
      protectedRows.forEach((row) => {
        const warning = `${entityType} ${row.rowId}: preserved (owned by package "${row.ownerPackageId || 'unknown'}").`;
        rowReport.warnings.push(warning);
        warnings.push(warning);
      });
    }
    entityReports.push(rowReport);
  }

  const durationMs = Date.now() - startedAt;
  const overallStatus = failedTotal > 0 ? 'partial_success' : 'success';

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
    overallStatus,
    warnings,
    runIds: {
      resetPreflightRunId: preflightReport?.run?.id || ''
    },
    durationMs
  };

  const runRow = await coreBootstrapRunRepository.create({
    action: 'reset-apply',
    baselineId: preflightReport?.baseline?.id || '',
    baselineVersion: preflightReport?.baseline?.version || '',
    manifestHash: preflightReport?.baseline?.manifestHash || '',
    backendMode,
    status: overallStatus,
    actor: { id: actor.id },
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    summary: {
      resetDeleted: deletedTotal,
      resetFailed: failedTotal,
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

// Backward-compat alias for older callers/tests.
async function applyResetAndBootstrap(options = {}) {
  return applyCoreReset(options);
}

module.exports = {
  CONFIRM_TOKEN,
  ALLOWED_PURGE_ENTITIES,
  PURGE_ORDER,
  preflightReset,
  applyCoreReset,
  applyResetAndBootstrap
};
