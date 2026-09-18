'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const scheduledTaskDefinitionService = requireCoreModule('MVC/services/scheduledTaskDefinitionService');
const scheduledTaskDefinitionRepository = requireCoreModule('MVC/repositories/scheduledTaskDefinitionRepository');
const {
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow,
  resolveActiveOrgTimezoneFromUser,
  getTodayDateKeyInTimezone
} = requireCoreModule('MVC/utils/timezoneUtils');
const notificationRuleModel = require('../../models/school/notificationRuleModel');
const notificationCenterRuleService = require('./notificationCenterRuleService');

async function resolveOrgTimeZone(orgId) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return resolveDefaultTimezone();
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgKey);
    if (row) return resolveOrganizationTimezoneFromRow(row);
  } catch (_) {
    // fall through
  }
  return resolveDefaultTimezone();
}

async function resolveSchedulingTimezone(orgId, reqUser = null, options = {}) {
  const explicit = cleanText(options.schedulingTimezone);
  if (explicit) return explicit;
  const orgTz = await resolveOrgTimeZone(orgId);
  if (reqUser) {
    const userTz = resolveActiveOrgTimezoneFromUser(reqUser);
    if (userTz) return userTz;
  }
  return orgTz || resolveDefaultTimezone();
}

const PREPARE_TASK_KEY = 'school.notificationCenter.prepare';
const DISPATCH_TASK_KEY = 'school.notificationCenter.dispatch';
const SOURCE = 'school.notificationCenter';
const RULE_SOURCE_REF_PREFIX = 'rule:';

function cleanText(value) {
  return String(value || '').trim();
}

function buildRuleSourceRef(ruleId) {
  return `${RULE_SOURCE_REF_PREFIX}${cleanText(ruleId)}`;
}

function resolveRuleDaysOfWeek(rule = {}) {
  const schedule = rule.schedule && typeof rule.schedule === 'object' ? rule.schedule : {};
  const hadExplicitDays = schedule.daysOfWeek !== undefined && schedule.daysOfWeek !== null && schedule.daysOfWeek !== '';
  const days = notificationRuleModel.normalizeDaysOfWeek(schedule.daysOfWeek);
  if (days.length) return days;
  if (schedule.scheduleEnabled === true && !hadExplicitDays) return [0, 1, 2, 3, 4, 5, 6];
  return [];
}

function isScheduleActive(rule = {}) {
  return notificationRuleModel.isRuleScheduleConfigured(rule)
    && resolveRuleDaysOfWeek(rule).length >= 1;
}

function isScheduledTaskEnabledForRule(rule = {}, timeZone = '') {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const todayKey = getTodayDateKeyInTimezone(tz);
  return notificationRuleModel.isRuleScheduledEvaluationAllowed(rule, todayKey);
}

async function syncRuleScheduledTasks(orgId, rule, options = {}) {
  const orgKey = cleanText(orgId);
  const ruleId = cleanText(rule?.id);
  if (!orgKey || !ruleId) return null;

  const schedule = rule.schedule && typeof rule.schedule === 'object' ? rule.schedule : {};
  const timezone = await resolveSchedulingTimezone(orgKey, options.reqUser, options);
  const runAtTime = cleanText(schedule.runAtTime).slice(0, 5) || '08:00';
  const daysOfWeek = resolveRuleDaysOfWeek(rule);
  const active = isScheduledTaskEnabledForRule(rule, timezone);
  const sourceRef = buildRuleSourceRef(ruleId);
  const label = cleanText(rule.label) || ruleId;

  return scheduledTaskDefinitionService.upsertDefinition({
    orgId: orgKey,
    packageName: 'SCHOOL',
    taskKey: PREPARE_TASK_KEY,
    label: `Notification centre: ${label}`,
    description: 'Runs a scheduled notification rule evaluation and stores preview results for review.',
    scheduleType: 'weekly',
    runAtTime: active ? runAtTime : (runAtTime || '08:00'),
    timezone,
    enabled: active,
    paused: false,
    source: SOURCE,
    sourceRef,
    input: { ruleId, daysOfWeek }
  }, options);
}

async function disableOrphanNcRuleTasks(orgId, activeSourceRefs = []) {
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
  const disabledIds = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const ref = cleanText(row?.sourceRef);
    if (!ref.startsWith(RULE_SOURCE_REF_PREFIX)) continue;
    if (active.has(ref)) continue;
    if (row?.enabled === false && row?.paused === true) continue;
    // eslint-disable-next-line no-await-in-loop
    await scheduledTaskDefinitionRepository.update(row.id, { enabled: false, paused: true });
    disabledIds.push(row.id);
  }
  return disabledIds;
}

async function syncAllRulesForOrg(orgId, reqUser = null, options = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return { synced: 0, activeRefs: [] };

  const user = reqUser || notificationCenterRuleService.buildNcReqUser(orgKey, 'task-sync');
  const syncOptions = {
    ...options,
    reqUser: user
  };
  const rules = await notificationCenterRuleService.listRulesForOrg(orgKey, user);
  const activeRefs = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule?.id) continue;
    activeRefs.push(buildRuleSourceRef(rule.id));
    // eslint-disable-next-line no-await-in-loop
    await syncRuleScheduledTasks(orgKey, rule, syncOptions);
  }
  const disabledIds = await disableOrphanNcRuleTasks(orgKey, activeRefs);
  return { synced: activeRefs.length, activeRefs, disabledIds };
}

/** @deprecated Disables all NC task definitions including legacy rows. Prefer rule-scoped sync. */
async function disableNotificationCenterScheduledTasks(orgId) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return { disabledIds: [] };
  const rows = await scheduledTaskDefinitionRepository.list({
    query: {
      orgId__eq: orgKey,
      source__eq: SOURCE,
      page: 1,
      limit: 500
    }
  });
  const disabledIds = [];
  for (const row of rows) {
    if (row?.enabled !== false || row?.paused !== true) {
      // eslint-disable-next-line no-await-in-loop
      await scheduledTaskDefinitionRepository.update(row.id, { enabled: false, paused: true });
      disabledIds.push(row.id);
    }
  }
  return { disabledIds };
}

async function syncOrgRules(orgId, reqUser = null, options = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  await notificationCenterRuleService.syncLegacySessionNotFinalRule(orgKey, null, reqUser || notificationCenterRuleService.buildNcReqUser(orgKey, 'legacy-sync'));
  return syncAllRulesForOrg(orgKey, reqUser, options);
}

async function syncAllOrgs() {
  const schoolRepositories = require('../../repositories/school');
  const { buildUnboundedQuery } = require('./schoolPaginationUtils');
  const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
  const all = await schoolRepositories.notificationRules.list({
    query: normalizeQueryOptions(buildUnboundedQuery({})),
    scope: { canViewAll: true }
  });
  const orgIds = [...new Set((Array.isArray(all) ? all : []).map((row) => cleanText(row.orgId)).filter(Boolean))];
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
  buildRuleSourceRef,
  isScheduleActive,
  syncRuleScheduledTasks,
  syncAllRulesForOrg,
  disableNotificationCenterScheduledTasks,
  syncOrgRules,
  syncAllOrgs
};
