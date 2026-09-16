const notificationCenterRuleService = require('../../services/school/notificationCenterRuleService');

const notificationCenterRunService = require('../../services/school/notificationCenterRunService');

const notificationCenterAccessService = require('../../services/school/notificationCenterAccessService');

const { disableNotificationCenterScheduledTasks } = require('../../services/school/notificationCenterTaskSyncService');

const notificationCenterRunPresentationService = require('../../services/school/notificationCenterRunPresentationService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');

const notificationCenterComposeService = require('../../services/school/notificationCenterComposeService');

const notificationRuleModel = require('../../models/school/notificationRuleModel');

const { formatNotificationTokenLabel, SESSION_DATE_RANGE_TYPES } = notificationRuleModel;

const { requireCoreModule } = require('../../services/school/schoolCoreContracts');

const paginate = requireCoreModule('MVC/utils/paginationHelper');

const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');

const settingService = requireCoreModule('MVC/services/settingService');

const emailOutboxService = requireCoreModule('MVC/services/emailOutboxService');

const { formatMsToDateTimeLocalInput } = requireCoreModule('MVC/utils/timezoneUtils');



function getActiveOrgIdOrThrow(reqUser) {

  const activeOrgId = String(reqUser?.activeOrgId || '').trim();

  if (!activeOrgId) throw new Error('No active organization selected.');

  return activeOrgId;

}



function wantsJson(req) {

  return Boolean(req.xhr || req.headers['x-ajax-request'] || String(req.headers.accept || '').includes('application/json'));

}



function parseSelectionKeys(body = {}) {

  const raw = body.selectionKeys ?? body['selectionKeys[]'] ?? body.selectionKey;

  if (Array.isArray(raw)) return raw.map((k) => String(k || '').trim()).filter(Boolean);

  const single = String(raw || '').trim();

  if (!single) return [];

  return single.split(',').map((k) => k.trim()).filter(Boolean);

}



async function baseView(req, res, extra = {}) {

  const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

  return {

    user: req.user,

    includeModal: true,

    actionStateId: req.actionStateId,

    schoolSectionDashboardHref: res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL',

    ruleTypes: notificationRuleModel.NOTIFICATION_RULE_TYPES,

    sessionDateRangeTypes: SESSION_DATE_RANGE_TYPES,

    formatNotificationTokenLabel,

    access,

    ...extra

  };

}



async function showHome(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    await notificationCenterRuleService.syncLegacySessionNotFinalRule(orgId);

    await disableNotificationCenterScheduledTasks(orgId);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);



    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });

    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';

    if (query.q === searchDefaultKeyword) query.q = '';



    let rows = await notificationCenterRuleService.listRulesForOrg(orgId);

    rows = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {

      const labelA = String(a?.label || a?.ruleType || '');

      const labelB = String(b?.label || b?.ruleType || '');

      return labelA.localeCompare(labelB);

    });



    const searchableFields = ['label', 'ruleType', 'legacyKey'];

    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });

    const { data, pagination } = paginate(rows, query.page, query.limit);



    const runs = access.canViewRuns

      ? await notificationCenterRunService.listRuns(orgId, { limit: 20 })

      : [];



    if (isAjax(req)) {

      return res.json({ status: 'success', results: data, pagination, runs });

    }



    return res.render('school/notificationCenter/list', await baseView(req, res, {

      title: 'Notification Centre',

      tableName: 'School_NotificationCenter_Rules',

      newUrl: 'school/notification-center',

      data,

      runs,

      searchableFields,

      includeModal_Table: true,

      print: true,

      pagination,

      filters: req.query

    }));

  } catch (error) {

    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });

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

      ? { id: '', orgId, enabled: true, ruleType: 'session_not_final', label: '', criteria: {}, channels: { email: { enabled: true }, sms: {} }, schedule: { autoQueueOnSchedule: false } }

      : await notificationCenterRuleService.getRule(orgId, ruleId);

    if (!rule) throw new Error('Notification rule not found.');

    const isEdit = ruleId !== 'new';

    return res.render('school/notificationCenter/ruleForm', await baseView(req, res, {

      title: isEdit ? 'Edit Notification Rule' : 'New Notification Rule',

      isEdit,

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

    const emailChannel = payload.channels.email && typeof payload.channels.email === 'object'

      ? payload.channels.email

      : {};

    emailChannel.enabled = emailChannel.enabled === 'true' || emailChannel.enabled === true;

    payload.channels.email = emailChannel;

    payload.channels.sms = { enabled: false };

    payload.schedule = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : {};

    payload.schedule.autoQueueOnSchedule = false;

    const saved = await notificationCenterRuleService.saveRule(orgId, payload, req.user?.id);

    await disableNotificationCenterScheduledTasks(orgId);

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

    const rule = await notificationCenterRuleService.getRule(orgId, run.ruleId);

    const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });

    const presentationTree = notificationCenterRunPresentationService.buildRunPresentationTree(run, {

      asOfDate: run.asOfDate,

      statusMap

    });

    return res.render('school/notificationCenter/runDetail', await baseView(req, res, {

      title: `Run review: ${run.ruleLabel || run.id}`,

      run,

      rule,

      presentationTree,

      access

    }));

  } catch (error) {

    return res.status(403).render('error', { title: 'Error', message: error.message, error, user: req.user });

  }

}



async function showComposeEmail(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

    if (!access.canDispatch) throw new Error('Not authorized to schedule notification emails.');

    const run = await notificationCenterRunService.getRun(orgId, req.params.id);

    if (!run) throw new Error('Notification run not found.');

    const rule = await notificationCenterRuleService.getRule(orgId, run.ruleId);

    if (!rule) throw new Error('Notification rule not found.');

    const selectionKeys = parseSelectionKeys(req.query);

    const recipientPersonId = String(req.query.recipientPersonId || '').trim();

    const baseUrl = notificationCenterComposeService.resolveRequestBaseUrl(req);

    const { preview, recipientPersonId: teacherId } = await notificationCenterComposeService.buildPreviewFromSelection({

      run,

      rule,

      recipientPersonId,

      selectionKeys,

      orgId,

      baseUrl

    });

    const timeZone = await notificationCenterComposeService.resolveOrgTimeZone(orgId);

    const defaultSendAtLocal = formatMsToDateTimeLocalInput(Date.now() + 3600000, timeZone);

    const composePayload = {

      preview,

      selectionKeys,

      recipientPersonId: teacherId,

      timeZone,

      defaultSendAtLocal,

      runId: run.id

    };

    if (wantsJson(req)) return res.json({ status: 'ok', ...composePayload });

    return res.render('school/notificationCenter/composeEmail', await baseView(req, res, {

      title: 'Schedule email',

      run,

      rule,

      ...composePayload

    }));

  } catch (error) {

    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });

    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });

  }

}



async function scheduleEmail(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

    if (!access.canDispatch) throw new Error('Not authorized to schedule notification emails.');

    const run = await notificationCenterRunService.getRun(orgId, req.params.id);

    if (!run) throw new Error('Notification run not found.');

    const rule = await notificationCenterRuleService.getRule(orgId, run.ruleId);

    if (!rule) throw new Error('Notification rule not found.');

    const selectionKeys = parseSelectionKeys(req.body);

    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const result = await notificationCenterComposeService.scheduleEmail({

      orgId,

      user: req.user,

      run,

      rule,

      recipientPersonId: String(body.recipientPersonId || '').trim(),

      selectionKeys,

      subject: body.subject,

      bodyText: body.bodyText,

      bodyHtml: body.bodyHtml,

      sendAtLocal: body.sendAtLocal,

      baseUrl: notificationCenterComposeService.resolveRequestBaseUrl(req),

      req

    });

    if (wantsJson(req)) return res.json({ status: 'ok', result });

    return res.redirect(`/school/notification-center/outbox?scheduled=1&outboxId=${encodeURIComponent(result.outboxId)}`);

  } catch (error) {

    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });

    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });

  }

}



async function showOutbox(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

    if (!access.canViewRuns && !access.canDispatch) {

      throw new Error('Not authorized to view notification outbox.');

    }

    const rows = await emailOutboxService.listByMetaSource(

      orgId,

      notificationCenterComposeService.NC_META_SOURCE

    );

    return res.render('school/notificationCenter/outboxList', await baseView(req, res, {

      title: 'Scheduled emails',

      tableName: 'School_NotificationCenter_Outbox',

      data: rows,

      canCancelOutbox: access.canDispatch,

      canDeleteOutbox: access.canDispatch,

      scheduledFlash: String(req.query.scheduled || '') === '1'

    }));

  } catch (error) {

    return res.status(403).render('error', { title: 'Error', message: error.message, error, user: req.user });

  }

}



async function cancelOutboxEntry(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

    if (!access.canDispatch) throw new Error('Not authorized to cancel scheduled emails.');

    const row = await emailOutboxService.getById(req.params.id);

    if (!row || String(row.orgId || '').trim() !== orgId) throw new Error('Outbox entry not found.');

    if (String(row?.meta?.source || '') !== notificationCenterComposeService.NC_META_SOURCE) {

      throw new Error('Outbox entry is not from Notification Centre.');

    }

    await emailOutboxService.cancelById(row.id);

    if (wantsJson(req)) return res.json({ status: 'ok' });

    return res.redirect('/school/notification-center/outbox?cancelled=1');

  } catch (error) {

    if (wantsJson(req)) return res.status(400).json({ status: 'error', message: error.message });

    return res.status(400).render('error', { title: 'Error', message: error.message, error, user: req.user });

  }

}



async function deleteOutboxEntry(req, res) {

  try {

    const orgId = getActiveOrgIdOrThrow(req.user);

    const access = await notificationCenterAccessService.buildAccessFlags(req.user, req.ip);

    if (!access.canDispatch) throw new Error('Not authorized to delete outbox entries.');

    const row = await emailOutboxService.getById(req.params.id);

    if (!row || String(row.orgId || '').trim() !== orgId) throw new Error('Outbox entry not found.');

    if (String(row?.meta?.source || '') !== notificationCenterComposeService.NC_META_SOURCE) {

      throw new Error('Outbox entry is not from Notification Centre.');

    }

    await emailOutboxService.deleteById(row.id);

    if (wantsJson(req)) return res.json({ status: 'ok' });

    return res.redirect('/school/notification-center/outbox?deleted=1');

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

  showComposeEmail,

  scheduleEmail,

  showOutbox,

  cancelOutboxEntry,

  deleteOutboxEntry

};


