const notificationService = require('../../services/school/notificationService');
const notificationRoutingRuleService = require('../../services/school/notificationRoutingRuleService');
const notificationModel = require('../../models/school/notificationModel');
const routingRuleModel = require('../../models/school/notificationRoutingRuleModel');
const personDisplayNameService = require('../../services/school/personDisplayNameService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { buildDataServiceQuery, normalizeSearchKeyword } = requireCoreModule('MVC/utils/generalTools');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function getStatusCode(error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || fallback);
  return Number.isFinite(status) && status >= 400 && status < 600 ? status : fallback;
}

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  if (!activeOrgId) {
    throw new Error('No active organization selected.');
  }
  return activeOrgId;
}

function resolvePersonMembershipOrgIds(person = null) {
  const list = Array.isArray(person?.organizations) ? person.organizations : [];
  return list.map((entry) => String(entry?.orgId || '').trim()).filter(Boolean);
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
    canManageAll: notificationService.isAdminViewer(req.user),
    currentPersonId: String(personDisplayNameService.getUserPersonId(req.user) || '').trim(),
    canManageRouting: notificationRoutingRuleService.isAdminViewer(req.user),
    schoolSectionDashboardHref: resLocalSchoolDashboard(res),
    ...extra
  };
}

function filterTasksForViewer(reqUser, notification) {
  const canManageAll = notificationService.isAdminViewer(reqUser);
  if (canManageAll) return notification;
  const currentPersonId = String(personDisplayNameService.getUserPersonId(reqUser) || '').trim();
  if (!currentPersonId) {
    return {
      ...notification,
      tasks: []
    };
  }
  return {
    ...notification,
    tasks: (Array.isArray(notification?.tasks) ? notification.tasks : []).filter((task) => String(task?.assignedPersonId || '').trim() === currentPersonId)
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
    const notification = filterTasksForViewer(req.user, await notificationService.getNotificationById(req.params.id, req.user));
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

async function listEligiblePersons(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = normalizeSearchKeyword(query.q || '');
    if (query.q === searchDefaultKeyword) query.q = '';

    const persons = await dataServiceGlobal.fetchData('persons', {
      q: query.q || '',
      type: query.type || 'contains',
      searchFields: query.searchFields || 'id,name.first,name.last,name.preferred,preferredName,contact.email'
    }, req.user, PERSON_QUERY_OPTIONS);

    const mapped = (Array.isArray(persons) ? persons : []).filter((person) => {
      const orgIds = resolvePersonMembershipOrgIds(person);
      return orgIds.length === 0 || orgIds.includes(activeOrgId);
    }).map((person) => {
      const firstName = String(person?.name?.first || person?.firstName || '').trim();
      const lastName = String(person?.name?.last || person?.lastName || '').trim();
      const preferredName = String(person?.name?.preferred || person?.preferredName || '').trim();
      const personId = String(person?.id || '').trim();
      const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
      const contactEmail = String(person?.contact?.email || person?.email || emails[0]?.email || '').trim();
      const displayName = preferredName || `${firstName} ${lastName}`.trim() || String(person?.name || person?.displayName || person?.fullName || '').trim() || personId;

      return {
        id: personId,
        personId,
        firstName,
        lastName,
        preferredName,
        email: contactEmail,
        name: {
          first: firstName,
          last: lastName,
          preferred: preferredName
        },
        displayName,
        organizations: person?.organizations || []
      };
    });

    const { data, pagination } = paginate(mapped, query);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
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

async function deleteNotification(req, res) {
  try {
    const row = await notificationService.deleteNotification(req.user, req.params.id);
    return res.json({ status: 'success', message: 'Notification deleted.', notification: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

module.exports = {
  showList,
  showDetail,
  showRouting,
  listEligiblePersons,
  updateStatus,
  reassignNotification,
  saveRoutingRule,
  addTask,
  updateTask,
  deleteNotification
};
