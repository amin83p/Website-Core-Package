'use strict';

const schoolDataService = require('./schoolDataService');
const holidayModel = require('../../models/school/holidayModel');
const holidayYearCalendarStateModel = require('../../models/school/holidayYearCalendarStateModel');
const holidayAiObservancePreviewService = require('./holidayAiObservancePreviewService');
function normalizeHolidayTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function getStateForOrgYear(orgId, year, requestingUser) {
  const targetYear = holidayAiObservancePreviewService.assertYear(year);
  const rows = await schoolDataService.fetchAllData('holidayYearCalendarStates', {
    orgId__eq: orgId,
    year__eq: targetYear
  }, requestingUser);
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row.orgId) === String(orgId) && String(row.year) === targetYear
  ) || null;
}

async function ensureStateForOrgYear(orgId, year, requestingUser) {
  const existing = await getStateForOrgYear(orgId, year, requestingUser);
  if (existing) return existing;
  return schoolDataService.addData('holidayYearCalendarStates', {
    orgId,
    year: holidayAiObservancePreviewService.assertYear(year),
    aiBatches: []
  }, requestingUser);
}

function findLatestAppliedBatch(state) {
  const batches = Array.isArray(state?.aiBatches) ? state.aiBatches : [];
  for (let i = batches.length - 1; i >= 0; i -= 1) {
    if (String(batches[i]?.status || '').toLowerCase() === 'applied') return batches[i];
  }
  return null;
}

function buildUndoSummary(state) {
  const latest = findLatestAppliedBatch(state);
  if (!latest) {
    return { canUndo: false, batch: null };
  }
  return {
    canUndo: true,
    batch: {
      batchId: latest.batchId,
      createdAt: latest.createdAt,
      createdByUserId: latest.createdByUserId,
      stats: latest.stats || {},
      holidayCount: (latest.holidayIds || []).length,
      occasionInput: latest.occasionInput || ''
    }
  };
}

async function applyPreview({
  orgId,
  year,
  previewItems = [],
  occasionInput = '',
  regionHint = '',
  traceId = '',
  usageRecordId = '',
  meta = {},
  requestingUser
}) {
  const targetYear = holidayAiObservancePreviewService.assertYear(year);
  const selected = (Array.isArray(previewItems) ? previewItems : [])
    .filter((row) => row && row.selected !== false && !row.duplicate);
  if (!selected.length) throw new Error('Select at least one occasion day to add.');

  const createdIds = [];
  const importedRows = [];
  let skippedDuplicates = 0;
  const existing = await schoolDataService.fetchAllData('holidays', {}, requestingUser);
  const dupIndex = new Set();
  (existing || []).forEach((row) => {
    if (String(row.orgId) !== String(orgId)) return;
    const date = String(row.date || '').trim().slice(0, 10);
    dupIndex.add(`${date}|${normalizeHolidayTitle(row.title)}`);
  });

  for (const row of selected) {
    const date = String(row.date || '').trim().slice(0, 10);
    const title = String(row.title || row.occasionName || '').trim();
    if (!date.startsWith(`${targetYear}-`) || !title) continue;
    const key = `${date}|${normalizeHolidayTitle(title)}`;
    if (dupIndex.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    const saved = await schoolDataService.addData('holidays', {
      orgId,
      date,
      title,
      type: holidayModel.SCHOOL_OPEN_OBSERVANCE_TYPE,
      notes: String(row.notes || '').trim(),
      countsAsSchoolOff: false,
      statutoryHolidayPayable: false
    }, requestingUser);
    if (saved?.id) {
      const holidayId = String(saved.id);
      createdIds.push(holidayId);
      importedRows.push({ holidayId, date, title });
      dupIndex.add(key);
    }
  }

  if (!createdIds.length) {
    throw new Error('No new holidays were created (all selected rows were duplicates).');
  }

  const state = await ensureStateForOrgYear(orgId, targetYear, requestingUser);
  const batch = holidayYearCalendarStateModel.sanitizeBatch({
    batchId: holidayYearCalendarStateModel.generateBatchId(),
    status: 'applied',
    createdAt: new Date().toISOString(),
    createdByUserId: String(requestingUser?.id || ''),
    occasionInput: String(occasionInput || meta.occasionInput || '').trim(),
    regionHint: String(regionHint || meta.regionHint || '').trim(),
    traceId: String(traceId || '').trim(),
    usageRecordId: String(usageRecordId || '').trim(),
    holidayIds: createdIds,
    importedRows,
    stats: {
      requestedOccasions: Number(meta.requestedOccasions || 0),
      previewDays: Number(meta.previewDays || selected.length),
      created: createdIds.length,
      skippedDuplicates
    }
  });

  const aiBatches = [...(Array.isArray(state.aiBatches) ? state.aiBatches : []), batch];
  await schoolDataService.updateData('holidayYearCalendarStates', state.id, {
    orgId,
    year: targetYear,
    aiBatches
  }, requestingUser);

  return {
    batchId: batch.batchId,
    createdIds,
    created: createdIds.length,
    skippedDuplicates
  };
}

async function resolveBatchHolidayItems(batch, requestingUser) {
  const snapshot = Array.isArray(batch?.importedRows) ? batch.importedRows : [];
  const ids = (Array.isArray(batch?.holidayIds) ? batch.holidayIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const items = [];

  if (snapshot.length) {
    for (const row of snapshot) {
      const holidayId = String(row.holidayId || '').trim();
      if (!holidayId) continue;
      let stillOnCalendar = false;
      let date = String(row.date || '').trim().slice(0, 10);
      let title = String(row.title || '').trim();
      try {
        const live = await schoolDataService.getDataById('holidays', holidayId, requestingUser);
        if (live) {
          stillOnCalendar = true;
          date = String(live.date || date).trim().slice(0, 10);
          title = String(live.title || title).trim();
        }
      } catch (_) {
        stillOnCalendar = false;
      }
      items.push({ holidayId, date, title, stillOnCalendar });
    }
  } else {
    for (const holidayId of ids) {
      let stillOnCalendar = false;
      let date = '';
      let title = '';
      try {
        const live = await schoolDataService.getDataById('holidays', holidayId, requestingUser);
        if (live) {
          stillOnCalendar = true;
          date = String(live.date || '').trim().slice(0, 10);
          title = String(live.title || '').trim();
        }
      } catch (_) {
        stillOnCalendar = false;
      }
      items.push({ holidayId, date, title, stillOnCalendar });
    }
  }

  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
}

async function getUndoReview(state, requestingUser) {
  const summary = buildUndoSummary(state);
  if (!summary.canUndo) {
    return { canUndo: false, batch: null, items: [] };
  }
  const batch = findLatestAppliedBatch(state);
  const items = await resolveBatchHolidayItems(batch, requestingUser);
  return {
    canUndo: true,
    batch: {
      ...summary.batch,
      items
    },
    items
  };
}

async function undoLastBatch({ orgId, year, requestingUser }) {
  const targetYear = holidayAiObservancePreviewService.assertYear(year);
  const state = await getStateForOrgYear(orgId, targetYear, requestingUser);
  if (!state) throw new Error('No AI import history found for this year.');
  const batch = findLatestAppliedBatch(state);
  if (!batch) throw new Error('Nothing to undo. The last AI import was already undone or none exists.');

  const holidayIds = [...(Array.isArray(batch.holidayIds) ? batch.holidayIds : [])];
  let deleted = 0;
  let missing = 0;

  for (const id of holidayIds) {
    try {
      const row = await schoolDataService.getDataById('holidays', id, requestingUser);
      if (!row) {
        missing += 1;
        continue;
      }
      if (String(row.orgId) !== String(orgId)) continue;
      await schoolDataService.deleteData('holidays', id, requestingUser);
      deleted += 1;
    } catch (_) {
      missing += 1;
    }
  }

  const aiBatches = (Array.isArray(state.aiBatches) ? state.aiBatches : []).map((item) => {
    if (String(item.batchId) !== String(batch.batchId)) return item;
    return {
      ...item,
      status: 'undone',
      undoneAt: new Date().toISOString(),
      undoneByUserId: String(requestingUser?.id || ''),
      stats: {
        ...(item.stats || {}),
        undoneDeleted: deleted,
        undoneMissing: missing
      }
    };
  });

  await schoolDataService.updateData('holidayYearCalendarStates', state.id, {
    orgId,
    year: targetYear,
    aiBatches
  }, requestingUser);

  return {
    batchId: batch.batchId,
    deleted,
    missing,
    requested: holidayIds.length
  };
}

module.exports = {
  getStateForOrgYear,
  buildUndoSummary,
  getUndoReview,
  resolveBatchHolidayItems,
  applyPreview,
  undoLastBatch
};