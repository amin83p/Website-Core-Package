'use strict';

const scheduledTaskRunRepository = require('../repositories/scheduledTaskRunRepository');

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
  }
};

module.exports = scheduledTaskRunService;
