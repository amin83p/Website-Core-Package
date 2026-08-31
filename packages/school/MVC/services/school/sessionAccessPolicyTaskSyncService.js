'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const scheduledTaskDefinitionService = requireCoreModule('MVC/services/scheduledTaskDefinitionService');
const scheduledTaskDefinitionRepository = requireCoreModule('MVC/repositories/scheduledTaskDefinitionRepository');
const {
  resolveDefaultTimezone
} = requireCoreModule('MVC/utils/timezoneUtils');

const EMAIL_PREPARE_TASK_KEY = 'school.uncompletedSessionEmail.prepare';
const EMAIL_DISPATCH_TASK_KEY = 'school.uncompletedSessionEmail.dispatch';
const SMS_PREPARE_TASK_KEY = 'school.uncompletedSessionSms.prepare';
const SMS_DISPATCH_TASK_KEY = 'school.uncompletedSessionSms.dispatch';
const SOURCE = 'school.sessionAccessPolicy';

const EMAIL_TASK_KEY = EMAIL_PREPARE_TASK_KEY;

function cleanText(value) {
  return String(value || '').trim();
}

async function resolveTaskTimezone() {
  return resolveDefaultTimezone();
}

function isChannelTaskEnabled(notification, channel = {}) {
  return notification.enabled === true && channel.enabled === true;
}

function buildChannelTaskInput(channel = {}) {
  return {
    sendWhen: cleanText(channel.sendWhen || 'same_day'),
    prepareAtTime: cleanText(channel.prepareAtTime || channel.sendAtTime || '17:00').slice(0, 5),
    sendAtTime: cleanText(channel.sendAtTime || '18:00').slice(0, 5),
    sessionDateRange: channel.sessionDateRange || {}
  };
}

async function upsertChannelTasks({
  orgId,
  notification,
  channelName,
  prepareTaskKey,
  dispatchTaskKey,
  prepareLabel,
  dispatchLabel,
  timezone
}) {
  const channel = notification.channels?.[channelName] || {};
  const enabled = isChannelTaskEnabled(notification, channel);
  const input = buildChannelTaskInput(channel);
  const prepareSourceRef = `${orgId}:${channelName}:prepare`;
  const dispatchSourceRef = `${orgId}:${channelName}:dispatch`;

  const [prepareDefinition, dispatchDefinition] = await Promise.all([
    scheduledTaskDefinitionService.upsertDefinition({
      orgId,
      packageName: 'SCHOOL',
      taskKey: prepareTaskKey,
      label: prepareLabel,
      description: `Builds ${channelName} notification payloads and queues them in the core ${channelName} outbox.`,
      scheduleType: 'daily',
      runAtTime: input.prepareAtTime,
      timezone,
      enabled,
      paused: false,
      source: SOURCE,
      sourceRef: prepareSourceRef,
      input
    }),
    scheduledTaskDefinitionService.upsertDefinition({
      orgId,
      packageName: 'SCHOOL',
      taskKey: dispatchTaskKey,
      label: dispatchLabel,
      description: `Dispatches queued ${channelName} outbox entries when their scheduled send time arrives.`,
      scheduleType: 'daily',
      runAtTime: input.sendAtTime,
      timezone,
      enabled,
      paused: false,
      source: SOURCE,
      sourceRef: dispatchSourceRef,
      input
    })
  ]);

  return { prepareDefinition, dispatchDefinition };
}

async function disableOrphanPolicyTasks(orgId, activeSourceRefs = []) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return [];

  const active = new Set((Array.isArray(activeSourceRefs) ? activeSourceRefs : []).map((ref) => cleanText(ref)).filter(Boolean));
  const rows = await scheduledTaskDefinitionRepository.list({
    query: {
      orgId__eq: orgKey,
      source__eq: SOURCE,
      page: 1,
      limit: 200
    }
  });

  const disabled = [];
  for (const row of rows) {
    const sourceRef = cleanText(row?.sourceRef);
    if (!sourceRef || active.has(sourceRef)) continue;
    // eslint-disable-next-line no-await-in-loop
    await scheduledTaskDefinitionRepository.update(row.id, { enabled: false });
    disabled.push(row.id);
  }
  return disabled;
}

async function syncSessionAccessPolicyTasks(orgId = '', policy = null) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;

  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgKey);
  const notification = resolvedPolicy?.uncompletedSessionNotification || {};
  const timezone = await resolveTaskTimezone();

  const emailTasks = await upsertChannelTasks({
    orgId: orgKey,
    notification,
    channelName: 'email',
    prepareTaskKey: EMAIL_PREPARE_TASK_KEY,
    dispatchTaskKey: EMAIL_DISPATCH_TASK_KEY,
    prepareLabel: 'Prepare uncompleted session emails',
    dispatchLabel: 'Dispatch uncompleted session emails',
    timezone
  });

  const smsTasks = await upsertChannelTasks({
    orgId: orgKey,
    notification,
    channelName: 'sms',
    prepareTaskKey: SMS_PREPARE_TASK_KEY,
    dispatchTaskKey: SMS_DISPATCH_TASK_KEY,
    prepareLabel: 'Prepare uncompleted session SMS messages',
    dispatchLabel: 'Dispatch uncompleted session SMS messages',
    timezone
  });

  const activeSourceRefs = [
    `${orgKey}:email:prepare`,
    `${orgKey}:email:dispatch`,
    `${orgKey}:sms:prepare`,
    `${orgKey}:sms:dispatch`
  ];
  await disableOrphanPolicyTasks(orgKey, activeSourceRefs);

  return {
    emailPrepareDefinition: emailTasks.prepareDefinition,
    emailDispatchDefinition: emailTasks.dispatchDefinition,
    smsPrepareDefinition: smsTasks.prepareDefinition,
    smsDispatchDefinition: smsTasks.dispatchDefinition,
    emailDefinition: emailTasks.prepareDefinition,
    smsDefinition: smsTasks.prepareDefinition
  };
}

async function syncAllSessionAccessPolicyTasks() {
  const doc = await sessionAccessPolicyModel.readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const orgIds = Object.keys(byOrg).filter((orgId) => cleanText(orgId) && cleanText(orgId) !== 'SYSTEM');
  const results = [];
  for (const orgId of orgIds) {
    // eslint-disable-next-line no-await-in-loop
    const synced = await syncSessionAccessPolicyTasks(orgId);
    results.push({ orgId, synced });
  }
  return results;
}

module.exports = {
  TASK_KEY: EMAIL_TASK_KEY,
  EMAIL_TASK_KEY,
  EMAIL_PREPARE_TASK_KEY,
  EMAIL_DISPATCH_TASK_KEY,
  SMS_TASK_KEY: SMS_PREPARE_TASK_KEY,
  SMS_PREPARE_TASK_KEY,
  SMS_DISPATCH_TASK_KEY,
  SOURCE,
  syncSessionAccessPolicyTasks,
  syncAllSessionAccessPolicyTasks,
  disableOrphanPolicyTasks
};
