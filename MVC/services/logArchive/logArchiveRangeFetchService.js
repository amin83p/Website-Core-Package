'use strict';

const dataService = require('../dataService');
const {
  resolveArchiveRangeBoundsMs,
  timestampInArchiveRange,
  actionStateRowInArchiveRange
} = require('./logArchiveRangeUtils');
const { normalizePersistedLogRecord } = require('../../utils/logRecordUtils');

const BATCH_LIMIT = 1000;

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
  return rows.filter((row) => actionStateRowInArchiveRange(row, bounds));
}

async function countLogsForRange({ startDate, endDate, timezone, requestUser }) {
  const bounds = resolveArchiveRangeBoundsMs(startDate, endDate, timezone);
  const pageSize = BATCH_LIMIT;
  let page = 1;
  let total = 0;
  for (;;) {
    const rows = await dataService.fetchData('logs', {
      startDate,
      endDate,
      sort: 'timestamp',
      page,
      limit: pageSize
    }, requestUser);
    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;
    total += batch
      .map((row) => normalizePersistedLogRecord(row))
      .filter(Boolean)
      .filter((row) => timestampInArchiveRange(row.timestamp, bounds)).length;
    if (batch.length < pageSize) break;
    page += 1;
    if (page > 2000) break;
  }
  return total;
}

async function countActionStatesForRange({ startDate, endDate, timezone, requestUser }) {
  const bounds = resolveArchiveRangeBoundsMs(startDate, endDate, timezone);
  const pageSize = BATCH_LIMIT;
  let page = 1;
  let total = 0;
  for (;;) {
    const rows = await dataService.fetchData('actionStates', {
      startDate,
      endDate,
      sort: '-startedAt',
      page,
      limit: pageSize
    }, requestUser);
    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;
    total += batch.filter((row) => actionStateRowInArchiveRange(row, bounds)).length;
    if (batch.length < pageSize) break;
    page += 1;
    if (page > 2000) break;
  }
  return total;
}

module.exports = {
  BATCH_LIMIT,
  fetchAllPaged,
  fetchLogsForRange,
  fetchActionStatesForRange,
  countLogsForRange,
  countActionStatesForRange
};
