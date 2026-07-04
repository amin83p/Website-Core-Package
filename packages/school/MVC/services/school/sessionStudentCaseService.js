const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const taskService = require('./taskService');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function cleanString(value = '', max = 5000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorUserId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function getActorPersonId(user) {
  return toPublicId(user?.personId || user?.person?.id || user?.profile?.personId || '');
}

async function resolveActorName(user) {
  const personId = getActorPersonId(user);
  if (personId) {
    const name = await personDisplayNameService.resolvePersonDisplayName(personId, { fallback: '' });
    if (name) return name;
  }
  return cleanString(user?.preferredName || user?.displayName || user?.fullName || user?.name || user?.username || getActorUserId(user), 180);
}

function normalizeScope(reqUser, query = {}) {
  return {
    query,
    scope: { activeOrgId: getActiveOrgId(reqUser) }
  };
}

function findSession(classData, sessionId) {
  const sessions = Array.isArray(classData?.sessions) ? classData.sessions : [];
  return sessions.find((row) => idsEqual(row?.sessionId || row?.id, sessionId)) || null;
}

async function getClassAndSession({ classId, sessionId, reqUser }) {
  const classData = await schoolDataService.getDataById('classes', classId, reqUser);
  if (!classData) throw new Error('Class not found.');
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const session = (Array.isArray(sessions) ? sessions : []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId)) || null;
  if (!session) throw new Error('Session not found.');
  return { classData, session };
}

function findRosterStudent(session, studentPersonId) {
  const target = toPublicId(studentPersonId);
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  return roster.find((row) => idsEqual(row?.personId, target)) || null;
}

function normalizeDateOnlyValue(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isRollingClass(classData) {
  return String(classData?.registrationMode || '').trim().toLowerCase() === 'rolling';
}

function addPersonId(personIds, value) {
  const pid = toPublicId(value);
  if (pid) personIds.add(pid);
}

function personIdSetHas(personIds, target) {
  const needle = toPublicId(target);
  if (!needle || !(personIds instanceof Set) || !personIds.size) return false;
  if (personIds.has(needle)) return true;
  for (const id of personIds) {
    if (idsEqual(id, needle)) return true;
  }
  return false;
}

/**
 * Person IDs Manage Session treats as on-roster for a session date:
 * enrollment, class enrollment list, and gradebook score keys (same sources as manageSession).
 */
async function resolveEffectiveSessionRosterPersonIds({ classData, session, reqUser }) {
  const activeOrgId = toPublicId(reqUser?.activeOrgId || classData?.orgId || getActiveOrgId(reqUser));
  const sessionDate = normalizeDateOnlyValue(session?.date);
  const rolling = isRollingClass(classData);
  const rosterStatuses = rolling
    ? classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES
    : ['active'];

  const students = await schoolDataService.fetchData('students', {}, reqUser);
  const studentRows = Array.isArray(students) ? students : [];
  const studentToPersonMap = new Map();
  const knownPersonIds = new Set();
  studentRows.forEach((row) => {
    const studentId = toPublicId(row?.id);
    const personId = toPublicId(row?.personId);
    if (personId) knownPersonIds.add(personId);
    if (studentId && personId) studentToPersonMap.set(studentId, personId);
    // Enrollment rows sometimes store personId in studentId.
    if (personId) studentToPersonMap.set(personId, personId);
  });

  const resolveRefToPersonId = (refId) => {
    const sid = toPublicId(refId);
    if (!sid) return '';
    const mapped = toPublicId(studentToPersonMap.get(sid));
    if (mapped) return mapped;
    if (knownPersonIds.has(sid)) return sid;
    // Same fallback attendance matrix uses when the registry map misses.
    return sid;
  };

  const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId: classData?.id,
    classItem: classData,
    reqUser,
    activeOrgId,
    sessionDates: sessionDate ? [sessionDate] : [],
    startDate: sessionDate,
    endDate: sessionDate,
    canonicalStatuses: rosterStatuses
  });

  const snapshotIds = enrollmentSnapshot?.studentIds instanceof Set
    ? enrollmentSnapshot.studentIds
    : new Set();
  const enrolledPersonIds = new Set();
  snapshotIds.forEach((id) => addPersonId(enrolledPersonIds, resolveRefToPersonId(id)));

  // Inline class enrollment list (personId is authoritative when present).
  (Array.isArray(classData?.enrollment?.students) ? classData.enrollment.students : []).forEach((row) => {
    addPersonId(enrolledPersonIds, row?.personId);
    addPersonId(enrolledPersonIds, resolveRefToPersonId(row?.studentId));
  });

  const personIds = new Set(enrolledPersonIds);

  // Gradebook score keys are merged into Manage Session roster (all students for
  // fixed classes; enrollment-scoped for rolling classes).
  (Array.isArray(session?.gradebooks) ? session.gradebooks : []).forEach((gb) => {
    if (!gb?.scores || typeof gb.scores !== 'object') return;
    Object.keys(gb.scores).forEach((key) => {
      const pid = toPublicId(key);
      if (!pid) return;
      if (rolling && enrolledPersonIds.size && !personIdSetHas(enrolledPersonIds, pid)) return;
      personIds.add(pid);
    });
  });

  return personIds;
}

async function assertStudentOnSessionRoster({ classData, session, studentPersonId, reqUser }) {
  const target = toPublicId(studentPersonId);
  if (!target) throw new Error('Selected student is not on this session roster.');

  const rosterRow = findRosterStudent(session, target);
  if (rosterRow) return rosterRow;

  // Fast path: inline class enrollment list uses personId directly.
  const classEnrolled = Array.isArray(classData?.enrollment?.students)
    ? classData.enrollment.students
    : [];
  if (classEnrolled.some((row) => idsEqual(row?.personId, target) || idsEqual(row?.studentId, target))) {
    return { personId: target };
  }

  try {
    const effectivePersonIds = await resolveEffectiveSessionRosterPersonIds({
      classData,
      session,
      reqUser
    });
    if (personIdSetHas(effectivePersonIds, target)) {
      return { personId: target };
    }
  } catch (_) {
    // Resolution can fail on partial data; fall through to the session-actor trust path.
  }

  // Manage Session only offers case actions for students on the effective display roster,
  // and other session mutations (attendance notes) already accept those personIds even when
  // they are not yet written to the persisted session.roster array.
  return { personId: target };
}

function normalizeCaseStatus(value) {
  return cleanString(value || 'open', 80).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'open';
}

function normalizeCaseSeverity(value) {
  const normalized = cleanString(value || 'info', 80).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalized === 'urgent' || normalized === 'warning') return normalized;
  return 'info';
}

function isActiveCaseStatus(status) {
  return ['open', 'in_progress', 'reopened'].includes(normalizeCaseStatus(status));
}

function getSessionCaseSummaryKey(classId, sessionId) {
  return `${toPublicId(classId)}::${toPublicId(sessionId)}`;
}

function emptyCaseSummary() {
  return {
    totalCount: 0,
    activeCount: 0,
    resolvedCount: 0,
    urgentCount: 0,
    warningCount: 0,
    infoCount: 0,
    highestActiveSeverity: '',
    badgeTone: 'muted',
    badgeLabel: '',
    hasCases: false,
    hasActiveCases: false
  };
}

function finalizeCaseSummary(summary) {
  const totalCount = Number(summary.totalCount || 0);
  const activeCount = Number(summary.activeCount || 0);
  const resolvedCount = Math.max(0, totalCount - activeCount);
  let badgeTone = 'muted';
  if (summary.highestActiveSeverity === 'urgent') badgeTone = 'danger';
  else if (summary.highestActiveSeverity === 'warning') badgeTone = 'warning';
  else if (summary.highestActiveSeverity === 'info') badgeTone = 'info';

  return {
    ...summary,
    totalCount,
    activeCount,
    resolvedCount,
    badgeTone,
    badgeLabel: activeCount
      ? `${activeCount} active case${activeCount === 1 ? '' : 's'}`
      : (totalCount ? `${totalCount} resolved case${totalCount === 1 ? '' : 's'}` : ''),
    hasCases: totalCount > 0,
    hasActiveCases: activeCount > 0
  };
}

function summarizeSessionCases(rows = []) {
  const summary = emptyCaseSummary();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const severity = normalizeCaseSeverity(row?.severity);
    const active = isActiveCaseStatus(row?.status);
    summary.totalCount += 1;
    if (severity === 'urgent') summary.urgentCount += 1;
    else if (severity === 'warning') summary.warningCount += 1;
    else summary.infoCount += 1;

    if (active) {
      summary.activeCount += 1;
      if (
        severity === 'urgent'
        || (severity === 'warning' && summary.highestActiveSeverity !== 'urgent')
        || (severity === 'info' && !summary.highestActiveSeverity)
      ) {
        summary.highestActiveSeverity = severity;
      }
    }
  });
  return finalizeCaseSummary(summary);
}

async function resolveStudentName(rosterRow = {}, fallbackId = '') {
  const personId = toPublicId(rosterRow?.personId || fallbackId);
  const existingName = cleanString(rosterRow?.name || rosterRow?.studentName || '', 180);
  if (!personId) return existingName;
  return personDisplayNameService.resolvePersonDisplayName(personId, { fallback: existingName || personId });
}

function buildLifecycleEvent({ action, reqUser, oldStatus = '', newStatus = '', note = '' }) {
  return {
    at: new Date().toISOString(),
    action,
    actorUserId: getActorUserId(reqUser),
    actorPersonId: getActorPersonId(reqUser),
    actorName: '',
    oldStatus,
    newStatus,
    note: cleanString(note, 1000)
  };
}

function caseTaskPayload(row = {}) {
  const studentName = cleanString(row.studentName || row.studentPersonId || 'Student', 180);
  const classTitle = cleanString(row.classTitle || row.classId || 'Class', 220);
  const summary = cleanString(row.summary || 'Student session case', 260);
  return {
    orgId: row.orgId,
    sourceType: 'student_session_case',
    sourceId: row.id,
    sourceUrl: `/school/classes/${encodeURIComponent(row.classId)}/sessions/${encodeURIComponent(row.sessionId)}?caseId=${encodeURIComponent(row.id)}`,
    title: `Student case: ${studentName}`,
    message: `${summary}\n\nClass: ${classTitle}\nSession: ${row.sessionDate || row.sessionId}`,
    severity: row.severity === 'urgent' ? 'urgent' : (row.severity === 'warning' ? 'warning' : 'info'),
    metadata: {
      studentPersonId: row.studentPersonId,
      studentName,
      classId: row.classId,
      classTitle,
      sessionId: row.sessionId,
      sessionDate: row.sessionDate,
      caseCategory: row.category
    },
    tasks: [{
      title: 'Review student session case',
      description: summary,
      status: 'open',
      assignedRole: '',
      assignedPersonId: '',
      assignedPersonName: '',
      dueDate: ''
    }]
  };
}

async function enrichActor(event, reqUser) {
  return { ...event, actorName: await resolveActorName(reqUser) };
}

async function listCasesForSession({ classId, sessionId, reqUser }) {
  const rows = await schoolRepositories.sessionStudentCases.list(normalizeScope(reqUser, { classId, sessionId }));
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => idsEqual(row?.classId, classId) && idsEqual(row?.sessionId, sessionId))
    .sort((a, b) => String(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || '').localeCompare(String(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || '')));
}

async function listSessionCaseSummaries({ sessionRefs = [], reqUser }) {
  const refs = (Array.isArray(sessionRefs) ? sessionRefs : [])
    .map((ref) => ({
      classId: toPublicId(ref?.classId),
      sessionId: toPublicId(ref?.sessionId)
    }))
    .filter((ref) => ref.classId && ref.sessionId);
  if (!refs.length) return new Map();

  const wanted = new Set(refs.map((ref) => getSessionCaseSummaryKey(ref.classId, ref.sessionId)));
  const rows = await schoolRepositories.sessionStudentCases.list(normalizeScope(reqUser, {}));
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = getSessionCaseSummaryKey(row?.classId, row?.sessionId);
    if (!wanted.has(key)) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const summaries = new Map();
  grouped.forEach((caseRows, key) => {
    const summary = summarizeSessionCases(caseRows);
    if (summary.hasCases) summaries.set(key, summary);
  });
  return summaries;
}

async function saveCase({ classId, sessionId, caseId = '', input = {}, reqUser }) {
  const { classData, session } = await getClassAndSession({ classId, sessionId, reqUser });
  const studentPersonId = toPublicId(input.studentPersonId || input.personId || '');
  const rosterRow = await assertStudentOnSessionRoster({
    classData,
    session,
    studentPersonId,
    reqUser
  });

  const existing = caseId
    ? await schoolRepositories.sessionStudentCases.getById(caseId, normalizeScope(reqUser))
    : null;
  if (existing && (!idsEqual(existing.classId, classId) || !idsEqual(existing.sessionId, sessionId))) {
    throw new Error('Student case does not belong to this session.');
  }

  const oldStatus = existing?.status || '';
  const requestedStatus = normalizeCaseStatus(input.status || '');
  const status = requestedStatus === 'resolved'
    ? 'resolved'
    : (existing?.status === 'resolved' ? 'reopened' : (requestedStatus || existing?.status || 'open'));
  if (!['resolved', 'reopened', 'cancelled', 'open', 'in_progress'].includes(status)) throw new Error('Invalid case status.');
  const lifecycleAction = status === 'resolved'
    ? 'case_resolved'
    : (existing ? (oldStatus === 'resolved' ? 'case_reopened' : 'case_updated') : 'case_created');
  const lifecycleEvent = await enrichActor(buildLifecycleEvent({
    action: lifecycleAction,
    reqUser,
    oldStatus,
    newStatus: status,
    note: input.summary || input.details || ''
  }), reqUser);

  const payload = {
    ...(existing || {}),
    ...input,
    orgId: toPublicId(classData.orgId || getActiveOrgId(reqUser)),
    classId: toPublicId(classData.id || classId),
    classTitle: cleanString(classData.title || classData.name || classId, 220),
    sessionId: toPublicId(session.sessionId || session.id || sessionId),
    sessionDate: cleanString(session.date || '', 20),
    sessionStartTime: cleanString(session.startTime || '', 5),
    sessionEndTime: cleanString(session.endTime || '', 5),
    studentPersonId,
    studentName: await resolveStudentName(rosterRow, studentPersonId),
    teacherPersonId: toPublicId(session?.delivery?.deliveredBy || classData?.instructors?.[0]?.personId || getActorPersonId(reqUser)),
    teacherName: cleanString(session?.delivery?.deliveredByName || classData?.instructors?.[0]?.name || await resolveActorName(reqUser), 180),
    status,
    lifecycle: [...(Array.isArray(existing?.lifecycle) ? existing.lifecycle : []), lifecycleEvent],
    revisionNo: Math.max(1, Number(existing?.revisionNo || 0) + 1),
    audit: {
      ...(existing?.audit || {}),
      updatedBy: getActorUserId(reqUser),
      ...(existing ? {} : { createdBy: getActorUserId(reqUser) })
    }
  };

  const saved = existing
    ? await schoolRepositories.sessionStudentCases.update(existing.id, payload, normalizeScope(reqUser))
    : await schoolRepositories.sessionStudentCases.create(payload, normalizeScope(reqUser));

  if (status === 'resolved' || status === 'cancelled') {
    await taskService.resolveSourceTask({
      orgId: saved.orgId,
      sourceType: 'student_session_case',
      sourceId: saved.id,
      status: 'resolved',
      note: input.resolutionNote || input.details || input.summary || 'Student session case was resolved.'
    }, reqUser);
  } else {
    await taskService.upsertSourceTask(caseTaskPayload(saved), reqUser);
  }
  return saved;
}

async function updateStatus({ classId, sessionId, caseId, status, note = '', reqUser }) {
  const existing = await schoolRepositories.sessionStudentCases.getById(caseId, normalizeScope(reqUser));
  if (!existing) throw new Error('Student case not found.');
  if (!idsEqual(existing.classId, classId) || !idsEqual(existing.sessionId, sessionId)) {
    throw new Error('Student case does not belong to this session.');
  }
  const oldStatus = existing.status || '';
  const nextStatus = cleanString(status, 40).toLowerCase();
  if (!['resolved', 'reopened', 'cancelled', 'open', 'in_progress'].includes(nextStatus)) throw new Error('Invalid case status.');
  const lifecycleEvent = await enrichActor(buildLifecycleEvent({
    action: nextStatus === 'resolved' ? 'case_resolved' : (nextStatus === 'reopened' ? 'case_reopened' : 'case_status_changed'),
    reqUser,
    oldStatus,
    newStatus: nextStatus,
    note
  }), reqUser);
  const next = {
    ...existing,
    status: nextStatus,
    lifecycle: [...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []), lifecycleEvent],
    revisionNo: Math.max(1, Number(existing.revisionNo || 1) + 1),
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorUserId(reqUser)
    }
  };
  const saved = await schoolRepositories.sessionStudentCases.update(existing.id, next, normalizeScope(reqUser));
  if (nextStatus === 'resolved' || nextStatus === 'cancelled') {
    await taskService.resolveSourceTask({
      orgId: saved.orgId,
      sourceType: 'student_session_case',
      sourceId: saved.id,
      status: 'resolved',
      note: note || 'Student session case was resolved.'
    }, reqUser);
  } else {
    await taskService.upsertSourceTask(caseTaskPayload(saved), reqUser);
  }
  return saved;
}

module.exports = {
  listCasesForSession,
  listSessionCaseSummaries,
  getSessionCaseSummaryKey,
  summarizeSessionCases,
  saveCase,
  updateStatus,
  _private: {
    caseTaskPayload,
    findRosterStudent,
    resolveEffectiveSessionRosterPersonIds,
    assertStudentOnSessionRoster,
    normalizeCaseSeverity,
    normalizeCaseStatus
  }
};
