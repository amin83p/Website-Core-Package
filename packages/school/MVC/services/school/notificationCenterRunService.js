'use strict';

const notificationRunModel = require('../../models/school/notificationRunModel');
const notificationCenterRuleService = require('./notificationCenterRuleService');
const notificationCenterEvaluatorRegistry = require('./notificationCenterEvaluatorRegistry');
const notificationCenterDeliveryService = require('./notificationCenterDeliveryService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanText(value) {
  return String(value || '').trim();
}

function getActorId(user) {
  return cleanText(user?.id || user?._id || user?.userId);
}

async function executeRun({
  orgId,
  ruleId,
  user = null,
  trigger = 'manual',
  asOfDate = '',
  queueDelivery = false
} = {}) {
  const orgKey = cleanText(orgId);
  const rule = await notificationCenterRuleService.getRule(orgKey, ruleId);
  if (!rule) throw new Error('Notification rule not found.');
  if (rule.enabled !== true && trigger === 'scheduled') {
    return null;
  }
  const evaluator = notificationCenterEvaluatorRegistry.getEvaluator(rule.ruleType);
  if (!evaluator) throw new Error(`Unsupported rule type: ${rule.ruleType}`);

  const run = await notificationRunModel.createNotificationRun({
    orgId: orgKey,
    ruleId: rule.id,
    ruleType: rule.ruleType,
    ruleLabel: rule.label,
    trigger,
    status: 'pending',
    asOfDate: cleanText(asOfDate) || cleanText(new Date().toISOString().slice(0, 10)),
    auditUserId: getActorId(user)
  });

  try {
    const { findings = [] } = await evaluator.evaluate({
      orgId: orgKey,
      rule,
      asOfDate: run.asOfDate,
      reqUser: user || { activeOrgId: orgKey }
    });
    const grouped = evaluator.groupFindings(findings, rule);
    const batches = [];
    for (const [recipientPersonId, items] of grouped.entries()) {
      const preview = await notificationCenterEvaluatorRegistry.buildBatchPreview({
        recipientPersonId,
        items,
        rule
      });
      batches.push(notificationRunModel.sanitizeBatchRow({
        recipientPersonId,
        recipientName: preview.recipientName,
        itemCount: items.length,
        items,
        preview
      }));
    }

    const status = queueDelivery ? 'completed' : 'preview';
    const updated = await notificationRunModel.updateNotificationRun(run.id, {
      status,
      findingCount: findings.length,
      batchCount: batches.length,
      batches,
      completedAt: new Date().toISOString()
    });

    if (queueDelivery) {
      await notificationCenterDeliveryService.dispatchRunBatches({
        orgId: orgKey,
        rule,
        run: updated,
        user
      });
    }

    return updated;
  } catch (error) {
    await notificationRunModel.updateNotificationRun(run.id, {
      status: 'failed',
      errorMessage: error?.message || 'Run failed.',
      completedAt: new Date().toISOString()
    });
    throw error;
  }
}

async function dispatchRun(orgId, runId, user, { batchIds = [] } = {}) {
  const orgKey = cleanText(orgId);
  const run = await notificationRunModel.getNotificationRunById(runId);
  if (!run || !idsEqual(run.orgId, orgKey)) throw new Error('Notification run not found.');
  const rule = await notificationCenterRuleService.getRule(orgKey, run.ruleId);
  if (!rule) throw new Error('Notification rule not found.');
  let batches = Array.isArray(run.batches) ? run.batches : [];
  if (Array.isArray(batchIds) && batchIds.length) {
    const wanted = new Set(batchIds.map((id) => cleanText(id)));
    batches = batches.filter((batch) => wanted.has(cleanText(batch.id)));
  }
  const metrics = await notificationCenterDeliveryService.dispatchRunBatches({
    orgId: orgKey,
    rule,
    run: { ...run, batches },
    user
  });
  await notificationRunModel.updateNotificationRun(runId, {
    status: 'completed',
    completedAt: new Date().toISOString()
  });
  return metrics;
}

async function listRuns(orgId, options = {}) {
  return notificationRunModel.listNotificationRunsByOrg(orgId, options);
}

async function getRun(orgId, runId) {
  const run = await notificationRunModel.getNotificationRunById(runId);
  if (!run || cleanText(run.orgId) !== cleanText(orgId)) return null;
  return run;
}

module.exports = {
  executeRun,
  dispatchRun,
  listRuns,
  getRun
};
