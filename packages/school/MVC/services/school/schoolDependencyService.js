/**
 * Cross-entity dependency scans and timesheet-approval source locking.
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
      activityEntryId: activityEntryId || ''
    });
  }
  if (sessionId.startsWith('act-')) {
    const parsed = parseActivitySessionId(sessionId);
    if (parsed?.activityId) {
      refs.push({
        type: 'activity',
        activityId: parsed.activityId,
        activityEntryId: parsed.activityEntryId || ''
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

function collectTimesheetSourceRefs(timesheet = {}) {
  const entries = [];
  if (Array.isArray(timesheet?.submissionSnapshot?.entries)) {
    entries.push(...timesheet.submissionSnapshot.entries);
  }
  if (Array.isArray(timesheet?.entries)) {
    entries.push(...timesheet.entries);
  }
  return dedupeRefs(entries.flatMap(collectRefsFromEntry));
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
      return true;
    }
    if (sourceType === 'reportAssignment') {
      return idsEqual(ref.assignmentId, sourceRef.assignmentId);
    }
    return false;
  });
}

function timesheetReferencesSource(timesheet = {}, sourceType, sourceRef = {}) {
  const status = String(timesheet?.status || 'draft').trim().toLowerCase();
  if (!meetsMinTimesheetStatus(status)) return false;
  const entries = [];
  if (Array.isArray(timesheet?.submissionSnapshot?.entries)) entries.push(...timesheet.submissionSnapshot.entries);
  if (Array.isArray(timesheet?.entries)) entries.push(...timesheet.entries);
  if (sourceType === 'timesheetPeriod' && idsEqual(timesheet?.periodId, sourceRef.periodId)) {
    return meetsMinTimesheetStatus(status);
  }
  return entries.some((entry) => entryReferencesSource(entry, sourceType, sourceRef));
}

async function listTimesheets(reqUser, orgId) {
  const rows = await schoolDataService.fetchData('timesheets', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => !orgId || idsEqual(row?.orgId, orgId));
}

async function findTimesheetsReferencingSource({ orgId, sourceType, sourceRef, minStatus = GUARD_MIN_STATUS, reqUser }) {
  const timesheets = await listTimesheets(reqUser, orgId);
  return timesheets.filter((row) => {
    const status = String(row?.status || 'draft').trim().toLowerCase();
    if (!meetsMinTimesheetStatus(status, minStatus)) return false;
    return timesheetReferencesSource(row, sourceType, sourceRef);
  });
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
  const periods = await schoolDataService.fetchData('timesheetPeriods', {}, reqUser);
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

async function lockActivitySources({ activityId, entryIds = [], timesheetId, reqUser }) {
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) return { locked: false };
  const activity = await schoolDataService.getDataById('activities', normalizedActivityId, reqUser);
  if (!activity) return { locked: false, missing: true };
  const entryIdSet = new Set((Array.isArray(entryIds) ? entryIds : []).map(normalizeId).filter(Boolean));
  const lockAllEntries = !entryIdSet.size;
  let changed = false;
  const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
    const entryId = normalizeId(entry?.entryId || entry?.id);
    if (!lockAllEntries && !entryIdSet.has(entryId)) return entry;
    if (isActivityEntryTimesheetLocked(entry) && String(entry?.lockReason || '') === 'timesheet_approved') return entry;
    changed = true;
    return {
      ...entry,
      locked: true,
      lockedAt: new Date().toISOString(),
      lockedBy: toPublicId(reqUser?.id),
      lockReason: 'timesheet_approved',
      lockedTimesheetId: normalizeId(timesheetId)
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

async function lockSourcesForApprovedTimesheet(timesheet = {}, reqUser) {
  const refs = collectTimesheetSourceRefs(timesheet);
  const timesheetId = normalizeId(timesheet?.id);
  const classSessionsByClass = new Map();
  const activityEntries = new Map();

  refs.forEach((ref) => {
    if (ref.type === 'classSession' && ref.classId && ref.sessionId) {
      if (!classSessionsByClass.has(ref.classId)) classSessionsByClass.set(ref.classId, new Set());
      classSessionsByClass.get(ref.classId).add(ref.sessionId);
    }
    if (ref.type === 'activity' && ref.activityId) {
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

async function unlockClassSessionsForTimesheet({ timesheetId, reqUser }) {
  const token = normalizeId(timesheetId);
  if (!token) return;
  const classes = await schoolDataService.fetchData('classes', {}, reqUser);
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
  const activities = await schoolDataService.fetchData('activities', {}, reqUser);
  for (const activity of Array.isArray(activities) ? activities : []) {
    const activityId = normalizeId(activity?.id);
    if (!activityId) continue;
    let changed = false;
    const entries = (Array.isArray(activity.entries) ? activity.entries : []).map((entry) => {
      if (normalizeId(entry?.lockedTimesheetId) !== token) return entry;
      if (String(entry?.lockReason || '') !== 'timesheet_approved') return entry;
      changed = true;
      const next = { ...entry };
      next.locked = false;
      delete next.lockReason;
      delete next.lockedTimesheetId;
      next.unlockedAt = new Date().toISOString();
      next.unlockedBy = toPublicId(reqUser?.id);
      return next;
    });
    if (!changed) continue;
    const stillLocked = entries.some(isActivityEntryTimesheetLocked);
    // eslint-disable-next-line no-await-in-loop
    await schoolDataService.updateData('activities', activityId, {
      ...activity,
      entries,
      locked: stillLocked
    }, reqUser);
  }
}

async function unlockReportAssignmentsForTimesheet({ timesheetId, reqUser }) {
  const token = normalizeId(timesheetId);
  if (!token) return;
  const assignments = await schoolDataService.fetchData('reportAssignments', {}, reqUser);
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
  const classes = await schoolDataService.fetchData('classes', {}, reqUser);
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
  findTimesheetsReferencingSource,
  buildTimesheetBlockers,
  assertSourceNotReferenced,
  assertPeriodHasNoTimesheets,
  assertClassHasNoLockedSessions,
  assertClassSessionsNotReferencedByApprovedTimesheets,
  assertSessionStatusNotReferenced,
  assertActivityNotTimesheetLocked,
  assertSessionNotTimesheetLocked,
  isSessionTimesheetLocked,
  isActivityTimesheetLocked,
  isActivityEntryTimesheetLocked,
  lockSourcesForApprovedTimesheet,
  unlockSourcesForTimesheet
};
