'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const sessionConductService = require('./sessionConductService');
const sessionConductReportLockService = require('./sessionConductReportLockService');
const conductRatingScaleService = require('./conductRatingScaleService');
const schoolDataService = require('./schoolDataService');

const CONDUCT_DIMENSIONS = Object.freeze([
  { key: 'classEffortPercent', label: 'Effort' },
  { key: 'classParticipationPercent', label: 'Participation' },
  { key: 'respectsTeachersPercent', label: 'Respects teachers' },
  { key: 'respectsStudentsPercent', label: 'Respects students' }
]);

function personKey(value) {
  return String(toPublicId(value) || value || '').trim();
}

function resolveSessionConductRequired(assignments, session, classId) {
  const sessionContext = {
    classId: String(classId || '').trim(),
    sessionId: String(session?.sessionId || session?.id || '').trim(),
    sessionDate: String(session?.date || '').trim()
  };
  const sessionMatchedAssignments = (Array.isArray(assignments) ? assignments : []).filter((assignment) => (
    reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)
  ));
  return sessionConductService.resolveSessionHasConductRequiredReports({
    instanceRows: [],
    sessionMatchedAssignments,
    sessionContext
  });
}

function rosterRowForPerson(session, personId) {
  const pid = personKey(personId);
  if (!pid) return null;
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  return roster.find((row) => personKey(row?.personId) === pid) || null;
}

function personOnSessionRoster(session, personId) {
  return Boolean(rosterRowForPerson(session, personId));
}

function buildCellFromRosterRow(rosterRow, conductPolicy) {
  if (!rosterRow || !sessionConductService.rosterRowHasRatedConduct(rosterRow)) {
    return null;
  }
  const percents = sessionConductService.extractConductPercents(rosterRow);
  const levels = {};
  const labels = {};
  CONDUCT_DIMENSIONS.forEach(({ key }) => {
    const pct = percents[key];
    const level = conductRatingScaleService.percentToLevel(pct, conductPolicy);
    levels[key] = level?.code || 'NA';
    labels[key] = level?.displayCode || level?.code || '—';
  });
  const summary = CONDUCT_DIMENSIONS.map(({ key }) => labels[key] || '—').join('/');
  return {
    percents,
    levels,
    labels,
    summary,
    conductSavedAt: rosterRow.conductSavedAt || null,
    conductLockedByReport: sessionConductReportLockService.isRosterConductLockedByReport(rosterRow)
  };
}

/**
 * @param {import('express').Request} req
 * @param {{ classId: string, startDate?: string, endDate?: string }} query
 * @param {object} matrixContext from loadGradesMatrixSharedContext
 * @param {object} conductPolicy resolved conduct rating scale policy
 */
async function buildConductMatrixPayload(req, query, matrixContext, conductPolicy) {
  const classId = String(query?.classId || '').trim();
  const {
    classData,
    filteredSessions,
    studentList,
    getApplicabilityForSession,
    isRollingClass
  } = matrixContext;

  const assignments = await schoolDataService.fetchAllData('reportAssignments', {}, req.user);

  const conductRequiredBySessionId = new Map();
  const reportConductTargetsBySessionId = new Map();

  const sessions = filteredSessions.map((session) => {
    const sessionId = String(session?.sessionId || session?.id || '').trim();
    const sessionContext = {
      classId: String(classId || '').trim(),
      sessionId,
      sessionDate: String(session?.date || '').trim()
    };
    const conductRequiredForReports = resolveSessionConductRequired(assignments, session, classId);
    conductRequiredBySessionId.set(sessionId, conductRequiredForReports);
    const sessionMatchedAssignments = (Array.isArray(assignments) ? assignments : []).filter((assignment) => (
      reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)
    ));
    const reportConductPersonIds = sessionConductService.resolveSessionReportConductPersonIds({
      assignments: sessionMatchedAssignments,
      sessionContext,
      sessionRoster: session?.roster
    });
    reportConductTargetsBySessionId.set(sessionId, new Set(reportConductPersonIds.map(personKey).filter(Boolean)));
    const conductReportStepEnabled = sessionConductService.parseConductReportStepEnabled(session);
    const hasSavedConduct = sessionConductService.sessionHasAnySavedConduct(session);
    return {
      sessionId,
      date: String(session?.date || '').trim(),
      startTime: String(session?.startTime || '').trim(),
      endTime: String(session?.endTime || '').trim(),
      label: [session?.date, session?.startTime].filter(Boolean).join(' '),
      conductRequiredForReports,
      conductReportStepEnabled,
      hasSavedConduct,
      columnShowByDefault: conductRequiredForReports || conductReportStepEnabled,
      conductReadyForReports: sessionConductService.isSessionConductReady(session),
      manageSessionHref: classId && sessionId
        ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`
        : ''
    };
  });

  const cells = {};
  studentList.forEach((stu) => {
    const pid = personKey(stu.personId);
    if (!pid) return;
    cells[pid] = {};
    filteredSessions.forEach((session) => {
      const sessionId = String(session?.sessionId || session?.id || '').trim();
      if (!sessionId) return;
      const conductRequiredForReports = conductRequiredBySessionId.get(sessionId) === true;
      const conductReportStepEnabled = sessionConductService.parseConductReportStepEnabled(session);
      const voluntaryConduct = conductReportStepEnabled && !conductRequiredForReports;
      const reportTargets = reportConductTargetsBySessionId.get(sessionId) || new Set();
      const reportGatedStudent = conductRequiredForReports && reportTargets.has(pid);
      if (isRollingClass) {
        const applicability = getApplicabilityForSession(stu, session);
        if (!applicability?.expected && !reportGatedStudent && !voluntaryConduct) {
          cells[pid][sessionId] = { onRoster: false, value: null };
          return;
        }
      }
      let onRoster = personOnSessionRoster(session, pid);
      if (!onRoster && reportGatedStudent) onRoster = true;
      if (!onRoster && voluntaryConduct) {
        if (isRollingClass) {
          onRoster = getApplicabilityForSession(stu, session)?.expected === true;
        } else {
          onRoster = true;
        }
      }
      if (!onRoster) {
        cells[pid][sessionId] = { onRoster: false, value: null };
        return;
      }
      const rosterRow = rosterRowForPerson(session, pid);
      const value = buildCellFromRosterRow(rosterRow, conductPolicy);
      cells[pid][sessionId] = { onRoster: true, value };
    });
  });

  let cellsWithValue = 0;
  let cellsOnRoster = 0;
  let cellsReportGated = 0;
  Object.values(cells).forEach((bySession) => {
    Object.values(bySession || {}).forEach((cell) => {
      if (cell?.onRoster) cellsOnRoster += 1;
      if (cell?.value?.summary) cellsWithValue += 1;
    });
  });
  studentList.forEach((stu) => {
    const pid = personKey(stu.personId);
    if (!pid) return;
    filteredSessions.forEach((session) => {
      const sessionId = String(session?.sessionId || session?.id || '').trim();
      if (!sessionId || conductRequiredBySessionId.get(sessionId) !== true) return;
      const reportTargets = reportConductTargetsBySessionId.get(sessionId) || new Set();
      if (reportTargets.has(pid) && cells[pid]?.[sessionId]?.onRoster) cellsReportGated += 1;
    });
  });
  const requiredSessionCount = sessions.filter((s) => s.conductRequiredForReports).length;

  return {
    registrationMode: isRollingClass ? 'rolling' : 'term_based',
    class: {
      id: classData?.id || classId,
      title: String(classData?.title || classId).trim()
    },
    sessions,
    students: studentList.map((row) => ({
      personId: row.personId,
      name: row.name,
      legalName: row.legalName || row.name,
      rosterNickname: row.rosterNickname || '',
      studentRecordId: row.studentRecordId || ''
    })),
    rosterNicknames: matrixContext?.rosterNicknames || {},
    cells,
    dimensions: CONDUCT_DIMENSIONS.map(({ key, label }) => ({ key, label })),
    conductPolicy: conductRatingScaleService.resolvePolicy(conductPolicy)
  };
}

module.exports = {
  CONDUCT_DIMENSIONS,
  buildConductMatrixPayload,
  buildCellFromRosterRow,
  resolveSessionConductRequired
};
