const schoolRepositories = require('../../repositories/school');
const notificationModel = require('../../models/school/notificationModel');
const personDisplayNameService = require('./personDisplayNameService');
const notificationRoutingRuleService = require('./notificationRoutingRuleService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');

const OPEN_STATUSES = new Set(['open', 'in_progress']);
const CLOSED_STATUSES = new Set(['resolved', 'dismissed']);
const INVALID_LIFECYCLE_PERSON_IDS = new Set(['NO_PERSONID', 'NO_PERSON_ID']);

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeLifecyclePersonId(value) {
  const id = toPublicId(value || '');
  if (!id) return '';
  return INVALID_LIFECYCLE_PERSON_IDS.has(String(id).toUpperCase()) ? '' : id;
}

function firstLifecyclePersonId(...values) {
  for (const value of values) {
    const id = normalizeLifecyclePersonId(value);
    if (id) return id;
  }
  return '';
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

function addRoleTokens(target, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => addRoleTokens(target, item));
    return;
  }
  const raw = cleanString(value, 240).toLowerCase();
  if (!raw) return;
  raw.split(/[\s,;|]+/).map((token) => token.trim()).filter(Boolean).forEach((token) => {
    target.add(token);
    if (token.startsWith('member') && token.length > 'member'.length) {
      target.add(token.slice('member'.length));
    }
  });
}

function getActorOrgRoleTokens(user) {
  const tokens = new Set();
  addRoleTokens(tokens, user?.roles);
  addRoleTokens(tokens, user?.role);

  const activeOrgId = getActiveOrgId(user);
  const memberships = Array.isArray(user?.organizations) ? user.organizations : [];
  memberships.forEach((membership) => {
    const membershipOrgId = toPublicId(membership?.orgId || membership?.organizationId || membership?.id || '');
    if (activeOrgId && membershipOrgId && !idsEqual(activeOrgId, membershipOrgId)) return;
    addRoleTokens(tokens, membership?.roles);
    addRoleTokens(tokens, membership?.role);
  });

  return tokens;
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

async function resolvePersonName(personId, fallback = '') {
  const id = normalizeLifecyclePersonId(personId);
  if (!id) return cleanString(fallback, 160);
  return personDisplayNameService.resolvePersonDisplayName(id, {
    fallback: cleanString(fallback || id, 160)
  });
}

function isAdminViewer(user) {
  return Boolean(adminChekersService.isAdminForRequest(user, SECTIONS.SCHOOL_NOTIFICATIONS, OPERATIONS.READ_ALL, {
    orgId: getActiveOrgId(user),
    section: { id: SECTIONS.SCHOOL_NOTIFICATIONS, category: 'SCHOOL' }
  }));
}

function canManageNotificationWorkflow(user, notification) {
  if (isAdminViewer(user)) return true;
  if (isAssignedToActor(notification, user)) return true;
  const assignedRole = cleanString(notification?.assignedRole, 120).toLowerCase();
  return Boolean(assignedRole && getActorOrgRoleTokens(user).has(assignedRole));
}

function assertNotificationWorkflowOwner(user, notification, action = 'manage this notification workflow') {
  if (canManageNotificationWorkflow(user, notification)) return;
  const error = new Error(`You are not authorized to ${action}.`);
  error.statusCode = 403;
  throw error;
}

function assertTaskAssigneeSelected(assignment) {
  const assignedPersonId = toPublicId(assignment?.assignedPersonId || '');
  if (!assignedPersonId) {
    const error = new Error('Select a person assignee before assigning this task.');
    error.statusCode = 400;
    throw error;
  }
}

function assertAdminViewer(user, action = 'delete this item') {
  if (isAdminViewer(user)) return;
  const error = new Error(`You are not authorized to ${action}.`);
  error.statusCode = 403;
  throw error;
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

async function buildLifecycleEvent({
  action,
  actorUser,
  oldStatus = '',
  newStatus = '',
  note = '',
  snapshot = {},
  personId = '',
  personName = '',
  targetPersonId = '',
  targetPersonName = ''
}) {
  const actorUserId = getActorId(actorUser);
  const actorPersonId = getActorPersonId(actorUser);
  const actorName = await resolveActorName(actorUser);
  const safeSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const resolvedTargetPersonId = firstLifecyclePersonId(
    targetPersonId,
    safeSnapshot.targetPersonId,
    safeSnapshot.taskAssignedPersonId,
    safeSnapshot.assignedPersonId,
    safeSnapshot.requesterPersonId
  );
  const resolvedTargetPersonName = await resolvePersonName(
    resolvedTargetPersonId,
    targetPersonName || safeSnapshot.targetPersonName || safeSnapshot.taskAssignedPersonName || safeSnapshot.assignedPersonName || safeSnapshot.requesterName || resolvedTargetPersonId
  );
  const resolvedPersonId = firstLifecyclePersonId(personId, resolvedTargetPersonId, actorPersonId);
  const resolvedPersonName = await resolvePersonName(
    resolvedPersonId,
    personName || resolvedTargetPersonName || actorName || resolvedPersonId
  );

  return {
    at: new Date().toISOString(),
    action: cleanString(action, 80),
    personId: resolvedPersonId,
    personName: resolvedPersonName,
    actorId: actorUserId,
    actorUserId,
    actorPersonId,
    actorName,
    targetPersonId: resolvedTargetPersonId || resolvedPersonId,
    targetPersonName: resolvedTargetPersonName || resolvedPersonName,
    oldStatus: cleanString(oldStatus, 40),
    newStatus: cleanString(newStatus, 40),
    note: cleanString(note, 1000),
    snapshot: safeSnapshot
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
    assignedPersonName: cleanString(row?.assignedPersonName, 160),
    requesterPersonId: toPublicId(row?.requesterPersonId || row?.metadata?.requesterPersonId),
    requesterName: cleanString(row?.requesterName || row?.metadata?.requesterName, 160),
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

function findLifecycleTaskContext(row = {}, event = {}) {
  const snapshot = event?.snapshot && typeof event.snapshot === 'object' && !Array.isArray(event.snapshot) ? event.snapshot : {};
  const targetTaskId = toPublicId(snapshot.taskId || '');
  const tasks = Array.isArray(row?.tasks) ? row.tasks : [];
  if (targetTaskId) {
    const byId = tasks.find((task) => idsEqual(task?.id, targetTaskId));
    if (byId) return byId;
  }
  return tasks.find((task) => normalizeLifecyclePersonId(task?.assignedPersonId)) || {};
}

async function enrichLifecycleForDisplay(lifecycle = [], row = {}) {
  const events = Array.isArray(lifecycle) ? lifecycle : [];
  return Promise.all(events.map(async (event) => {
    const snapshot = event?.snapshot && typeof event.snapshot === 'object' && !Array.isArray(event.snapshot) ? event.snapshot : {};
    const taskContext = findLifecycleTaskContext(row, event);
    const actorUserId = toPublicId(event?.actorUserId || event?.actorId || '');
    const actorPersonId = firstLifecyclePersonId(event?.actorPersonId);
    const actorName = actorPersonId
      ? await resolvePersonName(actorPersonId, event?.actorName || actorPersonId)
      : await personDisplayNameService.resolveUserIdDisplayName(actorUserId, {
      fallback: cleanString(event?.actorName || event?.actorId || 'System', 160)
    });
    const targetPersonId = firstLifecyclePersonId(
      event?.targetPersonId,
      snapshot.targetPersonId,
      snapshot.taskAssignedPersonId,
      snapshot.assignedPersonId,
      taskContext?.assignedPersonId,
      row?.assignedPersonId,
      row?.metadata?.requesterPersonId,
      snapshot.requesterPersonId
    );
    const targetPersonName = await resolvePersonName(
      targetPersonId,
      event?.targetPersonName
        || snapshot.targetPersonName
        || snapshot.taskAssignedPersonName
        || snapshot.assignedPersonName
        || taskContext?.assignedPersonName
        || row?.assignedPersonName
        || row?.metadata?.requesterName
        || snapshot.requesterName
        || targetPersonId
    );
    const personId = firstLifecyclePersonId(event?.personId, targetPersonId, actorPersonId);
    const personName = await resolvePersonName(
      personId,
      event?.personName || targetPersonName || actorName || personId
    );
    const actorDiffers = Boolean(actorPersonId && personId && !idsEqual(actorPersonId, personId));
    const displayPersonLabel = actorDiffers && actorName
      ? `${personName || personId} (by ${actorName})`
      : (personName || personId || actorName || 'System');
    return {
      ...event,
      personId,
      personName,
      actorId: actorUserId,
      actorUserId,
      actorPersonId,
      actorName,
      targetPersonId: targetPersonId || personId,
      targetPersonName: targetPersonName || personName,
      displayPersonLabel
    };
  }));
}

async function enrichTaskForDisplay(task = {}) {
  const assignedPersonId = toPublicId(task.assignedPersonId || '');
  const taskStatus = normalizeTaskStatus(task.status, 'open');
  const next = {
    ...task,
    status: assignedPersonId && taskStatus === 'open' ? 'in_progress' : taskStatus
  };
  if (assignedPersonId && taskStatus === 'open') {
    next.startedAt = cleanString(task.startedAt || task.reassignedAt || task.assignedAt || task.updatedAt || task.createdAt, 40) || new Date().toISOString();
    next.assignedAt = cleanString(task.assignedAt || task.reassignedAt || next.startedAt, 40);
  }
  if (!assignedPersonId) return next;
  return {
    ...next,
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
    lifecycle: await enrichLifecycleForDisplay(row.lifecycle, row),
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
    if (assignedChanged || reassigned) {
      nextReassignedAt = now;
      nextAssignedAt = now;
      nextStartedAt = '';
    }
    if (!nextStartedAt && nextStatusValue === 'in_progress') {
      nextStartedAt = now;
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

function buildCompletedAssignmentHistoryEntry(task = {}, reassignedAt = new Date().toISOString(), nextAssignment = {}) {
  const previousPersonId = toPublicId(task.assignedPersonId || '');
  if (!previousPersonId) return null;
  return {
    id: `SNTA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    assignedRole: cleanString(task.assignedRole, 120),
    assignedPersonId: previousPersonId,
    assignedPersonName: cleanString(task.assignedPersonName || previousPersonId, 160),
    assignedAt: cleanString(task.assignedAt, 40),
    startedAt: cleanString(task.startedAt, 40),
    reassignedAt,
    completedAt: reassignedAt,
    status: 'completed',
    note: nextAssignment?.assignedPersonId
      ? `Task was assigned to ${cleanString(nextAssignment.assignedPersonName || nextAssignment.assignedPersonId, 160)}.`
      : 'Task assignment ended.'
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

async function deleteSourceNotification(input = {}, reqUser = null) {
  const orgId = toPublicId(input.orgId || getActiveOrgId(reqUser));
  const sourceType = cleanString(input.sourceType, 80).toLowerCase();
  const sourceId = toPublicId(input.sourceId || '');
  if (!reqUser) {
    const error = new Error('Request user is required to delete source notifications.');
    error.statusCode = 403;
    throw error;
  }
  assertAdminViewer(reqUser, 'remove source notification');
  if (!orgId || !sourceType || !sourceId) return false;
  const existing = await findBySource({ orgId, sourceType, sourceId });
  if (!existing) return false;
  const row = await getNotificationById(existing.id, reqUser);
  if (!row) return false;
  const removed = await schoolRepositories.notifications.remove(existing.id, normalizeQueryScope(reqUser));
  return removed !== false;
}

async function deleteNotification(reqUser, id) {
  assertAdminViewer(reqUser, 'delete this notification');
  const existing = await getNotificationById(id, reqUser);
  if (!existing) {
    const error = new Error('Notification was not found.');
    error.statusCode = 404;
    throw error;
  }
  const removed = await schoolRepositories.notifications.remove(existing.id, normalizeQueryScope(reqUser));
  if (removed === false) {
    const error = new Error('Notification could not be deleted.');
    error.statusCode = 404;
    throw error;
  }
  return {
    id: toPublicId(existing.id),
    removed: removed !== false
  };
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
    status: assignment.assignedPersonId ? 'in_progress' : 'open',
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
      targetPersonId: assignment.assignedPersonId || routedInput?.metadata?.requesterPersonId,
      targetPersonName: assignment.assignedPersonName || routedInput?.metadata?.requesterName,
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
        targetPersonId: existing.assignedPersonId || existing?.metadata?.requesterPersonId,
        targetPersonName: existing.assignedPersonName || existing?.metadata?.requesterName,
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
      requesterName,
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
        targetPersonId: existing.assignedPersonId || existing?.metadata?.requesterPersonId,
        targetPersonName: existing.assignedPersonName || existing?.metadata?.requesterName,
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
        targetPersonId: assignment.assignedPersonId || previousAssignedPersonId || existing?.metadata?.requesterPersonId,
        targetPersonName: assignment.assignedPersonName || existing.assignedPersonName || existing?.metadata?.requesterName,
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
  assertNotificationWorkflowOwner(reqUser, existing, 'assign tasks for this notification');
  const assignment = await resolveAssignmentInput(input);
  assertTaskAssigneeSelected(assignment);
  const now = new Date().toISOString();
  const taskTiming = normalizeTaskWithTiming({
    actor: true,
    task: {},
    assignedPersonId: assignment.assignedPersonId,
    assignedRole: assignment.assignedRole,
    assignedPersonName: assignment.assignedPersonName,
    status: assignment.assignedPersonId ? 'in_progress' : 'open',
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
        targetPersonId: assignment.assignedPersonId,
        targetPersonName: assignment.assignedPersonName,
        snapshot: {
          ...buildNotificationSummary(existing),
          taskAssignedPersonId: assignment.assignedPersonId,
          taskAssignedPersonName: assignment.assignedPersonName
        }
      })
    ]
  };
  return schoolRepositories.notifications.update(id, next, normalizeQueryScope(reqUser));
}

async function updateNotificationTask(reqUser, id, taskId, input = {}) {
  const existing = await getNotificationById(id, reqUser);
  if (!existing) throw new Error('Notification was not found.');
  const canManageWorkflow = canManageNotificationWorkflow(reqUser, existing);
  const targetTaskId = toPublicId(taskId);
  const now = new Date().toISOString();
  const rejectTaskWorkflowChange = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  };
  let found = false;
  let lifecycleTargetPersonId = '';
  let lifecycleTargetPersonName = '';
  let lifecyclePreviousAssignedPersonId = '';
  let lifecyclePreviousAssignedPersonName = '';
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
    const previousStatus = taskCopy.status;
    const statusProvided = Object.prototype.hasOwnProperty.call(input, 'status');
    const requestedStatus = statusProvided ? normalizeTaskStatus(input.status, '') : '';
    const assignmentProvided = Object.prototype.hasOwnProperty.call(input, 'assignedPersonId')
      || Object.prototype.hasOwnProperty.call(input, 'assignedPersonName')
      || Object.prototype.hasOwnProperty.call(input, 'assignedRole');
    const detailProvided = Object.prototype.hasOwnProperty.call(input, 'title')
      || Object.prototype.hasOwnProperty.call(input, 'description')
      || Object.prototype.hasOwnProperty.call(input, 'dueDate');

    if (!canManageWorkflow) {
      assertTaskOwnership(reqUser, taskCopy, 'complete this task');
      if (requestedStatus !== 'done') {
        const error = new Error('You can only mark your assigned task as completed.');
        error.statusCode = 403;
        throw error;
      }
      if (assignmentProvided || detailProvided) {
        const error = new Error('You cannot edit or reassign this task.');
        error.statusCode = 403;
        throw error;
      }
    }
    if (assignmentProvided && !['open', 'in_progress'].includes(previousStatus)) {
      rejectTaskWorkflowChange('Completed or cancelled tasks cannot be reassigned.');
    }
    if (!assignmentProvided) {
      if (detailProvided) {
        rejectTaskWorkflowChange('Task details can only be changed while reassigning the task.');
      }
      if (requestedStatus !== 'done') {
        rejectTaskWorkflowChange('Task status can only be completed from this workflow.');
      }
      if (previousStatus !== 'in_progress') {
        rejectTaskWorkflowChange('Only started tasks can be completed.');
      }
    }
    const assignment = canManageWorkflow
      ? await resolveAssignmentInput(input, taskCopy)
      : await resolveAssignmentInput({}, taskCopy);
    if (canManageWorkflow && assignmentProvided) {
      assertTaskAssigneeSelected(assignment);
    }
    const previousAssignedPersonId = toPublicId(taskCopy.assignedPersonId || '');
    const nextAssignedPersonId = toPublicId(assignment.assignedPersonId || '');
    const shouldClosePreviousAssignment = Boolean(
      canManageWorkflow
      && assignmentProvided
      && previousAssignedPersonId
      && nextAssignedPersonId
      && !idsEqual(previousAssignedPersonId, nextAssignedPersonId)
    );
    const nextStatus = assignmentProvided ? 'in_progress' : 'done';
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
    const completedAt = nextTaskTiming.status === 'done'
      ? (task.completedAt || cleanString(taskCopy.completedAt, 40) || now)
      : '';
    const previousAssignmentHistory = Array.isArray(taskCopy.assignmentHistory) ? taskCopy.assignmentHistory : [];
    const closedAssignmentEntry = shouldClosePreviousAssignment
      ? buildCompletedAssignmentHistoryEntry(taskCopy, nextTaskTiming.reassignedAt || now, assignment)
      : null;
    const updated = {
      ...taskCopy,
      title: cleanString(input.title || task.title, 220),
      description: cleanString(input.description ?? task.description, 2000),
      ...nextTaskTiming,
      note: normalizedNote,
      updatedAt: now,
      completedAt,
      assignmentHistory: closedAssignmentEntry
        ? previousAssignmentHistory.concat(closedAssignmentEntry)
        : previousAssignmentHistory
    };
    updated.assignedRole = nextTaskTiming.assignedRole;
    updated.assignedPersonId = nextTaskTiming.assignedPersonId;
    updated.assignedPersonName = nextTaskTiming.assignedPersonName;
    updated.dueDate = cleanDate(input.dueDate ?? task.dueDate);
    lifecycleTargetPersonId = updated.assignedPersonId || previousAssignedPersonId;
    lifecycleTargetPersonName = updated.assignedPersonName || taskCopy.assignedPersonName || lifecycleTargetPersonId;
    lifecyclePreviousAssignedPersonId = previousAssignedPersonId;
    lifecyclePreviousAssignedPersonName = taskCopy.assignedPersonName || previousAssignedPersonId;
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
        targetPersonId: lifecycleTargetPersonId,
        targetPersonName: lifecycleTargetPersonName,
        snapshot: {
          taskId: targetTaskId,
          taskAssignedPersonId: lifecycleTargetPersonId,
          taskAssignedPersonName: lifecycleTargetPersonName,
          previousAssignedPersonId: lifecyclePreviousAssignedPersonId,
          previousAssignedPersonName: lifecyclePreviousAssignedPersonName
        }
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
  canManageNotificationWorkflow,
  listVisibleNotifications,
  getNotificationById,
  upsertSourceNotification,
  resolveSourceNotification,
  upsertLeaveRequestNotification,
  resolveLeaveRequestNotification,
  deleteSourceNotification,
  deleteNotification,
  updateNotificationStatus,
  reassignNotification,
  addNotificationTask,
  updateNotificationTask,
  _private: {
    buildLifecycleEvent,
    buildNotificationSummary,
    enrichLifecycleForDisplay,
    findBySource,
    applyRoutingRule,
    normalizeLifecyclePersonId,
    resolveAssignmentInput
  }
};
