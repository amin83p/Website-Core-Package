'use strict';

const { registerCoreScheduledTaskHandler } = require('./scheduledTaskRegistry');
const emailOutboxDispatchService = require('./emailOutboxDispatchService');
const smsOutboxDispatchService = require('./smsOutboxDispatchService');
const scheduledTaskDefinitionService = require('./scheduledTaskDefinitionService');

function registerCoreScheduledTasks() {
  registerCoreScheduledTaskHandler({
    taskKey: 'core.emailOutbox.dispatch',
    label: 'Dispatch queued emails',
    description: 'Sends queued email outbox entries when their scheduled send time arrives.',
    scope: 'system',
    handler: async ({ logger }) => {
      const metrics = await emailOutboxDispatchService.dispatchDue({ logger });
      return {
        resultSummary: `Dispatched ${metrics.sent} email(s); ${metrics.failed} failed; ${metrics.skipped} skipped.`,
        metrics
      };
    }
  });

  registerCoreScheduledTaskHandler({
    taskKey: 'core.smsOutbox.dispatch',
    label: 'Dispatch queued SMS messages',
    description: 'Sends queued SMS outbox entries when their scheduled send time arrives.',
    scope: 'system',
    handler: async ({ logger }) => {
      const metrics = await smsOutboxDispatchService.dispatchDue({ logger });
      return {
        resultSummary: `Dispatched ${metrics.sent} SMS message(s); ${metrics.failed} failed; ${metrics.skipped} skipped.`,
        metrics
      };
    }
  });
}

async function bootstrapCoreScheduledTaskDefinitions(options = {}) {
  await scheduledTaskDefinitionService.ensureSystemDispatchDefinition(options);
  await scheduledTaskDefinitionService.ensureSystemSmsDispatchDefinition(options);
}

module.exports = {
  registerCoreScheduledTasks,
  bootstrapCoreScheduledTaskDefinitions
};
