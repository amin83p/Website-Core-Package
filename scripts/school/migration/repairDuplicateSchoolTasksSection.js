/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const MIGRATION_ID = 'repair-duplicate-school-tasks-section-445576';
const SECTION_ID = '445576';
const SECTION_NAME = 'SCHOOL_TASKS';
const SECTION_HOME_URL = '/school/tasks';
const ARCHIVE_COLLECTION = 'migrationArchives';
const SOURCE_COLLECTION = 'sections';

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return;

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;

    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function parseArgs(argv = []) {
  const out = {
    apply: false,
    uri: '',
    db: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--apply') out.apply = true;
    if (token === '--uri' && next) {
      out.uri = next;
      i += 1;
    } else if (token.startsWith('--uri=')) {
      out.uri = token.slice('--uri='.length).trim();
    }
    if (token === '--db' && next) {
      out.db = next;
      i += 1;
    } else if (token.startsWith('--db=')) {
      out.db = token.slice('--db='.length).trim();
    }
  }

  return out;
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(token)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(token)) return false;
  return fallback;
}

function parseMongoUriHost(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    return String(new URL(normalized).hostname || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function shouldUseDirectConnection(uri = '') {
  if (process.env.MONGO_DIRECT_CONNECTION !== undefined && process.env.MONGO_DIRECT_CONNECTION !== '') {
    return parseBoolean(process.env.MONGO_DIRECT_CONNECTION, false);
  }

  const host = parseMongoUriHost(uri);
  return Boolean(host && (host.endsWith('.proxy.rlwy.net') || host.endsWith('.rlwy.net')));
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function stringifyMongoId(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  return normalizeText(value);
}

function hasAuditMetadata(row = {}) {
  const audit = row?.audit;
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return false;
  return Boolean(
    normalizeText(audit.createDateTime) ||
    normalizeText(audit.lastUpdateDateTime) ||
    normalizeText(audit.createUser) ||
    normalizeText(audit.lastUpdateUser)
  );
}

function isExpectedSchoolTasksSection(row = {}) {
  return normalizeText(row?.id) === SECTION_ID
    && normalizeText(row?.name) === SECTION_NAME
    && normalizeText(row?.homeURL) === SECTION_HOME_URL
    && normalizeText(row?.packageId).toLowerCase() === 'school'
    && normalizeText(row?.packageName).toUpperCase() === 'SCHOOL';
}

function buildDeleteFilter(row = {}) {
  return {
    _id: row._id,
    id: SECTION_ID,
    name: SECTION_NAME,
    category: row.category,
    description: row.description,
    active: row.active,
    homeURL: SECTION_HOME_URL,
    packageId: 'school',
    packageName: 'SCHOOL',
    $or: [
      { audit: { $exists: false } },
      { audit: null },
      {
        'audit.createDateTime': { $exists: false },
        'audit.lastUpdateDateTime': { $exists: false },
        'audit.createUser': { $exists: false },
        'audit.lastUpdateUser': { $exists: false }
      }
    ]
  };
}

function buildPlan(rows = []) {
  const candidates = Array.isArray(rows) ? rows : [];
  const expectedRows = candidates.filter(isExpectedSchoolTasksSection);
  const canonicalRows = expectedRows.filter(hasAuditMetadata);
  const duplicateRows = expectedRows.filter((row) => !hasAuditMetadata(row));

  if (candidates.length === 1 && canonicalRows.length === 1) {
    return {
      ok: true,
      alreadyClean: true,
      canonical: canonicalRows[0],
      duplicate: null,
      reason: 'Only the audited canonical SCHOOL_TASKS section row exists.'
    };
  }

  if (candidates.length !== 2) {
    return {
      ok: false,
      reason: `Expected exactly 2 rows with id ${SECTION_ID}; found ${candidates.length}.`
    };
  }

  if (expectedRows.length !== candidates.length) {
    return {
      ok: false,
      reason: 'One or more duplicate rows do not match the expected SCHOOL_TASKS section shape.'
    };
  }

  if (canonicalRows.length !== 1 || duplicateRows.length !== 1) {
    return {
      ok: false,
      reason: `Expected one audited row and one no-audit duplicate; found audited=${canonicalRows.length} noAudit=${duplicateRows.length}.`
    };
  }

  return {
    ok: true,
    alreadyClean: false,
    canonical: canonicalRows[0],
    duplicate: duplicateRows[0],
    reason: 'One audited canonical row and one no-audit duplicate are ready for guarded repair.'
  };
}

function summarizeRow(row = {}) {
  if (!row) return null;
  return {
    mongoId: stringifyMongoId(row._id),
    id: normalizeText(row.id),
    name: normalizeText(row.name),
    description: normalizeText(row.description),
    homeURL: normalizeText(row.homeURL),
    hasAudit: hasAuditMetadata(row),
    audit: row.audit || null
  };
}

async function archiveDuplicate({ db, canonical, duplicate, nowIso }) {
  const sourceId = stringifyMongoId(duplicate._id);
  const canonicalSourceId = stringifyMongoId(canonical._id);
  const archiveId = `${MIGRATION_ID}:${sourceId}`;
  const archive = {
    _id: archiveId,
    migrationId: MIGRATION_ID,
    sourceCollection: SOURCE_COLLECTION,
    sourceId,
    canonicalSourceId,
    archivedAt: nowIso,
    archivedBy: 'system:repairDuplicateSchoolTasksSection',
    reason: `Archived duplicate no-audit ${SECTION_NAME} section row before deleting it from ${SOURCE_COLLECTION}.`,
    sourceDocument: duplicate
  };

  const result = await db.collection(ARCHIVE_COLLECTION).updateOne(
    { _id: archiveId },
    { $setOnInsert: archive },
    { upsert: true }
  );

  return {
    archiveId,
    inserted: Number(result?.upsertedCount || 0) === 1,
    existing: Number(result?.matchedCount || 0) === 1
  };
}

async function run(options = {}) {
  const startedAt = new Date().toISOString();
  const uri = normalizeText(options.uri || process.env.MONGODB_URI || process.env.MONGO_URI);
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');

  const dbName = normalizeText(options.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app');
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
    ...(shouldUseDirectConnection(uri) ? { directConnection: true } : {})
  });

  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection(SOURCE_COLLECTION);
    const rows = await sections.find({ id: SECTION_ID }).toArray();
    const plan = buildPlan(rows);
    const report = {
      migrationId: MIGRATION_ID,
      mode: options.apply ? 'apply' : 'dry_run',
      startedAt,
      database: db.databaseName,
      sectionId: SECTION_ID,
      rowCount: rows.length,
      ok: plan.ok,
      alreadyClean: Boolean(plan.alreadyClean),
      reason: plan.reason,
      canonical: summarizeRow(plan.canonical),
      duplicate: summarizeRow(plan.duplicate),
      archived: null,
      deleted: 0,
      remainingRows: rows.length
    };

    if (!plan.ok) {
      report.status = 'blocked';
      return report;
    }

    if (plan.alreadyClean) {
      report.status = 'already_clean';
      return report;
    }

    if (!options.apply) {
      report.status = 'dry_run_ready';
      return report;
    }

    const nowIso = new Date().toISOString();
    report.archived = await archiveDuplicate({
      db,
      canonical: plan.canonical,
      duplicate: plan.duplicate,
      nowIso
    });

    const deleteResult = await sections.deleteOne(buildDeleteFilter(plan.duplicate));
    report.deleted = Number(deleteResult?.deletedCount || 0);
    if (report.deleted !== 1) {
      report.status = 'blocked_after_archive';
      report.remainingRows = await sections.countDocuments({ id: SECTION_ID });
      return report;
    }

    report.remainingRows = await sections.countDocuments({ id: SECTION_ID });
    report.status = report.remainingRows === 1 ? 'repaired' : 'blocked_after_delete';
    return report;
  } finally {
    await client.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  loadLocalEnvFile();
  const args = parseArgs(argv);
  const report = await run(args);
  console.log(`[${MIGRATION_ID}] Completed.`);
  console.log(JSON.stringify(report, null, 2));

  if (report.status && report.status.startsWith('blocked')) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${MIGRATION_ID}] Failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_ID,
  SECTION_ID,
  SECTION_NAME,
  SECTION_HOME_URL,
  ARCHIVE_COLLECTION,
  hasAuditMetadata,
  isExpectedSchoolTasksSection,
  buildDeleteFilter,
  buildPlan,
  run,
  parseArgs
};
