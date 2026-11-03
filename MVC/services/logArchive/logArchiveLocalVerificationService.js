'use strict';

const {
  cleanDateKey,
  userRangeExtendsBeyondManifest
} = require('./logArchiveRangeUtils');

function normalizeArchiveEntry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const range = src.range && typeof src.range === 'object' ? src.range : {};
  const startDate = cleanDateKey(src.startDate || range.startDate);
  const endDate = cleanDateKey(src.endDate || range.endDate);
  const counts = src.counts && typeof src.counts === 'object' ? src.counts : {};
  return {
    exportId: String(src.exportId || '').trim(),
    startDate,
    endDate,
    counts: {
      logs: Number(counts.logs || 0),
      actionStates: Number(counts.actionStates || 0)
    },
    hasLogsFile: src.hasLogsFile === true,
    hasActionStatesFile: src.hasActionStatesFile === true,
    ndjsonCounts: src.ndjsonCounts && typeof src.ndjsonCounts === 'object'
      ? {
        logs: Number(src.ndjsonCounts.logs || 0),
        actionStates: Number(src.ndjsonCounts.actionStates || 0)
      }
      : null
  };
}

function mergeArchiveCoverage(archives = []) {
  const rows = (Array.isArray(archives) ? archives : [])
    .map(normalizeArchiveEntry)
    .filter((row) => row.startDate && row.endDate);
  if (!rows.length) {
    return {
      archives: [],
      coveredRange: { startDate: '', endDate: '' },
      localCounts: { logs: 0, actionStates: 0 }
    };
  }
  const startDates = rows.map((r) => r.startDate).sort();
  const endDates = rows.map((r) => r.endDate).sort();
  const localCounts = rows.reduce(
    (acc, row) => ({
      logs: acc.logs + row.counts.logs,
      actionStates: acc.actionStates + row.counts.actionStates
    }),
    { logs: 0, actionStates: 0 }
  );
  return {
    archives: rows,
    coveredRange: {
      startDate: startDates[0],
      endDate: endDates[endDates.length - 1]
    },
    localCounts
  };
}

function normalizeLocalVerificationInput(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const archives = Array.isArray(src.archives) ? src.archives.map(normalizeArchiveEntry) : [];
  return { archives };
}

/**
 * Verify client-attested local archives cover the delete range and manifest counts
 * are sufficient vs server preview counts for selected collections.
 */
function verifyLocalArchiveAgainstDelete(options = {}) {
  const deleteStart = cleanDateKey(options.startDate);
  const deleteEnd = cleanDateKey(options.endDate);
  const includeLogs = options.includeLogs === true;
  const includeActionStates = options.includeActionStates === true;
  const serverCounts = options.serverCounts && typeof options.serverCounts === 'object'
    ? options.serverCounts
    : { logs: 0, actionStates: 0 };
  const { archives: rawArchives } = normalizeLocalVerificationInput(options.localVerification);

  if (!deleteStart || !deleteEnd) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: 'Start date and end date are required (YYYY-MM-DD).'
    };
  }
  if (deleteStart > deleteEnd) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: 'Start date must be on or before end date.'
    };
  }
  if (!includeLogs && !includeActionStates) {
    return {
      ok: false,
      code: 'NO_COLLECTIONS',
      message: 'Select at least one collection to delete.'
    };
  }
  if (!rawArchives.length) {
    return {
      ok: false,
      code: 'LOCAL_PROOF_REQUIRED',
      message: 'Attach at least one local activity archive (ZIP or folder with manifest.json).'
    };
  }

  const merged = mergeArchiveCoverage(rawArchives);
  const { coveredRange, localCounts, archives } = merged;

  if (!coveredRange.startDate || !coveredRange.endDate) {
    return {
      ok: false,
      code: 'LOCAL_PROOF_INVALID',
      message: 'Local archive manifest(s) are missing valid date ranges.'
    };
  }

  if (userRangeExtendsBeyondManifest(
    deleteStart,
    deleteEnd,
    coveredRange.startDate,
    coveredRange.endDate
  )) {
    return {
      ok: false,
      code: 'LOCAL_COVERAGE_GAP',
      message: `Delete range ${deleteStart} → ${deleteEnd} extends beyond local archive coverage ${coveredRange.startDate} → ${coveredRange.endDate}. Add more export ZIPs or narrow the delete range.`,
      coveredRange,
      deleteRange: { startDate: deleteStart, endDate: deleteEnd },
      archives,
      localCounts,
      serverCounts: {
        logs: Number(serverCounts.logs || 0),
        actionStates: Number(serverCounts.actionStates || 0)
      }
    };
  }

  const previewLogs = Number(serverCounts.logs || 0);
  const previewActionStates = Number(serverCounts.actionStates || 0);

  if (includeLogs && previewLogs > localCounts.logs) {
    const hasLogsBackup = rawArchives.some((row) => row.hasLogsFile === true);
    if (!hasLogsBackup) {
      return {
        ok: false,
        code: 'LOCAL_COUNT_INSUFFICIENT',
        message: `Local archives report ${localCounts.logs} log(s) but the database has ${previewLogs} in this range. Re-export or attach additional archives.`,
        coveredRange,
        localCounts,
        serverCounts: { logs: previewLogs, actionStates: previewActionStates },
        archives
      };
    }
  }
  if (includeActionStates && previewActionStates > localCounts.actionStates) {
    const hasActionStatesBackup = rawArchives.some((row) => row.hasActionStatesFile === true);
    if (!hasActionStatesBackup) {
      return {
        ok: false,
        code: 'LOCAL_COUNT_INSUFFICIENT',
        message: `Local archives report ${localCounts.actionStates} action state(s) but the database has ${previewActionStates} in this range. Re-export or attach additional archives.`,
        coveredRange,
        localCounts,
        serverCounts: { logs: previewLogs, actionStates: previewActionStates },
        archives
      };
    }
  }

  return {
    ok: true,
    coveredRange,
    deleteRange: { startDate: deleteStart, endDate: deleteEnd },
    localCounts,
    serverCounts: { logs: previewLogs, actionStates: previewActionStates },
    archives
  };
}

module.exports = {
  normalizeArchiveEntry,
  mergeArchiveCoverage,
  verifyLocalArchiveAgainstDelete
};
