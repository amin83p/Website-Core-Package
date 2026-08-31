'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const emailOutboxDispatchService = requireCoreModule('MVC/services/emailOutboxDispatchService');
const smsOutboxDispatchService = requireCoreModule('MVC/services/smsOutboxDispatchService');

async function dispatchUncompletedSessionEmailsForOrg({ orgId = '', logger = null, now = new Date() } = {}) {
  const metrics = await emailOutboxDispatchService.dispatchDue({ orgId, now, logger });
  return metrics;
}

async function dispatchUncompletedSessionSmsForOrg({ orgId = '', logger = null, now = new Date() } = {}) {
  const metrics = await smsOutboxDispatchService.dispatchDue({ orgId, now, logger });
  return metrics;
}

module.exports = {
  dispatchUncompletedSessionEmailsForOrg,
  dispatchUncompletedSessionSmsForOrg
};
