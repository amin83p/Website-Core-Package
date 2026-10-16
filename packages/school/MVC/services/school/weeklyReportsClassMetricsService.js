const bookCoveringReportService = require('./bookCoveringReportService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const reportViewService = require('./reportViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const FINALIZED_FALLBACK_CODES = new Set([
  'completed',
  'cancelled',
  'missed',
  'merged',
  'no_show',
  'absent_session'
]);

function cleanText(value) {
  return String(value || '').trim();
}

function dateInRange(dateValue, startDate, endDate) {
  const date = cleanText(dateValue);
  if (!date) return false;
  const start = cleanText(startDate);
  const end = cleanText(endDate);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function resolveSessionId(sessionRow = {}) {
  return toPublicId(sessionRow?.sessionId || sessionRow?.id) || '';
}

function resolveSessionStatusLabel(statusMap, sessionRow = {}) {
  const { normalized, definition } = sessionStatusPolicyService.resolveStatusDefinition
    ? sessionStatusPolicyService.resolveStatusDefinition(statusMap, {
      status: sessionRow?.status,
      notes: sessionRow?.notes
    })
    : { normalized: String(sessionRow?.status || '').trim().toLowerCase(), definition: null };
  if (definition?.label) return String(definition.label);
  return normalized || 'scheduled';
}

function isWeeklyReportFinalizedSession(statusMap, sessionRow = {}) {
  const { normalized, definition } = sessionStatusPolicyService.resolveStatusDefinition(statusMap, {
    status: sessionRow?.status,
    notes: sessionRow?.notes
  });
  if (definition) {
    if (definition.isFinal === true) return true;
    if (definition.makeUpRequired === true) return true;
    if (definition.mergedSessionRequired === true) return true;
    if (definition.excludeFromAttendance === true) return true;
  }
  return FINALIZED_FALLBACK_CODES.has(normalized);
}

function sessionHasSubmittedBookCoverage(classRow, sessionRow, orgBookRows = []) {
  return bookCoveringReportService.hasSubmittedBookReportForSession({
    classData: classRow,
    session: sessionRow,
    orgRows: orgBookRows
  });
}

function sessionHasNotes(sessionRow = {}) {
  return Boolean(cleanText(sessionRow?.notes));
}

function sessionHasGradebooks(sessionRow = {}) {
  return Array.isArray(sessionRow?.gradebooks) && sessionRow.gradebooks.length > 0;
}

function emptyAttendanceBucket() {
  return { count: 0, minutes: 0 };
}

function summarizeAttendanceFromMatrix(matrix = []) {
  const totals = {
    absence: emptyAttendanceBucket(),
    late: emptyAttendanceBucket(),
    early: emptyAttendanceBucket()
  };
  const perSessionIndex = new Map();

  const ensureSessionBucket = (index) => {
    if (!perSessionIndex.has(index)) {
      perSessionIndex.set(index, {
        absence: emptyAttendanceBucket(),
        late: emptyAttendanceBucket(),
        early: emptyAttendanceBucket()
      });
    }
    return perSessionIndex.get(index);
  };

  (Array.isArray(matrix) ? matrix : []).forEach((studentRow) => {
    (Array.isArray(studentRow?.records) ? studentRow.records : []).forEach((record, index) => {
      if (record?.expectedForSession !== true) return;
      const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
      const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
      const earlyLeaveMinutes = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
      const scheduledMinutes = Math.max(0, Number(record?.scheduledMinutes) || 0);
      const sessionBucket = ensureSessionBucket(index);

      if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) {
        totals.absence.count += 1;
        totals.absence.minutes += scheduledMinutes;
        sessionBucket.absence.count += 1;
        sessionBucket.absence.minutes += scheduledMinutes;
      }
      if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) {
        totals.late.count += 1;
        totals.late.minutes += lateMinutes;
        sessionBucket.late.count += 1;
        sessionBucket.late.minutes += lateMinutes;
      }
      if (earlyLeaveMinutes > 0) {
        totals.early.count += 1;
        totals.early.minutes += earlyLeaveMinutes;
        sessionBucket.early.count += 1;
        sessionBucket.early.minutes += earlyLeaveMinutes;
      }
    });
  });

  return { totals, perSessionIndex };
}

function formatAttendanceDrillDetail(bucket, labelSingular) {
  const count = Number(bucket?.count || 0);
  const minutes = Number(bucket?.minutes || 0);
  if (!count) return '';
  const noun = count === 1 ? labelSingular : `${labelSingular}s`;
  return `${count} ${noun} · ${minutes} min`;
}

function buildSessionListItem(classRow, sessionRow, statusMap, extra = {}) {
  const sessionId = resolveSessionId(sessionRow);
  return {
    sessionId,
    date: cleanText(sessionRow?.date),
    startTime: cleanText(sessionRow?.startTime) || '--:--',
    endTime: cleanText(sessionRow?.endTime) || '--:--',
    statusLabel: resolveSessionStatusLabel(statusMap, sessionRow),
    detail: cleanText(extra.detail),
    href: extra.href || (sessionId && classRow?.id
      ? `/school/classes/${encodeURIComponent(classRow.id)}/sessions/${encodeURIComponent(sessionId)}`
      : '')
  };
}

function countUnmarkedAttendanceCells(matrix = [], sessions = []) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  let unmarkedCount = 0;
  const unmarkedBySessionIndex = new Map();

  (Array.isArray(matrix) ? matrix : []).forEach((studentRow) => {
    const records = Array.isArray(studentRow?.records) ? studentRow.records : [];
    records.forEach((record, index) => {
      if (record?.expectedForSession !== true) return;
      if (!attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(record?.status)) return;
      unmarkedCount += 1;
      unmarkedBySessionIndex.set(index, (unmarkedBySessionIndex.get(index) || 0) + 1);
    });
  });

  const sessionsWithUnmarked = [];
  unmarkedBySessionIndex.forEach((count, index) => {
    const sessionMeta = sessionList[index] || {};
    sessionsWithUnmarked.push({
      index,
      unmarkedCount: count,
      sessionId: toPublicId(sessionMeta?.id || sessionMeta?.sessionId) || ''
    });
  });

  return { unmarkedCount, sessionsWithUnmarked };
}

function indexCasesByClass(caseRows = [], sessionIdSet = new Set()) {
  const byClass = new Map();
  (Array.isArray(caseRows) ? caseRows : []).forEach((row) => {
    const classId = toPublicId(row?.classId);
    const sessionId = toPublicId(row?.sessionId);
    if (!classId || !sessionId || !sessionIdSet.has(sessionId)) return;
    if (!byClass.has(classId)) byClass.set(classId, []);
    byClass.get(classId).push(row);
  });
  return byClass;
}

function summarizeReportInstancesForClass({
  classId,
  startDate = '',
  endDate = '',
  assignments = [],
  instances = []
} = {}) {
  const classToken = toPublicId(classId);
  const matchingAssignmentKeys = new Set();

  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    const assignmentId = toPublicId(assignment?.id);
    if (!assignmentId) return;
    const targetRows = reportViewService.getEffectiveAssignmentRows(assignment);
    targetRows.forEach((targetRow) => {
      const rowClassId = toPublicId(targetRow?.classId || assignment?.classId);
      if (!idsEqual(rowClassId, classToken)) return;
      const sessionDate = cleanText(targetRow?.sessionDate || targetRow?.dueDate || assignment?.sessionDate || assignment?.dueDate);
      if (!dateInRange(sessionDate, startDate, endDate)) return;
      const rowId = cleanText(targetRow?.rowId || targetRow?.id || '');
      matchingAssignmentKeys.add(`${assignmentId}::${rowId}`);
      matchingAssignmentKeys.add(assignmentId);
    });
  });

  let assigned = 0;
  let completed = 0;
  let incomplete = 0;

  (Array.isArray(instances) ? instances : []).forEach((instance) => {
    const assignmentId = toPublicId(instance?.assignmentId);
    if (!assignmentId) return;
    const rowId = cleanText(instance?.assignmentRowId || '');
    const key = rowId ? `${assignmentId}::${rowId}` : assignmentId;
    if (!matchingAssignmentKeys.has(key) && !matchingAssignmentKeys.has(assignmentId)) return;

    const instanceClassId = toPublicId(instance?.classId);
    if (instanceClassId && !idsEqual(instanceClassId, classToken)) return;
    const sessionDate = cleanText(instance?.sessionDate);
    if (sessionDate && !dateInRange(sessionDate, startDate, endDate)) return;

    const status = cleanText(instance?.status).toLowerCase();
    if (status === 'archived') return;

    assigned += 1;
    if (status === 'submitted' || status === 'locked') {
      completed += 1;
    } else {
      incomplete += 1;
    }
  });

  return { assigned, completed, incomplete };
}

function buildEmptyOperationalMetrics() {
  return {
    sessions: { total: 0, finalized: 0, uncompleted: 0 },
    bookCoverage: { with: 0, without: 0 },
    gradebooks: { with: 0, without: 0 },
    notes: { with: 0, without: 0 },
    reports: { assigned: 0, completed: 0, incomplete: 0 },
    studentCases: { total: 0 },
    attendance: {
      absence: emptyAttendanceBucket(),
      late: emptyAttendanceBucket(),
      early: emptyAttendanceBucket(),
      unmarked: 0
    }
  };
}

function buildClassWeeklyMetrics({
  classRow = {},
  filteredSessions = [],
  matrixPayload = {},
  statusMap = new Map(),
  orgCaches = {},
  startDate = '',
  endDate = ''
} = {}) {
  const sessions = Array.isArray(filteredSessions) ? filteredSessions : [];
  const matrix = Array.isArray(matrixPayload?.matrix) ? matrixPayload.matrix : [];
  const orgBookRows = Array.isArray(orgCaches.bookCoveringReports) ? orgCaches.bookCoveringReports : [];
  const classId = toPublicId(classRow?.id);

  let finalized = 0;
  let bookWith = 0;
  let bookWithout = 0;
  let gradebooksWith = 0;
  let gradebooksWithout = 0;
  let notesWith = 0;
  let notesWithout = 0;

  sessions.forEach((sessionRow) => {
    if (isWeeklyReportFinalizedSession(statusMap, sessionRow)) finalized += 1;
    if (sessionHasSubmittedBookCoverage(classRow, sessionRow, orgBookRows)) {
      bookWith += 1;
    } else {
      bookWithout += 1;
    }
    if (sessionHasGradebooks(sessionRow)) gradebooksWith += 1;
    else gradebooksWithout += 1;
    if (sessionHasNotes(sessionRow)) notesWith += 1;
    else notesWithout += 1;
  });

  const sessionIdSet = new Set(sessions.map((row) => resolveSessionId(row)).filter(Boolean));
  const casesByClass = indexCasesByClass(orgCaches.sessionStudentCases, sessionIdSet);
  const classCases = classId && casesByClass.has(classId) ? casesByClass.get(classId) : [];

  const reports = summarizeReportInstancesForClass({
    classId,
    startDate,
    endDate,
    assignments: orgCaches.reportAssignments,
    instances: orgCaches.reportInstances
  });

  const unmarkedAttendance = countUnmarkedAttendanceCells(matrix, sessions);
  const attendanceSummary = summarizeAttendanceFromMatrix(matrix);

  return {
    metrics: {
      sessions: {
        total: sessions.length,
        finalized,
        uncompleted: Math.max(0, sessions.length - finalized)
      },
      bookCoverage: { with: bookWith, without: bookWithout },
      gradebooks: { with: gradebooksWith, without: gradebooksWithout },
      notes: { with: notesWith, without: notesWithout },
      reports,
      studentCases: { total: classCases.length },
      attendance: {
        absence: attendanceSummary.totals.absence,
        late: attendanceSummary.totals.late,
        early: attendanceSummary.totals.early,
        unmarked: unmarkedAttendance.unmarkedCount
      }
    },
    _internal: {
      sessions,
      matrix,
      classCases,
      attendanceSessions: unmarkedAttendance.sessionsWithUnmarked,
      attendanceBySessionIndex: attendanceSummary.perSessionIndex,
      statusMap
    }
  };
}

const DRILL_TITLES = {
  sessionsTotal: 'All sessions in period',
  sessionsFinalized: 'Finalized sessions',
  sessionsUncompleted: 'Uncompleted sessions',
  bookCoverageWith: 'Sessions with submitted book coverage',
  bookCoverageWithout: 'Sessions without submitted book coverage',
  notesWith: 'Sessions with notes',
  notesWithout: 'Sessions without notes',
  reportInstancesAssigned: 'Assigned student reports',
  reportInstancesCompleted: 'Completed student reports',
  reportInstancesIncomplete: 'Incomplete student reports',
  studentCases: 'Student cases',
  attendanceUnmarked: 'Sessions with unmarked attendance',
  gradebooksWith: 'Sessions with gradebooks',
  gradebooksWithout: 'Sessions without gradebooks',
  attendanceAbsence: 'Sessions with absences',
  attendanceLate: 'Sessions with late arrivals',
  attendanceEarly: 'Sessions with early leave'
};

function buildWeeklyReportsDrilldown({
  metricKey = '',
  classRow = {},
  filteredSessions = [],
  matrixPayload = {},
  statusMap = new Map(),
  orgCaches = {},
  startDate = '',
  endDate = ''
} = {}) {
  const key = cleanText(metricKey);
  const built = buildClassWeeklyMetrics({
    classRow,
    filteredSessions,
    matrixPayload,
    statusMap,
    orgCaches,
    startDate,
    endDate
  });
  const sessions = built._internal.sessions;
  const title = DRILL_TITLES[key] || 'Details';
  const rows = [];

  if (key === 'sessionsTotal') {
    sessions.forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap)));
  } else if (key === 'sessionsFinalized') {
    sessions.filter((row) => isWeeklyReportFinalizedSession(statusMap, row))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap)));
  } else if (key === 'sessionsUncompleted') {
    sessions.filter((row) => !isWeeklyReportFinalizedSession(statusMap, row))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap)));
  } else if (key === 'bookCoverageWith') {
    const orgBookRows = orgCaches.bookCoveringReports || [];
    sessions.filter((row) => sessionHasSubmittedBookCoverage(classRow, row, orgBookRows))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap, { detail: 'Submitted book coverage' })));
  } else if (key === 'bookCoverageWithout') {
    const orgBookRows = orgCaches.bookCoveringReports || [];
    sessions.filter((row) => !sessionHasSubmittedBookCoverage(classRow, row, orgBookRows))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap, { detail: 'No submitted book coverage' })));
  } else if (key === 'gradebooksWith') {
    sessions.filter(sessionHasGradebooks)
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap, { detail: 'Has gradebook entries' })));
  } else if (key === 'gradebooksWithout') {
    sessions.filter((row) => !sessionHasGradebooks(row))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap, { detail: 'No gradebook entries' })));
  } else if (key === 'notesWith') {
    sessions.filter(sessionHasNotes)
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap)));
  } else if (key === 'notesWithout') {
    sessions.filter((row) => !sessionHasNotes(row))
      .forEach((sessionRow) => rows.push(buildSessionListItem(classRow, sessionRow, statusMap)));
  } else if (key === 'attendanceUnmarked') {
    const unmarkedByIndex = new Map(
      (built._internal.attendanceSessions || []).map((row) => [row.index, row.unmarkedCount])
    );
    sessions.forEach((sessionRow, index) => {
      const count = unmarkedByIndex.get(index) || 0;
      if (!count) return;
      rows.push(buildSessionListItem(classRow, sessionRow, statusMap, {
        detail: `${count} unmarked student(s)`
      }));
    });
  } else if (key === 'attendanceAbsence' || key === 'attendanceLate' || key === 'attendanceEarly') {
    const bucketKey = key === 'attendanceAbsence' ? 'absence' : (key === 'attendanceLate' ? 'late' : 'early');
    const labelSingular = bucketKey === 'absence' ? 'absence' : (bucketKey === 'late' ? 'late arrival' : 'early leave');
    const byIndex = built._internal.attendanceBySessionIndex || new Map();
    sessions.forEach((sessionRow, index) => {
      const bucket = byIndex.get(index)?.[bucketKey] || emptyAttendanceBucket();
      if (!bucket.count) return;
      rows.push(buildSessionListItem(classRow, sessionRow, statusMap, {
        detail: formatAttendanceDrillDetail(bucket, labelSingular)
      }));
    });
  } else if (key === 'studentCases') {
    const sessionById = new Map(sessions.map((row) => [resolveSessionId(row), row]));
    (built._internal.classCases || []).forEach((caseRow) => {
      const sessionRow = sessionById.get(toPublicId(caseRow?.sessionId)) || {};
      rows.push({
        sessionId: toPublicId(caseRow?.sessionId),
        date: cleanText(sessionRow?.date || caseRow?.sessionDate),
        startTime: cleanText(sessionRow?.startTime) || '--:--',
        endTime: cleanText(sessionRow?.endTime) || '--:--',
        statusLabel: cleanText(caseRow?.status || caseRow?.severity || 'Case'),
        detail: cleanText(caseRow?.summary || caseRow?.category || caseRow?.title),
        href: ''
      });
    });
  } else if (key === 'reportInstancesAssigned' || key === 'reportInstancesCompleted' || key === 'reportInstancesIncomplete') {
    const classToken = toPublicId(classRow?.id);
    const matchingAssignmentIds = new Set();
    (Array.isArray(orgCaches.reportAssignments) ? orgCaches.reportAssignments : []).forEach((assignment) => {
      const assignmentId = toPublicId(assignment?.id);
      reportViewService.getEffectiveAssignmentRows(assignment).forEach((targetRow) => {
        const rowClassId = toPublicId(targetRow?.classId || assignment?.classId);
        if (!idsEqual(rowClassId, classToken)) return;
        const sessionDate = cleanText(targetRow?.sessionDate || targetRow?.dueDate || assignment?.sessionDate);
        if (!dateInRange(sessionDate, startDate, endDate)) return;
        if (assignmentId) matchingAssignmentIds.add(assignmentId);
      });
    });

    (Array.isArray(orgCaches.reportInstances) ? orgCaches.reportInstances : []).forEach((instance) => {
      const assignmentId = toPublicId(instance?.assignmentId);
      if (!assignmentId || !matchingAssignmentIds.has(assignmentId)) return;
      const status = cleanText(instance?.status).toLowerCase();
      if (status === 'archived') return;
      const isCompleted = status === 'submitted' || status === 'locked';
      const isIncomplete = !isCompleted;
      if (key === 'reportInstancesCompleted' && !isCompleted) return;
      if (key === 'reportInstancesIncomplete' && !isIncomplete) return;

      rows.push({
        sessionId: '',
        date: cleanText(instance?.sessionDate),
        startTime: '--:--',
        endTime: '--:--',
        statusLabel: status || 'draft',
        detail: cleanText(instance?.studentName || instance?.studentId || instance?.id),
        href: instance?.id ? `/school/reports/instances/edit/${encodeURIComponent(instance.id)}` : ''
      });
    });
  }

  rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  return {
    title,
    metricKey: key,
    columns: ['Date', 'Time', 'Status', 'Detail'],
    rows
  };
}

async function loadWeeklyReportsOrgCaches(reqUser, activeOrgId = '') {
  const orgId = cleanText(activeOrgId || reqUser?.activeOrgId);
  const schoolDataService = require('./schoolDataService');
  const [bookCoveringReports, reportAssignments, reportInstances, sessionStudentCases] = await Promise.all([
    schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser).catch(() => []),
    schoolDataService.fetchAllData('reportAssignments', {}, reqUser).catch(() => []),
    schoolDataService.fetchAllData('reportInstances', {}, reqUser).catch(() => []),
    schoolDataService.fetchAllData('sessionStudentCases', {}, reqUser).catch(() => [])
  ]);

  const scoped = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!orgId) return true;
    const rowOrg = cleanText(row?.orgId || row?.organizationId);
    return !rowOrg || idsEqual(rowOrg, orgId);
  });

  return {
    bookCoveringReports: scoped(bookCoveringReports),
    reportAssignments: scoped(reportAssignments),
    reportInstances: scoped(reportInstances),
    sessionStudentCases: scoped(sessionStudentCases)
  };
}

module.exports = {
  isWeeklyReportFinalizedSession,
  sessionHasSubmittedBookCoverage,
  sessionHasNotes,
  sessionHasGradebooks,
  summarizeAttendanceFromMatrix,
  countUnmarkedAttendanceCells,
  summarizeReportInstancesForClass,
  indexCasesByClass,
  buildEmptyOperationalMetrics,
  buildClassWeeklyMetrics,
  buildWeeklyReportsDrilldown,
  loadWeeklyReportsOrgCaches,
  dateInRange,
  buildSessionListItem
};
