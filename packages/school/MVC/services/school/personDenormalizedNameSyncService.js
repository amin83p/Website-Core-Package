const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const indexService = require('./schoolIndexService');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

const SYSTEM_READ_USER = null;

function emptySummary() {
  return {
    classes: 0,
    sessions: 0,
    instructors: 0,
    sessionStudentCases: 0,
    activities: 0,
    schoolAccounts: 0,
    tasks: 0,
    leaveRequests: 0,
    skipped: 0,
    errors: 0
  };
}

function recordSyncError(summary, errorDetails, collection, id, error) {
  summary.errors += 1;
  errorDetails.push({
    collection: String(collection || 'unknown'),
    id: toPublicId(id),
    message: String(error?.message || error || 'Name synchronization failed.')
  });
}

function mergeSummary(target, source) {
  Object.keys(target).forEach((key) => {
    target[key] += Number(source?.[key] || 0);
  });
  return target;
}

async function buildPersonAliasIds({ personId, activeOrgId, reqUser } = {}) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return [];

  const aliasIds = new Set([normalizedPersonId]);
  const orgId = String(activeOrgId || '').trim();

  const [teachers, staff, students] = await Promise.all([
    schoolDataService.fetchData('teachers', {}, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchData('staff', {}, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchData('students', {}, reqUser || SYSTEM_READ_USER).catch(() => [])
  ]);

  [teachers, staff, students].forEach((rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!idsEqual(row?.personId, normalizedPersonId)) return;
      if (orgId && row?.orgId && !idsEqual(row.orgId, orgId)) return;
      const recordId = toPublicId(row?.id);
      if (recordId) aliasIds.add(recordId);
    });
  });

  return [...aliasIds];
}

function matchesPersonRef(storedId, personId, aliasIds = []) {
  const normalizedStored = toPublicId(storedId);
  const normalizedPerson = toPublicId(personId);
  if (!normalizedStored || !normalizedPerson) return false;
  if (idsEqual(normalizedStored, normalizedPerson)) return true;
  return aliasIds.some((aliasId) => idsEqual(normalizedStored, aliasId));
}

function sliceName(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function pickSchoolAccountNameSuffix(account, fallback = '') {
  const name = String(account?.name || '').trim();
  for (const suffix of ['Self-Funded Student', 'Funded Student', 'Teacher', 'Staff', 'Student']) {
    if (name.toLowerCase().endsWith(`(${suffix.toLowerCase()})`)) return suffix;
  }
  return String(fallback || '').trim();
}

async function syncSchoolAccountNames({ personId, displayName, activeOrgId, summary, errorDetails, reqUser } = {}) {
  const orgFilter = activeOrgId ? { orgId__eq: activeOrgId } : {};
  let students;
  let teachers;
  let staff;
  let accounts;
  try {
    [students, teachers, staff, accounts] = await Promise.all([
      schoolDataService.fetchData('students', orgFilter, reqUser),
      schoolDataService.fetchData('teachers', orgFilter, reqUser),
      schoolDataService.fetchData('staff', orgFilter, reqUser),
      schoolDataService.fetchData('schoolAccounts', orgFilter, reqUser)
    ]);
  } catch (error) {
    recordSyncError(summary, errorDetails, 'schoolAccounts', '', error);
    console.error('personDenormalizedNameSyncService.schoolAccounts load failed:', error?.message || error);
    return;
  }
  const accountsById = new Map((Array.isArray(accounts) ? accounts : []).map((row) => [toPublicId(row?.id), row]));
  const linked = [];

  function collect(rows, accountField, fallback) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!idsEqual(row?.personId, personId)) continue;
      if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
      const accountId = toPublicId(row?.[accountField]);
      if (accountId) linked.push({ accountId, fallback });
    }
  }

  collect(students, 'studentAccountId', 'Student');
  collect(teachers, 'teacherAccountId', 'Teacher');
  collect(staff, 'staffAccountId', 'Staff');

  const seen = new Set();
  for (const item of linked) {
    if (seen.has(item.accountId)) continue;
    seen.add(item.accountId);
    const account = accountsById.get(item.accountId);
    if (!account) {
      summary.skipped += 1;
      continue;
    }
    if (activeOrgId && account?.orgId && !idsEqual(account.orgId, activeOrgId)) {
      summary.skipped += 1;
      continue;
    }
    const suffix = pickSchoolAccountNameSuffix(account, item.fallback);
    const desiredName = suffix ? `${displayName} (${suffix})` : displayName;
    if (String(account.name || '').trim() === desiredName) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('schoolAccounts', item.accountId, { name: desiredName }, reqUser);
      summary.schoolAccounts += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, 'schoolAccounts', item.accountId, error);
      console.error('personDenormalizedNameSyncService.schoolAccounts update failed:', item.accountId, error?.message || error);
    }
  }
}

async function syncClassSessionAndInstructorNames({
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary,
  errorDetails,
  reqUser
} = {}) {
  const orgFilter = activeOrgId ? { orgId__eq: activeOrgId } : {};
  const classes = await schoolDataService.fetchData('classes', orgFilter, reqUser);
  const touchedClassIds = new Set();

  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    try {
      let instructorsChanged = false;
      let instructorUpdateCount = 0;
      const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors.map((row) => ({ ...row })) : [];
      instructors.forEach((instructor) => {
        if (!matchesPersonRef(instructor?.personId, personId, aliasIds)) return;
        const nextName = sliceName(displayName);
        if (String(instructor?.name || '').trim() === nextName) return;
        instructor.name = nextName;
        instructorsChanged = true;
        instructorUpdateCount += 1;
      });

      const sessions = await schoolDataService.getClassSessions(classId, reqUser);
      let sessionsChanged = false;
      let sessionUpdateCount = 0;
      const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
        const row = session && typeof session === 'object' ? { ...session } : {};
        if (!matchesPersonRef(row?.delivery?.deliveredBy, personId, aliasIds)) return row;
        if (!row.delivery || typeof row.delivery !== 'object') row.delivery = {};
        const nextName = sliceName(displayName);
        if (String(row.delivery.deliveredByName || '').trim() === nextName) return row;
        row.delivery = { ...row.delivery, deliveredByName: nextName };
        sessionsChanged = true;
        sessionUpdateCount += 1;
        return row;
      });

      if (sessionsChanged) await schoolDataService.saveClassSessions(classId, nextSessions, reqUser);
      if (instructorsChanged) await schoolDataService.updateData('classes', classId, { instructors }, reqUser);
      if (sessionsChanged || instructorsChanged) {
        touchedClassIds.add(classId);
        summary.classes += 1;
        summary.sessions += sessionUpdateCount;
        summary.instructors += instructorUpdateCount;
      }
    } catch (error) {
      recordSyncError(summary, errorDetails, 'classes', classId, error);
      console.error('personDenormalizedNameSyncService.classes update failed:', classId, error?.message || error);
    }
  }

  for (const classId of touchedClassIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await indexService.rebuildIndexesForClass(classId);
    } catch (error) {
      recordSyncError(summary, errorDetails, 'classIndexes', classId, error);
      console.error('personDenormalizedNameSyncService.rebuildIndexesForClass failed:', classId, error?.message || error);
    }
  }
}

async function syncSessionStudentCaseNames({ personId, displayName, aliasIds, activeOrgId, summary, errorDetails } = {}) {
  const rows = await schoolRepositories.sessionStudentCases.list({
    query: {},
    scope: { canViewAll: true }
  });
  const nextName = sliceName(displayName);

  for (const row of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
    const updates = {};
    if (matchesPersonRef(row?.studentPersonId, personId, aliasIds) && String(row?.studentName || '').trim() !== nextName) {
      updates.studentName = nextName;
    }
    if (matchesPersonRef(row?.teacherPersonId, personId, aliasIds) && String(row?.teacherName || '').trim() !== nextName) {
      updates.teacherName = nextName;
    }
    if (!Object.keys(updates).length) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.sessionStudentCases.update(row.id, { ...row, ...updates }, { scope: { canViewAll: true } });
      summary.sessionStudentCases += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, 'sessionStudentCases', row?.id, error);
      console.error('personDenormalizedNameSyncService.sessionStudentCases update failed:', row?.id, error?.message || error);
    }
  }
}

async function syncActivityAssigneeNames({ personId, displayName, aliasIds, activeOrgId, summary, errorDetails } = {}) {
  const rows = await schoolRepositories.activities.list({
    query: {},
    scope: { canViewAll: true }
  });
  const nextName = sliceName(displayName);

  for (const activity of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && activity?.orgId && !idsEqual(activity.orgId, activeOrgId)) continue;
    let changed = false;
    const entries = (Array.isArray(activity?.entries) ? activity.entries : []).map((entry) => {
      const nextEntry = { ...entry };
      const assignees = (Array.isArray(nextEntry.assignees) ? nextEntry.assignees : []).map((assignee) => {
        if (!matchesPersonRef(assignee?.personId, personId, aliasIds)) return assignee;
        if (String(assignee?.personName || '').trim() === nextName) return assignee;
        changed = true;
        return { ...assignee, personName: nextName };
      });
      nextEntry.assignees = assignees;
      return nextEntry;
    });
    if (!changed) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.activities.update(activity.id, { ...activity, entries }, { scope: { canViewAll: true } });
      summary.activities += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, 'activities', activity?.id, error);
      console.error('personDenormalizedNameSyncService.activities update failed:', activity?.id, error?.message || error);
    }
  }
}

function isLiveTaskStatus(status) {
  return !['completed', 'resolved', 'cancelled', 'canceled', 'closed', 'void', 'archived'].includes(String(status || '').trim().toLowerCase());
}

function patchTaskPersonNames(task, personId, aliasIds, displayName) {
  let changed = false;
  const nextName = sliceName(displayName, 160);
  const next = { ...task };

  if (isLiveTaskStatus(next.status) && matchesPersonRef(next.assignedPersonId, personId, aliasIds) && String(next.assignedPersonName || '').trim() !== nextName) {
    next.assignedPersonName = nextName;
    changed = true;
  }

  next.tasks = (Array.isArray(next.tasks) ? next.tasks : []).map((assignment) => {
    const row = { ...assignment };
    if (isLiveTaskStatus(row.status) && matchesPersonRef(row.assignedPersonId, personId, aliasIds) && String(row.assignedPersonName || '').trim() !== nextName) {
      changed = true;
      row.assignedPersonName = nextName;
    }
    return row;
  });

  return changed ? next : null;
}

async function syncTaskPersonNames({ personId, displayName, aliasIds, activeOrgId, summary, errorDetails } = {}) {
  const rows = await schoolRepositories.tasks.list({
    query: {},
    scope: { canViewAll: true }
  });

  for (const task of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && task?.orgId && !idsEqual(task.orgId, activeOrgId)) continue;
    const patched = patchTaskPersonNames(task, personId, aliasIds, displayName);
    if (!patched) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.tasks.update(task.id, patched, { scope: { canViewAll: true } });
      summary.tasks += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, 'tasks', task?.id, error);
      console.error('personDenormalizedNameSyncService.tasks update failed:', task?.id, error?.message || error);
    }
  }
}

function patchLeaveRequestNames(row, personId, aliasIds, displayName) {
  let changed = false;
  const nextName = sliceName(displayName, 160);
  const next = { ...row };

  if (matchesPersonRef(next.requesterPersonId, personId, aliasIds) && String(next.requesterName || '').trim() !== nextName) {
    next.requesterName = nextName;
    changed = true;
  }

  next.sessionResolutions = (Array.isArray(next.sessionResolutions) ? next.sessionResolutions : []).map((resolution) => {
    if (String(resolution?.resolvedAt || '').trim()) return resolution;
    if (!matchesPersonRef(resolution?.substituteTeacherId, personId, aliasIds)) return resolution;
    if (String(resolution?.substituteTeacherName || '').trim() === nextName) return resolution;
    changed = true;
    return { ...resolution, substituteTeacherName: nextName };
  });

  return changed ? next : null;
}

async function syncLeaveRequestNames({ personId, displayName, aliasIds, activeOrgId, summary, errorDetails } = {}) {
  const rows = await schoolRepositories.leaveRequests.list({
    query: {},
    scope: { canViewAll: true }
  });

  for (const row of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
    const patched = patchLeaveRequestNames(row, personId, aliasIds, displayName);
    if (!patched) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.leaveRequests.update(row.id, patched, { scope: { canViewAll: true } });
      summary.leaveRequests += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, 'leaveRequests', row?.id, error);
      console.error('personDenormalizedNameSyncService.leaveRequests update failed:', row?.id, error?.message || error);
    }
  }
}

async function syncPersonDisplayName({
  personId,
  displayName,
  activeOrgId,
  reqUser
} = {}) {
  const normalizedPersonId = toPublicId(personId);
  const normalizedName = sliceName(displayName);
  if (!normalizedPersonId || !normalizedName) {
    return { personId: normalizedPersonId, displayName: normalizedName, updated: emptySummary() };
  }

  const aliasIds = await buildPersonAliasIds({ personId: normalizedPersonId, activeOrgId, reqUser });
  const summary = emptySummary();
  const errorDetails = [];
  const context = {
    personId: normalizedPersonId,
    displayName: normalizedName,
    aliasIds,
    activeOrgId,
    summary,
    errorDetails,
    reqUser
  };

  const steps = [
    ['classes', syncClassSessionAndInstructorNames],
    ['sessionStudentCases', syncSessionStudentCaseNames],
    ['activities', syncActivityAssigneeNames],
    ['schoolAccounts', syncSchoolAccountNames],
    ['tasks', syncTaskPersonNames],
    ['leaveRequests', syncLeaveRequestNames]
  ];
  for (const [collection, synchronizer] of steps) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await synchronizer(context);
    } catch (error) {
      recordSyncError(summary, errorDetails, collection, '', error);
      console.error('personDenormalizedNameSyncService.' + collection + ' sync failed:', error?.message || error);
    }
  }

  return {
    personId: normalizedPersonId,
    displayName: normalizedName,
    aliasIds,
    updated: summary,
    errorDetails
  };
}

async function syncPersonDisplayNameForRoleUpdate({ personId, activeOrgId, reqUser } = {}) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return null;
  try {
    const person = await schoolPersonAccessService.getPersonById({ reqUser, personId: normalizedPersonId });
    const displayName = schoolPersonAccessService.formatPersonName(person, normalizedPersonId);
    return await syncPersonDisplayName({
      personId: normalizedPersonId,
      displayName,
      activeOrgId,
      reqUser
    });
  } catch (error) {
    const updated = emptySummary();
    const errorDetails = [];
    recordSyncError(updated, errorDetails, 'persons', normalizedPersonId, error);
    return { personId: normalizedPersonId, displayName: '', aliasIds: [], updated, errorDetails, partial: true };
  }
}

async function syncDenormalizedNamesForOrg({ activeOrgId, reqUser, personId = '', linkType = '' } = {}) {
  const orgId = String(activeOrgId || getActiveOrgIdOrThrow(reqUser)).trim();
  const targetPersonId = toPublicId(personId);
  const normalizedLinkType = String(linkType || '').trim().toLowerCase();
  const [teachers, staff, students] = await Promise.all([
    schoolDataService.fetchData('teachers', { orgId__eq: orgId }, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchData('staff', { orgId__eq: orgId }, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchData('students', { orgId__eq: orgId }, reqUser || SYSTEM_READ_USER).catch(() => [])
  ]);

  const personIds = new Set();
  if (targetPersonId) {
    personIds.add(targetPersonId);
  } else {
    [teachers, staff, students].forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const id = toPublicId(row?.personId);
        if (id) personIds.add(id);
      });
    });
  }

  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: reqUser || SYSTEM_READ_USER,
    personIds: [...personIds]
  });

  const totals = emptySummary();
  const people = [];
  const errorDetails = [];

  for (const id of personIds) {
    const person = personById.get(id);
    const displayName = schoolPersonAccessService.formatPersonName(person, id);
    // eslint-disable-next-line no-await-in-loop
    const result = await syncPersonDisplayName({
      personId: id,
      displayName,
      activeOrgId: orgId,
      reqUser
    });
    mergeSummary(totals, result.updated);
    errorDetails.push(...(Array.isArray(result.errorDetails) ? result.errorDetails.map((detail) => ({ personId: id, ...detail })) : []));
    people.push({
      personId: id,
      displayName,
      updated: result.updated
    });
  }

  return {
    orgId,
    linkType: targetPersonId ? (normalizedLinkType || 'person') : 'all',
    scanned: {
      teachers: Array.isArray(teachers) ? teachers.length : 0,
      students: Array.isArray(students) ? students.length : 0,
      staff: Array.isArray(staff) ? staff.length : 0,
      linkedAccounts: new Set([].concat(
        (Array.isArray(teachers) ? teachers : []).map((row) => toPublicId(row?.teacherAccountId)),
        (Array.isArray(students) ? students : []).map((row) => toPublicId(row?.studentAccountId)),
        (Array.isArray(staff) ? staff : []).map((row) => toPublicId(row?.staffAccountId))
      ).filter(Boolean)).size,
      uniquePeople: personIds.size
    },
    peopleProcessed: people.length,
    people,
    updated: totals,
    partial: totals.errors > 0,
    errorDetails
  };
}

async function syncAllSchoolPeopleSavedNamesForOrg({ activeOrgId, reqUser } = {}) {
  return syncDenormalizedNamesForOrg({ activeOrgId, reqUser, personId: '', linkType: 'all' });
}

module.exports = {
  buildPersonAliasIds,
  matchesPersonRef,
  syncPersonDisplayName,
  syncPersonDisplayNameForRoleUpdate,
  syncAllSchoolPeopleSavedNamesForOrg,
  syncDenormalizedNamesForOrg
};
