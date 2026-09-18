'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');const { registerPackageScheduledTaskHandler } = requireCoreModule('MVC/services/scheduledTaskRegistry');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const sessionNotificationPrepareService = require('./sessionNotificationPrepareService');
const sessionNotificationOutboxDispatchService = require('./sessionNotificationOutboxDispatchService');
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
    handler: async ({ orgId, logger, now, run, prepareMode }) => {
      const policy = await sessionAccessPolicyModel.getPolicyForOrg(orgId);
      const metrics = await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
        orgId,
        policy,
        logger,
        now,
        prepareMode,
        prepareRunId: cleanText(run?.id)
      });
      const resultSummary = `Prepared ${metrics.prepared} email(s); skipped ${metrics.skipped}; teachers ${metrics.teachers}.`;
      return {
        resultSummary,
        metrics
      };
    }
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: EMAIL_DISPATCH_TASK_KEY,
    label: 'Dispatch uncompleted session emails',
    description: 'Sends queued notification emails from the core email outbox for this organization.',
    scope: 'org',
    handler: async ({ orgId, logger, now }) => {
      const metrics = await sessionNotificationOutboxDispatchService.dispatchUncompletedSessionEmailsForOrg({
        orgId,
        logger,
        now
      });
      return {
        resultSummary: `Dispatched ${metrics.sent} email(s); ${metrics.failed} failed; ${metrics.skipped} skipped.`,
        metrics
      };
    }
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: SMS_PREPARE_TASK_KEY,
    label: 'Prepare uncompleted session SMS messages',
    description: 'Queues notification SMS messages in the core SMS outbox for later dispatch.',
    scope: 'org',
    handler: async ({ orgId, logger, now, run, prepareMode }) => {
      const policy = await sessionAccessPolicyModel.getPolicyForOrg(orgId);
      const metrics = await sessionNotificationPrepareService.prepareUncompletedSessionSmsForOrg({
        orgId,
        policy,
        logger,
        now,
        prepareMode,
        prepareRunId: cleanText(run?.id)
      });
      return {
        resultSummary: `Prepared ${metrics.prepared} SMS message(s); skipped ${metrics.skipped}; teachers ${metrics.teachers}.`,
        metrics
      };
    }
  });

  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: SMS_DISPATCH_TASK_KEY,
    label: 'Dispatch uncompleted session SMS messages',
    description: 'Sends queued notification SMS messages from the core SMS outbox for this organization.',
    scope: 'org',
    handler: async ({ orgId, logger, now }) => {
      const metrics = await sessionNotificationOutboxDispatchService.dispatchUncompletedSessionSmsForOrg({
        orgId,
        logger,
        now
      });
      return {
        resultSummary: `Dispatched ${metrics.sent} SMS message(s); ${metrics.failed} failed; ${metrics.skipped} skipped.`,
        metrics
      };
    }
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
