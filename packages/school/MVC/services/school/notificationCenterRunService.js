'use strict';



const notificationRunModel = require('../../models/school/notificationRunModel');

const notificationCenterRuleService = require('./notificationCenterRuleService');

const notificationCenterEvaluatorRegistry = require('./notificationCenterEvaluatorRegistry');

const notificationCenterDeliveryService = require('./notificationCenterDeliveryService');

const schoolDataService = require('./schoolDataService');

const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');



function cleanText(value) {

  return String(value || '').trim();

}



function getActorId(user) {

  return cleanText(user?.id || user?._id || user?.userId);

}



function resolveReqUser(orgId, reqUser) {
  if (reqUser && typeof reqUser === 'object') {
    return notificationCenterRuleService.buildNcReqUser(orgId, getActorId(reqUser));
  }
  return notificationCenterRuleService.buildNcReqUser(orgId, reqUser);
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

  const reqUser = resolveReqUser(orgKey, user);

  const rule = await notificationCenterRuleService.getRule(orgKey, ruleId, reqUser);

  if (!rule) throw new Error('Notification rule not found.');

  if (rule.enabled !== true && trigger === 'scheduled') {

    return null;

  }

  const evaluator = notificationCenterEvaluatorRegistry.getEvaluator(rule.ruleType);

  if (!evaluator) throw new Error(`Unsupported rule type: ${rule.ruleType}`);



  const run = await schoolDataService.addData('notificationRuns', {

    orgId: orgKey,

    ruleId: rule.id,

    ruleType: rule.ruleType,

    ruleLabel: rule.label,

    trigger,

    status: 'pending',

    asOfDate: cleanText(asOfDate) || cleanText(new Date().toISOString().slice(0, 10)),

    auditUserId: getActorId(user)

  }, reqUser);



  try {

    const { findings = [] } = await evaluator.evaluate({

      orgId: orgKey,

      rule,

      asOfDate: run.asOfDate,

      reqUser: user || reqUser

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

    const updated = await schoolDataService.updateData('notificationRuns', run.id, {

      status,

      findingCount: findings.length,

      batchCount: batches.length,

      batches,

      completedAt: new Date().toISOString()

    }, reqUser);



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

    await schoolDataService.updateData('notificationRuns', run.id, {

      status: 'failed',

      errorMessage: error?.message || 'Run failed.',

      completedAt: new Date().toISOString()

    }, reqUser);

    throw error;

  }

}



async function dispatchRun(orgId, runId, user, { batchIds = [] } = {}) {

  const orgKey = cleanText(orgId);

  const reqUser = resolveReqUser(orgKey, user);

  const run = await getRun(orgKey, runId, reqUser);

  if (!run) throw new Error('Notification run not found.');

  const rule = await notificationCenterRuleService.getRule(orgKey, run.ruleId, reqUser);

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

  await schoolDataService.updateData('notificationRuns', runId, {

    status: 'completed',

    completedAt: new Date().toISOString()

  }, reqUser);

  return metrics;

}



async function listRuns(orgId, options = {}, reqUser = null) {

  const orgKey = cleanText(orgId);

  const user = resolveReqUser(orgKey, reqUser);

  const ruleId = cleanText(options.ruleId);

  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);

  let rows = await schoolDataService.fetchAllData(

    'notificationRuns',

    { orgId__eq: orgKey },

    user

  );

  rows = Array.isArray(rows) ? rows : [];

  if (ruleId) rows = rows.filter((row) => idsEqual(row?.ruleId, ruleId));

  rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));

  return rows.slice(0, limit);

}



async function getRun(orgId, runId, reqUser = null) {

  const orgKey = cleanText(orgId);

  const user = resolveReqUser(orgKey, reqUser);

  const run = await schoolDataService.getDataById('notificationRuns', runId, user);

  if (!run || !idsEqual(run.orgId, orgKey)) return null;

  return run;

}



async function deleteRun(orgId, runId, reqUser = null) {

  const orgKey = cleanText(orgId);

  const user = resolveReqUser(orgKey, reqUser);

  const run = await getRun(orgKey, runId, user);

  if (!run) throw new Error('Notification run not found.');

  await schoolDataService.deleteData('notificationRuns', run.id, user);

  return true;

}

function isRunViewedByUser(run, reqUser) {
  const userId = getActorId(reqUser);
  if (!userId || !run || typeof run !== 'object') return false;
  const viewerState = run.viewerState && typeof run.viewerState === 'object' ? run.viewerState : {};
  const entry = viewerState[userId];
  return Boolean(entry && cleanText(entry.viewedAt));
}

async function markRunViewed(orgId, runId, reqUser = null) {
  const orgKey = cleanText(orgId);
  const user = resolveReqUser(orgKey, reqUser);
  const userId = getActorId(user);
  if (!userId) return null;
  const run = await getRun(orgKey, runId, user);
  if (!run) return null;
  if (isRunViewedByUser(run, user)) return run;
  const prior = run.viewerState && typeof run.viewerState === 'object' ? run.viewerState : {};
  const viewerState = {
    ...prior,
    [userId]: { viewedAt: new Date().toISOString() }
  };
  return schoolDataService.updateData('notificationRuns', run.id, { viewerState }, user);
}

module.exports = {

  executeRun,

  dispatchRun,

  listRuns,

  getRun,

  deleteRun,

  isRunViewedByUser,

  markRunViewed

};

