'use strict';

const crypto = require('crypto');
const PizZip = require('pizzip');
const dataService = require('../dataService');
const actionStateModel = require('../../models/actionStateModel');
const logArchiveStateService = require('./logArchiveStateService');
const {
  cleanDateKey,
  resolveArchiveRangeBoundsMs,
  timestampInArchiveRange
} = require('./logArchiveRangeUtils');
const { normalizePersistedLogRecord } = require('../../utils/logRecordUtils');
const { SYSTEM_CONTEXT } = require('../../../config/constants');

const ARCHIVE_SCHEMA_VERSION = 1;
const BATCH_LIMIT = 1000;

const exportJobsByUser = new Map();

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function fetchAllPaged(entityType, baseQuery, requestUser) {
  const pageSize = BATCH_LIMIT;
  let page = 1;
  const all = [];
  for (;;) {
    const rows = await dataService.fetchData(entityType, {
      ...baseQuery,
      page,
      limit: pageSize
    }, requestUser);
    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
    if (page > 2000) break;
  }
  return all;
}

async function fetchLogsForRange({ startDate, endDate, timezone, requestUser }) {
  const bounds = resolveArchiveRangeBoundsMs(startDate, endDate, timezone);
  const rows = await fetchAllPaged('logs', {
    startDate,
    endDate,
    sort: 'timestamp'
  }, requestUser);
  return rows
    .map((row) => normalizePersistedLogRecord(row))
    .filter(Boolean)
    .filter((row) => timestampInArchiveRange(row.timestamp, bounds));
}

async function fetchActionStatesForRange({ startDate, endDate, timezone, requestUser }) {
  const bounds = resolveArchiveRangeBoundsMs(startDate, endDate, timezone);
  const rows = await fetchAllPaged('actionStates', {
    startDate,
    endDate,
    sort: '-startedAt'
  }, requestUser);
  return rows.filter((row) => {
    const ts = row.startedAt || row.createdAt || row.updatedAt;
    return timestampInArchiveRange(ts, bounds);
  });
}

function toNdjson(rows = []) {
  return `${(Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function buildReferenceMaps(sections = [], operations = []) {
  const sectionRows = (Array.isArray(sections) ? sections : []).map((row) => ({
    id: String(row?.id || '').trim(),
    name: String(row?.name || '').trim()
  })).filter((row) => row.id);
  const operationRows = (Array.isArray(operations) ? operations : []).map((row) => ({
    id: String(row?.id || '').trim(),
    name: String(row?.name || '').trim()
  })).filter((row) => row.id);
  return { sections: sectionRows, operations: operationRows };
}

async function maybeBuildSnapshots(actionStates = [], includeDecrypted = false) {
  if (!includeDecrypted) return [];
  const out = [];
  for (const state of actionStates) {
    const id = String(state?.id || '').trim();
    if (!id) continue;
    const payload = await actionStateModel.getDecryptedData(id);
    out.push({ id, decrypted: payload });
  }
  return out;
}

function assertExportNotBusy(userId) {
  const key = String(userId || 'anonymous');
  if (exportJobsByUser.get(key)) {
    const err = new Error('An export is already running for this user.');
    err.code = 'EXPORT_BUSY';
    throw err;
  }
}

function markExportBusy(userId) {
  exportJobsByUser.set(String(userId || 'anonymous'), Date.now());
}

function clearExportBusy(userId) {
  exportJobsByUser.delete(String(userId || 'anonymous'));
}

async function buildActivityArchiveZip(options = {}) {
  const requestUser = options?.requestUser || null;
  const userId = String(requestUser?.id || 'anonymous');
  assertExportNotBusy(userId);
  markExportBusy(userId);

  try {
    const timezone = String(options?.timezone || requestUser?.activeOrgTimeZone || 'UTC').trim() || 'UTC';
    const startDate = cleanDateKey(options?.startDate);
    const endDate = cleanDateKey(options?.endDate);
    if (!startDate || !endDate) {
      const err = new Error('Start date and end date are required (YYYY-MM-DD).');
      err.code = 'INVALID_RANGE';
      throw err;
    }
    if (startDate > endDate) {
      const err = new Error('Start date must be on or before end date.');
      err.code = 'INVALID_RANGE';
      throw err;
    }

    const includeLogs = options?.includeLogs !== false;
    const includeActionStates = options?.includeActionStates !== false;
    const includeDecryptedSnapshots = options?.includeDecryptedSnapshots === true;

    const [logs, actionStates, sections, operations] = await Promise.all([
      includeLogs ? fetchLogsForRange({ startDate, endDate, timezone, requestUser }) : Promise.resolve([]),
      includeActionStates ? fetchActionStatesForRange({ startDate, endDate, timezone, requestUser }) : Promise.resolve([]),
      dataService.fetchData('sections', { limit: 5000, sort: 'name' }, requestUser || SYSTEM_CONTEXT),
      dataService.fetchData('operations', { limit: 5000, sort: 'name' }, requestUser || SYSTEM_CONTEXT)
    ]);

    const snapshots = await maybeBuildSnapshots(actionStates, includeDecryptedSnapshots);
    const reference = buildReferenceMaps(sections, operations);
    const exportId = `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const files = {};
    if (includeLogs) files['logs.ndjson'] = Buffer.from(toNdjson(logs), 'utf8');
    if (includeActionStates) files['action_states.ndjson'] = Buffer.from(toNdjson(actionStates), 'utf8');
    if (includeDecryptedSnapshots && snapshots.length) {
      files['action_state_snapshots.ndjson'] = Buffer.from(toNdjson(snapshots), 'utf8');
    }
    files['reference/sections.json'] = Buffer.from(JSON.stringify(reference.sections, null, 2), 'utf8');
    files['reference/operations.json'] = Buffer.from(JSON.stringify(reference.operations, null, 2), 'utf8');

    const manifestParts = Object.fromEntries(
      Object.entries(files).map(([name, buf]) => [name, { sha256: sha256Buffer(buf), bytes: buf.length }])
    );

    const manifest = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      exportId,
      exportedAt: new Date().toISOString(),
      timezone,
      range: { startDate, endDate },
      counts: {
        logs: logs.length,
        actionStates: actionStates.length,
        actionStateSnapshots: snapshots.length
      },
      parts: manifestParts,
      appVersion: String(process.env.npm_package_version || '1.0.0')
    };
    files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

    const zip = new PizZip();
    Object.entries(files).forEach(([name, buf]) => {
      zip.file(name, buf);
    });
    const zipBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

    await logArchiveStateService.saveLogArchiveState({
      lastExportEndDate: endDate,
      lastExportAt: manifest.exportedAt,
      lastExportId: exportId,
      lastExportCounts: manifest.counts
    }, requestUser);

    return {
      buffer: zipBuffer,
      fileName: `activity-archive_${startDate}_${endDate}_${exportId}.zip`,
      manifest
    };
  } finally {
    clearExportBusy(userId);
  }
}

module.exports = {
  ARCHIVE_SCHEMA_VERSION,
  buildActivityArchiveZip,
  BATCH_LIMIT,
  resolveArchiveRangeBoundsMs,
  timestampInArchiveRange,
  cleanDateKey
};
