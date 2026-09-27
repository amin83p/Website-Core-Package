const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const activityService = require('./activityService');
const activityAssigneeTimingService = require('./activityAssigneeTimingService');
const schoolDependencyService = require('./schoolDependencyService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const workSessionAccessService = require('./workSessionAccessService');
const workSessionScheduleConflictService = require('./workSessionScheduleConflictService');
const activityEntryIdService = require('./activityEntryIdService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { OPERATIONS } = require('../../../config/accessConstants');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback || '').trim().toLowerCase();
}

function cleanText(value, { max = 500 } = {}) {
  return String(value === undefined || value === null ? '' : value).replace(/\0/g, '').trim().slice(0, max);
}

function parseJsonArray(value, fieldName = 'value') {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const raw = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'paid', 'payable'].includes(raw)) return true;
  if (['false', '0', 'no', 'off', 'unpaid', 'unpayable'].includes(raw)) return false;
  return fallback;
}

function normalizeClockTime(value, fieldName = 'Time') {
  const raw = cleanText(value, { max: 5 });
  if (!/^\d{2}:\d{2}$/.test(raw)) throw new Error(`${fieldName} must use HH:mm.`);
  const [hour, minute] = raw.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new Error(`${fieldName} must use HH:mm.`);
  return raw;
}

function normalizeDate(value) {
  const raw = cleanText(value, { max: 20 });
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw new Error('Work session date is required.');
}

function calculateDurationHours(startTime, endTime) {
  const duration = typeof activityService.calculateDurationHours === 'function'
    ? Number(activityService.calculateDurationHours(startTime, endTime) || 0)
    : 0;
  if (!(duration > 0)) throw new Error('Work session end time must be after start time.');
  return Number(duration.toFixed(2));
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

function canManageAllActivityWorkSessions(reqUser, operationId = OPERATIONS.UPDATE) {
  return schoolAdminAccessService.isWorkSessionsAdminViewer(reqUser, operationId)
    || schoolAdminAccessService.isActivitiesAdminViewer(reqUser, operationId);
}

function isAssigneeRowEditable({ entry, assignee, capabilities, targetPersonId, scopedPersonId }) {
  if (!assignee || activityService.isWorkSessionAssigneeLocked(entry || {}, assignee)) return false;
  const isSelf = scopedPersonId && idsEqual(assignee.personId, targetPersonId || scopedPersonId);
  return workSessionAccessService.canEditAssigneeRow(capabilities || {}, {
    isSelf,
    locked: false
  });
}

async function assertAssigneeNotLockedBySubmittedTimesheet({
  activity,
  entry,
  personId,
  reqUser,
  capabilities = {}
} = {}) {
  if (capabilities.isBypassAdmin || capabilities.canEditAnyAssigneeRow) return;
  await schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet({
    orgId: normalizeId(activity?.orgId || reqUser?.activeOrgId || reqUser?.orgId),
    activityId: normalizeId(activity?.id),
    entryId: normalizeId(entry?.entryId || entry?.id),
    personId: normalizeId(personId),
    reqUser
  });
}

function entryMatchesId(row = {}, entryId = '') {
  const token = normalizeId(entryId);
  if (!token) return false;
  const resolved = activityEntryIdService.resolveEntryId(row);
  return idsEqual(row.entryId, token)
    || idsEqual(row.id, token)
    || idsEqual(resolved, token)
    || idsEqual(row.legacyEntryId, token);
}

function findEntry(activity = {}, entryId = '') {
  const token = normalizeId(entryId);
  if (!token) return null;
  const entries = activityService.getActivityEntries(activity);
  let found = entries.find((row) => entryMatchesId(row, token));
  if (found) return found;
  const legacyIndex = token.match(/^ENTRY-(\d+)$/i);
  if (legacyIndex) {
    const activityToken = normalizeId(activity.id);
    const sequence = Number(legacyIndex[1]);
    if (activityToken && Number.isFinite(sequence) && sequence >= 1) {
      try {
        const candidate = activityEntryIdService.buildEntryId(activityToken, sequence);
        found = entries.find((row) => idsEqual(row.entryId, candidate));
        if (found) return found;
      } catch (_error) {
        // ignore invalid legacy sequence mapping
      }
    }
  }
  return null;
}

function resolveEntryAfterActivitySave(savedActivity = {}, entryId = '', priorEntry = null) {
  let savedEntry = findEntry(savedActivity, entryId);
  if (savedEntry) {
    return {
      entry: savedEntry,
      entryId: normalizeId(savedEntry.entryId || savedEntry.id)
    };
  }
  if (priorEntry) {
    savedEntry = activityService.getActivityEntries(savedActivity).find((row) => (
      String(row?.date || '') === String(priorEntry?.date || '')
      && String(row?.startTime || '') === String(priorEntry?.startTime || '')
      && String(row?.endTime || '') === String(priorEntry?.endTime || '')
    )) || null;
    if (savedEntry) {
      return {
        entry: savedEntry,
        entryId: normalizeId(savedEntry.entryId || savedEntry.id)
      };
    }
  }
  return { entry: null, entryId: normalizeId(entryId) };
}

function findAssignee(entry = {}, personId = '') {
  const token = normalizeId(personId);
  return normalizeAssigneeRows(entry.assignees)
    .find((row) => idsEqual(row.personId, token)) || null;
}

function assertCanViewWorkSession(activity, entry, reqUser, accessContext = {}, accessBundle = {}) {
  if (!activity) throw new Error('School activity not found.');
  if (!entry) throw new Error('Work session not found.');
  if (normalizeStatus(activity.status) === 'cancelled') {
    throw new Error('This activity has been cancelled.');
  }
  const entryStatus = normalizeStatus(entry.status, 'posted');
  const updateCaps = accessBundle.update || {};
  const canViewCancelledSession = (
    updateCaps.canEditSessionMetadataFull
    || updateCaps.canEditSessionMetadataPartial
    || updateCaps.canEditAnyAssigneeRow
  ) && entryStatus === 'cancelled';
  if (entryStatus !== 'posted' && !canViewCancelledSession) {
    throw new Error('This work session is not posted.');
  }
  workSessionAccessService.assertCanReadWorkSession({
    activity,
    entry,
    reqUser,
    accessContext,
    readCapabilities: accessBundle.read,
    readAllCapabilities: accessBundle.readAll
  });
}

function assertCanManageWorkSession(activity, entry, reqUser, accessContext = {}, accessBundle = {}) {
  assertCanViewWorkSession(activity, entry, reqUser, accessContext, accessBundle);
  const capabilities = accessBundle.update || accessBundle;
  workSessionAccessService.assertCanMutateWorkSession({
    activity,
    entry,
    reqUser,
    accessContext,
    updateCapabilities: capabilities
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

function enrichAssigneeRow(activity, assignee, {
  entry,
  scopedPersonId,
  lockDisplays,
  capabilities = {}
} = {}) {
  const locked = activityService.isWorkSessionAssigneeLocked(entry || {}, assignee);
  const isSelf = scopedPersonId && idsEqual(assignee.personId, scopedPersonId);
  const fieldCapabilities = workSessionAccessService.buildAssigneeFieldCapabilities(capabilities, {
    isSelf,
    locked
  });
  const editable = workSessionAccessService.canEditAssigneeRow(capabilities, { isSelf, locked });
  const lockKey = activityService.buildAssigneeLockDisplayKey(entry?.entryId || entry?.id, assignee.personId);
  const lockDisplay = lockDisplays && lockDisplays[lockKey] ? lockDisplays[lockKey] : null;
  return {
    ...assignee,
    locked,
    editable,
    isSelf,
    lockDisplay,
    ...fieldCapabilities,
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
    locked: activityService.isWorkSessionAssigneeLocked(entry, assignee),
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
  const hasLockedAssignees = activityService.activityHasLockedAssigneeRows(activity);
  const accessBundle = await workSessionAccessService.resolveWorkSessionAccessBundle(reqUser, accessContext, {
    hasLockedAssignees
  });
  if (!accessBundle.read?.canOpenPage) {
    throw new Error('You do not have permission to open Manage Work Session.');
  }
  if (!accessBundle.readAll?.canViewAnyData) {
    throw new Error('You do not have permission to view work sessions.');
  }
  const capabilities = accessBundle.update;
  const postedEntries = listAccessiblePostedEntries(activity, access);
  if (!postedEntries.length) {
    throw new Error('No accessible posted work sessions found for this activity.');
  }
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const sessions = postedEntries.map((entry, index) => mapEntryToSessionSummary(activity, entry, index, { access }));
  const canManageAll = capabilities.canManageAssigneeRoster
    && (capabilities.canEditSessionMetadataFull || capabilities.canEditSessionMetadataPartial);
  return {
    activity,
    sessions,
    evaluationType,
    evaluationTypeLabel: evaluationType === 'completion' ? 'Completion evaluation' : 'Attendance evaluation',
    canManageAll,
    capabilities,
    access: accessBundle,
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
  const activityId = normalizeId(context.activity?.id);
  const entryId = normalizeId(context.entry?.entryId || context.entry?.id);
  return {
    context,
    manageUrl: buildSessionManageUrl(activityId, entryId),
    sessionSummary: buildSessionSummaryFromContext(context, accessContext, reqUser)
  };
}

function buildSiblingSessions(activity, access, currentEntryId) {
  return listAccessiblePostedEntries(activity, access)
    .map((entry, index) => mapEntryToSessionSummary(activity, entry, index, { access, currentEntryId }));
}

function mapEligibleAssigneePickerRow(row = {}) {
  const personId = normalizeId(row.personId || row.id);
  if (!personId) return null;
  const displayName = cleanText(row.displayName || row.personName || personId, { max: 180 });
  const roles = Array.isArray(row.roles) ? row.roles.map((role) => cleanText(role, { max: 40 }).toLowerCase()).filter(Boolean) : [];
  const matchedRole = cleanText(row.matchedRole || roles[0] || '', { max: 40 }).toLowerCase();
  return {
    id: personId,
    personId,
    displayName,
    firstName: cleanText(row.firstName || '', { max: 80 }),
    lastName: cleanText(row.lastName || '', { max: 80 }),
    preferredName: cleanText(row.preferredName || '', { max: 80 }),
    roles,
    matchedRole,
    title: displayName
  };
}

async function buildEligibleAssigneePersons(activity = {}, entry = {}, reqUser = {}) {
  const orgId = normalizeId(activity.orgId || reqUser?.activeOrgId || reqUser?.orgId);
  const eligiblePersons = await activityService.getEligiblePersons({ orgId, reqUser, q: '' });
  const eligiblePersonIds = [...new Set((Array.isArray(eligiblePersons) ? eligiblePersons : [])
    .map((row) => normalizeId(row?.personId || row?.id))
    .filter(Boolean))];
  const allowedIds = activityService.getEffectiveEntryAllowedIds(activity, entry, eligiblePersonIds);
  const allowedSet = new Set(allowedIds);
  return (Array.isArray(eligiblePersons) ? eligiblePersons : [])
    .filter((row) => allowedSet.has(normalizeId(row?.personId || row?.id)))
    .map((row) => mapEligibleAssigneePickerRow(row))
    .filter(Boolean)
    .sort((a, b) => String(a.displayName || a.personId).localeCompare(String(b.displayName || b.personId)));
}

async function getWorkSessionContext(activityId, entryId, reqUser, accessContext = {}) {
  const activity = await activityService.getActivity(activityId, reqUser, accessContext);
  if (!activity) throw new Error('School activity not found.');
  let entry = findEntry(activity, entryId);
  if (!entry) throw new Error('Work session not found.');
  entry = await schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded({
    activity,
    entry,
    reqUser
  });
  const access = schoolRecordAccessService.resolveAccessFromUser(reqUser, accessContext);
  const hasLockedAssignees = workSessionAccessService.entryHasLockedAssignees(entry);
  const accessBundle = await workSessionAccessService.resolveWorkSessionAccessBundle(reqUser, accessContext, {
    hasLockedAssignees
  });
  const capabilities = accessBundle.update;
  assertCanViewWorkSession(activity, entry, reqUser, accessContext, accessBundle);
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const scopedPersonId = normalizeId(access.personId || reqUser?.personId);
  const readAllCaps = accessBundle.readAll;
  const createCaps = accessBundle.create;
  const deleteCaps = accessBundle.delete;
  const canViewAllAssignees = Boolean(readAllCaps.canViewAllAssignees);
  const canManageAssigneeRoster = Boolean(
    createCaps.canAddAssignees || deleteCaps.canRemoveAssignees || capabilities.canManageAssigneeRoster
  );
  const canManageAll = canManageAssigneeRoster
    && (capabilities.canEditSessionMetadataFull || capabilities.canEditSessionMetadataPartial);
  const canEditWorkSessionMetadata = capabilities.canEditSessionMetadataFull
    || capabilities.canEditSessionMetadataPartial;
  const canViewSessionMetadata = canEditWorkSessionMetadata || Boolean(readAllCaps.canViewSessionDetailsReadOnly);
  const canAddAssignees = Boolean(createCaps.canAddAssignees);
  const canRemoveAssignees = Boolean(deleteCaps.canRemoveAssignees);
  const canEditAssigneeTiming = capabilities.canEditAnyAssigneeRow || capabilities.canEditOwnAssigneeTiming;
  const eligibleAssigneePersons = await buildEligibleAssigneePersons(activity, entry, reqUser);
  const eligibleRolesByPersonId = new Map(
    eligibleAssigneePersons.map((row) => [
      normalizeId(row.personId),
      normalizeRoleList(row.roles || row.matchedRole || row.role, row.matchedRole || 'participant')
    ]).filter(([personId]) => Boolean(personId))
  );
  const assigneeLockDisplays = await activityService.buildActivityAssigneeLockDisplays(activity, reqUser);
  const assignees = normalizeAssigneeRows(entry.assignees)
    .map((assignee) => {
      const enriched = enrichAssigneeRow(activity, assignee, {
        entry,
        scopedPersonId,
        lockDisplays: assigneeLockDisplays,
        capabilities
      });
      const personId = normalizeId(enriched.personId);
      const mergedRoles = mergeAssigneeRoleLists(
        enriched.roles || enriched.role,
        eligibleRolesByPersonId.get(personId) || [],
        enriched.role
      );
      return { ...enriched, ...mergedRoles };
    })
    .filter((assignee) => canViewAllAssignees || assignee.isSelf);
  const siblingSessions = buildSiblingSessions(activity, access, entryId);
  const visibilityScope = activityService.normalizeActivityVisibilityScope(
    activity.visibilityScope || activity.calendarScope || activity.scope
  );
  return {
    activity,
    entry: { ...entry, assignees, title: buildEntryDisplayTitle(entry, siblingSessions.findIndex((row) => row.isCurrent)) },
    evaluationType,
    evaluationTypeLabel: evaluationType === 'completion' ? 'Completion evaluation' : 'Attendance evaluation',
    canManageAll,
    canManageAssigneeRoster,
    canViewAllAssignees,
    canViewSessionMetadata,
    canAddAssignees,
    canRemoveAssignees,
    canEditWorkSessionMetadata,
    canEditSessionMetadataFull: capabilities.canEditSessionMetadataFull,
    canEditSessionMetadataPartial: capabilities.canEditSessionMetadataPartial,
    canEditAssigneeTiming,
    capabilities,
    access: accessBundle,
    scopedPersonId,
    hasLockedAssigneesOnEntry: hasLockedAssignees,
    evaluationTypeLocked: activityService.activityHasLockedAssigneeRows(activity),
    siblingSessions,
    overviewUrl: buildOverviewManageUrl(activity.id),
    eligibleAssigneePersons,
    visibilityScope
  };
}

function normalizeRoleList(value, fallback = 'participant') {
  const source = Array.isArray(value) ? value : String(value || fallback || '').split(',');
  const roles = [...new Set(source.map((item) => cleanText(
    typeof item === 'string' ? item : (item?.role || item?.key || item?.name || item?.label || ''),
    { max: 40 }
  ).toLowerCase()).filter(Boolean))];
  return roles.length ? roles : [fallback];
}

function mergeAssigneeRoleLists(storedRoles, lookupRoles, selectedRole = 'participant') {
  const role = cleanText(selectedRole || 'participant', { max: 40 }).toLowerCase() || 'participant';
  const roles = normalizeRoleList([
    ...(Array.isArray(storedRoles) ? storedRoles : []),
    role,
    ...(Array.isArray(lookupRoles) ? lookupRoles : [])
  ], role);
  const normalizedRole = roles.includes(role) ? role : (roles[0] || 'participant');
  return { role: normalizedRole, roles };
}

function normalizeAdminAssigneeRow(
  row = {},
  priorByPerson = new Map(),
  durationHours = 0,
  evaluationType = 'attendance',
  reqUser = {},
  timingContext = {}
) {
  const personId = normalizeId(row.personId || row.id);
  if (!personId) return null;
  const prior = priorByPerson.get(personId) || {};
  const role = cleanText(row.role || prior.role || 'participant', { max: 40 }).toLowerCase() || 'participant';
  const roles = normalizeRoleList(row.roles || prior.roles || role, role);
  if (!roles.includes(role)) roles.unshift(role);
  const status = normalizeStatus(row.status || prior.status, 'attended');
  if (!['attended', 'absent', 'excused'].includes(status)) throw new Error('Invalid assignee status.');
  let completionStatus = normalizeStatus(row.completionStatus || prior.completionStatus, 'pending');
  if (!['pending', 'completed'].includes(completionStatus)) completionStatus = 'pending';
  const wasCompleted = normalizeStatus(prior.completionStatus) === 'completed';
  const completedBy = toPublicId(reqUser?.personId || reqUser?.id);
  let completedAt = prior.completedAt || '';
  let completedByValue = prior.completedBy || '';
  if (evaluationType === 'completion') {
    if (completionStatus === 'completed' && !wasCompleted) {
      completedAt = new Date().toISOString();
      completedByValue = completedBy;
    } else if (completionStatus === 'pending') {
      completedAt = '';
      completedByValue = '';
    }
  } else {
    completionStatus = prior.completionStatus || 'pending';
    completedAt = prior.completedAt || '';
    completedByValue = prior.completedBy || '';
  }
  const isPaid = parseBoolean(row.paid, prior.paid !== false);
  const parsedPaidHours = row.paidHours === undefined || row.paidHours === ''
    ? Number(prior.paidHours ?? durationHours ?? 0)
    : Number(row.paidHours);
  const safeRowPaidHours = isPaid
    ? activityAssigneeTimingService.normalizePaidHours(parsedPaidHours, prior.paidHours ?? durationHours)
    : 0;
  const base = {
    ...prior,
    personId,
    personName: cleanText(row.personName || row.displayName || row.name || prior.personName || personId, { max: 180 }),
    roles,
    role,
    status,
    paid: isPaid,
    paidHours: safeRowPaidHours,
    notes: cleanText(row.notes === undefined ? prior.notes : row.notes, { max: 500 }),
    completionStatus,
    completedAt,
    completedBy: completedByValue
  };
  const entry = {
    startTime: timingContext.newSessionStartTime || timingContext.priorSessionStartTime || '',
    endTime: timingContext.sessionEndTime || '',
    durationHours
  };
  const nextStart = activityAssigneeTimingService.resolveAssigneeStartAfterSessionChange({
    assignee: base,
    priorSessionStartTime: timingContext.priorSessionStartTime,
    newSessionStartTime: timingContext.newSessionStartTime
  });
  const inputStart = activityAssigneeTimingService.normalizeClockTime(row.startTime);
  const inputEnd = activityAssigneeTimingService.normalizeClockTime(row.endTime);
  const timed = activityAssigneeTimingService.applyAssigneeTiming(base, entry, {
    startTime: inputStart || nextStart,
    endTime: inputEnd || undefined,
    paidHours: safeRowPaidHours
  });
  activityAssigneeTimingService.assertAssigneeTimingRules({ assignee: timed, entry });
  return timed;
}

function normalizeAdminAssigneeRows(
  inputRows,
  existingRows = [],
  durationHours = 0,
  evaluationType = 'attendance',
  reqUser = {},
  timingContext = {}
) {
  const priorByPerson = new Map(normalizeAssigneeRows(existingRows).map((row) => [normalizeId(row.personId), row]));
  const seen = new Set();
  return (Array.isArray(inputRows) ? inputRows : []).map((row) => {
    const normalized = normalizeAdminAssigneeRow(
      row,
      priorByPerson,
      durationHours,
      evaluationType,
      reqUser,
      timingContext
    );
    if (!normalized || seen.has(normalized.personId)) return null;
    seen.add(normalized.personId);
    return normalized;
  }).filter(Boolean);
}

async function saveWorkSessionMetadata({
  activityId,
  entryId,
  reqUser,
  input = {},
  accessContext = {}
} = {}) {
  const activity = await activityService.getActivity(activityId, reqUser, accessContext);
  if (!activity) throw new Error('School activity not found.');
  const priorEntry = findEntry(activity, entryId);
  if (!priorEntry) throw new Error('Work session not found.');
  const hasLockedAssignees = workSessionAccessService.entryHasLockedAssignees(priorEntry);
  const accessBundle = await workSessionAccessService.resolveWorkSessionAccessBundle(reqUser, accessContext, {
    hasLockedAssignees
  });
  const capabilities = accessBundle.update;
  if (!capabilities.canEditSessionMetadataFull && !capabilities.canEditSessionMetadataPartial) {
    throw new Error('You cannot edit this work session.');
  }
  assertCanManageWorkSession(activity, priorEntry, reqUser, accessContext, accessBundle);

  const status = normalizeStatus(input.status || priorEntry.status, 'posted');
  if (!['posted', 'cancelled'].includes(status)) {
    throw new Error('Manage Work Session supports only posted or cancelled status.');
  }
  const priorSessionStartRaw = String(input.priorSessionStartTime || priorEntry.startTime || '').trim();
  const priorSessionStartTime = /^\d{2}:\d{2}$/.test(priorSessionStartRaw)
    ? priorSessionStartRaw
    : normalizeClockTime(priorEntry.startTime, 'Start time');
  const startTime = normalizeClockTime(input.startTime || priorEntry.startTime, 'Start time');
  const endTime = normalizeClockTime(input.endTime || priorEntry.endTime, 'End time');
  const durationHours = calculateDurationHours(startTime, endTime);
  const date = normalizeDate(input.date || priorEntry.date);
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const submittedAssignees = input.assignees === undefined
    ? normalizeAssigneeRows(priorEntry.assignees)
    : parseJsonArray(input.assignees, 'Work session assignees');
  const priorAssigneeByPerson = new Map(
    normalizeAssigneeRows(priorEntry.assignees).map((row) => [normalizeId(row.personId), row])
  );
  const nextAssignees = normalizeAdminAssigneeRows(
    submittedAssignees,
    priorEntry.assignees,
    durationHours,
    evaluationType,
    reqUser,
    {
      priorSessionStartTime,
      newSessionStartTime: startTime,
      sessionEndTime: endTime
    }
  ).map((assignee) => {
    const prior = priorAssigneeByPerson.get(normalizeId(assignee.personId));
    if (prior && activityService.isAssigneeTimesheetLocked(prior)) {
      return prior;
    }
    return assignee;
  });
  workSessionAccessService.assertAssigneeRosterChanges({
    priorEntryAssignees: priorEntry.assignees,
    nextAssigneePersonIds: nextAssignees.map((row) => row.personId),
    createCapabilities: accessBundle.create,
    deleteCapabilities: accessBundle.delete
  });
  workSessionAccessService.assertSessionMetadataChanges({
    capabilities,
    priorEntry,
    input: {
      date,
      startTime,
      endTime,
      status,
      title: input.title,
      location: input.location
    },
    nextAssigneePersonIds: nextAssignees.map((row) => row.personId),
    priorEntryAssignees: priorEntry.assignees
  });
  await workSessionScheduleConflictService.assertNoAssigneeScheduleConflicts({
    orgId: activity.orgId || reqUser?.activeOrgId || '',
    activityId: normalizeId(activityId),
    entryId: normalizeId(priorEntry.entryId || entryId),
    date,
    startTime,
    endTime,
    assignees: nextAssignees,
    reqUser,
    priorEntry,
    status,
    forceConflicts: input.forceConflicts
  });
  const entries = activityService.getActivityEntries(activity).map((row) => {
    if (!entryMatchesId(row, entryId)) return row;
    return {
      ...row,
      title: cleanText(input.title === undefined ? row.title : input.title, { max: 180 }),
      status,
      location: cleanText(input.location === undefined ? row.location : input.location, { max: 180 }),
      date,
      startTime,
      endTime,
      durationHours,
      assignees: nextAssignees
    };
  });

  const savedActivity = await activityService.saveActivity({
    ...activity,
    id: normalizeId(activityId),
    entries,
    attendees: activityService.flattenActivityAssignees(entries)
  }, reqUser);
  const resolved = resolveEntryAfterActivitySave(savedActivity || {}, entryId, priorEntry);
  if (!resolved.entry) throw new Error('Work session not found.');
  const nextContext = await getWorkSessionContext(activityId, resolved.entryId, reqUser, accessContext);
  return buildMutationPayload(nextContext, accessContext, reqUser);
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

function assertContextCanMutate(context, reqUser, accessContext) {
  workSessionAccessService.assertCanMutateWorkSession({
    activity: context.activity,
    entry: context.entry,
    reqUser,
    accessContext,
    updateCapabilities: context.capabilities
  });
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
  assertContextCanMutate(context, reqUser, accessContext);
  const capabilities = context.capabilities || {};
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const priorAssignee = findAssignee(context.entry, targetPersonId);
  const assignee = priorAssignee;
  if (!assignee) throw new Error('Assignee not found on this work session.');
  const scopedPersonId = normalizeId(context.scopedPersonId);
  const isSelf = scopedPersonId && idsEqual(assignee.personId, scopedPersonId);
  if (!isAssigneeRowEditable({
    entry: context.entry,
    assignee,
    capabilities,
    targetPersonId,
    scopedPersonId
  })) {
    throw new Error('You cannot edit this assignee row.');
  }
  await assertAssigneeNotLockedBySubmittedTimesheet({
    activity: context.activity,
    entry: context.entry,
    personId: targetPersonId,
    reqUser,
    capabilities
  });
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
  const safePaidHours = Number.isFinite(paidHours)
    ? Number(paidHours.toFixed(2))
    : Number(assignee.paidHours || durationHours || 0);
  const canEditTiming = capabilities.canEditAnyAssigneeRow
    || (isSelf && capabilities.canEditOwnAssigneeTiming);
  workSessionAccessService.assertAssigneeFieldChanges({
    capabilities,
    assignee,
    prior: priorAssignee,
    isSelf,
    input,
    evaluationType
  });
  let inputStartTime;
  let inputEndTime;
  if (canEditTiming) {
    inputStartTime = input.startTime === undefined || input.startTime === ''
      ? undefined
      : normalizeClockTime(input.startTime, 'Assignee start time');
    inputEndTime = input.endTime === undefined || input.endTime === ''
      ? undefined
      : normalizeClockTime(input.endTime, 'Assignee end time');
  }
  const sessionEntry = findEntry(context.activity, entryId) || context.entry;
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => {
    const next = {
      ...row,
      status,
      paid,
      paidHours: paid ? safePaidHours : 0,
      notes: notes.slice(0, 500)
    };
    const timed = activityAssigneeTimingService.applyAssigneeTiming(next, sessionEntry, {
      startTime: inputStartTime,
      endTime: inputEndTime,
      paidHours: paid ? safePaidHours : 0
    });
    activityAssigneeTimingService.assertAssigneeTimingRules({ assignee: timed, entry: sessionEntry });
    return timed;
  }, reqUser);
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
  assertContextCanMutate(context, reqUser, accessContext);
  if (context.evaluationType !== 'completion') {
    throw new Error('Completion is only available for completion-type activities.');
  }
  const capabilities = context.capabilities || {};
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const assignee = findAssignee(context.entry, targetPersonId);
  if (!assignee) throw new Error('Assignee not found on this work session.');
  const scopedPersonId = normalizeId(context.scopedPersonId);
  if (!isAssigneeRowEditable({
    entry: context.entry,
    assignee,
    capabilities,
    targetPersonId,
    scopedPersonId
  })) {
    throw new Error('You cannot complete this assignee row.');
  }
  await assertAssigneeNotLockedBySubmittedTimesheet({
    activity: context.activity,
    entry: context.entry,
    personId: targetPersonId,
    reqUser,
    capabilities
  });
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
  const safePaidHours = Number.isFinite(paidHours)
    ? Number(paidHours.toFixed(2))
    : Number(assignee.paidHours || durationHours || 0);
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => {
    const next = {
      ...row,
      status,
      paid: row.paid !== false,
      paidHours: safePaidHours,
      notes: notes.slice(0, 500),
      completionStatus: 'completed',
      completedAt,
      completedBy
    };
    return activityAssigneeTimingService.applyAssigneeTiming(next, context.entry, {
      paidHours: safePaidHours
    });
  }, reqUser);
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
  assertContextCanMutate(context, reqUser, accessContext);
  if (context.evaluationType !== 'completion') {
    throw new Error('Pending completion is only available for completion-type activities.');
  }
  const capabilities = context.capabilities || {};
  const targetPersonId = normalizeId(personId || input.personId || context.scopedPersonId);
  const assignee = findAssignee(context.entry, targetPersonId);
  if (!assignee) throw new Error('Assignee not found on this work session.');
  const scopedPersonId = normalizeId(context.scopedPersonId);
  if (!isAssigneeRowEditable({
    entry: context.entry,
    assignee,
    capabilities,
    targetPersonId,
    scopedPersonId
  })) {
    throw new Error('You cannot update this assignee row.');
  }
  await assertAssigneeNotLockedBySubmittedTimesheet({
    activity: context.activity,
    entry: context.entry,
    personId: targetPersonId,
    reqUser,
    capabilities
  });
  const durationHours = Number(context.entry.durationHours || 0);
  const paidHours = input.paidHours === undefined || input.paidHours === ''
    ? Number(assignee.paidHours || durationHours || 0)
    : Number(input.paidHours);
  const notes = input.notes === undefined ? (assignee.notes || '') : String(input.notes || '').trim();
  const safePaidHours = Number.isFinite(paidHours)
    ? Number(paidHours.toFixed(2))
    : Number(assignee.paidHours || durationHours || 0);
  await persistAssigneeUpdate(activityId, entryId, targetPersonId, (row) => {
    const next = {
      ...row,
      paidHours: safePaidHours,
      notes: notes.slice(0, 500),
      completionStatus: 'pending',
      completedAt: '',
      completedBy: ''
    };
    return activityAssigneeTimingService.applyAssigneeTiming(next, context.entry, {
      paidHours: safePaidHours
    });
  }, reqUser);
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
  saveWorkSessionMetadata,
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
  resolveWorkSessionManageTargetForRequest,
  listAccessiblePostedEntries,
  enrichAssigneeRow,
  buildEntryDisplayTitle,
  canManageAllActivityWorkSessions,
  resolveEntryAfterActivitySave,
  findEntry
};
