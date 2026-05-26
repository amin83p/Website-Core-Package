const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const dataService = require('./dataService');
const systemSettingsRepository = require('../repositories/systemSettingsRepository');
const coreBootstrapRunRepository = require('../repositories/coreBootstrapRunRepository');
const firstRunBootstrapService = require('./firstRunBootstrapService');
const dataBackendRuntimeService = require('./dataBackendRuntimeService');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { SYSTEM_CONTEXT } = require('../../config/constants');

const BASELINE_ROOT = path.join(process.cwd(), 'data', 'bootstrap', 'core');
const MANIFEST_PATH = path.join(BASELINE_ROOT, 'manifest.json');
const JSON_SYSTEM_SETTINGS_PATH = path.join(process.cwd(), 'data', 'systemSettings.json');

const SUPPORTED_ENTITY_TYPES = Object.freeze([
  'sections',
  'operations',
  'roles',
  'scopes',
  'symbols',
  'accesses',
  'accessPolicies'
]);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function safeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeToken(value) {
  return cleanText(value, 800).toLowerCase();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = normalizeToken(value);
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex');
}

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach((key) => {
    out[key] = stableSortObject(value[key]);
  });
  return out;
}

function normalizeComparableRow(row = {}) {
  const source = row && typeof row === 'object' ? { ...row } : {};
  delete source.audit;
  delete source.createDateTime;
  delete source.lastUpdateDateTime;
  delete source.createUser;
  delete source.lastUpdateUser;
  return stableSortObject(source);
}

function assertRelativePackPath(file = '') {
  const token = cleanText(file, 1600).replace(/\\/g, '/');
  if (!token) throw new Error('Baseline entity file is required.');
  if (token.includes('..')) throw new Error(`Invalid baseline file path: ${token}`);
  const resolved = path.resolve(BASELINE_ROOT, token);
  const relative = path.relative(BASELINE_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Baseline file escapes root: ${token}`);
  }
  return { token, resolved };
}

async function readJsonFile(filePath = '') {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
}

function normalizeManifestEntity(row = {}) {
  const source = safeObject(row);
  const entityType = cleanText(source.entityType, 120);
  if (!entityType) throw new Error('Manifest entityType is required.');
  if (!SUPPORTED_ENTITY_TYPES.includes(entityType)) {
    throw new Error(`Unsupported manifest entityType: ${entityType}`);
  }
  const file = cleanText(source.file, 1600);
  if (!file) throw new Error(`Manifest file is required for entity: ${entityType}`);
  const identityFields = Array.isArray(source.identityFields)
    ? source.identityFields.map((item) => cleanText(item, 120)).filter(Boolean)
    : [];
  return {
    entityType,
    file,
    identityFields,
    mode: cleanText(source.mode, 80) || 'upsert-missing'
  };
}

function normalizeDefaultsSpec(row = {}) {
  const source = safeObject(row);
  const file = cleanText(source.file, 1600);
  if (!file) throw new Error('systemSettingsDefaults.file is required.');
  return {
    file,
    mode: cleanText(source.mode, 80) || 'create-if-missing'
  };
}

async function loadBaselineBundle() {
  const manifest = safeObject(await readJsonFile(MANIFEST_PATH));
  const baselineId = cleanText(manifest.id, 160) || 'core-bootstrap-security-baseline';
  const baselineVersion = cleanText(manifest.version, 120) || '1.0.0';
  const entities = Array.isArray(manifest.entities)
    ? manifest.entities.map(normalizeManifestEntity)
    : [];
  if (!entities.length) throw new Error('Baseline manifest has no entities.');

  const defaultsSpec = normalizeDefaultsSpec(manifest.systemSettingsDefaults || {});
  const loadedEntities = [];
  for (const row of entities) {
    const { resolved } = assertRelativePackPath(row.file);
    // eslint-disable-next-line no-await-in-loop
    const parsed = await readJsonFile(resolved);
    if (!Array.isArray(parsed)) {
      throw new Error(`Baseline file must contain an array: ${row.file}`);
    }
    const cleanRows = parsed.filter((item) => item && typeof item === 'object');
    loadedEntities.push({
      ...row,
      filePath: resolved,
      rows: cleanRows
    });
  }

  const defaultsPath = assertRelativePackPath(defaultsSpec.file).resolved;
  const defaultsPayload = safeObject(await readJsonFile(defaultsPath));

  return {
    baselineId,
    baselineVersion,
    manifest,
    manifestHash: hashPayload(manifest),
    entities: loadedEntities,
    systemSettingsDefaults: {
      ...defaultsSpec,
      filePath: defaultsPath,
      payload: defaultsPayload
    },
    sourceRoot: BASELINE_ROOT
  };
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
    const idToken = normalizeToken(row?.id);
    if (idToken && !idMap.has(idToken)) idMap.set(idToken, row);
    const identityValue = buildIdentityValue(row, identityFields);
    if (identityValue && !identityMap.has(identityValue)) identityMap.set(identityValue, row);
  });

  return { idMap, identityMap };
}

function buildEntityPreflight(entityType = '', baselineRows = [], existingRows = [], identityFields = []) {
  const baselineList = Array.isArray(baselineRows) ? baselineRows : [];
  const existingList = Array.isArray(existingRows) ? existingRows : [];
  const { idMap, identityMap } = mapExistingRows(existingList, identityFields);

  const createCandidates = [];
  const conflicts = [];
  let existingSameCount = 0;

  baselineList.forEach((row) => {
    const idToken = normalizeToken(row?.id);
    const identityValue = buildIdentityValue(row, identityFields);
    const matched = (idToken && idMap.get(idToken)) || (identityValue && identityMap.get(identityValue)) || null;

    if (!matched) {
      createCandidates.push(row);
      return;
    }

    const same = hashPayload(normalizeComparableRow(matched)) === hashPayload(normalizeComparableRow(row));
    if (same) {
      existingSameCount += 1;
      return;
    }

    conflicts.push({
      identityKey: idToken ? `id:${row.id}` : (identityValue || '(no-identity)'),
      entityType,
      reason: 'modified_existing_record'
    });
  });

  return {
    entityType,
    baselineCount: baselineList.length,
    existingCount: existingList.length,
    createCandidates,
    createCandidateCount: createCandidates.length,
    existingSameCount,
    conflictCount: conflicts.length,
    conflicts
  };
}

async function getSystemSettingsState(backendMode = 'json') {
  const mode = cleanText(backendMode, 40).toLowerCase() || 'json';
  if (mode === 'mongo') {
    const row = await getMongoCollection('systemSettings').findOne({ id: 'system-settings' });
    return { exists: Boolean(row), mode: 'mongo' };
  }

  try {
    const raw = await fs.readFile(JSON_SYSTEM_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    return { exists: Boolean(parsed && typeof parsed === 'object'), mode: 'json' };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, mode: 'json' };
    throw error;
  }
}

function resolveBackendMode(options = {}) {
  const explicit = cleanText(options.backendMode, 40).toLowerCase();
  if (explicit) return explicit;
  const status = dataBackendRuntimeService.getPublicBackendStatus() || {};
  return cleanText(status.mode || 'json', 40).toLowerCase() || 'json';
}

function resolveActor(options = {}) {
  const actor = options.actor;
  if (!actor || typeof actor !== 'object') return { id: 'SYSTEM', label: 'SYSTEM' };
  const id = cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  return { id, label: id };
}

async function preflight(options = {}) {
  const backendMode = resolveBackendMode(options);
  const actor = resolveActor(options);
  const bundle = await loadBaselineBundle();
  const entities = [];
  const warnings = [];

  for (const entity of bundle.entities) {
    // eslint-disable-next-line no-await-in-loop
    const existingRows = await dataService.fetchData(entity.entityType, {}, SYSTEM_CONTEXT, { backendMode });
    entities.push(buildEntityPreflight(entity.entityType, entity.rows, existingRows, entity.identityFields));
  }

  const totals = entities.reduce((acc, row) => {
    acc.baselineRows += row.baselineCount;
    acc.existingRows += row.existingCount;
    acc.createCandidates += row.createCandidateCount;
    acc.existingSame += row.existingSameCount;
    acc.conflicts += row.conflictCount;
    return acc;
  }, {
    baselineRows: 0,
    existingRows: 0,
    createCandidates: 0,
    existingSame: 0,
    conflicts: 0
  });

  const systemSettingsState = await getSystemSettingsState(backendMode);
  const emptyDatabase = totals.existingRows === 0 && !systemSettingsState.exists;

  const report = {
    action: 'preflight',
    backendMode,
    emptyDatabase,
    baseline: {
      id: bundle.baselineId,
      version: bundle.baselineVersion,
      manifestHash: bundle.manifestHash,
      sourceRoot: path.relative(process.cwd(), bundle.sourceRoot).replace(/\\/g, '/')
    },
    entities: entities.map((row) => ({
      entityType: row.entityType,
      baselineCount: row.baselineCount,
      existingCount: row.existingCount,
      createCandidateCount: row.createCandidateCount,
      existingSameCount: row.existingSameCount,
      conflictCount: row.conflictCount,
      conflicts: row.conflicts
    })),
    systemSettings: {
      exists: systemSettingsState.exists,
      defaultsMode: bundle.systemSettingsDefaults.mode
    },
    summary: {
      baselineRows: totals.baselineRows,
      existingRows: totals.existingRows,
      plannedCreates: totals.createCandidates,
      existingSame: totals.existingSame,
      conflicts: totals.conflicts
    },
    warnings
  };

  const runRow = await coreBootstrapRunRepository.create({
    action: 'preflight',
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
    warnings
  }, { backendMode, actor: options.actor || null });

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

async function apply(options = {}) {
  const backendMode = resolveBackendMode(options);
  const actor = resolveActor(options);
  const dryRun = parseBoolean(options.dryRun, false);
  const startTime = Date.now();
  const preflightReport = await preflight({ ...options, backendMode });
  const bundle = await loadBaselineBundle();

  const warnings = [];
  const entityReports = [];
  let createdTotal = 0;
  let skippedTotal = 0;
  let conflictTotal = 0;
  let failedTotal = 0;

  for (const preflightEntity of preflightReport.entities) {
    const entitySpec = bundle.entities.find((row) => row.entityType === preflightEntity.entityType);
    const createCandidates = Array.isArray(entitySpec?.rows)
      ? buildEntityPreflight(
        preflightEntity.entityType,
        entitySpec.rows,
        await dataService.fetchData(preflightEntity.entityType, {}, SYSTEM_CONTEXT, { backendMode }),
        entitySpec.identityFields
      ).createCandidates
      : [];

    const reportRow = {
      entityType: preflightEntity.entityType,
      baselineCount: preflightEntity.baselineCount,
      existingCount: preflightEntity.existingCount,
      created: 0,
      updated: 0,
      skipped: preflightEntity.existingSameCount,
      conflicts: preflightEntity.conflictCount,
      failed: 0,
      warnings: []
    };

    skippedTotal += preflightEntity.existingSameCount;
    conflictTotal += preflightEntity.conflictCount;

    for (const candidate of createCandidates) {
      if (dryRun) {
        reportRow.created += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await dataService.addData(preflightEntity.entityType, candidate, SYSTEM_CONTEXT, { backendMode });
        reportRow.created += 1;
      } catch (error) {
        reportRow.failed += 1;
        const warning = `${preflightEntity.entityType} ${cleanText(candidate?.id || '', 120) || '(no-id)'}: ${error.message}`;
        reportRow.warnings.push(warning);
        warnings.push(warning);
      }
    }

    createdTotal += reportRow.created;
    failedTotal += reportRow.failed;
    entityReports.push(reportRow);
  }

  const settingsState = await getSystemSettingsState(backendMode);
  let systemSettingsResult = {
    existed: settingsState.exists,
    created: false,
    skipped: true,
    failed: false,
    warning: ''
  };

  if (!settingsState.exists && !dryRun) {
    try {
      await systemSettingsRepository.updateSettings(bundle.systemSettingsDefaults.payload, options.actor || null, { backendMode });
      systemSettingsResult = { existed: false, created: true, skipped: false, failed: false, warning: '' };
      createdTotal += 1;
    } catch (error) {
      systemSettingsResult = {
        existed: false,
        created: false,
        skipped: false,
        failed: true,
        warning: error.message
      };
      failedTotal += 1;
      warnings.push(`systemSettings defaults: ${error.message}`);
    }
  }

  if (systemSettingsResult.skipped) skippedTotal += 1;

  firstRunBootstrapService.clearBootstrapStateCache();

  const durationMs = Date.now() - startTime;
  const status = failedTotal > 0 ? 'partial_success' : 'success';

  const report = {
    action: dryRun ? 'apply-dry-run' : 'apply',
    backendMode,
    baseline: {
      id: bundle.baselineId,
      version: bundle.baselineVersion,
      manifestHash: bundle.manifestHash,
      sourceRoot: path.relative(process.cwd(), bundle.sourceRoot).replace(/\\/g, '/')
    },
    entityReports,
    systemSettings: systemSettingsResult,
    summary: {
      created: createdTotal,
      updated: 0,
      skipped: skippedTotal,
      conflicts: conflictTotal,
      failed: failedTotal,
      warnings: warnings.length,
      durationMs
    },
    warnings,
    preflightRunId: preflightReport?.run?.id || ''
  };

  const runRow = await coreBootstrapRunRepository.create({
    action: dryRun ? 'apply-dry-run' : 'apply',
    baselineId: bundle.baselineId,
    baselineVersion: bundle.baselineVersion,
    manifestHash: bundle.manifestHash,
    backendMode,
    status,
    actor: { id: actor.id },
    startedAt: new Date(startTime).toISOString(),
    finishedAt: new Date().toISOString(),
    summary: report.summary,
    report,
    warnings
  }, { backendMode, actor: options.actor || null });

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

module.exports = {
  BASELINE_ROOT,
  MANIFEST_PATH,
  loadBaselineBundle,
  preflight,
  apply
};
