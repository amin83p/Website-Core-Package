/**
 * Cross-entity dependency scans and timesheet-approval source locking.
 * Timesheet reference scanners are also consumed by schoolDeletionRuleRegistry.
 */
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const TIMESHEET_STATUS_RANK = Object.freeze({
  draft: 0,
  submitted: 1,
  approved: 2,
  processed: 3
});

const GUARD_MIN_STATUS = 'approved';

function normalizeId(value) {
  return String(value || '').trim();
}

function timesheetStatusRank(status) {
  const token = String(status || 'draft').trim().toLowerCase();
  return TIMESHEET_STATUS_RANK[token] ?? 0;
}

function meetsMinTimesheetStatus(status, minStatus = GUARD_MIN_STATUS) {
  return timesheetStatusRank(status) >= timesheetStatusRank(minStatus);
}

function parseActivitySessionId(sessionId) {
  const token = normalizeId(sessionId);
  if (!token.startsWith('act-')) return null;
  const body = token.slice(4);
  const entryMarker = body.indexOf('-ENTRY');
  if (entryMarker < 0) return null;
  const activityId = body.slice(0, entryMarker);
  const rest = body.slice(entryMarker + 1);
  const lastDash = rest.lastIndexOf('-');
  if (lastDash <= 0) return null;
  return {
    activityId: normalizeId(activityId),
    activityEntryId: normalizeId(rest.slice(0, lastDash)),
    personId: normalizeId(rest.slice(lastDash + 1))
  };
}

function parseReportReflectionSessionId(sessionId) {
  const token = normalizeId(sessionId);
  if (!token.startsWith('rptref-')) return null;
  return { assignmentId: normalizeId(token.slice(7)) };
}

function collectRefsFromEntry(entry = {}) {
  if (!entry || entry.isDeleted === true) return [];
  const refs = [];
  const sessionId = normalizeId(entry.sessionId);
  const classId = normalizeId(entry.classId);
  if (sessionId && classId && !sessionId.startsWith('act-') && !sessionId.startsWith('rptref-')) {
    refs.push({ type: 'classSession', classId, sessionId });
  }
  const activityId = normalizeId(entry.activityId);
  const activityEntryId = normalizeId(entry.activityEntryId);
  if (activityId) {
    refs.push({
      type: 'activity',
      activityId,
      activityEntryId: activityEntryId || '',
      personId: normalizeId(entry.personId || '')
    });
  }
  if (sessionId.startsWith('act-')) {
    const parsed = parseActivitySessionId(sessionId);
    if (parsed?.activityId) {
      refs.push({
        type: 'activity',
        activityId: parsed.activityId,
        activityEntryId: parsed.activityEntryId || '',
        personId: parsed.personId || ''
      });
    }
  }
  if (sessionId.startsWith('rptref-')) {
    const parsed = parseReportReflectionSessionId(sessionId);
    if (parsed?.assignmentId) {
      refs.push({ type: 'reportAssignment', assignmentId: parsed.assignmentId });
    }
  }
  const sourceSessionId = normalizeId(entry?.adjustmentMeta?.sourceSessionId);
  const sourceClassId = normalizeId(entry?.adjustmentMeta?.sourceClassId);
  if (sourceSessionId) {
    refs.push({
      type: 'classSession',
      classId: sourceClassId,
      sessionId: sourceSessionId
    });
  }
  return refs;
}

function dedupeRefs(refs = []) {
  const seen = new Set();
  const out = [];
  refs.forEach((ref) => {
    if (!ref || !ref.type) return;
    const key = JSON.stringify(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  });
  return out;
}

function getTimesheetBillableEntries(timesheet = {}) {
  const entries = [];
  const keepEntry = (entry) => (
    entry?.reconciliationRequired !== true && entry?.isPriorPeriodAdjustment !== true
  );
  if (Array.isArray(timesheet?.submissionSnapshot?.entries)) {
    entries.push(...timesheet.submissionSnapshot.entries.filter(keepEntry));
  }
  if (Array.isArray(timesheet?.entries)) {
    entries.push(...timesheet.entries.filter(keepEntry));
  }
  return entries;
}

function resolveActivityRefPersonId(ref = {}, timesheet = {}) {
  return normalizeId(ref.personId) || normalizeId(timesheet?.teacherId);
}

function timesheetEntryReferencesActivityPerson(entry = {}, sourceRef = {}, timesheet = {}) {
  const activityId = normalizeId(sourceRef.activityId);
  const activityEntryId = normalizeId(sourceRef.activityEntryId);
  const targetPersonId = normalizeId(sourceRef.personId);
  if (!activityId || !targetPersonId) return false;
  return collectRefsFromEntry(entry).some((ref) => {
    if (ref.type !== 'activity') return false;
    if (!idsEqual(ref.activityId, activityId)) return false;
    if (activityEntryId && !idsEqual(ref.activityEntryId, activityEntryId)) return false;
    return idsEqual(resolveActivityRefPersonId(ref, timesheet), targetPersonId);
  });
}

function collectTimesheetSourceRefs(timesheet = {}) {
  const teacherId = normalizeId(timesheet?.teacherId);
  const entries = getTimesheetBillableEntries(timesheet);
  const refs = dedupeRefs(entries.flatMap(collectRefsFromEntry));
  if (!teacherId) return refs;
  return refs.map((ref) => {
    if (ref.type !== 'activity') return ref;
    if (normalizeId(ref.personId)) return ref;
    if (!normalizeId(ref.activityEntryId)) return ref;
    return { ...ref, personId: teacherId };
  });
}

function entryReferencesSource(entry = {}, sourceType, sourceRef = {}) {
  const refs = collectRefsFromEntry(entry);
  return refs.some((ref) => {
    if (ref.type !== sourceType) return false;
    if (sourceType === 'classSession') {
      const classMatch = !sourceRef.classId || idsEqual(ref.classId, sourceRef.classId);
      const sessionMatch = idsEqual(ref.sessionId, sourceRef.sessionId);
      return classMatch && sessionMatch;
    }
    if (sourceType === 'activity') {
      if (!idsEqual(ref.activityId, sourceRef.activityId)) return false;
      if (sourceRef.activityEntryId && !idsEqual(ref.activityEntryId, sourceRef.activityEntryId)) return false;
      if (sourceRef.personId && ref.personId && !idsEqual(ref.personId, sourceRef.personId)) return false;
      return true;
    }
    if (sourceType === 'reportAssignment') {
      return idsEqual(ref.assignmentId, sourceRef.assignmentId);
    }
    return false;
  });
}

function timesheetReferencesSource(timesheet = {}, sourceType, sourceRef = {}, minStatus = GUARD_MIN_STATUS) {
  const status = String(timesheet?.status || 'draft').trim().toLowerCase();
  if (!meetsMinTimesheetStatus(status, minStatus)) return false;
  const entries = getTimesheetBillableEntries(timesheet);
  if (sourceType === 'timesheetPeriod' && idsEqual(timesheet?.periodId, sourceRef.periodId)) {
    return meetsMinTimesheetStatus(status);
  }
  if (sourceType === 'activity' && normalizeId(sourceRef.personId)) {
    return entries.some((entry) => timesheetEntryReferencesActivityPerson(entry, sourceRef, timesheet));
  }
  return entries.some((entry) => entryReferencesSource(entry, sourceType, sourceRef));
}

async function listTimesheets(reqUser, orgId) {
  const rows = await schoolDataService.fetchAllData('timesheets', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => !orgId || idsEqual(row?.orgId, orgId));
}

async function findTimesheetsReferencingSource({ orgId, sourceType, sourceRef, minStatus = GUARD_MIN_STATUS, reqUser }) {
  const timesheets = await listTimesheets(reqUser, orgId);
  return timesheets.filter((row) => (
    timesheetReferencesSource(row, sourceType, sourceRef, minStatus)
  ));
}

function buildBlockedMessage(label, blockers = []) {
  if (!blockers.length) {
    return `${label} is referenced by approved timesheet data and cannot be modified.`;
  }
  const items = blockers.slice(0, 8).map((row) => {
    const period = String(row.periodName || row.periodId || '').trim();
    const teacher = String(row.teacherLabel || row.teacherId || '').trim();
    const status = String(row.status || '').trim();
    return `<li><strong>${period || 'Period'}</strong> — ${teacher || 'Teacher'} (${status || 'approved'})</li>`;
  });
  const extra = blockers.length > 8 ? `<li>…and ${blockers.length - 8} more</li>` : '';
  return `${label} is referenced by approved timesheet data and cannot be removed or structurally changed:<ul>${items.join('')}${extra}</ul>`;
}

async function buildTimesheetBlockers({ orgId, sourceType, sourceRef, minStatus = GUARD_MIN_STATUS, reqUser }) {
  const matches = await findTimesheetsReferencingSource({ orgId, sourceType, sourceRef, minStatus, reqUser });
  if (!matches.length) return [];
  const periods = await schoolDataService.fetchAllData('timesheetPeriods', {}, reqUser);
  const periodMap = new Map((Array.isArray(periods) ? periods : []).map((row) => [normalizeId(row?.id), row]));
  return matches.map((row) => {
    const period = periodMap.get(normalizeId(row?.periodId)) || {};
    return {
      timesheetId: normalizeId(row?.id),
      periodId: normalizeId(row?.periodId),
      periodName: String(period?.name || row?.periodId || '').trim(),
      teacherId: normalizeId(row?.teacherId),
      teacherLabel: normalizeId(row?.teacherId),
      status: String(row?.status || '').trim()
    };
  });
}

async function assertSourceNotReferenced({ orgId, sourceType, sourceRef, label, minStatus = GUARD_MIN_STATUS, reqUser }) {
  const blockers = await buildTimesheetBlockers({ orgId, sourceType, sourceRef, minStatus, reqUser });
  if (!blockers.length) return [];
  throw new Error(buildBlockedMessage(label || 'This record', blockers));
}

async function assertPeriodHasNoTimesheets({ periodId, orgId, reqUser }) {
  const timesheets = await listTimesheets(reqUser, orgId);
  const matches = timesheets.filter((row) => idsEqual(row?.periodId, periodId));
  if (!matches.length) return;
  throw new Error(`Cannot delete this timesheet period because ${matches.length} timesheet record(s) exist for it.`);
}

function isSessionTimesheetLocked(session = {}) {
  return session?.locked === true || String(session?.locked) === 'true';
}

function isActivityEntryTimesheetLocked(entry = {}) {
  return entry?.locked === true || String(entry?.locked) === 'true';
}

function isAssigneeTimesheetLocked(assignee = {}) {
  if (assignee?.locked === true || String(assignee?.locked) === 'true') {
    return String(assignee?.lockReason || '') === 'timesheet_approved';
  }
  return false;
}

function isActivityTimesheetLocked(activity = {}) {
  if (activity?.locked === true || String(activity?.locked) === 'true') return true;
  return (Array.isArray(activity?.entries) ? activity.entries : []).some(isActivityEntryTimesheetLocked);
}

async function lockClassSessions({ classId, sessionIds, timesheetId, reqUser }) {
  const normalizedClassId = normalizeId(classId);
  if (!normalizedClassId) return { locked: 0, missing: [] };
  const sessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
  const idSet = new Set((Array.isArray(sessionIds) ? sessionIds : []).map(normalizeId).filter(Boolean));
  let changed = false;
  const summary = { locked: 0, alreadyLocked: 0, missing: [] };
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const currentId = normalizeId(session?.sessionId || session?.id);
    if (!idSet.has(currentId)) return;
    if (isSessionTimesheetLocked(session) && String(session?.lockReason || '') === 'timesheet_approved') {
      summary.alreadyLocked += 1;
      return;
    }
    session.locked = true;
    session.lockedAt = new Date().toISOString();
    session.lockedBy = toPublicId(reqUser?.id);
    session.lockReason = 'timesheet_approved';
    session.lockedTimesheetId = normalizeId(timesheetId);
    summary.locked += 1;
    changed = true;
  });
  idSet.forEach((sessionId) => {
    const found = (Array.isArray(sessions) ? sessions : []).some((session) => idsEqual(session?.sessionId || session?.id, sessionId));
    if (!found) summary.missing.push({ classId: normalizedClassId, sessionId });
  });
  if (changed) {
    await schoolDataService.saveClassSessions(normalizedClassId, sessions, reqUser);
  }
  return summary;
}

async function lockActivityAssignees({ activityId, locks = [], timesheetId, reqUser }) {
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) return { locked: 0, alreadyLocked: 0, missing: [] };
  const activity = await schoolDataService.getDataById('activities', normalizedActivityId, reqUser);
  if (!activity) return { locked: 0, alreadyLocked: 0, missing: [{ activityId: normalizedActivityId }], missingActivity: true };
  const lockTargets = (Array.isArray(locks) ? locks : []).map((row) => ({
    entryId: normalizeId(row.entryId || row.activityEntryId),
    personId: normalizeId(row.personId)
  })).filter((row) => row.entryId);
  if (!lockTargets.length) return { locked: 0, alreadyLocked: 0, missing: [] };
  const targetSet = new Set(lockTargets.map((row) => `${row.entryId}::${row.personId}`));
  let changed = false;
  const summary = { locked: 0, alreadyLocked: 0, missing: [] };
  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
    const entryId = normalizeId(entry?.entryId || entry?.id);
    const assignees = (Array.isArray(entry?.assignees) ? entry.assignees : [])
      .filter((assignee) => assignee && typeof assignee === 'object')
      .map((assignee) => {
      const personId = normalizeId(assignee.personId || assignee.id);
      const key = `${entryId}::${personId}`;
      if (!targetSet.has(key)) return assignee;
      if (isAssigneeTimesheetLocked(assignee)) {
        summary.alreadyLocked += 1;
        return assignee;
      }
      changed = true;
      summary.locked += 1;
      return {
        ...assignee,
        locked: true,
        lockedAt: new Date().toISOString(),
        lockedBy: toPublicId(reqUser?.id),
        lockReason: 'timesheet_approved',
        lockedTimesheetId: normalizeId(timesheetId)
      };
    });
    const allAssigneesLocked = assignees.length > 0 && assignees.every(isAssigneeTimesheetLocked);
    return {
      ...entry,
      assignees,
      locked: allAssigneesLocked ? true : entry.locked,
      lockedAt: allAssigneesLocked ? (entry.lockedAt || new Date().toISOString()) : entry.lockedAt,
      lockedBy: allAssigneesLocked ? (entry.lockedBy || toPublicId(reqUser?.id)) : entry.lockedBy,
      lockReason: allAssigneesLocked ? 'timesheet_approved' : entry.lockReason,
      lockedTimesheetId: allAssigneesLocked ? normalizeId(timesheetId) : entry.lockedTimesheetId
    };
  });
  lockTargets.forEach((target) => {
    const entry = (Array.isArray(activity.entries) ? activity.entries : [])
      .find((row) => idsEqual(row?.entryId || row?.id, target.entryId));
    if (!entry) {
      summary.missing.push(target);
      return;
    }
    const assignee = (Array.isArray(entry.assignees) ? entry.assignees : [])
      .filter((row) => row && typeof row === 'object')
      .find((row) => idsEqual(row.personId || row.id, target.personId));
    if (!assignee) summary.missing.push(target);
  });
  const nextActivity = {
    ...activity,
    entries,
    locked: entries.some((entry) => isActivityEntryTimesheetLocked(entry))
      || entries.some((entry) => (Array.isArray(entry?.assignees) ? entry.assignees : [])
        .filter((assignee) => assignee && typeof assignee === 'object')
        .some(isAssigneeTimesheetLocked))
  };
  if (changed) {
    await schoolDataService.updateData('activities', normalizedActivityId, nextActivity, reqUser);
  }
  return summary;
}

async function assertActivityAssigneeNotReferencedBySubmittedTimesheet({
  orgId,
  activityId,
  entryId,
  personId,
  reqUser
} = {}) {
  const blockers = await buildTimesheetBlockers({
    orgId,
    sourceType: 'activity',
    sourceRef: {
      activityId: normalizeId(activityId),
      activityEntryId: normalizeId(entryId),
      personId: normalizeId(personId)
    },
    minStatus: 'submitted',
    reqUser
  });
  if (!blockers.length) return;
  throw new Error(buildBlockedMessage('This work session assignee', blockers));
}

async function lockActivitySources({ activityId, entryIds = [], locks = [], timesheetId, reqUser }) {
  const normalizedLocks = (Array.isArray(locks) ? locks : []).filter((row) => row?.entryId || row?.activityEntryId);
  if (normalizedLocks.length) {
    return lockActivityAssignees({ activityId, locks: normalizedLocks, timesheetId, reqUser });
  }
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) return { locked: false };
  const activity = await schoolDataService.getDataById('activities', normalizedActivityId, reqUser);
  if (!activity) return { locked: false, missing: true };
  const entryIdSet = new Set((Array.isArray(entryIds) ? entryIds : []).map(normalizeId).filter(Boolean));
  const lockAllEntries = !entryIdSet.size;
  let changed = false;
  const lockedAt = new Date().toISOString();
  const lockedBy = toPublicId(reqUser?.id);
  const lockedTimesheetId = normalizeId(timesheetId);
  const stampAssigneeLock = (assignee) => {
    if (isAssigneeTimesheetLocked(assignee)) return assignee;
    changed = true;
    return {
      ...assignee,
      locked: true,
      lockedAt,
      lockedBy,
      lockReason: 'timesheet_approved',
      lockedTimesheetId
    };
  };
  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
    const entryId = normalizeId(entry?.entryId || entry?.id);
    if (!lockAllEntries && !entryIdSet.has(entryId)) return entry;
    const priorAssignees = (Array.isArray(entry?.assignees) ? entry.assignees : [])
      .filter((assignee) => assignee && typeof assignee === 'object');
    const assignees = priorAssignees.map(stampAssigneeLock);
    const entryAlreadyLocked = isActivityEntryTimesheetLocked(entry)
      && String(entry?.lockReason || '') === 'timesheet_approved';
    const assigneesChanged = assignees.some((row, index) => row !== priorAssignees[index]);
    if (entryAlreadyLocked && !assigneesChanged) return entry;
    changed = true;
    return {
      ...entry,
      assignees,
      locked: true,
      lockedAt: entryAlreadyLocked ? (entry.lockedAt || lockedAt) : lockedAt,
      lockedBy: entryAlreadyLocked ? (entry.lockedBy || lockedBy) : lockedBy,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: entryAlreadyLocked ? (entry.lockedTimesheetId || lockedTimesheetId) : lockedTimesheetId
    };
  });
  const nextActivity = {
    ...activity,
    entries,
    locked: lockAllEntries || entries.some(isActivityEntryTimesheetLocked) ? true : activity.locked
  };
  if (changed || (!activity.locked && nextActivity.locked)) {
    await schoolDataService.updateData('activities', normalizedActivityId, nextActivity, reqUser);
  }
  return { locked: changed || nextActivity.locked === true };
}

async function lockReportAssignment({ assignmentId, timesheetId, reqUser }) {
  const id = normalizeId(assignmentId);
  if (!id) return { locked: false };
  const assignment = await schoolDataService.getDataById('reportAssignments', id, reqUser);
  if (!assignment) return { locked: false, missing: true };
  if (assignment.timesheetLocked === true) return { locked: false, alreadyLocked: true };
  await schoolDataService.updateData('reportAssignments', id, {
    ...assignment,
    timesheetLocked: true,
    timesheetLockedAt: new Date().toISOString(),
    timesheetLockedBy: toPublicId(reqUser?.id),
    lockedTimesheetId: normalizeId(timesheetId)
  }, reqUser);
  return { locked: true };
}

async function getActivityEntrySubmittedTimesheetLockMap({
  orgId,
  activityId,
  entryId,
  minStatus = 'submitted',
  reqUser
} = {}) {
  const normalizedActivityId = normalizeId(activityId);
  const normalizedEntryId = normalizeId(entryId);
  const lockMap = new Map();
  if (!normalizedActivityId || !normalizedEntryId) return lockMap;
  const matches = await findTimesheetsReferencingSource({
    orgId,
    sourceType: 'activity',
    sourceRef: { activityId: normalizedActivityId, activityEntryId: normalizedEntryId },
    minStatus,
    reqUser
  });
  matches.forEach((timesheet) => {
    const timesheetId = normalizeId(timesheet?.id);
    getTimesheetBillableEntries(timesheet).forEach((entry) => {
      collectRefsFromEntry(entry).forEach((ref) => {
        if (ref.type !== 'activity') return;
        if (!idsEqual(ref.activityId, normalizedActivityId)) return;
        if (!idsEqual(ref.activityEntryId, normalizedEntryId)) return;
        const personId = resolveActivityRefPersonId(ref, timesheet);
        if (personId) lockMap.set(personId, timesheetId);
      });
    });
  });
  return lockMap;
}

async function repairActivityEntryTimesheetLocksIfNeeded({ activity, entry, reqUser } = {}) {
  const entryId = normalizeId(entry?.entryId || entry?.id);
  const activityId = normalizeId(activity?.id);
  if (!activityId || !entryId) return entry;
  const assignees = (Array.isArray(entry.assignees) ? entry.assignees : [])
    .filter((assignee) => assignee && typeof assignee === 'object');
  if (assignees.length <= 1) return entry;

  const lockMap = await getActivityEntrySubmittedTimesheetLockMap({
    orgId: activity.orgId,
    activityId,
    entryId,
    minStatus: 'submitted',
    reqUser
  });

  let changed = false;
  const nextAssignees = assignees.map((assignee) => {
    const personId = normalizeId(assignee.personId);
    const shouldLock = lockMap.has(personId);
    const isLocked = isAssigneeTimesheetLocked(assignee);
    if (shouldLock === isLocked) return assignee;
    changed = true;
    if (!shouldLock) {
      const next = { ...assignee };
      next.locked = false;
      delete next.lockReason;
      delete next.lockedTimesheetId;
      delete next.lockedAt;
      delete next.lockedBy;
      return next;
    }
    return {
      ...assignee,
      locked: true,
      lockedAt: assignee.lockedAt || new Date().toISOString(),
      lockedBy: assignee.lockedBy || null,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: lockMap.get(personId)
    };
  });

  const allAssigneesLocked = nextAssignees.length > 0 && nextAssignees.every(isAssigneeTimesheetLocked);
  const entryWasLocked = isActivityEntryTimesheetLocked(entry);
  let nextEntry = { ...entry, assignees: nextAssignees };
  if (allAssigneesLocked && !entryWasLocked) {
    changed = true;
    nextEntry.locked = true;
    nextEntry.lockReason = 'timesheet_approved';
    nextEntry.lockedTimesheetId = normalizeId(nextEntry.lockedTimesheetId)
      || normalizeId([...lockMap.values()][0]);
  } else if (!allAssigneesLocked && entryWasLocked) {
    changed = true;
    nextEntry.locked = false;
    delete nextEntry.lockReason;
    delete nextEntry.lockedTimesheetId;
    delete nextEntry.lockedAt;
    delete nextEntry.lockedBy;
  }

  if (!changed) return entry;

  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((row) => (
    idsEqual(row?.entryId || row?.id, entryId) ? nextEntry : row
  ));
  const stillActivityLocked = entries.some(isActivityEntryTimesheetLocked)
    || entries.some((row) => (Array.isArray(row?.assignees) ? row.assignees : []).some(isAssigneeTimesheetLocked));
  await schoolDataService.updateData('activities', activityId, {
    ...activity,
    entries,
    locked: stillActivityLocked
  }, reqUser);
  return nextEntry;
}

async function lockSourcesForApprovedTimesheet(timesheet = {}, reqUser) {
  const refs = collectTimesheetSourceRefs(timesheet);
  const timesheetId = normalizeId(timesheet?.id);
  const classSessionsByClass = new Map();
  const activityEntries = new Map();
  const activityAssigneeLocks = new Map();

  refs.forEach((ref) => {
    if (ref.type === 'classSession' && ref.classId && ref.sessionId) {
      if (!classSessionsByClass.has(ref.classId)) classSessionsByClass.set(ref.classId, new Set());
      classSessionsByClass.get(ref.classId).add(ref.sessionId);
    }
    if (ref.type === 'activity' && ref.activityId) {
      if (ref.personId && ref.activityEntryId) {
        if (!activityAssigneeLocks.has(ref.activityId)) activityAssigneeLocks.set(ref.activityId, []);
        activityAssigneeLocks.get(ref.activityId).push({
          entryId: ref.activityEntryId,
          personId: ref.personId
        });
        return;
      }
      if (!activityEntries.has(ref.activityId)) activityEntries.set(ref.activityId, new Set());
      if (ref.activityEntryId) activityEntries.get(ref.activityId).add(ref.activityEntryId);
    }
  });
  const summary = {
    classSessions: [],
    activities: [],
    reportAssignments: [],
    lockedSourceRefs: refs
  };

  for (const [classId, sessionIds] of classSessionsByClass.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lockClassSessions({
      classId,
      sessionIds: [...sessionIds],
      timesheetId,
      reqUser
    });
    summary.classSessions.push({ classId, ...result });
  }

  for (const [activityId, entryIds] of activityEntries.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lockActivitySources({
      activityId,
      entryIds: [...entryIds],
      timesheetId,
      reqUser
    });
    summary.activities.push({ activityId, ...result });
  }

  for (const [activityId, locks] of activityAssigneeLocks.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lockActivityAssignees({
      activityId,
      locks,
      timesheetId,
      reqUser
    });
    summary.activities.push({ activityId, assigneeLocks: true, ...result });
  }

  const assignmentIds = refs
    .filter((ref) => ref.type === 'reportAssignment' && ref.assignmentId)
    .map((ref) => ref.assignmentId);
  for (const assignmentId of assignmentIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lockReportAssignment({ assignmentId, timesheetId, reqUser });
    summary.reportAssignments.push({ assignmentId, ...result });
  }

  return summary;
}

async function lockReconciliationSourceRefs({ refs = [], timesheetId = '', reqUser } = {}) {
  const normalizedRefs = dedupeRefs((Array.isArray(refs) ? refs : [])
    .filter((ref) => ref?.type === 'classSession' && ref?.classId && ref?.sessionId)
    .map((ref) => ({
      type: 'classSession',
      classId: normalizeId(ref.classId),
      sessionId: normalizeId(ref.sessionId)
    })));
  const byClass = new Map();
  normalizedRefs.forEach((ref) => {
    if (!byClass.has(ref.classId)) byClass.set(ref.classId, new Set());
    byClass.get(ref.classId).add(ref.sessionId);
  });
  const classSessions = [];
  for (const [classId, sessionIds] of byClass.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lockClassSessions({
      classId,
      sessionIds: [...sessionIds],
      timesheetId,
      reqUser
    });
    classSessions.push({ classId, ...result });
  }
  return { classSessions, lockedSourceRefs: normalizedRefs };
}

function dedupeSourceRefs(refs = []) {
  return dedupeRefs(refs);
}

async function unlockClassSessionsForTimesheet({ timesheetId, reqUser }) {
  const token = normalizeId(timesheetId);
  if (!token) return;
  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser);
  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = normalizeId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    let changed = false;
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      if (normalizeId(session?.lockedTimesheetId) !== token) return;
      if (String(session?.lockReason || '') !== 'timesheet_approved') return;
      session.locked = false;
      delete session.lockReason;
      delete session.lockedTimesheetId;
      session.unlockedAt = new Date().toISOString();
      session.unlockedBy = toPublicId(reqUser?.id);
      changed = true;
    });
    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.saveClassSessions(classId, sessions, reqUser);
    }
  }
}

async function unlockActivitySourcesForTimesheet({ timesheetId, reqUser }) {
  const token = normalizeId(timesheetId);
  if (!token) return;
  const activities = await schoolDataService.fetchAllData('activities', {}, reqUser);
  for (const activity of Array.isArray(activities) ? activities : []) {
    const activityId = normalizeId(activity?.id);
    if (!activityId) continue;
    let changed = false;
    const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
      const assignees = (Array.isArray(entry.assignees) ? entry.assignees : []).map((assignee) => {
        if (normalizeId(assignee?.lockedTimesheetId) !== token) return assignee;
        if (String(assignee?.lockReason || '') !== 'timesheet_approved') return assignee;
        changed = true;
        const next = { ...assignee };
        next.locked = false;
        delete next.lockReason;
        delete next.lockedTimesheetId;
        next.unlockedAt = new Date().toISOString();
        next.unlockedBy = toPublicId(reqUser?.id);
        return next;
      });
      let nextEntry = { ...entry, assignees };
      if (normalizeId(entry?.lockedTimesheetId) === token && String(entry?.lockReason || '') === 'timesheet_approved') {
        changed = true;
        nextEntry = { ...nextEntry };
        nextEntry.locked = false;
        delete nextEntry.lockReason;
        delete nextEntry.lockedTimesheetId;
        nextEntry.unlockedAt = new Date().toISOString();
        nextEntry.unlockedBy = toPublicId(reqUser?.id);
      }
      const allAssigneesLocked = assignees.length > 0 && assignees.every(isAssigneeTimesheetLocked);
      if (!allAssigneesLocked && nextEntry.locked === true && normalizeId(nextEntry.lockedTimesheetId) === token) {
        nextEntry.locked = false;
        delete nextEntry.lockReason;
        delete nextEntry.lockedTimesheetId;
      }
      return nextEntry;
    });
    if (!changed) continue;
    const stillLocked = entries.some(isActivityEntryTimesheetLocked)
      || entries.some((entry) => (Array.isArray(entry.assignees) ? entry.assignees : []).some(isAssigneeTimesheetLocked));
    // eslint-disable-next-line no-await-in-loop
    await schoolDataService.updateData('activities', activityId, {
      ...activity,
      entries,
      locked: stillLocked
    }, reqUser);
  }
}

function clearTimesheetApprovedLockFields(row = {}, reqUser = null, note = '') {
  const next = { ...row };
  next.locked = false;
  delete next.lockReason;
  delete next.lockedTimesheetId;
  next.unlockedAt = new Date().toISOString();
  next.unlockedBy = toPublicId(reqUser?.id);
  const reason = String(note || '').trim();
  if (reason) next.forceUnlockReason = reason.slice(0, 500);
  return next;
}

function assigneeHasTimesheetApprovedLock(assignee = {}) {
  if (isAssigneeTimesheetLocked(assignee)) return true;
  if (!(assignee?.locked === true || String(assignee?.locked) === 'true')) return false;
  return String(assignee?.lockReason || '') === 'timesheet_approved' || Boolean(normalizeId(assignee?.lockedTimesheetId));
}

function entryHasTimesheetApprovedLock(entry = {}) {
  if (isActivityEntryTimesheetLocked(entry) && (
    String(entry?.lockReason || '') === 'timesheet_approved' || Boolean(normalizeId(entry?.lockedTimesheetId))
  )) {
    return true;
  }
  return (Array.isArray(entry?.assignees) ? entry.assignees : []).some(assigneeHasTimesheetApprovedLock);
}

function toExistingTimesheetIdSet(existingTimesheetIds) {
  if (existingTimesheetIds instanceof Set) return existingTimesheetIds;
  return new Set(
    (Array.isArray(existingTimesheetIds) ? existingTimesheetIds : [])
      .map((id) => normalizeId(id))
      .filter(Boolean)
  );
}

/**
 * Orphan = timesheet-approved lock whose lockedTimesheetId is empty or not in the live timesheet set.
 */
function isOrphanTimesheetLock(row = {}, existingTimesheetIds = []) {
  const locked = row?.locked === true || String(row?.locked) === 'true';
  const reasonApproved = String(row?.lockReason || '') === 'timesheet_approved';
  const timesheetId = normalizeId(row?.lockedTimesheetId);
  if (!locked || (!reasonApproved && !timesheetId)) return false;
  if (!timesheetId) return true;
  return !toExistingTimesheetIdSet(existingTimesheetIds).has(timesheetId);
}

function entryHasOrphanTimesheetLock(entry = {}, existingTimesheetIds = []) {
  if (isOrphanTimesheetLock(entry, existingTimesheetIds)) return true;
  return (Array.isArray(entry?.assignees) ? entry.assignees : [])
    .some((assignee) => isOrphanTimesheetLock(assignee, existingTimesheetIds));
}

function buildOrphanWorkSessionLabel(entry = {}) {
  const entryId = normalizeId(entry?.entryId || entry?.id) || 'work session';
  const date = String(entry?.date || '').trim();
  const title = String(entry?.title || entry?.label || '').trim();
  if (date && title) return `${entryId} — ${date} — ${title}`;
  if (date) return `${entryId} — ${date}`;
  if (title) return `${entryId} — ${title}`;
  return entryId;
}

function collectEntryOrphanTimesheetIds(entry = {}, existingTimesheetIds = []) {
  const ids = [];
  const pushId = (row) => {
    if (!isOrphanTimesheetLock(row, existingTimesheetIds)) return;
    const id = normalizeId(row?.lockedTimesheetId);
    if (id && !ids.includes(id)) ids.push(id);
  };
  pushId(entry);
  (Array.isArray(entry?.assignees) ? entry.assignees : []).forEach(pushId);
  return ids;
}

function listOrphanTimesheetLockedActivityEntries(activity = {}, existingTimesheetIds = []) {
  const existing = toExistingTimesheetIdSet(existingTimesheetIds);
  return (Array.isArray(activity?.entries) ? activity.entries : [])
    .filter((entry) => entryHasOrphanTimesheetLock(entry, existing))
    .map((entry) => {
      const orphanIds = collectEntryOrphanTimesheetIds(entry, existing);
      return {
        entryId: normalizeId(entry?.entryId || entry?.id),
        label: buildOrphanWorkSessionLabel(entry),
        lockedTimesheetId: orphanIds[0] || '',
        lockedTimesheetIds: orphanIds
      };
    })
    .filter((row) => row.entryId);
}

async function listExistingTimesheetIds(reqUser, orgId) {
  const rows = await listTimesheets(reqUser, orgId);
  return rows.map((row) => normalizeId(row?.id)).filter(Boolean);
}

function forceClearEntryTimesheetLocks(entry = {}, reqUser = null, note = '', options = {}) {
  const orphansOnly = options.orphansOnly === true;
  const existingTimesheetIds = toExistingTimesheetIdSet(options.existingTimesheetIds || []);
  let changed = false;
  const assignees = (Array.isArray(entry.assignees) ? entry.assignees : []).map((assignee) => {
    if (!assigneeHasTimesheetApprovedLock(assignee)) return assignee;
    if (orphansOnly && !isOrphanTimesheetLock(assignee, existingTimesheetIds)) return assignee;
    changed = true;
    return clearTimesheetApprovedLockFields(assignee, reqUser, note);
  });
  let nextEntry = { ...entry, assignees };
  const entryLocked = isActivityEntryTimesheetLocked(entry)
    || String(entry?.lockReason || '') === 'timesheet_approved'
    || Boolean(normalizeId(entry?.lockedTimesheetId));
  if (entryLocked) {
    if (!orphansOnly || isOrphanTimesheetLock(entry, existingTimesheetIds)) {
      changed = true;
      nextEntry = clearTimesheetApprovedLockFields(nextEntry, reqUser, note);
      nextEntry.assignees = assignees;
    }
  }
  return { entry: nextEntry, changed };
}

function recomputeActivityTimesheetLocked(activity = {}, entries = []) {
  const entryList = Array.isArray(entries) ? entries : [];
  const stillLocked = entryList.some(entryHasTimesheetApprovedLock);
  const next = { ...activity, entries: entryList, locked: stillLocked };
  if (!stillLocked) {
    if (String(next.lockReason || '') === 'timesheet_approved') delete next.lockReason;
    if (next.lockedTimesheetId) delete next.lockedTimesheetId;
  }
  return next;
}

/**
 * Force-clear timesheet locks on one work session (entry + assignees), even if the timesheet is gone.
 * @returns {{ activity: object, changed: boolean, entryId: string }}
 */
function forceUnlockActivityEntryTimesheetLocks({ activity, entryId, reqUser = null, note = '' } = {}) {
  if (!activity || typeof activity !== 'object') throw new Error('Activity is required.');
  const targetEntryId = normalizeId(entryId);
  if (!targetEntryId) throw new Error('Work session id is required.');
  let found = false;
  let changed = false;
  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
    const currentId = normalizeId(entry?.entryId || entry?.id);
    if (currentId !== targetEntryId) return entry;
    found = true;
    const result = forceClearEntryTimesheetLocks(entry, reqUser, note);
    if (result.changed) changed = true;
    return result.entry;
  });
  if (!found) throw new Error('Work session not found.');
  return {
    activity: recomputeActivityTimesheetLocked(activity, entries),
    changed,
    entryId: targetEntryId
  };
}

/**
 * Force-clear orphan timesheet locks on an activity (locks whose timesheet is missing).
 * Live timesheet locks are left intact.
 * @returns {{ activity: object, changed: boolean, unlockedEntryIds: string[], skippedLiveLockEntryIds: string[] }}
 */
function forceUnlockAllActivityTimesheetLocks({
  activity,
  reqUser = null,
  note = '',
  existingTimesheetIds = []
} = {}) {
  if (!activity || typeof activity !== 'object') throw new Error('Activity is required.');
  const existing = toExistingTimesheetIdSet(existingTimesheetIds);
  const unlockedEntryIds = [];
  const skippedLiveLockEntryIds = [];
  let changed = false;
  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
    const entryId = normalizeId(entry?.entryId || entry?.id);
    if (!entryHasTimesheetApprovedLock(entry)) return entry;
    if (!entryHasOrphanTimesheetLock(entry, existing)) {
      if (entryId) skippedLiveLockEntryIds.push(entryId);
      return entry;
    }
    const result = forceClearEntryTimesheetLocks(entry, reqUser, note, {
      orphansOnly: true,
      existingTimesheetIds: existing
    });
    if (result.changed) {
      changed = true;
      if (entryId) unlockedEntryIds.push(entryId);
    }
    if (entryHasTimesheetApprovedLock(result.entry)) {
      if (entryId && !skippedLiveLockEntryIds.includes(entryId)) skippedLiveLockEntryIds.push(entryId);
    }
    return result.entry;
  });
  let nextActivity = recomputeActivityTimesheetLocked(activity, entries);
  const activityOrphanLocked = (activity?.locked === true || String(activity?.locked) === 'true')
    && String(activity?.lockReason || '') === 'timesheet_approved'
    && isOrphanTimesheetLock(activity, existing);
  if (activityOrphanLocked && !nextActivity.locked) {
    changed = true;
    nextActivity = {
      ...nextActivity,
      unlockedAt: new Date().toISOString(),
      unlockedBy: toPublicId(reqUser?.id)
    };
    delete nextActivity.lockReason;
    delete nextActivity.lockedTimesheetId;
    if (String(note || '').trim()) {
      nextActivity.forceUnlockReason = String(note).trim().slice(0, 500);
    }
  }
  return { activity: nextActivity, changed, unlockedEntryIds, skippedLiveLockEntryIds };
}

async function unlockReportAssignmentsForTimesheet({ timesheetId, reqUser }) {
  const token = normalizeId(timesheetId);
  if (!token) return;
  const assignments = await schoolDataService.fetchAllData('reportAssignments', {}, reqUser);
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (normalizeId(assignment?.lockedTimesheetId) !== token) continue;
    const id = normalizeId(assignment?.id);
    if (!id) continue;
    // eslint-disable-next-line no-await-in-loop
    await schoolDataService.updateData('reportAssignments', id, {
      ...assignment,
      timesheetLocked: false,
      timesheetUnlockedAt: new Date().toISOString(),
      timesheetUnlockedBy: toPublicId(reqUser?.id)
    }, reqUser);
  }
}

async function unlockSourcesForTimesheet(timesheet = {}, reqUser) {
  const timesheetId = normalizeId(timesheet?.id);
  await unlockClassSessionsForTimesheet({ timesheetId, reqUser });
  await unlockActivitySourcesForTimesheet({ timesheetId, reqUser });
  await unlockReportAssignmentsForTimesheet({ timesheetId, reqUser });
}

async function assertClassHasNoLockedSessions(classId, reqUser, label = 'This class') {
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const locked = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (!isSessionTimesheetLocked(session)) return false;
    return String(session?.lockReason || '') === 'timesheet_approved';
  });
  if (!locked.length) return;
  throw new Error(`${label} has ${locked.length} timesheet-locked session(s) and cannot be deleted. Reopen the approved timesheet first.`);
}

function assertSessionNotTimesheetLocked(session = {}, label = 'This session') {
  if (!isSessionTimesheetLocked(session)) return;
  if (String(session?.lockReason || '') === 'timesheet_approved') {
    throw new Error(`${label} is locked by an approved timesheet and cannot be modified.`);
  }
}

const SESSION_TIMESHEET_LOCK_MUTATION_SCOPE = Object.freeze({
  STATUS: 'status',
  ROOM: 'room',
  DATE_TIME: 'date_time',
  TEACHER_ASSIGNMENT: 'teacher_assignment',
  CO_TEACHERS_ASSIGNMENT: 'co_teachers_assignment',
  DELETE: 'delete'
});

const SESSION_TIMESHEET_LOCK_MUTATION_LABEL = Object.freeze({
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.STATUS]: 'status',
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.ROOM]: 'room',
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.DATE_TIME]: 'date/time',
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.TEACHER_ASSIGNMENT]: 'teacher assignment',
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.CO_TEACHERS_ASSIGNMENT]: 'co-teachers assignment',
  [SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.DELETE]: 'deletion'
});

function normalizeSessionStatusToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeSessionRoomToken(value) {
  return String(value || '').trim();
}

function normalizeSessionDateToken(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function normalizeSessionTimeToken(value) {
  const token = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(token) ? token : '';
}

function resolveSessionMainTeacherId(session = {}) {
  return normalizeId(
    session?.delivery?.deliveredBy
    || session?.teacherId
    || session?.deliveredBy
  );
}

function normalizePaidFlag(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (value === false || token === 'false' || token === '0' || token === 'unpaid') return false;
  return true;
}

function normalizeCoTeacherPaidHours(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function normalizeSessionCoTeachersForComparison(session = {}) {
  const rows = Array.isArray(session?.delivery?.coTeachers)
    ? session.delivery.coTeachers
    : (Array.isArray(session?.coTeachers) ? session.coTeachers : []);
  const normalizeRole = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (!token || token === 'co-teacher' || token === 'coteacher') return '';
    return token;
  };
  return rows
    .map((row) => {
      const personId = normalizeId(row?.personId || row?.teacherId || row?.id);
      if (!personId) return null;
      return {
        personId,
        roleLabel: normalizeRole(row?.roleLabel || row?.role),
        canEdit: row?.canEdit === true,
        paid: normalizePaidFlag(row?.paid),
        paidHours: normalizeCoTeacherPaidHours(row?.paidHours)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.personId.localeCompare(right.personId));
}

function collectSessionTimesheetRestrictedMutationScopes({ previousSession = {}, nextSession = {} } = {}) {
  const scopes = new Set();
  if (normalizeSessionStatusToken(previousSession?.status) !== normalizeSessionStatusToken(nextSession?.status)) {
    scopes.add(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.STATUS);
  }
  if (normalizeSessionRoomToken(previousSession?.room) !== normalizeSessionRoomToken(nextSession?.room)) {
    scopes.add(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.ROOM);
  }
  const dateChanged = normalizeSessionDateToken(previousSession?.date) !== normalizeSessionDateToken(nextSession?.date);
  const startChanged = normalizeSessionTimeToken(previousSession?.startTime) !== normalizeSessionTimeToken(nextSession?.startTime);
  const endChanged = normalizeSessionTimeToken(previousSession?.endTime) !== normalizeSessionTimeToken(nextSession?.endTime);
  if (dateChanged || startChanged || endChanged) {
    scopes.add(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.DATE_TIME);
  }
  if (!idsEqual(resolveSessionMainTeacherId(previousSession), resolveSessionMainTeacherId(nextSession))) {
    scopes.add(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.TEACHER_ASSIGNMENT);
  }
  const priorCoTeachers = JSON.stringify(normalizeSessionCoTeachersForComparison(previousSession));
  const nextCoTeachers = JSON.stringify(normalizeSessionCoTeachersForComparison(nextSession));
  if (priorCoTeachers !== nextCoTeachers) {
    scopes.add(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.CO_TEACHERS_ASSIGNMENT);
  }
  return [...scopes];
}

function assertSessionTimesheetLockAllowsMutationScopes(session = {}, scopes = [], label = 'This session') {
  if (!isSessionTimesheetApprovedLock(session)) return;
  const blocked = [...new Set((Array.isArray(scopes) ? scopes : [])
    .map((scope) => String(scope || '').trim().toLowerCase())
    .filter((scope) => Object.values(SESSION_TIMESHEET_LOCK_MUTATION_SCOPE).includes(scope)))];
  if (!blocked.length) return;
  const labels = blocked
    .map((scope) => SESSION_TIMESHEET_LOCK_MUTATION_LABEL[scope] || scope)
    .filter(Boolean);
  const humanList = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  throw new Error(`${label} is locked by an approved timesheet. Reopen the timesheet to change ${humanList}.`);
}

function isSessionTimesheetApprovedLock(session = {}) {
  return isSessionTimesheetLocked(session)
    && String(session?.lockReason || '') === 'timesheet_approved';
}

function sessionLedgerId(session = {}) {
  return normalizeId(session?.sessionId || session?.id);
}

/**
 * Prevent class-form session ledger saves from dropping or unlocking
 * sessions that are locked by approved timesheets.
 */
async function assertClassSessionLedgerPreservesTimesheetLocks({
  classId,
  orgId,
  existingSessions = [],
  incomingSessions = [],
  reqUser,
  label = 'This class session ledger'
} = {}) {
  const existing = Array.isArray(existingSessions) ? existingSessions : [];
  const incoming = Array.isArray(incomingSessions) ? incomingSessions : [];
  const incomingById = new Map();
  incoming.forEach((row) => {
    const id = sessionLedgerId(row);
    if (!id) return;
    incomingById.set(id, row);
  });

  const missingLocked = [];
  const unlocked = [];

  for (const session of existing) {
    if (!isSessionTimesheetApprovedLock(session)) continue;
    const sessionId = sessionLedgerId(session);
    if (!sessionId) continue;
    const next = incomingById.get(sessionId);
    if (!next) {
      missingLocked.push(sessionId);
      continue;
    }
    if (!isSessionTimesheetApprovedLock(next)) {
      unlocked.push(sessionId);
    }
  }

  if (missingLocked.length || unlocked.length) {
    const parts = [];
    if (missingLocked.length) {
      parts.push(`${missingLocked.length} timesheet-locked session(s) were removed`);
    }
    if (unlocked.length) {
      parts.push(`${unlocked.length} timesheet-locked session(s) were unlocked`);
    }
    throw new Error(
      `${label} cannot be saved because ${parts.join(' and ')}. `
      + 'Reopen the approved timesheet first, then try again.'
    );
  }

  // Also block removing sessions still referenced by approved/processed timesheets
  // even if the stored lock flags were cleared client-side.
  const missingApprovedRefs = [];
  for (const session of existing) {
    const sessionId = sessionLedgerId(session);
    if (!sessionId || incomingById.has(sessionId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const blockers = await buildTimesheetBlockers({
      orgId,
      sourceType: 'classSession',
      sourceRef: { classId: normalizeId(classId), sessionId },
      reqUser
    });
    if (blockers.length) missingApprovedRefs.push(sessionId);
  }

  if (!missingApprovedRefs.length) return;

  throw new Error(
    `${label} cannot be saved because ${missingApprovedRefs.length} session(s) referenced by approved timesheets were removed. `
    + 'Reopen the approved timesheet first, then try again.'
  );
}

function applySessionAdminLock(session = {}, locked, reqUser = {}) {
  if (!session || typeof session !== 'object') {
    throw new Error('Session is required.');
  }
  if (isSessionTimesheetApprovedLock(session)) {
    throw new Error('This session is locked by an approved timesheet. Reopen the timesheet to change the lock.');
  }
  const shouldLock = locked === true || String(locked) === 'true';
  if (shouldLock) {
    session.locked = true;
    session.lockReason = 'admin_locked';
    session.lockedAt = new Date().toISOString();
    session.lockedBy = toPublicId(reqUser?.id);
    delete session.unlockedAt;
    delete session.unlockedBy;
    return session;
  }
  session.locked = false;
  delete session.lockReason;
  delete session.lockedTimesheetId;
  session.unlockedAt = new Date().toISOString();
  session.unlockedBy = toPublicId(reqUser?.id);
  return session;
}

function assertActivityNotTimesheetLocked(activity = {}, label = 'This activity') {
  const entries = Array.isArray(activity?.entries) ? activity.entries : [];
  const entryLocked = entries.some((entry) =>
    isActivityEntryTimesheetLocked(entry) && String(entry?.lockReason || '') === 'timesheet_approved'
  );
  const parentLocked = (activity?.locked === true || String(activity?.locked) === 'true')
    && String(activity?.lockReason || '') === 'timesheet_approved';
  if (!entryLocked && !parentLocked) return;
  throw new Error(`${label} is locked by an approved timesheet and cannot be deleted or structurally modified. Reopen the timesheet first.`);
}

async function assertClassSessionsNotReferencedByApprovedTimesheets({ classId, orgId, label, reqUser }) {
  const normalizedClassId = normalizeId(classId);
  if (!normalizedClassId) return;
  const sessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = normalizeId(session?.sessionId || session?.id);
    if (!sessionId) continue;
    // eslint-disable-next-line no-await-in-loop
    await assertSourceNotReferenced({
      orgId,
      sourceType: 'classSession',
      sourceRef: { classId: normalizedClassId, sessionId },
      label: label || 'This class',
      reqUser
    });
  }
}

async function assertSessionStatusNotReferenced({ statusCode, orgId, label, reqUser }) {
  const normalizedCode = String(statusCode || '').trim().toLowerCase();
  if (!normalizedCode) return;
  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser);
  const scoped = (Array.isArray(classes) ? classes : []).filter((row) => !orgId || idsEqual(row?.orgId, orgId));
  for (const classRow of scoped) {
    const classId = normalizeId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const code = String(session?.status || '').trim().toLowerCase();
      if (code !== normalizedCode) continue;
      const sessionId = normalizeId(session?.sessionId || session?.id);
      if (!sessionId) continue;
      // eslint-disable-next-line no-await-in-loop
      await assertSourceNotReferenced({
        orgId,
        sourceType: 'classSession',
        sourceRef: { classId, sessionId },
        label: label || 'This session status',
        reqUser
      });
    }
  }
}

module.exports = {
  GUARD_MIN_STATUS,
  TIMESHEET_STATUS_RANK,
  meetsMinTimesheetStatus,
  parseActivitySessionId,
  parseReportReflectionSessionId,
  collectRefsFromEntry,
  collectTimesheetSourceRefs,
  getActivityEntrySubmittedTimesheetLockMap,
  repairActivityEntryTimesheetLocksIfNeeded,
  resolveActivityRefPersonId,
  findTimesheetsReferencingSource,
  buildTimesheetBlockers,
  assertSourceNotReferenced,
  assertPeriodHasNoTimesheets,
  assertClassHasNoLockedSessions,
  assertClassSessionsNotReferencedByApprovedTimesheets,
  assertClassSessionLedgerPreservesTimesheetLocks,
  assertSessionStatusNotReferenced,
  assertActivityNotTimesheetLocked,
  assertSessionNotTimesheetLocked,
  SESSION_TIMESHEET_LOCK_MUTATION_SCOPE,
  collectSessionTimesheetRestrictedMutationScopes,
  assertSessionTimesheetLockAllowsMutationScopes,
  isSessionTimesheetApprovedLock,
  applySessionAdminLock,
  isSessionTimesheetLocked,
  isActivityTimesheetLocked,
  isActivityEntryTimesheetLocked,
  isAssigneeTimesheetLocked,
  lockActivityAssignees,
  lockActivitySources,
  lockSourcesForApprovedTimesheet,
  dedupeSourceRefs,
  lockReconciliationSourceRefs,
  unlockSourcesForTimesheet,
  assertActivityAssigneeNotReferencedBySubmittedTimesheet,
  entryHasTimesheetApprovedLock,
  isOrphanTimesheetLock,
  entryHasOrphanTimesheetLock,
  listOrphanTimesheetLockedActivityEntries,
  listExistingTimesheetIds,
  forceUnlockActivityEntryTimesheetLocks,
  forceUnlockAllActivityTimesheetLocks
};
