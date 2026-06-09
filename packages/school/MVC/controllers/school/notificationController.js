const notificationService = require('../../services/school/notificationService');
const notificationRoutingRuleService = require('../../services/school/notificationRoutingRuleService');
const notificationModel = require('../../models/school/notificationModel');
const routingRuleModel = require('../../models/school/notificationRoutingRuleModel');

function getStatusCode(error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || fallback);
  return Number.isFinite(status) && status >= 400 && status < 600 ? status : fallback;
}

function wantsJson(req) {
  return Boolean(req.xhr || req.headers['x-ajax-request'] || String(req.headers.accept || '').includes('application/json'));
}

function sendError(req, res, error, fallback = 500) {
  const status = getStatusCode(error, fallback);
  if (wantsJson(req)) {
    return res.status(status).json({
      status: 'error',
      message: error?.message || 'Request failed.',
      code: error?.code || undefined
    });
  }
  return res.status(status).render('error', {
    title: 'Error',
    message: error?.message || 'Request failed.',
    error,
    user: req.user
  });
}

function resLocalSchoolDashboard(res) {
  return res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL';
}

function baseViewModel(req, res, extra = {}) {
  return {
    user: req.user,
    includeModal: true,
    actionStateId: req.actionStateId,
    statuses: notificationModel.NOTIFICATION_STATUSES,
    severities: notificationModel.NOTIFICATION_SEVERITIES,
    sourceTypes: notificationModel.NOTIFICATION_SOURCE_TYPES,
    taskStatuses: notificationModel.NOTIFICATION_TASK_STATUSES,
    assignmentFilters: ['all', 'mine', 'unassigned'],
    canManageAll: true,
    canManageRouting: notificationRoutingRuleService.isAdminViewer(req.user),
    schoolSectionDashboardHref: resLocalSchoolDashboard(res),
    ...extra
  };
}

function buildStatusPayload(body = {}) {
  return {
    status: body.status,
    note: body.note
  };
}

function buildTaskPayload(body = {}) {
  return {
    title: body.title,
    description: body.description,
    status: body.status,
    assignedRole: body.assignedRole,
    assignedPersonId: body.assignedPersonId,
    assignedPersonName: body.assignedPersonName,
    dueDate: body.dueDate,
    note: body.note
  };
}

function buildAssignmentPayload(body = {}) {
  return {
    assignedRole: body.assignedRole,
    assignedPersonId: body.assignedPersonId,
    assignedPersonName: body.assignedPersonName
  };
}

function buildRoutingRulePayload(body = {}) {
  return {
    id: body.id,
    sourceType: body.sourceType,
    active: body.active,
    assigneePersonId: body.assigneePersonId,
    assigneePersonName: body.assigneePersonName,
    label: body.label,
    notes: body.notes
  };
}

async function showList(req, res) {
  try {
    const notifications = await notificationService.listVisibleNotifications(req.user, req.query);
    return res.render('school/notification/list', baseViewModel(req, res, {
      title: 'School Notification Center',
      notifications,
      filters: req.query || {}
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showDetail(req, res) {
  try {
    const notification = await notificationService.getNotificationById(req.params.id, req.user);
    return res.render('school/notification/detail', baseViewModel(req, res, {
      title: 'School Notification Detail',
      notification
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showRouting(req, res) {
  try {
    const rules = await notificationRoutingRuleService.listRoutingRules(req.user, req.query);
    return res.render('school/notification/routing', baseViewModel(req, res, {
      title: 'School Notification Routing',
      rules,
      routingSourceTypes: routingRuleModel.NOTIFICATION_ROUTING_SOURCE_TYPES,
      filters: req.query || {}
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function updateStatus(req, res) {
  try {
    const row = await notificationService.updateNotificationStatus(req.user, req.params.id, buildStatusPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Notification updated.', notification: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function reassignNotification(req, res) {
  try {
    const row = await notificationService.reassignNotification(req.user, req.params.id, buildAssignmentPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Notification reassigned.', notification: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function saveRoutingRule(req, res) {
  try {
    const rule = await notificationRoutingRuleService.saveRoutingRule(req.user, buildRoutingRulePayload(req.body || {}));
    return res.json({ status: 'success', message: 'Notification routing rule saved.', rule });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function addTask(req, res) {
  try {
    const row = await notificationService.addNotificationTask(req.user, req.params.id, buildTaskPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Notification task added.', notification: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function updateTask(req, res) {
  try {
    const row = await notificationService.updateNotificationTask(
      req.user,
      req.params.id,
      req.params.taskId,
      buildTaskPayload(req.body || {})
    );
    return res.json({ status: 'success', message: 'Notification task updated.', notification: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

module.exports = {
  showList,
  showDetail,
  showRouting,
  updateStatus,
  reassignNotification,
  saveRoutingRule,
  addTask,
  updateTask
};
