const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const activityService = require('./activityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback || '').trim().toLowerCase();
}

function normalizeAssigneeRows(rows = []) {
  if (typeof activityService.normalizeActivityAssigneeRows === 'function') {
    return activityService.normalizeActivityAssigneeRows(rows);
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const personId = normalizeId(row.personId || row.id);
      return personId ? { ...row, personId } : null;
    })
    .filter(Boolean);
}

function isOrgWideAccess(access = {}) {
  return schoolRecordAccessService.isOrgWideScope(access);
}

function isAssigneeRowEditable({ assignee, reqUser, access, targetPersonId }) {
  if (!assignee || activityService.isAssigneeTimesheetLocked(assignee)) return false;
  if (isOrgWideAccess(access)) return true;
  const scopedPersonId = normalizeId(access?.personId || reqUser?.personId);
  return scopedPersonId && idsEqual(assignee.personId, targetPersonId || scopedPersonId);
}

function findEntry(activity = {}, entryId = '') {
  const token = normalizeId(entryId);
  return activityService.getActivityEntries(activity).find((row) => idsEqual(row.entryId, token)) || null;
}

function findAssignee(entry = {}, personId = '') {
  const token = normalizeId(personId);
  return normalizeAssigneeRows(entry.assignees)
    .find((row) => idsEqual(row.personId, token)) || null;
}

function assertCanManageWorkSession(activity, entry, reqUser, accessContext = {}) {
  if (!activity) throw new Error('School activity not found.');
  if (!entry) throw new Error('Work session not found.');
  if (normalizeStatus(activity.status) === 'cancelled') {
    throw new Error('This activity has been cancelled.');
  }
  if (normalizeStatus(entry.status, 'posted') !== 'posted') {
    throw new Error('This work session is not posted.');
  }
  schoolRecordAccessService.assertActivityWorkSessionAccessible({
    activity,
    entry,
    access: schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext),
    context: 'manageWorkSession'
  });
}

function buildEntryDisplayTitle(entry = {}, index = 0) {
  const customTitle = String(entry.title || '').trim();
  if (customTitle) return customTitle;
  const date = String(entry.date || '').trim();
  if (date) return `Work session — ${date}`;
  return `Work session ${index + 1}`;
}

function buildAssigneeCompletionLabel(activity, assignee) {
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  if (evaluationType === 'completion') {
    return String(assignee.completionStatus || '').toLowerCase() === 'completed' ? 'Completed' : 'Pending';
  }
  return normalizeStatus(assignee.status) ? 'Attendance recorded' : 'Pending attendance';
}

function enrichAssigneeRow(activity, assignee, { reqUser, access, scopedPersonId } = {}) {
  const locked = activityService.isAssigneeTimesheetLocked(assignee);
  const editable = isAssigneeRowEditable({
    assignee,
    reqUser,
    access,
    targetPersonId: assignee.personId
  });
  const isSelf = scopedPersonId && idsEqual(assignee.personId, scopedPersonId);
  return {
    ...assignee,
    locked,
    editable,
    isSelf,
    readyForTimesheet: activityService.isAssigneeEligibleForTimesheet(activity, assignee),
    completionLabel: buildAssigneeCompletionLabel(activity, assignee)
  };
}

function isEntryAccessible(activity, entry, access) {
  return schoolRecordAccessService.isActivityWorkSessionAccessible({
    activity,
    entry,
    access,
    context: 'manageWorkSession'
  });
}

function buildSessionManageUrl(activityId, entryId) {
  return `/school/activities/${encodeURIComponent(normalizeId(activityId))}/work-sessions/${encodeURIComponent(normalizeId(entryId))}/manage`;
}

function buildOverviewManageUrl(activityId) {
  return `/school/activities/${encodeURIComponent(normalizeId(activityId))}/work-sessions/manage`;
}

function mapEntryToSessionSummary(activity, entry, index, { access, currentEntryId } = {}) {
  const entryId = normalizeId(entry.entryId);
  const assignees = normalizeAssigneeRows(entry.assignees).map((assignee) => ({
    personId: normalizeId(assignee.personId),
    personName: assignee.personName || assignee.personId || 'Unknown',
    role: assignee.role || 'participant',
    status: normalizeStatus(assignee.status, 'attended'),
    completionLabel: buildAssigneeCompletionLabel(activity, assignee),
    locked: activityService.isAssigneeTimesheetLocked(assignee),
    readyForTimesheet: activityService.isAssigneeEligibleForTimesheet(activity, assignee)
  }));
  const readyCount = assignees.filter((row) => row.readyForTimesheet).length;
  return {
    entryId,
    title: buildEntryDisplayTitle(entry, index),
    date: entry.date || '',
    startTime: entry.startTime || '',
    endTime: entry.endTime || '',
    durationHours: Number(entry.durationHours || 0),
    location: entry.location || activity.location || '',
    notes: entry.notes || '',
    assignees,
    assigneeNames: assignees.map((row) => row.personName).filter(Boolean).join(', '),
    assigneeCount: assignees.length,
    readyCount,
    hasLockedAssignees: assignees.some((row) => row.locked),
    manageUrl: buildSessionManageUrl(activity.id, entryId),
    isCurrent: currentEntryId ? idsEqual(entryId, currentEntryId) : false,
    accessible: isEntryAccessible(activity, entry, access)
  };
}

function listAccessiblePostedEntries(activity, access) {
  if (normalizeStatus(activity.status) === 'cancelled') return [];
  return activityService.getActivityEntries(activity)
    .filter((entry) => normalizeStatus(entry.status, 'posted') === 'posted')
    .filter((entry) => isEntryAccessible(activity, entry, access));
}

async function getWorkSessionsOverview(activityId, reqUser, accessContext = {}) {
  const activity = await activityService.getActivity(activityId, reqUser, accessContext);
  if (!activity) throw new Error('School activity not found.');
  if (normalizeStatus(activity.status) === 'cancelled') {
    throw new Error('This activity has been cancelled.');
  }
  if (normalizeStatus(activity.status) !== 'posted') {
    throw new Error('This activity is not posted.');
  }
  const access = schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext);
  const scopedPersonId = normalizeId(access.personId || reqUser?.personId);
  const canManageAll = isOrgWideAccess(access);
  const postedEntries = listAccessiblePostedEntries(activity, access);
  if (!postedEntries.length) {
    throw new Error('No accessible posted work sessions found for this activity.');
  }
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const sessions = postedEntries.map((entry, index) => mapEntryToSessionSummary(activity, entry, index, { access }));
  return {
    activity,
    sessions,
    evaluationType,
    evaluationTypeLabel: evaluationType === 'completion' ? 'Completion evaluation' : 'Attendance evaluation',
    canManageAll,
    scopedPersonId,
    overviewUrl: buildOverviewManageUrl(activity.id),
    evaluationTypeLocked: activityService.activityHasLockedAssigneeRows(activity)
  };
}

function buildSessionSummaryFromContext(context = {}, accessContext = {}, reqUser) {
  const activity = context.activity || {};
  const entry = context.entry || {};
  const access = schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext);
  const entries = listAccessiblePostedEntries(activity, access);
  const index = entries.findIndex((row) => idsEqual(row.entryId, entry.entryId));
  return mapEntryToSessionSummary(activity, entry, index >= 0 ? index : 0, {
    access,
    currentEntryId: entry.entryId
  });
}

function buildMutationPayload(context, accessContext, reqUser) {
  return {
    context,
    sessionSummary: buildSessionSummaryFromContext(context, accessContext, reqUser)
  };
}

function buildSiblingSessions(activity, access, currentEntryId) {
  return listAccessiblePostedEntries(activity, access)
    .map((entry, index) => mapEntryToSessionSummary(activity, entry, index, { access, currentEntryId }));
}

async function getWorkSessionContext(activityId, entryId, reqUser, accessContext = {}) {
  const activity = await activityService.getActivity(activityId, reqUser, accessContext);
  if (!activity) throw new Error('School activity not found.');
  const entry = findEntry(activity, entryId);
  if (!entry) throw new Error('Work session not found.');
  const access = schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext);
  assertCanManageWorkSession(activity, entry, reqUser, accessContext);
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const scopedPersonId = normalizeId(access.personId || reqUser?.personId);
  const canManageAll = isOrgWideAccess(access);
  const assignees = normalizeAssigneeRows(entry.assignees).map((assignee) =>
    enrichAssigneeRow(activity, assignee, { reqUser, access, scopedPersonId })
  );
  const siblingSessions = buildSiblingSessions(activity, access, entryId);
  return {
    activity,
    entry: { ...entry, assignees, title: buildEntryDisplayTitle(entry, siblingSessions.findIndex((row) => row.isCurrent)) },
    evaluationType,
    evaluationTypeLabel: evaluationType === 'completion' ? 'Completion evaluation' : 'Attendance evaluation',
    canManageAll,
    scopedPersonId,
    evaluationTypeLocked: activityService.activityHasLockedAssigneeRows(activity),
    siblingSessions,
    overviewUrl: buildOverviewManageUrl(activity.id)
  };
}

async function persistAssigneeUpdate(activityId, entryId, personId, updater, reqUser) {
  const activity = await schoolDataService.getDataById('activities', normalizeId(activityId), reqUser);
  if (!activity) throw new Error('School activity not found.');
  const entries = activityService.getActivityEntries(activity).map((entry) => {
    if (!idsEqual(entry.entryId, entryId)) return entry;
    const assignees = normalizeAssigneeRows(entry.assignees)
      .map((assignee) => {
        if (!idsEqual(assignee.personId, personId)) return assignee;
        return updater(assignee);
      });
    return { ...entry, assignees };
  });
  const attendees = activityService.flattenActivityAssignees(entries);
  return schoolDataService.updateData('activities', normalizeId(activityId), {
    ...activity,
    entries,
    attendees
  }, reqUser);
}

async function saveAssigneeRow({
  activityId,
  entryId,
  personId,
  reqUser,
  input = {},
  accessContext = {}
} = {}) {
  const context = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const assignee = findAssignee(context.entry, targetPersonId);
  if (!assignee) throw new Error('Assignee not found on this work session.');
  if (!isAssigneeRowEditable({
    assignee,
    reqUser,
    access: schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext),
    targetPersonId
  })) {
    throw new Error('You cannot edit this assignee row.');
  }
  const durationHours = Number(context.entry.durationHours || 0);
  const evaluationType = context.evaluationType;
  const paid = input.paid === undefined
    ? assignee.paid !== false
    : (input.paid === true || input.paid === 'true' || input.paid === 'on');
  const paidHours = input.paidHours === undefined || input.paidHours === ''
    ? Number(assignee.paidHours || durationHours || 0)
    : Number(input.paidHours);
  const notes = input.notes === undefined ? (assignee.notes || '') : String(input.notes || '').trim();
  let status = normalizeStatus(assignee.status, 'attended');
  if (evaluationType === 'attendance') {
    status = normalizeStatus(input.status || assignee.status, 'attended');
    if (!['attended', 'absent', 'excused'].includes(status)) {
      throw new Error('Invalid attendance status.');
    }
  } else if (input.status !== undefined && normalizeStatus(input.status) !== normalizeStatus(assignee.status)) {
    throw new Error('Attendance cannot be changed on completion-type activities. Use Mark complete instead.');
  }
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => ({
    ...row,
    status,
    paid,
    paidHours: Number.isFinite(paidHours) ? Number(paidHours.toFixed(2)) : row.paidHours,
    notes: notes.slice(0, 500)
  }), reqUser);
  const nextContext = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  return buildMutationPayload(nextContext, accessContext, reqUser);
}

async function completeAssignee({
  activityId,
  entryId,
  personId,
  reqUser,
  input = {},
  accessContext = {}
} = {}) {
  const context = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  if (context.evaluationType !== 'completion') {
    throw new Error('Completion is only available for completion-type activities.');
  }
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const assignee = findAssignee(context.entry, targetPersonId);
  if (!assignee) throw new Error('Assignee not found on this work session.');
  if (!isAssigneeRowEditable({
    assignee,
    reqUser,
    access: schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext),
    targetPersonId
  })) {
    throw new Error('You cannot complete this assignee row.');
  }
  const durationHours = Number(context.entry.durationHours || 0);
  const paid = assignee.paid !== false || context.activity.paid === true;
  let status = normalizeStatus(input.status || assignee.status, '');
  if (paid) {
    status = 'attended';
  } else if (!status) {
    status = normalizeStatus(assignee.status, 'attended');
  }
  const paidHours = input.paidHours === undefined || input.paidHours === ''
    ? Number(assignee.paidHours || durationHours || 0)
    : Number(input.paidHours);
  const notes = input.notes === undefined ? (assignee.notes || '') : String(input.notes || '').trim();
  const completedBy = toPublicId(reqUser?.personId || reqUser?.id);
  const completedAt = new Date().toISOString();
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => ({
    ...row,
    status,
    paid: row.paid !== false,
    paidHours: Number.isFinite(paidHours) ? Number(paidHours.toFixed(2)) : row.paidHours,
    notes: notes.slice(0, 500),
    completionStatus: 'completed',
    completedAt,
    completedBy
  }), reqUser);
  const nextContext = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  return buildMutationPayload(nextContext, accessContext, reqUser);
}

async function resetAssigneeCompletion({
  activityId,
  entryId,
  personId,
  reqUser,
  input = {},
  accessContext = {}
} = {}) {
  const context = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  if (context.evaluationType !== 'completion') {
    throw new Error('Pending completion is only available for completion-type activities.');
  }
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const assignee = findAssignee(context.entry, targetPersonId);
  if (!assignee) throw new Error('Assignee not found on this work session.');
  if (!isAssigneeRowEditable({
    assignee,
    reqUser,
    access: schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext),
    targetPersonId
  })) {
    throw new Error('You cannot update this assignee row.');
  }
  const durationHours = Number(context.entry.durationHours || 0);
  const paidHours = input.paidHours === undefined || input.paidHours === ''
    ? Number(assignee.paidHours || durationHours || 0)
    : Number(input.paidHours);
  const notes = input.notes === undefined ? (assignee.notes || '') : String(input.notes || '').trim();
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => ({
    ...row,
    paidHours: Number.isFinite(paidHours) ? Number(paidHours.toFixed(2)) : row.paidHours,
    notes: notes.slice(0, 500),
    completionStatus: 'pending',
    completedAt: '',
    completedBy: ''
  }), reqUser);
  const nextContext = await getWorkSessionContext(activityId, entryId, reqUser, accessContext);
  return buildMutationPayload(nextContext, accessContext, reqUser);
}

function countAccessiblePostedSessions(activity = {}, access = {}) {
  return listAccessiblePostedEntries(activity, access).length;
}


function resolveWorkSessionManageTarget({
  activity = {},
  entryId = '',
  access = {}
} = {}) {
  const entries = listAccessiblePostedEntries(activity, access);
  const requestedEntryId = normalizeId(entryId);
  const resolvedEntryId = normalizeId(
    (requestedEntryId && entries.some((row) => idsEqual(row.entryId, requestedEntryId))
      ? requestedEntryId
      : entries[0]?.entryId) || ''
  );
  const useDedicated = entries.length <= 1
    || (requestedEntryId && entries.some((row) => idsEqual(row.entryId, requestedEntryId)));
  if (useDedicated) {
    return {
      mode: 'dedicated',
      entryId: resolvedEntryId,
      url: buildSessionManageUrl(activity.id, resolvedEntryId)
    };
  }
  return {
    mode: 'overview',
    entryId: resolvedEntryId,
    url: buildOverviewManageUrl(activity.id)
  };
}

async function resolveWorkSessionManageTargetForRequest({
  activityId,
  entryId = '',
  reqUser,
  accessContext = {}
} = {}) {
  const activity = await activityService.getActivity(activityId, reqUser, accessContext);
  if (!activity) throw new Error('School activity not found.');
  const access = schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext);
  return resolveWorkSessionManageTarget({ activity, entryId, access });
}

module.exports = {
  assertCanManageWorkSession,
  getWorkSessionsOverview,
  getWorkSessionContext,
  saveAssigneeRow,
  completeAssignee,
  resetAssigneeCompletion,
  isAssigneeRowEditable,
  buildOverviewManageUrl,
  buildSessionManageUrl,
  buildSessionSummaryFromContext,
  buildMutationPayload,
  countAccessiblePostedSessions,
  resolveWorkSessionManageTarget,
  resolveWorkSessionManageTargetForRequest
};
