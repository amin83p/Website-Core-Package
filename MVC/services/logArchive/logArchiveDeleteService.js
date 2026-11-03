'use strict';

const { cleanDateKey } = require('./logArchiveRangeUtils');
const rangeFetch = require('./logArchiveRangeFetchService');
const rangeDelete = require('./logArchiveRangeDeleteService');
const { verifyLocalArchiveAgainstDelete } = require('./logArchiveLocalVerificationService');

const DELETE_BATCH_SIZE = 100;

const deleteJobsByUser = new Map();

function validateDeleteOptions(options = {}) {
  const timezone = String(options?.timezone || options?.requestUser?.activeOrgTimeZone || 'UTC').trim() || 'UTC';
  const startDate = cleanDateKey(options?.startDate);
  const endDate = cleanDateKey(options?.endDate);
  const includeLogs = options?.includeLogs === true;
  const includeActionStates = options?.includeActionStates === true;

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
  if (!includeLogs && !includeActionStates) {
    const err = new Error('Select at least one collection to delete.');
    err.code = 'NO_COLLECTIONS';
    throw err;
  }

  return {
    timezone,
    startDate,
    endDate,
    includeLogs,
    includeActionStates,
    requestUser: options?.requestUser || null
  };
}

function assertDeleteNotBusy(userId) {
  const key = String(userId || 'anonymous');
  if (deleteJobsByUser.get(key)) {
    const err = new Error('A delete operation is already running for this user.');
    err.code = 'DELETE_BUSY';
    throw err;
  }
}

function markDeleteBusy(userId) {
  deleteJobsByUser.set(String(userId || 'anonymous'), Date.now());
}

function clearDeleteBusy(userId) {
  deleteJobsByUser.delete(String(userId || 'anonymous'));
}

async function previewArchiveRangeDelete(options = {}) {
  const parsed = validateDeleteOptions(options);
  const { startDate, endDate, timezone, includeLogs, includeActionStates, requestUser } = parsed;

  const [logCount, actionStateCount] = await Promise.all([
    includeLogs
      ? rangeFetch.countLogsForRange({ startDate, endDate, timezone, requestUser })
      : Promise.resolve(0),
    includeActionStates
      ? rangeFetch.countActionStatesForRange({ startDate, endDate, timezone, requestUser })
      : Promise.resolve(0)
  ]);

  const counts = {
    logs: includeLogs ? logCount : 0,
    actionStates: includeActionStates ? actionStateCount : 0
  };

  const preview = {
    startDate,
    endDate,
    timezone,
    includeLogs,
    includeActionStates,
    counts
  };

  let verification = null;
  if (options.localVerification) {
    verification = verifyLocalArchiveAgainstDelete({
      startDate,
      endDate,
      includeLogs,
      includeActionStates,
      serverCounts: counts,
      localVerification: options.localVerification
    });
  }

  return { preview, verification };
}

async function deleteArchiveRangeRecords(options = {}) {
  const parsed = validateDeleteOptions(options);
  const { startDate, endDate, timezone, includeLogs, includeActionStates, requestUser } = parsed;
  const userId = String(requestUser?.id || 'anonymous');

  const { preview, verification } = await previewArchiveRangeDelete({
    startDate,
    endDate,
    timezone,
    includeLogs,
    includeActionStates,
    requestUser,
    localVerification: options.localVerification
  });

  if (!options.localVerification) {
    const err = new Error('Local archive verification is required before deleting records.');
    err.code = 'LOCAL_PROOF_REQUIRED';
    throw err;
  }

  if (!verification?.ok) {
    const err = new Error(verification.message || 'Local archive verification failed.');
    err.code = verification.code || 'LOCAL_VERIFICATION_FAILED';
    err.verification = verification;
    throw err;
  }

  assertDeleteNotBusy(userId);
  markDeleteBusy(userId);

  try {
    const [deletedLogs, deletedActionStates] = await Promise.all([
      includeLogs
        ? rangeDelete.deleteLogsForArchiveRange({
          startDate,
          endDate,
          timezone,
          requestUser
        })
        : Promise.resolve(0),
      includeActionStates
        ? rangeDelete.deleteActionStatesForArchiveRange({
          startDate,
          endDate,
          timezone,
          requestUser
        })
        : Promise.resolve(0)
    ]);

    const expectedLogs = preview?.counts?.logs ?? 0;
    const expectedStates = preview?.counts?.actionStates ?? 0;
    if (includeLogs && deletedLogs !== expectedLogs) {
      console.warn(
        `Log archive delete: logs deleted (${deletedLogs}) differed from preview count (${expectedLogs}).`
      );
    }
    if (includeActionStates && deletedActionStates !== expectedStates) {
      console.warn(
        `Log archive delete: action states deleted (${deletedActionStates}) differed from preview count (${expectedStates}).`
      );
    }

    return {
      startDate,
      endDate,
      timezone,
      deleted: {
        logs: deletedLogs,
        actionStates: deletedActionStates
      },
      verification
    };
  } finally {
    clearDeleteBusy(userId);
  }
}

module.exports = {
  DELETE_BATCH_SIZE,
  previewArchiveRangeDelete,
  deleteArchiveRangeRecords,
  validateDeleteOptions
};
