const notificationCenterRuleService = require('../../services/school/notificationCenterRuleService');
const notificationCenterRunService = require('../../services/school/notificationCenterRunService');
const notificationCenterAccessService = require('../../services/school/notificationCenterAccessService');
const notificationCenterTaskSyncService = require('../../services/school/notificationCenterTaskSyncService');
const notificationRuleModel = require('../../models/school/notificationRuleModel');

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  if (!activeOrgId) throw new Error('No active organization selected.');
  return activeOrgId;
}

function wantsJson(req) {
  return Boolean(req.xhr || req.headers['x-ajax-request'] || String(req.headers.accept || '').includes('application/json'));
}

async function baseView(req, res, extra = {}) {
  const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
  return {
    user: req.user,
    includeModal: true,
    actionStateId: req.actionStateId,
    schoolSectionDashboardHref: res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL',
    ruleTypes: notificationRuleModel.NOTIFICATION_RULE_TYPES,
    access,
    ...extra
  };
}

async function showHome(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    await notificationCenterRuleService.syncLegacySessionNotFinalRule(orgId);
    const rules = await notificationCenterRuleService.listRulesForOrg(orgId);
    const runs = await notificationCenterRunService.listRuns(orgId, { limit: 20 });
    return res.render('school/notificationCenter/list', await baseView(req, res, {
      title: 'Notification Centre',
      rules,
      runs
    }));
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

async function showRuleForm(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
    if (!access.canConfigure) throw new Error('Not authorized to configure notification rules.');
    const ruleId = String(req.params.id || '').trim();
    const rule = ruleId === 'new'
      ? { id: '', orgId, enabled: true, ruleType: 'session_not_final', label: '', criteria: {}, channels: { email: {}, sms: {} } }
      : await notificationCenterRuleService.getRule(orgId, ruleId);
    if (!rule) throw new Error('Notification rule not found.');
    return res.render('school/notificationCenter/ruleForm', await baseView(req, res, {
      title: ruleId === 'new' ? 'New notification rule' : `Edit rule: ${rule.label}`,
      rule
    }));
  } catch (error) {
    return res.status(403).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

async function saveRule(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
    if (!access.canConfigure) throw new Error('Not authorized to configure notification rules.');
    const payload = req.body?.rule && typeof req.body.rule === 'object' ? { ...req.body.rule } : { ...req.body };
    payload.enabled = payload.enabled === 'true' || payload.enabled === true;
    payload.channels = payload.channels && typeof payload.channels === 'object' ? payload.channels : {};
    ['email', 'sms'].forEach((channelName) => {
      const channel = payload.channels[channelName] && typeof payload.channels[channelName] === 'object'
        ? payload.channels[channelName]
        : {};
      channel.enabled = channel.enabled === 'true' || channel.enabled === true;
      payload.channels[channelName] = channel;
    });
    payload.schedule = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : {};
    payload.schedule.autoQueueOnSchedule = payload.schedule.autoQueueOnSchedule === 'true'
      || payload.schedule.autoQueueOnSchedule === true
      || payload.schedule.autoQueueOnSchedule === undefined;
    const saved = await notificationCenterRuleService.saveRule(orgId, payload, req.user?.id);
    await notificationCenterTaskSyncService.syncOrgRules(orgId);
    if (wantsJson(req)) return res.json({ status: 'ok', rule: saved });
    return res.redirect(`/school/notification-center/rules/${encodeURIComponent(saved.id)}`);
  } catch (error) {
    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

async function runRuleNow(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
    if (!access.canRunNow) throw new Error('Not authorized to run notification evaluations.');
    const ruleId = String(req.params.id || '').trim();
    const run = await notificationCenterRunService.executeRun({
      orgId,
      ruleId,
      user: req.user,
      trigger: 'manual',
      queueDelivery: false
    });
    if (wantsJson(req)) return res.json({ status: 'ok', run });
    return res.redirect(`/school/notification-center/runs/${encodeURIComponent(run.id)}`);
  } catch (error) {
    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

async function showRun(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
    if (!access.canViewRuns) throw new Error('Not authorized to view notification runs.');
    const run = await notificationCenterRunService.getRun(orgId, req.params.id);
    if (!run) throw new Error('Notification run not found.');
    return res.render('school/notificationCenter/runDetail', await baseView(req, res, {
      title: `Run: ${run.ruleLabel || run.id}`,
      run
    }));
  } catch (error) {
    return res.status(403).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

async function dispatchRun(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);
    if (!access.canDispatch) throw new Error('Not authorized to dispatch notifications.');
    const metrics = await notificationCenterRunService.dispatchRun(orgId, req.params.id, req.user);
    if (wantsJson(req)) return res.json({ status: 'ok', metrics });
    return res.redirect(`/school/notification-center/runs/${encodeURIComponent(req.params.id)}?dispatched=1`);
  } catch (error) {
    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });
  }
}

module.exports = {
  showHome,
  showRuleForm,
  saveRule,
  runRuleNow,
  showRun,
  dispatchRun
};
