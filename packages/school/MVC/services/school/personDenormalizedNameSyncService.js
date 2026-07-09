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
    tasks: 0,
    leaveRequests: 0,
    errors: 0
  };
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

async function syncClassSessionAndInstructorNames({
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary
} = {}) {
  const orgFilter = activeOrgId ? { orgId__eq: activeOrgId } : {};
  const classes = await schoolDataService.fetchData('classes', orgFilter, SYSTEM_READ_USER);
  const touchedClassIds = new Set();

  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    let instructorsChanged = false;
    const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors.map((row) => ({ ...row })) : [];
    instructors.forEach((instructor) => {
      if (!matchesPersonRef(instructor?.personId, personId, aliasIds)) return;
      const nextName = sliceName(displayName);
      if (String(instructor?.name || '').trim() === nextName) return;
      instructor.name = nextName;
      instructorsChanged = true;
      summary.instructors += 1;
    });

    const sessions = await schoolDataService.getClassSessions(classId, SYSTEM_READ_USER);
    let sessionsChanged = false;
    const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
      const row = session && typeof session === 'object' ? { ...session } : {};
      if (!matchesPersonRef(row?.delivery?.deliveredBy, personId, aliasIds)) return row;
      if (!row.delivery || typeof row.delivery !== 'object') row.delivery = {};
      const nextName = sliceName(displayName);
      if (String(row.delivery.deliveredByName || '').trim() === nextName) return row;
      row.delivery = { ...row.delivery, deliveredByName: nextName };
      sessionsChanged = true;
      summary.sessions += 1;
      return row;
    });

    if (sessionsChanged) {
      await schoolDataService.saveClassSessions(classId, nextSessions, SYSTEM_READ_USER);
    }

    if (instructorsChanged) {
      await schoolDataService.updateData('classes', classId, { instructors }, SYSTEM_READ_USER);
    }

    if (sessionsChanged || instructorsChanged) {
      touchedClassIds.add(classId);
      summary.classes += 1;
    }
  }

  for (const classId of touchedClassIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await indexService.rebuildIndexesForClass(classId);
    } catch (error) {
      summary.errors += 1;
      console.error('personDenormalizedNameSyncService.rebuildIndexesForClass failed:', classId, error?.message || error);
    }
  }
}

async function syncSessionStudentCaseNames({ personId, displayName, aliasIds, activeOrgId, summary } = {}) {
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
      summary.errors += 1;
      console.error('personDenormalizedNameSyncService.sessionStudentCases update failed:', row?.id, error?.message || error);
    }
  }
}

async function syncActivityAssigneeNames({ personId, displayName, aliasIds, activeOrgId, summary } = {}) {
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
      summary.errors += 1;
      console.error('personDenormalizedNameSyncService.activities update failed:', activity?.id, error?.message || error);
    }
  }
}

function patchTaskPersonNames(task, personId, aliasIds, displayName) {
  let changed = false;
  const nextName = sliceName(displayName, 160);
  const next = { ...task };

  if (matchesPersonRef(next.assignedPersonId, personId, aliasIds) && String(next.assignedPersonName || '').trim() !== nextName) {
    next.assignedPersonName = nextName;
    changed = true;
  }

  next.lifecycle = (Array.isArray(next.lifecycle) ? next.lifecycle : []).map((event) => {
    const row = { ...event };
    let eventChanged = false;
    if (matchesPersonRef(row.personId, personId, aliasIds) && String(row.personName || '').trim() !== nextName) {
      row.personName = nextName;
      eventChanged = true;
    }
    if (matchesPersonRef(row.targetPersonId, personId, aliasIds) && String(row.targetPersonName || '').trim() !== nextName) {
      row.targetPersonName = nextName;
      eventChanged = true;
    }
    if (eventChanged) changed = true;
    return row;
  });

  next.tasks = (Array.isArray(next.tasks) ? next.tasks : []).map((assignment) => {
    const row = { ...assignment };
    if (matchesPersonRef(row.assignedPersonId, personId, aliasIds) && String(row.assignedPersonName || '').trim() !== nextName) {
      changed = true;
      row.assignedPersonName = nextName;
    }
    row.assignmentHistory = (Array.isArray(row.assignmentHistory) ? row.assignmentHistory : []).map((entry) => {
      if (!matchesPersonRef(entry?.assignedPersonId, personId, aliasIds)) return entry;
      if (String(entry?.assignedPersonName || '').trim() === nextName) return entry;
      changed = true;
      return { ...entry, assignedPersonName: nextName };
    });
    return row;
  });

  return changed ? next : null;
}

async function syncTaskPersonNames({ personId, displayName, aliasIds, activeOrgId, summary } = {}) {
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
      summary.errors += 1;
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

  if (next.lastApprovedSnapshot && typeof next.lastApprovedSnapshot === 'object') {
    const snapshot = { ...next.lastApprovedSnapshot };
    if (matchesPersonRef(snapshot.requesterPersonId, personId, aliasIds) && String(snapshot.requesterName || '').trim() !== nextName) {
      snapshot.requesterName = nextName;
      next.lastApprovedSnapshot = snapshot;
      changed = true;
    }
  }

  next.sessionResolutions = (Array.isArray(next.sessionResolutions) ? next.sessionResolutions : []).map((resolution) => {
    if (!matchesPersonRef(resolution?.substituteTeacherId, personId, aliasIds)) return resolution;
    if (String(resolution?.substituteTeacherName || '').trim() === nextName) return resolution;
    changed = true;
    return { ...resolution, substituteTeacherName: nextName };
  });

  return changed ? next : null;
}

async function syncLeaveRequestNames({ personId, displayName, aliasIds, activeOrgId, summary } = {}) {
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
      summary.errors += 1;
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
  const context = {
    personId: normalizedPersonId,
    displayName: normalizedName,
    aliasIds,
    activeOrgId,
    summary
  };

  await syncClassSessionAndInstructorNames(context);
  await syncSessionStudentCaseNames(context);
  await syncActivityAssigneeNames(context);
  await syncTaskPersonNames(context);
  await syncLeaveRequestNames(context);

  return {
    personId: normalizedPersonId,
    displayName: normalizedName,
    aliasIds,
    updated: summary
  };
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

  const buckets = {
    teacher: teachers,
    staff,
    student: students
  };

  const personIds = new Set();
  if (targetPersonId) {
    personIds.add(targetPersonId);
  } else if (buckets[normalizedLinkType]) {
    (Array.isArray(buckets[normalizedLinkType]) ? buckets[normalizedLinkType] : []).forEach((row) => {
      const id = toPublicId(row?.personId);
      if (id) personIds.add(id);
    });
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
    people.push({
      personId: id,
      displayName,
      updated: result.updated
    });
  }

  return {
    orgId,
    linkType: normalizedLinkType || 'all',
    peopleProcessed: people.length,
    people,
    updated: totals
  };
}

module.exports = {
  buildPersonAliasIds,
  matchesPersonRef,
  syncPersonDisplayName,
  syncDenormalizedNamesForOrg
};
