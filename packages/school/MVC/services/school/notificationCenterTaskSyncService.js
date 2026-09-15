'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const scheduledTaskDefinitionService = requireCoreModule('MVC/services/scheduledTaskDefinitionService');
const scheduledTaskDefinitionRepository = requireCoreModule('MVC/repositories/scheduledTaskDefinitionRepository');
const notificationCenterRuleService = require('./notificationCenterRuleService');
const {
  resolveDefaultTimezone
} = requireCoreModule('MVC/utils/timezoneUtils');

const PREPARE_TASK_KEY = 'school.notificationCenter.prepare';
const DISPATCH_TASK_KEY = 'school.notificationCenter.dispatch';
const SOURCE = 'school.notificationCenter';

function cleanText(value) {
  return String(value || '').trim();
}

function resolvePrimarySchedule(rule = {}) {
  const email = rule.channels?.email || {};
  const sms = rule.channels?.sms || {};
  const enabledEmail = rule.enabled === true && email.enabled === true;
  const enabledSms = rule.enabled === true && sms.enabled === true;
  const prepareAtTime = cleanText(enabledEmail ? email.prepareAtTime : sms.prepareAtTime || '17:00').slice(0, 5) || '17:00';
  const sendAtTime = cleanText(enabledEmail ? email.sendAtTime : sms.sendAtTime || '18:00').slice(0, 5) || '18:00';
  return {
    enabled: enabledEmail || enabledSms,
    prepareAtTime,
    sendAtTime
  };
}

async function upsertRuleTasks(orgId, rule, timezone) {
  const orgKey = cleanText(orgId);
  const ruleId = cleanText(rule?.id);
  if (!orgKey || !ruleId) return null;
  const schedule = resolvePrimarySchedule(rule);
  const prepareSourceRef = `${orgKey}:${ruleId}:prepare`;
  const dispatchSourceRef = `${orgKey}:${ruleId}:dispatch`;

  const [prepareDefinition, dispatchDefinition] = await Promise.all([
    scheduledTaskDefinitionService.upsertDefinition({
      orgId: orgKey,
      packageName: 'SCHOOL',
      taskKey: PREPARE_TASK_KEY,
      label: `Prepare notifications: ${rule.label || ruleId}`,
      description: 'Evaluates a notification centre rule and queues or previews recipient batches.',
      scheduleType: 'daily',
      runAtTime: schedule.prepareAtTime,
      timezone,
      enabled: schedule.enabled,
      paused: false,
      source: SOURCE,
      sourceRef: prepareSourceRef,
      input: { ruleId }
    }),
    scheduledTaskDefinitionService.upsertDefinition({
      orgId: orgKey,
      packageName: 'SCHOOL',
      taskKey: DISPATCH_TASK_KEY,
      label: `Dispatch notifications: ${rule.label || ruleId}`,
      description: 'Dispatches queued notification centre messages when send time arrives.',
      scheduleType: 'daily',
      runAtTime: schedule.sendAtTime,
      timezone,
      enabled: schedule.enabled,
      paused: false,
      source: SOURCE,
      sourceRef: dispatchSourceRef,
      input: { ruleId }
    })
  ]);

  return { prepareDefinition, dispatchDefinition, prepareSourceRef, dispatchSourceRef };
}

async function disableOrphanTasks(orgId, activeSourceRefs = []) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return [];
  const active = new Set((Array.isArray(activeSourceRefs) ? activeSourceRefs : []).map((ref) => cleanText(ref)).filter(Boolean));
  const rows = await scheduledTaskDefinitionRepository.list({
    query: {
      orgId__eq: orgKey,
      source__eq: SOURCE,
      page: 1,
      limit: 500
    }
  });
  const disabled = [];
  for (const row of rows) {
    const sourceRef = cleanText(row?.sourceRef);
    if (!sourceRef || active.has(sourceRef)) continue;
    await scheduledTaskDefinitionRepository.update(row.id, { enabled: false });
    disabled.push(row.id);
  }
  return disabled;
}

async function syncOrgRules(orgId) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  await notificationCenterRuleService.syncLegacySessionNotFinalRule(orgKey);
  const rules = await notificationCenterRuleService.listRulesForOrg(orgKey);
  const timezone = await resolveDefaultTimezone();
  const activeRefs = [];
  for (const rule of rules) {
    const synced = await upsertRuleTasks(orgKey, rule, timezone);
    if (synced?.prepareSourceRef) activeRefs.push(synced.prepareSourceRef);
    if (synced?.dispatchSourceRef) activeRefs.push(synced.dispatchSourceRef);
  }
  await disableOrphanTasks(orgKey, activeRefs);
  return { ruleCount: rules.length, activeRefs };
}

async function syncAllOrgs() {
  const notificationRuleModel = require('../../models/school/notificationRuleModel');
  const all = await notificationRuleModel.getAllNotificationRules();
  const orgIds = [...new Set(all.map((row) => cleanText(row.orgId)).filter(Boolean))];
  const results = [];
  for (const orgId of orgIds) {
    results.push({ orgId, synced: await syncOrgRules(orgId) });
  }
  return results;
}

module.exports = {
  PREPARE_TASK_KEY,
  DISPATCH_TASK_KEY,
  SOURCE,
  syncOrgRules,
  syncAllOrgs,
  upsertRuleTasks
};
