const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const indexService = require('./schoolIndexService');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

const SYSTEM_READ_USER = null;

const TEACHER_NAME_SNAPSHOT_KEYS = Object.freeze([
  'teacher_name',
  'clb_evaluation_teacher_label'
]);

function emptySummary() {
  return {
    classes: 0,
    sessions: 0,
    instructors: 0,
    coTeachers: 0,
    sessionStudentCases: 0,
    caseAssignees: 0,
    caseCollaborators: 0,
    caseHistory: 0,
    activities: 0,
    schoolAccounts: 0,
    tasks: 0,
    taskHistory: 0,
    leaveRequests: 0,
    leaveHistory: 0,
    timesheets: 0,
    reportInstances: 0,
    bookCoveringReports: 0,
    studentsClbHistory: 0,
    skipped: 0,
    errors: 0
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nameDiffers(current, next) {
  return String(current || '').trim() !== String(next || '').trim();
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
    schoolDataService.fetchAllData('teachers', {}, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchAllData('staff', {}, reqUser || SYSTEM_READ_USER).catch(() => []),
    schoolDataService.fetchAllData('students', {}, reqUser || SYSTEM_READ_USER).catch(() => [])
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

async function syncSchoolAccountNames({ personId, displayName, activeOrgId, summary, errorDetails, reqUser, dryRun = false } = {}) {
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
    summary.schoolAccounts += 1;
    if (dryRun) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('schoolAccounts', item.accountId, { name: desiredName }, reqUser);
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
  reqUser,
  dryRun = false
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
      let coTeacherUpdateCount = 0;
      const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
        const row = session && typeof session === 'object' ? { ...session } : {};
        let sessionRowChanged = false;
        const nextName = sliceName(displayName);

        if (matchesPersonRef(row?.delivery?.deliveredBy, personId, aliasIds)) {
          if (!row.delivery || typeof row.delivery !== 'object') row.delivery = {};
          if (nameDiffers(row.delivery.deliveredByName, nextName)) {
            row.delivery = { ...row.delivery, deliveredByName: nextName };
            sessionRowChanged = true;
          }
        }

        const coTeachers = Array.isArray(row?.delivery?.coTeachers) ? row.delivery.coTeachers.map((ct) => ({ ...ct })) : [];
        coTeachers.forEach((coTeacher) => {
          if (!matchesPersonRef(coTeacher?.personId, personId, aliasIds)) return;
          if (!nameDiffers(coTeacher?.name, nextName)) return;
          coTeacher.name = nextName;
          sessionRowChanged = true;
          coTeacherUpdateCount += 1;
        });
        if (coTeachers.length && row.delivery) {
          row.delivery = { ...row.delivery, coTeachers };
        }

        if (row?.merged && matchesPersonRef(row.merged.previousTeacherId, personId, aliasIds)) {
          if (nameDiffers(row.merged.previousTeacherName, nextName)) {
            row.merged = { ...row.merged, previousTeacherName: nextName };
            sessionRowChanged = true;
          }
        }

        if (!sessionRowChanged) return row;
        sessionsChanged = true;
        sessionUpdateCount += 1;
        return row;
      });

      if (sessionsChanged || instructorsChanged) {
        touchedClassIds.add(classId);
        summary.classes += 1;
        summary.sessions += sessionUpdateCount;
        summary.instructors += instructorUpdateCount;
        summary.coTeachers += coTeacherUpdateCount;
      }
      if (dryRun) continue;
      if (sessionsChanged) await schoolDataService.saveClassSessions(classId, nextSessions, reqUser);
      if (instructorsChanged) await schoolDataService.updateData('classes', classId, { instructors }, reqUser);
    } catch (error) {
      recordSyncError(summary, errorDetails, 'classes', classId, error);
      console.error('personDenormalizedNameSyncService.classes update failed:', classId, error?.message || error);
    }
  }

  if (dryRun) return;

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

function patchSessionStudentCasePersonNames(row, { personId, displayName, aliasIds, includeHistorical = false } = {}) {
  const nextName = sliceName(displayName);
  let changed = false;
  const next = { ...row };

  if (matchesPersonRef(next?.studentPersonId, personId, aliasIds) && nameDiffers(next.studentName, nextName)) {
    next.studentName = nextName;
    changed = true;
  }
  if (matchesPersonRef(next?.teacherPersonId, personId, aliasIds) && nameDiffers(next.teacherName, nextName)) {
    next.teacherName = nextName;
    changed = true;
  }
  if (next.assignedTo && matchesPersonRef(next.assignedTo.personId, personId, aliasIds) && nameDiffers(next.assignedTo.personName, nextName)) {
    next.assignedTo = { ...next.assignedTo, personName: nextName };
    changed = true;
  }
  const collaborators = (Array.isArray(next.collaborators) ? next.collaborators : []).map((entry) => {
    if (!matchesPersonRef(entry?.personId, personId, aliasIds)) return entry;
    if (!nameDiffers(entry?.personName, nextName)) return entry;
    changed = true;
    return { ...entry, personName: nextName };
  });
  if (collaborators.length || Array.isArray(next.collaborators)) {
    next.collaborators = collaborators;
  }

  if (includeHistorical) {
    let historyCount = 0;
    next.workActions = (Array.isArray(next.workActions) ? next.workActions : []).map((entry) => {
      if (!matchesPersonRef(entry?.actorPersonId, personId, aliasIds)) return entry;
      if (!nameDiffers(entry?.actorName, nextName)) return entry;
      historyCount += 1;
      changed = true;
      return { ...entry, actorName: nextName };
    });
    next.lifecycle = (Array.isArray(next.lifecycle) ? next.lifecycle : []).map((event) => {
      if (!matchesPersonRef(event?.actorPersonId, personId, aliasIds)) return event;
      if (!nameDiffers(event?.actorName, nextName)) return event;
      historyCount += 1;
      changed = true;
      return { ...event, actorName: nextName };
    });
    if (historyCount) next.__caseHistoryCount = historyCount;
  }

  return changed ? next : null;
}

async function syncSessionStudentCaseNames({
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary,
  errorDetails,
  includeHistorical = false,
  dryRun = false
} = {}) {
  const rows = await schoolRepositories.sessionStudentCases.list({
    query: {},
    scope: { canViewAll: true }
  });

  for (const row of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
    const patched = patchSessionStudentCasePersonNames(row, { personId, displayName, aliasIds, includeHistorical });
    if (!patched) continue;
    if (dryRun) {
      summary.sessionStudentCases += 1;
      if (patched.assignedTo && matchesPersonRef(patched.assignedTo.personId, personId, aliasIds)) {
        summary.caseAssignees += 1;
      }
      summary.caseCollaborators += (Array.isArray(patched.collaborators) ? patched.collaborators : [])
        .filter((entry) => matchesPersonRef(entry?.personId, personId, aliasIds)).length;
      summary.caseHistory += Number(patched.__caseHistoryCount || 0);
      continue;
    }
    const payload = { ...patched };
    delete payload.__caseHistoryCount;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.sessionStudentCases.update(row.id, payload, { scope: { canViewAll: true } });
      summary.sessionStudentCases += 1;
      if (payload.assignedTo && matchesPersonRef(payload.assignedTo.personId, personId, aliasIds) && nameDiffers(row?.assignedTo?.personName, sliceName(displayName))) {
        summary.caseAssignees += 1;
      }
      const collabUpdates = (Array.isArray(payload.collaborators) ? payload.collaborators : []).filter((entry, index) => {
        const prior = Array.isArray(row.collaborators) ? row.collaborators[index] : null;
        return matchesPersonRef(entry?.personId, personId, aliasIds) && nameDiffers(prior?.personName, entry.personName);
      }).length;
      summary.caseCollaborators += collabUpdates;
      summary.caseHistory += Number(patched.__caseHistoryCount || 0);
    } catch (error) {
      recordSyncError(summary, errorDetails, 'sessionStudentCases', row?.id, error);
      console.error('personDenormalizedNameSyncService.sessionStudentCases update failed:', row?.id, error?.message || error);
    }
  }
}

async function syncActivityAssigneeNames({ personId, displayName, aliasIds, activeOrgId, summary, errorDetails, dryRun = false } = {}) {
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
    summary.activities += 1;
    if (dryRun) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.activities.update(activity.id, { ...activity, entries }, { scope: { canViewAll: true } });
    } catch (error) {
      recordSyncError(summary, errorDetails, 'activities', activity?.id, error);
      console.error('personDenormalizedNameSyncService.activities update failed:', activity?.id, error?.message || error);
    }
  }
}

function isLiveTaskStatus(status) {
  return !['completed', 'resolved', 'cancelled', 'canceled', 'closed', 'void', 'archived'].includes(String(status || '').trim().toLowerCase());
}

function patchTaskPersonNames(task, personId, aliasIds, displayName, { includeHistorical = false } = {}) {
  let changed = false;
  let historyCount = 0;
  const nextName = sliceName(displayName, 160);
  const next = { ...task };
  const allowAssigneePatch = (status) => includeHistorical || isLiveTaskStatus(status);

  if (allowAssigneePatch(next.status) && matchesPersonRef(next.assignedPersonId, personId, aliasIds) && nameDiffers(next.assignedPersonName, nextName)) {
    next.assignedPersonName = nextName;
    changed = true;
  }
  if (includeHistorical && matchesPersonRef(next.resolvedBy, personId, aliasIds) && nameDiffers(next.resolvedByName, nextName)) {
    next.resolvedByName = nextName;
    changed = true;
    historyCount += 1;
  }

  next.tasks = (Array.isArray(next.tasks) ? next.tasks : []).map((assignment) => {
    const row = { ...assignment };
    if (allowAssigneePatch(row.status) && matchesPersonRef(row.assignedPersonId, personId, aliasIds) && nameDiffers(row.assignedPersonName, nextName)) {
      changed = true;
      row.assignedPersonName = nextName;
    }
  if (includeHistorical && Array.isArray(row.assignmentHistory)) {
      row.assignmentHistory = row.assignmentHistory.map((entry) => {
        if (!matchesPersonRef(entry?.assignedPersonId, personId, aliasIds)) return entry;
        if (!nameDiffers(entry?.assignedPersonName, nextName)) return entry;
        historyCount += 1;
        changed = true;
        return { ...entry, assignedPersonName: nextName };
      });
    }
    return row;
  });

  if (includeHistorical) {
    next.lifecycle = (Array.isArray(next.lifecycle) ? next.lifecycle : []).map((event) => {
      let eventChanged = false;
      const patched = { ...event };
      if (matchesPersonRef(patched.personId, personId, aliasIds) && nameDiffers(patched.personName, nextName)) {
        patched.personName = nextName;
        eventChanged = true;
      }
      if (matchesPersonRef(patched.actorPersonId || patched.actorId, personId, aliasIds) && nameDiffers(patched.actorName, nextName)) {
        patched.actorName = nextName;
        eventChanged = true;
      }
      if (matchesPersonRef(patched.targetPersonId, personId, aliasIds) && nameDiffers(patched.targetPersonName, nextName)) {
        patched.targetPersonName = nextName;
        eventChanged = true;
      }
      if (eventChanged) {
        historyCount += 1;
        changed = true;
      }
      return eventChanged ? patched : event;
    });
  }

  if (historyCount) next.__taskHistoryCount = historyCount;
  return changed ? next : null;
}

async function syncTaskPersonNames({
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary,
  errorDetails,
  includeHistorical = false,
  dryRun = false
} = {}) {
  const rows = await schoolRepositories.tasks.list({
    query: {},
    scope: { canViewAll: true }
  });

  for (const task of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && task?.orgId && !idsEqual(task.orgId, activeOrgId)) continue;
    const patched = patchTaskPersonNames(task, personId, aliasIds, displayName, { includeHistorical });
    if (!patched) continue;
    if (dryRun) {
      summary.tasks += 1;
      summary.taskHistory += Number(patched.__taskHistoryCount || 0);
      continue;
    }
    const payload = { ...patched };
    delete payload.__taskHistoryCount;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.tasks.update(task.id, payload, { scope: { canViewAll: true } });
      summary.tasks += 1;
      summary.taskHistory += Number(patched.__taskHistoryCount || 0);
    } catch (error) {
      recordSyncError(summary, errorDetails, 'tasks', task?.id, error);
      console.error('personDenormalizedNameSyncService.tasks update failed:', task?.id, error?.message || error);
    }
  }
}

function patchLeaveRequestNames(row, personId, aliasIds, displayName, { includeHistorical = false } = {}) {
  let changed = false;
  let historyCount = 0;
  const nextName = sliceName(displayName, 160);
  const next = { ...row };

  if (matchesPersonRef(next.requesterPersonId, personId, aliasIds) && nameDiffers(next.requesterName, nextName)) {
    next.requesterName = nextName;
    changed = true;
  }

  next.sessionResolutions = (Array.isArray(next.sessionResolutions) ? next.sessionResolutions : []).map((resolution) => {
    if (String(resolution?.resolvedAt || '').trim()) return resolution;
    if (!matchesPersonRef(resolution?.substituteTeacherId, personId, aliasIds)) return resolution;
    if (!nameDiffers(resolution?.substituteTeacherName, nextName)) return resolution;
    changed = true;
    return { ...resolution, substituteTeacherName: nextName };
  });

  if (includeHistorical) {
    next.lifecycle = (Array.isArray(next.lifecycle) ? next.lifecycle : []).map((event) => {
      if (!matchesPersonRef(event?.actorPersonId, personId, aliasIds)) return event;
      if (!nameDiffers(event?.actorName, nextName)) return event;
      historyCount += 1;
      changed = true;
      return { ...event, actorName: nextName };
    });
  }

  if (historyCount) next.__leaveHistoryCount = historyCount;
  return changed ? next : null;
}

async function syncLeaveRequestNames({
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary,
  errorDetails,
  includeHistorical = false,
  dryRun = false
} = {}) {
  const rows = await schoolRepositories.leaveRequests.list({
    query: {},
    scope: { canViewAll: true }
  });

  for (const row of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
    const patched = patchLeaveRequestNames(row, personId, aliasIds, displayName, { includeHistorical });
    if (!patched) continue;
    if (dryRun) {
      summary.leaveRequests += 1;
      summary.leaveHistory += Number(patched.__leaveHistoryCount || 0);
      continue;
    }
    const payload = { ...patched };
    delete payload.__leaveHistoryCount;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolRepositories.leaveRequests.update(row.id, payload, { scope: { canViewAll: true } });
      summary.leaveRequests += 1;
      summary.leaveHistory += Number(patched.__leaveHistoryCount || 0);
    } catch (error) {
      recordSyncError(summary, errorDetails, 'leaveRequests', row?.id, error);
      console.error('personDenormalizedNameSyncService.leaveRequests update failed:', row?.id, error?.message || error);
    }
  }
}

function patchPlainTeacherNameFields(target, displayName, personId, aliasIds) {
  if (!isPlainObject(target)) return false;
  const nextName = sliceName(displayName);
  let changed = false;
  TEACHER_NAME_SNAPSHOT_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return;
    if (!nameDiffers(target[key], nextName)) return;
    target[key] = nextName;
    changed = true;
  });
  if (matchesPersonRef(target.clb_evaluation_teacher_id, personId, aliasIds)
    && nameDiffers(target.clb_evaluation_teacher_label, nextName)) {
    target.clb_evaluation_teacher_label = nextName;
    changed = true;
  }
  return changed;
}

function patchReportInstanceTeacherSnapshots(row, { personId, displayName, aliasIds } = {}) {
  if (!matchesPersonRef(row?.teacherId, personId, aliasIds)) return null;
  let changed = false;
  const next = { ...row };

  const patchSection = (section) => {
    if (!isPlainObject(section)) return;
    if (patchPlainTeacherNameFields(section, displayName, personId, aliasIds)) changed = true;
    ['mergedAnswers', 'placeholders', 'sourceValues', 'keys'].forEach((bucket) => {
      if (!isPlainObject(section[bucket])) return;
      section[bucket] = { ...section[bucket] };
      if (patchPlainTeacherNameFields(section[bucket], displayName, personId, aliasIds)) changed = true;
    });
  };

  if (isPlainObject(next.prefillSnapshot)) {
    next.prefillSnapshot = { ...next.prefillSnapshot };
    patchSection(next.prefillSnapshot);
  }
  if (isPlainObject(next.answers)) {
    next.answers = { ...next.answers };
    patchSection(next.answers);
  }
  ['lockSnapshot', 'renderCache'].forEach((snapshotKey) => {
    if (!isPlainObject(next[snapshotKey])) return;
    next[snapshotKey] = { ...next[snapshotKey] };
    patchSection(next[snapshotKey]);
  });

  return changed ? next : null;
}

function patchTimesheetTeacherNames(row, { personId, displayName, aliasIds } = {}) {
  if (!matchesPersonRef(row?.teacherId, personId, aliasIds)) return null;
  const nextName = sliceName(displayName);
  let changed = false;
  const next = { ...row };

  if (matchesPersonRef(next.processedBy, personId, aliasIds) && nameDiffers(next.processedByName, nextName)) {
    next.processedByName = nextName;
    changed = true;
  }

  if (isPlainObject(next.priorPeriodReconciliation)) {
    const reconciliation = { ...next.priorPeriodReconciliation };
    reconciliation.makeupChains = (Array.isArray(reconciliation.makeupChains) ? reconciliation.makeupChains : []).map((chain) => {
      const nextChain = { ...chain };
      nextChain.nodes = (Array.isArray(chain?.nodes) ? chain.nodes : []).map((node) => {
        const deliveryIds = Array.isArray(node?.deliveryPersonIds) ? node.deliveryPersonIds : [];
        const matchesNode = deliveryIds.some((id) => matchesPersonRef(id, personId, aliasIds))
          || matchesPersonRef(node?.targetPersonId, personId, aliasIds);
        if (!matchesNode || !nameDiffers(node?.teacherName, nextName)) return node;
        changed = true;
        return { ...node, teacherName: nextName };
      });
      return nextChain;
    });
    next.priorPeriodReconciliation = reconciliation;
  }

  return changed ? next : null;
}

function patchBookCoveringTeacherName(row, { personId, displayName, aliasIds } = {}) {
  if (!matchesPersonRef(row?.teacherId, personId, aliasIds)) return null;
  const nextName = sliceName(displayName, 200);
  if (!nameDiffers(row?.teacherName, nextName)) return null;
  return { ...row, teacherName: nextName };
}

function patchStudentClbEvaluationLabels(row, { personId, displayName, aliasIds } = {}) {
  const nextName = sliceName(displayName, 200);
  let changed = false;
  const history = (Array.isArray(row?.clbLevelHistory) ? row.clbLevelHistory : []).map((entry) => {
    if (!matchesPersonRef(entry?.evaluationTeacherId, personId, aliasIds)) return entry;
    if (!nameDiffers(entry?.evaluationTeacherLabel, nextName)) return entry;
    changed = true;
    return { ...entry, evaluationTeacherLabel: nextName };
  });
  if (!changed) return null;
  return { ...row, clbLevelHistory: history };
}

async function runRepositoryNameSync({
  listFn,
  updateFn,
  patchFn,
  entityLabel,
  summaryKey,
  personId,
  displayName,
  aliasIds,
  activeOrgId,
  summary,
  errorDetails,
  dryRun = false
} = {}) {
  const rows = await listFn({ query: {}, scope: { canViewAll: true } });
  for (const row of Array.isArray(rows) ? rows : []) {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) continue;
    const patched = patchFn(row, { personId, displayName, aliasIds });
    if (!patched) continue;
    if (dryRun) {
      summary[summaryKey] += 1;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await updateFn(row.id, patched, { scope: { canViewAll: true } });
      summary[summaryKey] += 1;
    } catch (error) {
      recordSyncError(summary, errorDetails, entityLabel, row?.id, error);
      console.error(`personDenormalizedNameSyncService.${entityLabel} update failed:`, row?.id, error?.message || error);
    }
  }
}

async function syncTimesheetTeacherNames(ctx = {}) {
  await runRepositoryNameSync({
    listFn: schoolRepositories.timesheets.list.bind(schoolRepositories.timesheets),
    updateFn: schoolRepositories.timesheets.update.bind(schoolRepositories.timesheets),
    patchFn: patchTimesheetTeacherNames,
    entityLabel: 'timesheets',
    summaryKey: 'timesheets',
    ...ctx
  });
}

async function syncReportInstanceTeacherNames(ctx = {}) {
  await runRepositoryNameSync({
    listFn: schoolRepositories.reportInstances.list.bind(schoolRepositories.reportInstances),
    updateFn: schoolRepositories.reportInstances.update.bind(schoolRepositories.reportInstances),
    patchFn: patchReportInstanceTeacherSnapshots,
    entityLabel: 'reportInstances',
    summaryKey: 'reportInstances',
    ...ctx
  });
}

async function syncBookCoveringReportTeacherNames(ctx = {}) {
  await runRepositoryNameSync({
    listFn: schoolRepositories.bookCoveringReports.list.bind(schoolRepositories.bookCoveringReports),
    updateFn: schoolRepositories.bookCoveringReports.update.bind(schoolRepositories.bookCoveringReports),
    patchFn: patchBookCoveringTeacherName,
    entityLabel: 'bookCoveringReports',
    summaryKey: 'bookCoveringReports',
    ...ctx
  });
}

async function syncStudentClbEvaluationTeacherLabels(ctx = {}) {
  const orgFilter = ctx.activeOrgId ? { orgId__eq: ctx.activeOrgId } : {};
  let students;
  try {
    students = await schoolDataService.fetchData('students', orgFilter, ctx.reqUser);
  } catch (error) {
    recordSyncError(ctx.summary, ctx.errorDetails, 'students', '', error);
    return;
  }
  for (const row of Array.isArray(students) ? students : []) {
    const patched = patchStudentClbEvaluationLabels(row, ctx);
    if (!patched) continue;
    if (ctx.dryRun) {
      ctx.summary.studentsClbHistory += 1;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('students', row.id, patched, ctx.reqUser);
      ctx.summary.studentsClbHistory += 1;
    } catch (error) {
      recordSyncError(ctx.summary, ctx.errorDetails, 'students', row?.id, error);
      console.error('personDenormalizedNameSyncService.students clb update failed:', row?.id, error?.message || error);
    }
  }
}

async function syncPersonDisplayName({
  personId,
  displayName,
  activeOrgId,
  reqUser,
  includeHistorical = false,
  dryRun = false
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
    reqUser,
    includeHistorical,
    dryRun
  };

  const liveSteps = [
    ['classes', syncClassSessionAndInstructorNames],
    ['sessionStudentCases', () => syncSessionStudentCaseNames({ ...context, includeHistorical: false })],
    ['activities', syncActivityAssigneeNames],
    ['schoolAccounts', syncSchoolAccountNames],
    ['tasks', () => syncTaskPersonNames({ ...context, includeHistorical: false })],
    ['leaveRequests', () => syncLeaveRequestNames({ ...context, includeHistorical: false })]
  ];

  if (includeHistorical) {
    liveSteps[1] = ['sessionStudentCases', syncSessionStudentCaseNames];
    liveSteps[4] = ['tasks', syncTaskPersonNames];
    liveSteps[5] = ['leaveRequests', syncLeaveRequestNames];
  }

  const historicalSteps = includeHistorical ? [
    ['timesheets', syncTimesheetTeacherNames],
    ['reportInstances', syncReportInstanceTeacherNames],
    ['bookCoveringReports', syncBookCoveringReportTeacherNames],
    ['studentsClbHistory', syncStudentClbEvaluationTeacherLabels]
  ] : [];

  for (const [collection, synchronizer] of [...liveSteps, ...historicalSteps]) {
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
    includeHistorical: includeHistorical === true,
    updated: summary,
    errorDetails,
    partial: summary.errors > 0
  };
}

async function previewPersonDenormalizedNameSync({ personId, displayName, activeOrgId, reqUser, includeHistorical = true } = {}) {
  const person = await schoolPersonAccessService.getPersonById({ reqUser, personId: toPublicId(personId) });
  const normalizedName = sliceName(displayName || schoolPersonAccessService.formatPersonName(person, personId));
  const result = await syncPersonDisplayName({
    personId,
    displayName: normalizedName,
    activeOrgId,
    reqUser,
    includeHistorical: includeHistorical !== false,
    dryRun: true
  });
  return {
    personId: result.personId,
    displayName: result.displayName,
    includeHistorical: result.includeHistorical,
    mismatchCounts: result.updated
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

async function syncDenormalizedNamesForOrg({
  activeOrgId,
  reqUser,
  personId = '',
  linkType = '',
  includeHistorical = false
} = {}) {
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

  const runHistorical = includeHistorical === true && Boolean(targetPersonId);

  for (const id of personIds) {
    const person = personById.get(id);
    const displayName = schoolPersonAccessService.formatPersonName(person, id);
    // eslint-disable-next-line no-await-in-loop
    const result = await syncPersonDisplayName({
      personId: id,
      displayName,
      activeOrgId: orgId,
      reqUser,
      includeHistorical: runHistorical
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
  previewPersonDenormalizedNameSync,
  syncPersonDisplayNameForRoleUpdate,
  syncAllSchoolPeopleSavedNamesForOrg,
  syncDenormalizedNamesForOrg
};
