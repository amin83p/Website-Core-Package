'use strict';

const { Parser } = require('json2csv');
const scheduledTaskRunRepository = require('../repositories/scheduledTaskRunRepository');

const EXPORT_CSV_FIELDS = Object.freeze([
  'id',
  'taskKey',
  'packageName',
  'orgId',
  'status',
  'scheduledFor',
  'startedAt',
  'finishedAt',
  'resultSummary',
  'errorMessage',
  'organizedByDisplayName'
]);

function cleanText(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function flattenRunForExport(row = {}) {
  return {
    id: cleanText(row.id, 120),
    taskKey: cleanText(row.taskKey, 240),
    packageName: cleanText(row.packageName, 80),
    orgId: cleanText(row.orgId, 120),
    status: cleanText(row.status, 40),
    scheduledFor: cleanText(row.scheduledFor, 80),
    startedAt: cleanText(row.startedAt, 80),
    finishedAt: cleanText(row.finishedAt, 80),
    resultSummary: cleanText(row.resultSummary, 800),
    errorMessage: cleanText(row.errorMessage, 800),
    organizedByDisplayName: cleanText(row.organizedByDisplayName, 180)
  };
}

let purgeTerminalRunsInFlight = false;

const scheduledTaskRunService = {
  async listRuns(query = {}, options = {}) {
    return scheduledTaskRunRepository.list({ ...options, query });
  },

  async countRuns(query = {}, options = {}) {
    return scheduledTaskRunRepository.count({ ...options, query });
  },

  async getRunById(id, options = {}) {
    return scheduledTaskRunRepository.getById(id, options);
  },

  async cancelRun(id, options = {}) {
    const run = await scheduledTaskRunRepository.getById(id, options);
    if (!run) throw new Error('Scheduled task run not found.');
    if (run.status !== 'pending') {
      throw new Error('Only pending runs can be cancelled.');
    }
    return scheduledTaskRunRepository.update(id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      resultSummary: 'Cancelled by user.'
    }, options);
  },

  async exportRuns(query = {}, options = {}) {
    const rows = await scheduledTaskRunRepository.listAllForQuery(query, options);
    const flatRows = rows.map((row) => flattenRunForExport(row));
    return { rows, flatRows };
  },

  runsToCsv(flatRows = []) {
    const parser = new Parser({ fields: [...EXPORT_CSV_FIELDS] });
    return parser.parse(Array.isArray(flatRows) ? flatRows : []);
  },

  async purgeTerminalRuns(options = {}) {
    if (purgeTerminalRunsInFlight) {
      throw new Error('A purge is already in progress. Try again in a moment.');
    }
    purgeTerminalRunsInFlight = true;
    try {
      const result = await scheduledTaskRunRepository.deleteTerminalRuns(options);
      if (!Number(result?.deletedCount)) {
        throw new Error('No finished task runs to purge in your scope.');
      }
      return result;
    } finally {
      purgeTerminalRunsInFlight = false;
    }
  }
};

module.exports = scheduledTaskRunService;