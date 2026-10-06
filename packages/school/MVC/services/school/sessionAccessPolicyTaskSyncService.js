'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const scheduledTaskDefinitionRepository = requireCoreModule('MVC/repositories/scheduledTaskDefinitionRepository');

const EMAIL_PREPARE_TASK_KEY = 'school.uncompletedSessionEmail.prepare';
const EMAIL_DISPATCH_TASK_KEY = 'school.uncompletedSessionEmail.dispatch';
const SMS_PREPARE_TASK_KEY = 'school.uncompletedSessionSms.prepare';
const SMS_DISPATCH_TASK_KEY = 'school.uncompletedSessionSms.dispatch';
const SOURCE = 'school.sessionAccessPolicy';

const EMAIL_TASK_KEY = EMAIL_PREPARE_TASK_KEY;

function cleanText(value) {
  return String(value || '').trim();
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
    await scheduledTaskDefinitionRepository.update(row.id, { enabled: false, paused: true });
    disabled.push(row.id);
  }
  return disabled;
}

async function syncSessionAccessPolicyTasks(orgId = '', _policy = null, _options = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  const disabledIds = await disableOrphanPolicyTasks(orgKey, []);
  return { disabledIds, legacyNotificationTasksDisabled: true };
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
