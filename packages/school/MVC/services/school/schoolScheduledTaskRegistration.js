'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');const { registerPackageScheduledTaskHandler } = requireCoreModule('MVC/services/scheduledTaskRegistry');
const {
  EMAIL_PREPARE_TASK_KEY,
  EMAIL_DISPATCH_TASK_KEY,
  SMS_PREPARE_TASK_KEY,
  SMS_DISPATCH_TASK_KEY
} = require('./sessionAccessPolicyTaskSyncService');
const {
  PREPARE_TASK_KEY: NC_PREPARE_TASK_KEY,
  DISPATCH_TASK_KEY: NC_DISPATCH_TASK_KEY
} = require('./notificationCenterTaskSyncService');

function cleanText(value) {
  return String(value || '').trim();
}

function registerSchoolScheduledTasks() {
  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: EMAIL_PREPARE_TASK_KEY,
    label: 'Prepare uncompleted session emails',
    description: 'Queues notification emails in the core email outbox for later dispatch.',
    scope: 'org',
    handler: async () => ({
      resultSummary: 'Uncompleted session email prepare is retired; use Notification Centre rules.',
      metrics: { skipped: 1, retired: true }
    })
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: EMAIL_DISPATCH_TASK_KEY,
    label: 'Dispatch uncompleted session emails',
    description: 'Sends queued notification emails from the core email outbox for this organization.',
    scope: 'org',
    handler: async () => ({
      resultSummary: 'Uncompleted session email dispatch is retired; use Notification Centre outbox.',
      metrics: { skipped: 1, retired: true }
    })
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: SMS_PREPARE_TASK_KEY,
    label: 'Prepare uncompleted session SMS messages',
    description: 'Queues notification SMS messages in the core SMS outbox for later dispatch.',
    scope: 'org',
    handler: async () => ({
      resultSummary: 'Uncompleted session SMS prepare is retired; use Notification Centre rules.',
      metrics: { skipped: 1, retired: true }
    })
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: SMS_DISPATCH_TASK_KEY,
    label: 'Dispatch uncompleted session SMS messages',
    description: 'Sends queued notification SMS messages from the core SMS outbox for this organization.',
    scope: 'org',
    handler: async () => ({
      resultSummary: 'Uncompleted session SMS dispatch is retired; use Notification Centre outbox.',
      metrics: { skipped: 1, retired: true }
    })
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: NC_PREPARE_TASK_KEY,
    label: 'Prepare notification centre rule',
    description: 'Evaluates a notification rule on schedule and stores preview results for review.',
    scope: 'org',
    handler: async ({ orgId, input = {}, logger, now }) => {
      const notificationCenterDeliveryService = require('./notificationCenterDeliveryService');
      const ruleId = cleanText(input.ruleId);
      if (!ruleId) {
        return {
          resultSummary: 'Skipped: missing ruleId in task input.',
          metrics: { skipped: 1 }
        };
      }
      const metrics = await notificationCenterDeliveryService.prepareScheduledRule({
        orgId,
        ruleId,
        logger,
        now
      });
      return {
        resultSummary: `Prepared preview run${metrics.runId ? ` (${metrics.runId})` : ''}; batches ${metrics.prepared || 0}.`,
        metrics
      };
    }
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: NC_DISPATCH_TASK_KEY,
    label: 'Dispatch notification centre messages (disabled)',
    description: 'Notification centre uses manual email scheduling only.',
    scope: 'org',
    handler: async () => ({
      resultSummary: 'Notification centre scheduled dispatch is disabled; schedule emails from a run review.',
      metrics: { skipped: 1 }
    })
  });
}

module.exports = {
  registerSchoolScheduledTasks
};
