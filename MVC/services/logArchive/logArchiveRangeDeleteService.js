'use strict';

const logRepository = require('../../repositories/logRepository');
const actionStateRepository = require('../../repositories/actionStateRepository');

async function deleteLogsForArchiveRange({ startDate, endDate, timezone, requestUser }, options = {}) {
  return logRepository.removeByArchiveRange(
    { startDate, endDate, timezone, requestUser },
    options
  );
}

async function deleteActionStatesForArchiveRange({ startDate, endDate, timezone, requestUser }, options = {}) {
  return actionStateRepository.removeByArchiveRange(
    { startDate, endDate, timezone, requestUser },
    options
  );
}

module.exports = {
  deleteLogsForArchiveRange,
  deleteActionStatesForArchiveRange
};
