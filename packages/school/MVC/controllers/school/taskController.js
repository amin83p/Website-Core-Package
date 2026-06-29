const taskService = require('../../services/school/taskService');
const taskRoutingRuleService = require('../../services/school/taskRoutingRuleService');
const taskModel = require('../../models/school/taskModel');
const routingRuleModel = require('../../models/school/taskRoutingRuleModel');
const personDisplayNameService = require('../../services/school/personDisplayNameService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { buildDataServiceQuery, normalizeSearchKeyword } = requireCoreModule('MVC/utils/generalTools');

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

function parseAllowedSchoolRoles(query = {}) {
  return String(query.allowedRoles || query.schoolRoles || query.roleFilter || '')
    .split(/[\s,;|]+/)
    .map((role) => String(role || '').trim())
    .filter(Boolean);
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
    statuses: taskModel.TASK_STATUSES,
    severities: taskModel.TASK_SEVERITIES,
    sourceTypes: taskModel.TASK_SOURCE_TYPES,
    assignmentStatuses: taskModel.TASK_ASSIGNMENT_STATUSES,
    assignmentFilters: ['all', 'mine', 'unassigned'],
    canManageAll: taskService.isAdminViewer(req.user),
    currentPersonId: String(personDisplayNameService.getUserPersonId(req.user) || '').trim(),
    canManageRouting: taskRoutingRuleService.isAdminViewer(req.user),
    schoolSectionDashboardHref: resLocalSchoolDashboard(res),
    ...extra
  };
}

function filterAssignmentsForViewer(reqUser, task) {
  const canManageTaskWorkflow = taskService.canManageTaskWorkflow(reqUser, task);
  if (canManageTaskWorkflow) return task;
  const currentPersonId = String(personDisplayNameService.getUserPersonId(reqUser) || '').trim();
  if (!currentPersonId) {
    return {
      ...task,
      tasks: []
    };
  }
  return {
    ...task,
    tasks: (Array.isArray(task?.tasks) ? task.tasks : []).filter((task) => {
      if (String(task?.assignedPersonId || '').trim() === currentPersonId) return true;
      return (Array.isArray(task?.assignmentHistory) ? task.assignmentHistory : [])
        .some((entry) => String(entry?.assignedPersonId || '').trim() === currentPersonId);
    })
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
    const tasks = await taskService.listVisibleTasks(req.user, req.query);
    return res.render('school/task/list', baseViewModel(req, res, {
      title: 'School Task Center',
      tasks,
      filters: req.query || {}
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showDetail(req, res) {
  try {
    const rawTask = await taskService.getTaskById(req.params.id, req.user);
    const canManageTaskWorkflow = taskService.canManageTaskWorkflow(req.user, rawTask);
    const task = filterAssignmentsForViewer(req.user, rawTask);
    return res.render('school/task/detail', baseViewModel(req, res, {
      title: 'School Task Detail',
      task,
      canManageTaskWorkflow,
      canAssignTasks: canManageTaskWorkflow
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showRouting(req, res) {
  try {
    const rules = await taskRoutingRuleService.listRoutingRules(req.user, req.query);
    return res.render('school/task/routing', baseViewModel(req, res, {
      title: 'School Task Routing',
      rules,
      routingSourceTypes: routingRuleModel.TASK_ROUTING_SOURCE_TYPES,
      filters: req.query || {}
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function listEligiblePersons(req, res) {
  try {
    getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = normalizeSearchKeyword(query.q || '');
    if (query.q === searchDefaultKeyword) query.q = '';

    const payload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser: req.user,
      q: query.q || '',
      query,
      requireSchoolRole: true,
      allowedSchoolRoles: parseAllowedSchoolRoles(req.query || {})
    });
    const data = (payload.rows || []).map((row) => ({
      ...row,
      name: {
        first: row.firstName || '',
        last: row.lastName || '',
        preferred: row.preferredName || ''
      }
    }));
    return res.json({
      status: 'success',
      results: data,
      pagination: payload.pagination || {}
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function updateStatus(req, res) {
  try {
    const row = await taskService.updateTaskStatus(req.user, req.params.id, buildStatusPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Task updated.', task: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function reassignTask(req, res) {
  try {
    const row = await taskService.reassignTask(req.user, req.params.id, buildAssignmentPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Task reassigned.', task: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function saveRoutingRule(req, res) {
  try {
    const rule = await taskRoutingRuleService.saveRoutingRule(req.user, buildRoutingRulePayload(req.body || {}));
    return res.json({ status: 'success', message: 'Task routing rule saved.', rule });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function addAssignment(req, res) {
  try {
    const row = await taskService.addTaskAssignment(req.user, req.params.id, buildTaskPayload(req.body || {}));
    return res.json({ status: 'success', message: 'Task assignment added.', task: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function updateAssignment(req, res) {
  try {
    const row = await taskService.updateTaskAssignment(
      req.user,
      req.params.id,
      req.params.assignmentId,
      buildTaskPayload(req.body || {})
    );
    return res.json({ status: 'success', message: 'Task assignment updated.', task: row });
  } catch (error) {
    return sendError(req, res, error, 400);
  }
}

async function deleteTask(req, res) {
  try {
    const row = await taskService.deleteTask(req.user, req.params.id);
    return res.json({ status: 'success', message: 'Task deleted.', task: row });
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
  reassignTask,
  saveRoutingRule,
  addAssignment,
  updateAssignment,
  deleteTask
};
