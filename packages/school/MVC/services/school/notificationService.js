const schoolRepositories = require('../../repositories/school');
const notificationModel = require('../../models/school/notificationModel');
const personDisplayNameService = require('./personDisplayNameService');
const notificationRoutingRuleService = require('./notificationRoutingRuleService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');

const OPEN_STATUSES = new Set(['open', 'in_progress']);
const CLOSED_STATUSES = new Set(['resolved', 'dismissed']);

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeStatus(value, fallback = 'open') {
  const token = cleanString(value, 40).toLowerCase();
  return notificationModel.NOTIFICATION_STATUSES.includes(token) ? token : fallback;
}

function normalizeTaskStatus(value, fallback = 'open') {
  const token = cleanString(value, 40).toLowerCase();
  return notificationModel.NOTIFICATION_TASK_STATUSES.includes(token) ? token : fallback;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function getActorPersonId(user) {
  return toPublicId(personDisplayNameService.getUserPersonId(user));
}

function getActorName(user) {
  const direct = cleanString(user?.displayName || user?.fullName, 160);
  if (direct) return direct;
  if (user?.name && typeof user.name === 'object') {
    return cleanString(`${user.name.first || ''} ${user.name.last || ''}`, 160);
  }
  return getActorId(user) || 'System';
}

async function resolveActorName(user) {
  return personDisplayNameService.resolveUserDisplayName(user, {
    fallback: getActorId(user) || 'System'
  });
}

function isAdminViewer(user) {
  return Boolean(adminChekersService.isSuperAdmin(user) || adminChekersService.isOrgAdmin(user));
}

function isAssignedToActor(notification, user) {
  return idsEqual(notification?.assignedPersonId || '', getActorPersonId(user));
}

function isTaskAssignedToActor(task, user) {
  return idsEqual(task?.assignedPersonId || '', getActorPersonId(user));
}

function assertNotificationOwnership(user, notification, action = 'update this notification') {
  if (isAdminViewer(user)) return;
  if (!notification || !isAssignedToActor(notification, user)) {
    const error = new Error(`You are not authorized to ${action}.`);
    error.statusCode = 403;
    throw error;
  }
}

function assertTaskOwnership(user, task, action = 'update this task') {
  if (isAdminViewer(user)) return;
  if (!task || !isTaskAssignedToActor(task, user)) {
    const error = new Error(`You are not authorized to ${action}.`);
    error.statusCode = 403;
    throw error;
  }
}

function normalizeQueryScope(reqUser, query = {}) {
  return {
    query,
    scope: {
      activeOrgId: getActiveOrgId(reqUser)
    }
  };
}

async function buildLifecycleEvent({ action, actorUser, oldStatus = '', newStatus = '', note = '', snapshot = {} }) {
  return {
    at: new Date().toISOString(),
    action: cleanString(action, 80),
    actorId: getActorId(actorUser),
    actorName: await resolveActorName(actorUser),
    oldStatus: cleanString(oldStatus, 40),
    newStatus: cleanString(newStatus, 40),
    note: cleanString(note, 1000),
    snapshot
  };
}

function buildNotificationSummary(row) {
  return {
    id: toPublicId(row?.id),
    orgId: toPublicId(row?.orgId),
    sourceType: cleanString(row?.sourceType, 80),
    sourceId: toPublicId(row?.sourceId),
    title: cleanString(row?.title, 220),
    severity: cleanString(row?.severity, 40),
    status: cleanString(row?.status, 40),
    assignedRole: cleanString(row?.assignedRole, 120),
    assignedPersonId: toPublicId(row?.assignedPersonId),
    dueDate: cleanDate(row?.dueDate)
  };
}

function assertSameOrg(row, reqUser) {
  if (!row) throw new Error('Notification was not found.');
  const orgId = getActiveOrgId(reqUser);
  if (!orgId || idsEqual(row?.orgId, orgId)) return;
  const error = new Error('Notification is outside the active organization.');
  error.statusCode = 403;
  throw error;
}

async function enrichLifecycleForDisplay(lifecycle = []) {
  const events = Array.isArray(lifecycle) ? lifecycle : [];
  return Promise.all(events.map(async (event) => {
    const actorName = await personDisplayNameService.resolveUserIdDisplayName(event?.actorId, {
      fallback: cleanString(event?.actorName || event?.actorId || 'System', 160)
    });
    return { ...event, actorName };
  }));
}

async function enrichTaskForDisplay(task = {}) {
  const assignedPersonId = toPublicId(task.assignedPersonId || '');
  if (!assignedPersonId) return task;
  return {
    ...task,
    assignedPersonName: await personDisplayNameService.resolvePersonDisplayName(assignedPersonId, {
      fallback: task.assignedPersonName || assignedPersonId
    })
  };
}

async function enrichNotificationForDisplay(row) {
  if (!row || typeof row !== 'object') return row;
  const assignedPersonId = toPublicId(row.assignedPersonId || '');
  const next = {
    ...row,
    lifecycle: await enrichLifecycleForDisplay(row.lifecycle),
    tasks: await Promise.all((Array.isArray(row.tasks) ? row.tasks : []).map(enrichTaskForDisplay))
  };
  if (assignedPersonId) {
    next.assignedPersonName = await personDisplayNameService.resolvePersonDisplayName(assignedPersonId, {
      fallback: row.assignedPersonName || assignedPersonId
    });
  }
  if (next.resolvedBy) {
    next.resolvedByName = await personDisplayNameService.resolveUserIdDisplayName(next.resolvedBy, {
      fallback: next.resolvedByName || next.resolvedBy
    });
  }
  return next;
}

function normalizeTaskWithTiming({
  actor,
  task = {},
  assignedPersonId = '',
  assignedRole = '',
  assignedPersonName = '',
  status = 'open',
  now = new Date().toISOString()
} = {}) {
  const previousStatus = normalizeTaskStatus(task.status, 'open');
  const nextStatus = normalizeTaskStatus(status, previousStatus);
  const hadAssignee = !!toPublicId(task.assignedPersonId || '');
  const assignedChanged = assignedPersonId && (!hadAssignee || !idsEqual(task.assignedPersonId, assignedPersonId));
  const reassigned = hadAssignee && task.assignedPersonId && !idsEqual(task.assignedPersonId, assignedPersonId);
  const unassigned = !assignedPersonId;

  let nextStartedAt = cleanString(task.startedAt, 40);
  let nextAssignedAt = cleanString(task.assignedAt, 40);
  let nextReassignedAt = cleanString(task.reassignedAt, 40);
  let nextStatusValue = nextStatus;

  if (actor && assignedPersonId && nextStatusValue !== 'done' && nextStatusValue !== 'cancelled') {
    if (!hadAssignee && !nextAssignedAt) {
      nextAssignedAt = now;
    }
    if (!nextStartedAt && nextStatusValue === 'open') {
      nextStatusValue = 'in_progress';
      nextStartedAt = now;
    }
    if (assignedChanged || reassigned) {
      nextReassignedAt = now;
      if (!nextAssignedAt) {
        nextAssignedAt = now;
      }
    }
  }

  if (!assignedPersonId) {
    nextReassignedAt = '';
  }

  if (unassigned) {
    nextAssignedAt = '';
  }

  if ((nextStatusValue === 'done' || nextStatusValue === 'cancelled') && !task.completedAt) {
    nextStartedAt = nextStartedAt || now;
  }

  return {
    status: nextStatusValue,
    assignedRole,
    assignedPersonId,
    assignedPersonName,
    assignedAt: nextAssignedAt,
    startedAt: nextStartedAt,
    reassignedAt: nextReassignedAt,
    note: cleanString(task.note, 1000)
  };
}

async function resolveAssignmentInput(input = {}, fallback = {}) {
  const assignedPersonId = toPublicId(input.assignedPersonId ?? fallback.assignedPersonId ?? '');
  const assignedPersonName = assignedPersonId
    ? await personDisplayNameService.resolvePersonDisplayName(assignedPersonId, {
      fallback: cleanString(input.assignedPersonName ?? fallback.assignedPersonName ?? assignedPersonId, 160)
    })
    : '';
  return {
    assignedRole: cleanString(input.assignedRole ?? fallback.assignedRole ?? '', 120),
    assignedPersonId,
    assignedPersonName
  };
}

async function applyRoutingRule(input = {}, actorUser = null) {
  const sourceType = cleanString(input.sourceType, 80).toLowerCase();
  const explicitPersonId = toPublicId(input.assignedPersonId || '');
  if (explicitPersonId || sourceType !== 'leave_request') return input;

  const rule = await notificationRoutingRuleService.getActiveRuleForSource({
    orgId: input.orgId || getActiveOrgId(actorUser),
    sourceType,
    reqUser: actorUser
  });
  if (!rule) {
    return {
      ...input,
      assignedRole: cleanString(input.assignedRole, 120),
      assignedPersonId: '',
      assignedPersonName: ''
    };
  }

  return {
    ...input,
    assignedRole: cleanString(input.assignedRole || rule.label || '', 120),
    assignedPersonId: toPublicId(rule.assigneePersonId || ''),
    assignedPersonName: cleanString(rule.assigneePersonName || rule.assigneePersonId || '', 160)
  };
}

async function getNotificationById(id, reqUser, options = {}) {
  const row = await schoolRepositories.notifications.getById(id, options);
  if (!row) return null;
  assertSameOrg(row, reqUser);
  return enrichNotificationForDisplay(row);
}

async function listVisibleNotifications(reqUser, filters = {}) {
  const query = {};
  const status = cleanString(filters.status, 40).toLowerCase();
  if (status) query.status = status;
  const severity = cleanString(filters.severity, 40).toLowerCase();
  if (severity) query.severity = severity;
  const sourceType = cleanString(filters.sourceType, 80).toLowerCase();
  if (sourceType) query.sourceType = sourceType;
  const assignedRole = cleanString(filters.assignedRole, 120);
  if (assignedRole) query.assignedRole = assignedRole;
  const assignedPersonId = toPublicId(filters.assignedPersonId || '');
  if (assignedPersonId) query.assignedPersonId = assignedPersonId;
  const assignment = cleanString(filters.assignment, 40).toLowerCase();
  const currentPersonId = personDisplayNameService.getUserPersonId(reqUser);
  if (assignment === 'mine' && !currentPersonId) return [];
  if (assignment === 'mine' && currentPersonId) query.assignedPersonId = currentPersonId;

  const rows = await schoolRepositories.notifications.list(normalizeQueryScope(reqUser, query));
  const statusWeight = { open: 0, in_progress: 1, resolved: 2, dismissed: 3 };
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (assignment !== 'unassigned') return true;
      return !toPublicId(row?.assignedPersonId || '');
    })
    .sort((a, b) => {
      const aStatus = String(a?.status || '').toLowerCase();
      const bStatus = String(b?.status || '').toLowerCase();
      const aAssignedToMe = currentPersonId && OPEN_STATUSES.has(aStatus) && idsEqual(a?.assignedPersonId, currentPersonId);
      const bAssignedToMe = currentPersonId && OPEN_STATUSES.has(bStatus) && idsEqual(b?.assignedPersonId, currentPersonId);
      if (aAssignedToMe !== bAssignedToMe) return aAssignedToMe ? -1 : 1;
      const aUnassigned = OPEN_STATUSES.has(aStatus) && !toPublicId(a?.assignedPersonId || '');
      const bUnassigned = OPEN_STATUSES.has(bStatus) && !toPublicId(b?.assignedPersonId || '');
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      const aWeight = statusWeight[String(a?.status || '').toLowerCase()] ?? 9;
      const bWeight = statusWeight[String(b?.status || '').toLowerCase()] ?? 9;
      if (aWeight !== bWeight) return aWeight - bWeight;
      return String(b?.audit?.lastUpdateDateTime || b?.createdAt || '').localeCompare(String(a?.audit?.lastUpdateDateTime || a?.createdAt || ''));
    });
  return Promise.all(sorted.map(enrichNotificationForDisplay));
}

async function findBySource({ orgId, sourceType, sourceId } = {}) {
  const query = {
    sourceType: cleanString(sourceType, 80).toLowerCase(),
    sourceId: toPublicId(sourceId)
  };
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId || !query.sourceType || !query.sourceId) return null;
  const rows = await schoolRepositories.notifications.list({
    query,
    scope: { activeOrgId: targetOrgId },
    skipExecutor: true
  });
  return (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.orgId, targetOrgId)) || null;
}

async function buildDefaultReviewTask(input = {}) {
  const assignment = await resolveAssignmentInput(input);
  const now = new Date().toISOString();
  const startedTiming = normalizeTaskWithTiming({
    actor: true,
    task: {},
    assignedPersonId: assignment.assignedPersonId,
    assignedRole: assignment.assignedRole,
    assignedPersonName: assignment.assignedPersonName,
    status: 'open',
    now
  });
  return {
    title: cleanString(input.taskTitle, 220) || 'Review notification',
    description: cleanString(input.taskDescription || input.message, 2000),
    status: startedTiming.status,
    assignedRole: assignment.assignedRole,
    assignedPersonId: assignment.assignedPersonId,
    assignedPersonName: assignment.assignedPersonName,
    assignedAt: startedTiming.assignedAt,
    startedAt: startedTiming.startedAt,
    reassignedAt: '',
    dueDate: cleanDate(input.dueDate),
    note: ''
  };
}

async function upsertSourceNotification(input = {}, actorUser = null) {
  const routedInput = await applyRoutingRule(input, actorUser);
  const orgId = toPublicId(routedInput.orgId || getActiveOrgId(actorUser));
  const sourceType = cleanString(routedInput.sourceType, 80).toLowerCase();
  const sourceId = toPublicId(routedInput.sourceId || '');
  if (!orgId || !sourceType || !sourceId) return null;

  const existing = await findBySource({ orgId, sourceType, sourceId });
  const now = new Date().toISOString();
  const lifecycleAction = existing ? 'source_notification_reopened' : 'source_notification_created';
  const nextStatus = OPEN_STATUSES.has(String(existing?.status || '').toLowerCase()) ? (existing.status || 'open') : 'open';
  const base = existing || {};
  const baseTasks = Array.isArray(base.tasks) ? base.tasks : [];
  const hasOpenTask = baseTasks.some((task) => ['open', 'in_progress'].includes(normalizeTaskStatus(task?.status, 'open')));
  const tasks = hasOpenTask
    ? baseTasks
    : [...baseTasks, await buildDefaultReviewTask(routedInput)];
  const assignment = await resolveAssignmentInput(routedInput, base);
  const next = {
    ...base,
    orgId,
    sourceType,
    sourceId,
    sourceUrl: cleanString(routedInput.sourceUrl, 500),
    title: cleanString(routedInput.title, 220) || base.title || 'School notification',
    message: cleanString(routedInput.message, 5000) || base.message || '',
    severity: cleanString(routedInput.severity, 40).toLowerCase() || base.severity || 'info',
    status: nextStatus,
    dueDate: cleanDate(routedInput.dueDate) || base.dueDate || '',
    assignedRole: assignment.assignedRole,
    assignedPersonId: assignment.assignedPersonId,
    assignedPersonName: assignment.assignedPersonName,
    visibilityScope: cleanString(routedInput.visibilityScope || base.visibilityScope, 120) || 'section_access',
    tasks,
    metadata: {
      ...(base.metadata || {}),
      ...(routedInput.metadata || {}),
      lastSourceEventAt: now
    },
    resolvedAt: '',
    resolvedBy: '',
    resolvedByName: '',
    revisionNo: Math.max(1, Number(base.revisionNo || 0) + 1),
    audit: {
      ...(base.audit || {}),
      updatedBy: getActorId(actorUser)
    }
  };

  next.lifecycle = [
    ...(Array.isArray(base.lifecycle) ? base.lifecycle : []),
    await buildLifecycleEvent({
      action: lifecycleAction,
      actorUser,
      oldStatus: base.status || '',
      newStatus: next.status,
      note: cleanString(routedInput.note || '', 1000),
      snapshot: buildNotificationSummary(next)
    })
  ];

  if (existing) return schoolRepositories.notifications.update(existing.id, next, normalizeQueryScope(actorUser));
  next.audit.createdBy = getActorId(actorUser);
  return schoolRepositories.notifications.create(next, normalizeQueryScope(actorUser));
}

async function resolveSourceNotification(input = {}, actorUser = null) {
  const orgId = toPublicId(input.orgId || getActiveOrgId(actorUser));
  const sourceType = cleanString(input.sourceType, 80).toLowerCase();
  const sourceId = toPublicId(input.sourceId || '');
  if (!orgId || !sourceType || !sourceId) return null;
  const existing = await findBySource({ orgId, sourceType, sourceId });
  if (!existing) return null;

  const oldStatus = existing.status || '';
  const nextStatus = normalizeStatus(input.status, 'resolved');
  const now = new Date().toISOString();
  const nextTasks = (Array.isArray(existing.tasks) ? existing.tasks : []).map((task) => {
    const status = normalizeTaskStatus(task?.status, 'open');
    if (!['open', 'in_progress'].includes(status)) return task;
    return {
      ...task,
      status: 'done',
      note: cleanString(input.note || task?.note || 'Source item was resolved.', 1000),
      updatedAt: now,
      completedAt: now
    };
  });
  const next = {
    ...existing,
    status: nextStatus,
    tasks: nextTasks,
    resolvedAt: now,
    resolvedBy: getActorId(actorUser),
    resolvedByName: await resolveActorName(actorUser),
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(actorUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: cleanString(input.action || 'source_notification_resolved', 80),
        actorUser,
        oldStatus,
        newStatus: nextStatus,
        note: cleanString(input.note || '', 1000),
        snapshot: buildNotificationSummary({ ...existing, status: nextStatus })
      })
    ]
  };

  return schoolRepositories.notifications.update(existing.id, next, normalizeQueryScope(actorUser));
}

async function upsertLeaveRequestNotification(leaveRequest = {}, actorUser = null, options = {}) {
  const id = toPublicId(leaveRequest?.id);
  if (!id) return null;
  const requesterPersonId = toPublicId(leaveRequest.requesterPersonId || '');
  const requesterName = await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
    fallback: cleanString(leaveRequest.requesterName || requesterPersonId || 'Requester', 160)
  }) || 'Requester';
  const status = cleanString(leaveRequest.status, 40).replace(/_/g, ' ') || 'submitted';
  return upsertSourceNotification({
    orgId: leaveRequest.orgId,
    sourceType: 'leave_request',
    sourceId: id,
    sourceUrl: `/school/leave-requests/detail/${encodeURIComponent(id)}`,
    title: `Leave request needs review: ${requesterName}`,
    message: `${requesterName} has a ${status} leave request for ${leaveRequest.startDate || 'the requested date'}${leaveRequest.endDate && leaveRequest.endDate !== leaveRequest.startDate ? ` to ${leaveRequest.endDate}` : ''}.`,
    severity: options.severity || 'warning',
    taskTitle: 'Review leave request',
    taskDescription: 'Review the leave request and approve, reject, or cancel it.',
    metadata: {
      leaveRequestStatus: leaveRequest.status,
      requesterPersonId: leaveRequest.requesterPersonId,
      requesterRole: leaveRequest.requesterRole
    },
    note: options.note || ''
  }, actorUser);
}

async function resolveLeaveRequestNotification(leaveRequest = {}, actorUser = null, options = {}) {
  const id = toPublicId(leaveRequest?.id);
  if (!id) return null;
  return resolveSourceNotification({
    orgId: leaveRequest.orgId,
    sourceType: 'leave_request',
    sourceId: id,
    status: 'resolved',
    action: options.action || 'leave_request_resolved',
    note: options.note || `Leave request ${cleanString(leaveRequest.status, 40) || 'resolved'}.`
  }, actorUser);
}

async function updateNotificationStatus(reqUser, id, input = {}) {
  const existing = await getNotificationById(id, reqUser);
  if (!existing) throw new Error('Notification was not found.');
  assertNotificationOwnership(reqUser, existing, 'change this notification status');
  const nextStatus = normalizeStatus(input.status, existing.status || 'open');
  const now = new Date().toISOString();
  const next = {
    ...existing,
    status: nextStatus,
    resolvedAt: CLOSED_STATUSES.has(nextStatus) ? (existing.resolvedAt || now) : '',
    resolvedBy: CLOSED_STATUSES.has(nextStatus) ? getActorId(reqUser) : '',
    resolvedByName: CLOSED_STATUSES.has(nextStatus) ? await resolveActorName(reqUser) : '',
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: `notification_${nextStatus}`,
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: nextStatus,
        note: cleanString(input.note, 1000),
        snapshot: buildNotificationSummary({ ...existing, status: nextStatus })
      })
    ]
  };
  return schoolRepositories.notifications.update(id, next, normalizeQueryScope(reqUser));
}

async function reassignNotification(reqUser, id, input = {}) {
  const existing = await getNotificationById(id, reqUser);
  if (!existing) throw new Error('Notification was not found.');
  assertNotificationOwnership(reqUser, existing, 'reassign this notification');
  const assignment = await resolveAssignmentInput(input);
  const now = new Date().toISOString();
  const nextAssignedPersonId = assignment.assignedPersonId;
  const previousAssignedPersonId = toPublicId(existing.assignedPersonId || '');
  const shouldAutoStart = !!nextAssignedPersonId && !idsEqual(nextAssignedPersonId, previousAssignedPersonId);
  const tasks = notificationModel.sanitizeTasks(Array.isArray(existing.tasks) ? existing.tasks : [], { existingTasks: existing.tasks || [] }).map((task) => {
    if (task.assignedPersonId === nextAssignedPersonId) return task;
    const nextStatus = shouldAutoStart && ['open', ''].includes(String(task.status || '').toLowerCase())
      ? 'in_progress'
      : String(task.status || 'open').toLowerCase();

    if (!shouldAutoStart) return task;
    return {
      ...task,
      status: normalizeTaskStatus(nextStatus, task.status),
      reassignedAt: now,
      startedAt: task.startedAt || now,
      assignedAt: task.assignedAt || now
    };
  });
  const next = {
    ...existing,
    assignedRole: assignment.assignedRole,
    assignedPersonId: assignment.assignedPersonId,
    assignedPersonName: assignment.assignedPersonName,
    tasks,
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: 'notification_reassigned',
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: existing.status,
        note: assignment.assignedPersonId ? `Assigned to ${assignment.assignedPersonName || assignment.assignedPersonId}.` : 'Notification was unassigned.',
        snapshot: buildNotificationSummary({
          ...existing,
          assignedRole: assignment.assignedRole,
          assignedPersonId: assignment.assignedPersonId,
          assignedPersonName: assignment.assignedPersonName
        })
      })
    ]
  };
  return schoolRepositories.notifications.update(id, next, normalizeQueryScope(reqUser));
}

async function addNotificationTask(reqUser, id, input = {}) {
  const existing = await getNotificationById(id, reqUser);
  if (!existing) throw new Error('Notification was not found.');
  assertNotificationOwnership(reqUser, existing, 'add tasks to this notification');
  const assignment = await resolveAssignmentInput(input);
  const now = new Date().toISOString();
  const taskTiming = normalizeTaskWithTiming({
    actor: true,
    task: {},
    assignedPersonId: assignment.assignedPersonId,
    assignedRole: assignment.assignedRole,
    assignedPersonName: assignment.assignedPersonName,
    status: cleanString(input.status, 40) || 'open',
    now
  });
  const tasks = notificationModel.sanitizeTasks([
    ...(Array.isArray(existing.tasks) ? existing.tasks : []),
    {
      title: input.title,
      description: input.description,
      status: taskTiming.status,
      assignedRole: assignment.assignedRole,
      assignedPersonId: assignment.assignedPersonId,
      assignedPersonName: assignment.assignedPersonName,
      dueDate: input.dueDate,
      note: input.note,
      assignedAt: taskTiming.assignedAt,
      startedAt: taskTiming.startedAt,
      reassignedAt: taskTiming.reassignedAt,
      completedAt: ''
    }
  ], { existingTasks: existing.tasks || [] });
  const next = {
    ...existing,
    status: existing.status === 'open' ? 'in_progress' : existing.status,
    tasks,
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: 'task_added',
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: existing.status === 'open' ? 'in_progress' : existing.status,
        note: cleanString(input.title || 'Task added.', 1000),
        snapshot: buildNotificationSummary(existing)
      })
    ]
  };
  return schoolRepositories.notifications.update(id, next, normalizeQueryScope(reqUser));
}

async function updateNotificationTask(reqUser, id, taskId, input = {}) {
  const existing = await getNotificationById(id, reqUser);
  if (!existing) throw new Error('Notification was not found.');
  assertNotificationOwnership(reqUser, existing, 'update tasks for this notification');
  const targetTaskId = toPublicId(taskId);
  const now = new Date().toISOString();
  let found = false;
  const tasks = [];
  for (const task of (Array.isArray(existing.tasks) ? existing.tasks : [])) {
    if (!idsEqual(task?.id, targetTaskId)) {
      tasks.push(task);
      continue;
    }
    found = true;
    const taskCopy = {
      ...task,
      status: normalizeTaskStatus(task?.status, 'open')
    };
    assertTaskOwnership(reqUser, taskCopy, 'update this task');
    const nextStatus = normalizeTaskStatus(input.status, task.status || 'open');
    const assignment = await resolveAssignmentInput(input, taskCopy);
    const nextTaskTiming = normalizeTaskWithTiming({
      actor: true,
      task: taskCopy,
      assignedPersonId: assignment.assignedPersonId,
      assignedRole: assignment.assignedRole,
      assignedPersonName: assignment.assignedPersonName,
      status: nextStatus,
      now
    });
    const normalizedNote = cleanString(input.note ?? task.note, 1000);
    const previousStatus = normalizeTaskStatus(task?.status, 'open');
    const completedAt = nextTaskTiming.status === 'done'
      ? (task.completedAt || cleanString(taskCopy.completedAt, 40) || now)
      : (nextTaskTiming.status === 'cancelled'
        ? (task.completedAt || cleanString(task.completedAt, 40) || now)
        : (nextStatus === 'open' && previousStatus !== 'open' ? '' : cleanString(task.completedAt, 40)));
    const updated = {
      ...taskCopy,
      title: cleanString(input.title || task.title, 220),
      description: cleanString(input.description ?? task.description, 2000),
      ...nextTaskTiming,
      note: normalizedNote,
      updatedAt: now,
      completedAt
    };
    updated.assignedRole = nextTaskTiming.assignedRole;
    updated.assignedPersonId = nextTaskTiming.assignedPersonId;
    updated.assignedPersonName = nextTaskTiming.assignedPersonName;
    updated.dueDate = cleanDate(input.dueDate ?? task.dueDate);
    tasks.push(updated);
    }
  if (!found) throw new Error('Notification task was not found.');

  const hasOpenTask = tasks.some((task) => ['open', 'in_progress'].includes(normalizeTaskStatus(task?.status, 'open')));
  const nextStatus = hasOpenTask && existing.status === 'open' ? 'in_progress' : existing.status;
  const next = {
    ...existing,
    status: nextStatus,
    tasks,
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: 'task_updated',
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: nextStatus,
        note: cleanString(input.note || '', 1000),
        snapshot: { taskId: targetTaskId }
      })
    ]
  };
  return schoolRepositories.notifications.update(id, next, normalizeQueryScope(reqUser));
}

module.exports = {
  OPEN_STATUSES,
  CLOSED_STATUSES,
  getActiveOrgId,
  getActorId,
  getActorName,
  isAdminViewer,
  listVisibleNotifications,
  getNotificationById,
  upsertSourceNotification,
  resolveSourceNotification,
  upsertLeaveRequestNotification,
  resolveLeaveRequestNotification,
  updateNotificationStatus,
  reassignNotification,
  addNotificationTask,
  updateNotificationTask,
  _private: {
    buildLifecycleEvent,
    buildNotificationSummary,
    findBySource,
    applyRoutingRule,
    resolveAssignmentInput
  }
};
