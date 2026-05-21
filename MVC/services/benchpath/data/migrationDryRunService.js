const fs = require('fs').promises;
const path = require('path');
const uploadPathUtils = require('../../../utils/uploadPathUtils');
const uploadFolderSettingsService = require('../../uploadFolderSettingsService');
const { isDeepStrictEqual } = require('node:util');

const {
  normalizeBenchpathPayload,
  validateBenchpathPayloadShape
} = require('./payloadContractService');
const {
  validateBenchpathCrossEntityIntegrity
} = require('./integrityValidationService');

const ENTITY_FILE_MAP = Object.freeze({
  sources: 'source.json',
  sourceFragments: 'source-fragments.json',
  clbFrameworks: 'clb.framework.json',
  clbStages: 'clb.stages.json',
  clbSkills: 'clb.skills.json',
  clbCompetencyAreas: 'clb.competency-areas.json',
  clbBenchmarks: 'clb.benchmarks.json',
  clbCompetencies: 'clb.competencies.json',
  clbIndicators: 'clb.indicators.json',
  clbProfileOfAbility: 'clb.profile-of-ability.json',
  clbFeaturesOfCommunication: 'clb.features-of-communication.json',
  clbSampleTaskLabels: 'clb.sample-task-labels.json'
});

const DEFAULT_REFERENCE_DIR = path.join(__dirname, '../../../../data/benchpath/reference');
const DEFAULT_SAMPLE_LIMIT = 50;

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  return String(value == null ? '' : value).trim();
}

function getChangedFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = [];

  keys.forEach((key) => {
    if (!isDeepStrictEqual(before?.[key], after?.[key])) {
      changed.push(key);
    }
  });

  return changed;
}

function getReferenceDir(options = {}) {
  return options.referenceDir
    ? path.resolve(options.referenceDir)
    : DEFAULT_REFERENCE_DIR;
}

function resolveSampleLimit(options = {}) {
  return Number.isInteger(options.sampleLimit) && options.sampleLimit > 0
    ? options.sampleLimit
    : DEFAULT_SAMPLE_LIMIT;
}

function createIndexBuckets(keys) {
  const output = {};
  keys.forEach((key) => {
    output[key] = {};
  });
  return output;
}

function mapIndex(indexes, bucket, key, id) {
  const normalizedKey = normalizeId(key);
  if (!normalizedKey) return;

  if (!indexes[bucket][normalizedKey]) {
    indexes[bucket][normalizedKey] = [];
  }

  indexes[bucket][normalizedKey].push(id);
}

function getIndexKeysForEntity(entityType) {
  if (entityType === 'sources') {
    return ['bySourceType', 'byAuthorityLevel', 'byLanguage', 'byStatus', 'byReviewStatus', 'byOrgId'];
  }

  if (entityType === 'sourceFragments') {
    return ['bySourceId', 'byFragmentType', 'byMappedEntityType', 'bySemanticRole', 'byStatus', 'byReviewStatus', 'byLanguage', 'byOrgId'];
  }

  if (entityType === 'clbFrameworks') {
    return ['byCode', 'byFrameworkType', 'byStatus', 'byReviewStatus', 'byLanguage', 'byOrgId'];
  }

  if (entityType === 'clbStages') {
    return ['byFrameworkId', 'byStatus', 'byReviewStatus', 'byCode', 'byOrgId'];
  }

  if (entityType === 'clbSkills') {
    return ['byFrameworkId', 'byModality', 'byStatus', 'byReviewStatus', 'byCode', 'byOrgId'];
  }

  return ['byStatus', 'byReviewStatus', 'byFrameworkId', 'bySkillId', 'byBenchmarkId', 'byOrgId'];
}

function rebuildIndexesForEntity(entityType, db) {
  const ids = Array.isArray(db?.allIds)
    ? db.allIds
    : Object.keys(db?.itemsById || {});

  const indexes = createIndexBuckets(getIndexKeysForEntity(entityType));

  ids.forEach((id) => {
    const item = db?.itemsById?.[id];
    if (!item || typeof item !== 'object') return;

    if (entityType === 'sources') {
      mapIndex(indexes, 'bySourceType', item.sourceType, id);
      mapIndex(indexes, 'byAuthorityLevel', item.authorityLevel, id);
      mapIndex(indexes, 'byLanguage', item.language, id);
      mapIndex(indexes, 'byStatus', item.status, id);
      mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
      mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
      return;
    }

    if (entityType === 'sourceFragments') {
      mapIndex(indexes, 'bySourceId', item.sourceId, id);
      mapIndex(indexes, 'byFragmentType', item.fragmentType, id);
      mapIndex(indexes, 'byMappedEntityType', item.mappedEntityType, id);
      mapIndex(indexes, 'bySemanticRole', item.semanticRole, id);
      mapIndex(indexes, 'byStatus', item.status, id);
      mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
      mapIndex(indexes, 'byLanguage', item.language, id);
      mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
      return;
    }

    if (entityType === 'clbFrameworks') {
      mapIndex(indexes, 'byCode', item.code, id);
      mapIndex(indexes, 'byFrameworkType', item.frameworkType, id);
      mapIndex(indexes, 'byStatus', item.status, id);
      mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
      mapIndex(indexes, 'byLanguage', item.language, id);
      mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
      return;
    }

    if (entityType === 'clbStages') {
      mapIndex(indexes, 'byFrameworkId', item.frameworkId, id);
      mapIndex(indexes, 'byStatus', item.status, id);
      mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
      mapIndex(indexes, 'byCode', item.code, id);
      mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
      return;
    }

    if (entityType === 'clbSkills') {
      mapIndex(indexes, 'byFrameworkId', item.frameworkId, id);
      mapIndex(indexes, 'byModality', item.modality, id);
      mapIndex(indexes, 'byStatus', item.status, id);
      mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
      mapIndex(indexes, 'byCode', item.code, id);
      mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
      return;
    }

    mapIndex(indexes, 'byStatus', item.status, id);
    mapIndex(indexes, 'byReviewStatus', item.reviewStatus, id);
    mapIndex(indexes, 'byFrameworkId', item.frameworkId, id);
    mapIndex(indexes, 'bySkillId', item.skillId, id);
    mapIndex(indexes, 'byBenchmarkId', item.benchmarkId, id);
    mapIndex(indexes, 'byOrgId', item.orgId || 'SYSTEM', id);
  });

  return indexes;
}

async function readReferenceDb(referenceDir, fileName) {
  const absolutePath = path.join(referenceDir, fileName);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));

  return {
    path: absolutePath,
    db: parsed && typeof parsed === 'object' ? parsed : { itemsById: {}, allIds: [] }
  };
}

function buildLookupSnapshot(entityScans) {
  const lookup = {};

  Object.entries(entityScans).forEach(([entityType, scan]) => {
    lookup[entityType] = {};

    (scan.records || []).forEach((recordScan) => {
      const recordId = normalizeId(recordScan?.id);
      if (!recordId) return;
      lookup[entityType][recordId] = recordScan.normalized;
    });
  });

  return lookup;
}

function buildLookupResolver(lookup) {
  return async (entityType, id) => {
    const bucket = lookup?.[String(entityType || '')];
    if (!bucket || typeof bucket !== 'object') return null;
    return bucket[normalizeId(id)] || null;
  };
}

async function scanBenchpathReferenceData(options = {}) {
  const referenceDir = getReferenceDir(options);
  const sampleLimit = resolveSampleLimit(options);
  const startedAt = nowIso();
  const entityScans = {};

  for (const [entityType, fileName] of Object.entries(ENTITY_FILE_MAP)) {
    const { path: absolutePath, db } = await readReferenceDb(referenceDir, fileName);
    const allIds = Array.isArray(db?.allIds)
      ? db.allIds
      : Object.keys(db?.itemsById || {});

    const records = [];

    for (const id of allIds) {
      const item = db?.itemsById?.[id];

      if (!item || typeof item !== 'object') {
        records.push({
          id,
          raw: null,
          normalized: null,
          changedFields: [],
          shapeErrors: [`Record not found for id in itemsById: ${id}`],
          integrityErrors: []
        });
        continue;
      }

      const normalized = normalizeBenchpathPayload(entityType, item);
      const changedFields = getChangedFields(item, normalized);
      const shapeErrors = validateBenchpathPayloadShape(entityType, normalized, 'write');

      records.push({
        id,
        raw: item,
        normalized,
        changedFields,
        shapeErrors,
        integrityErrors: []
      });
    }

    entityScans[entityType] = {
      entityType,
      fileName,
      filePath: absolutePath,
      db,
      records,
      originalRecordCount: allIds.length,
      existingIndexBuckets: Object.keys(db?.indexes || {}).length
    };
  }

  const lookup = buildLookupSnapshot(entityScans);
  const getRecord = buildLookupResolver(lookup);

  for (const scan of Object.values(entityScans)) {
    for (const record of scan.records) {
      if (!record?.normalized || record.shapeErrors.length > 0) continue;

      record.integrityErrors = await validateBenchpathCrossEntityIntegrity(
        scan.entityType,
        record.normalized,
        { getRecord }
      );
    }
  }

  return {
    referenceDir,
    sampleLimit,
    startedAt,
    entityScans
  };
}

function summarizeEntityScans(entityScans, sampleLimit) {
  const entities = [];
  const summary = {
    recordsScanned: 0,
    recordsChanged: 0,
    fieldsCoerced: 0,
    invalidRelationsFound: 0,
    recordsSkipped: 0,
    indexesRebuilt: 0
  };

  for (const scan of Object.values(entityScans)) {
    const changedRecords = scan.records.filter((entry) => entry.changedFields.length > 0);
    const shapeInvalidRecords = scan.records.filter((entry) => entry.shapeErrors.length > 0);
    const integrityInvalidRecords = scan.records.filter((entry) => entry.integrityErrors.length > 0);

    const skippedRecordIds = new Set([
      ...shapeInvalidRecords.map((entry) => entry.id),
      ...integrityInvalidRecords.map((entry) => entry.id)
    ]);

    const fieldsCoerced = changedRecords.reduce((total, entry) => total + entry.changedFields.length, 0);
    const invalidRelationsFound = integrityInvalidRecords.reduce((total, entry) => total + entry.integrityErrors.length, 0);
    const indexesRebuilt = changedRecords.length > 0 || skippedRecordIds.size > 0 ? 1 : 0;

    summary.recordsScanned += scan.records.length;
    summary.recordsChanged += changedRecords.length;
    summary.fieldsCoerced += fieldsCoerced;
    summary.invalidRelationsFound += invalidRelationsFound;
    summary.recordsSkipped += skippedRecordIds.size;
    summary.indexesRebuilt += indexesRebuilt;

    entities.push({
      entityType: scan.entityType,
      fileName: scan.fileName,
      recordCount: scan.records.length,
      recordsChanged: changedRecords.length,
      fieldsCoerced,
      invalidRelationsFound,
      recordsSkipped: skippedRecordIds.size,
      indexesRebuilt,
      samples: {
        coercedRecords: changedRecords.slice(0, sampleLimit).map((entry) => ({
          id: entry.id,
          changedFields: entry.changedFields
        })),
        shapeIssues: shapeInvalidRecords.slice(0, sampleLimit).map((entry) => ({
          id: entry.id,
          errors: entry.shapeErrors
        })),
        integrityIssues: integrityInvalidRecords.slice(0, sampleLimit).map((entry) => ({
          id: entry.id,
          errors: entry.integrityErrors
        }))
      }
    });
  }

  return { summary, entities };
}

async function runBenchpathMigrationDryRunReport(options = {}) {
  const scanResult = await scanBenchpathReferenceData(options);
  const { summary, entities } = summarizeEntityScans(scanResult.entityScans, scanResult.sampleLimit);

  return {
    meta: {
      mode: 'dry-run',
      generatedAt: nowIso(),
      startedAt: scanResult.startedAt,
      sampleLimit: scanResult.sampleLimit,
      referenceDir: scanResult.referenceDir
    },
    summary,
    entities
  };
}

function buildBackupDir(options = {}) {
  if (options.createBackup === false) return null;

  if (options.backupDir) {
    return path.resolve(options.backupDir);
  }

  const stamp = nowIso().replace(/[:.]/g, '-');
  return path.resolve(path.join(
    uploadPathUtils.getUploadRootAbsolute(),
    'GLOBAL',
    uploadFolderSettingsService.resolveUploadFolder('generated.benchpathReports'),
    `benchpath-migration-backup-${stamp}`
  ));
}

async function applyBenchpathNormalizationMigration(options = {}) {
  const scanResult = await scanBenchpathReferenceData(options);
  const { summary, entities } = summarizeEntityScans(scanResult.entityScans, scanResult.sampleLimit);

  const backupDir = buildBackupDir(options);
  let backupsCreated = 0;
  let filesWritten = 0;

  if (backupDir) {
    await fs.mkdir(backupDir, { recursive: true });
  }

  for (const scan of Object.values(scanResult.entityScans)) {
    const validChangedRecords = scan.records.filter((entry) => {
      if (!entry || !entry.raw || !entry.normalized) return false;
      if (entry.shapeErrors.length > 0 || entry.integrityErrors.length > 0) return false;
      return entry.changedFields.length > 0;
    });

    if (validChangedRecords.length === 0) {
      continue;
    }

    if (backupDir) {
      await fs.copyFile(scan.filePath, path.join(backupDir, scan.fileName));
      backupsCreated += 1;
    }

    const nextDb = {
      ...(scan.db || {}),
      itemsById: { ...(scan.db?.itemsById || {}) },
      allIds: Array.isArray(scan.db?.allIds)
        ? [...scan.db.allIds]
        : Object.keys(scan.db?.itemsById || {})
    };

    validChangedRecords.forEach((entry) => {
      nextDb.itemsById[entry.id] = entry.normalized;
      if (!nextDb.allIds.includes(entry.id)) {
        nextDb.allIds.push(entry.id);
      }
    });

    nextDb.indexes = rebuildIndexesForEntity(scan.entityType, nextDb);
    nextDb.meta = {
      ...(nextDb.meta || {}),
      updatedAt: nowIso()
    };

    await fs.writeFile(scan.filePath, JSON.stringify(nextDb, null, 2), 'utf8');
    filesWritten += 1;
  }

  return {
    meta: {
      mode: 'apply',
      generatedAt: nowIso(),
      startedAt: scanResult.startedAt,
      sampleLimit: scanResult.sampleLimit,
      referenceDir: scanResult.referenceDir,
      backupDir,
      backupsCreated,
      filesWritten
    },
    summary,
    entities
  };
}

async function writeBenchpathMigrationDryRunReport(report, outputPath) {
  const absolutePath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(report, null, 2), 'utf8');
  return absolutePath;
}

module.exports = {
  ENTITY_FILE_MAP,
  DEFAULT_REFERENCE_DIR,
  runBenchpathMigrationDryRunReport,
  applyBenchpathNormalizationMigration,
  writeBenchpathMigrationDryRunReport
};
