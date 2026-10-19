const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const activityService = require('./activityService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const weeklyReportsClassMetricsService = require('./weeklyReportsClassMetricsService');

function getWeeklyReportsEngagementService() {
  return require('./weeklyReportsEngagementService');
}
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
const { buildGradesMatrixPayload } = require('../../controllers/school/gradesMatrixController');
const { requireCoreModule } = require('./schoolCoreContracts');
const dataService = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function buildWeeklyReportsOrgNameMap(organizations = []) {
  const orgNameMap = new Map();
  (Array.isArray(organizations) ? organizations : []).forEach((org) => {
    const id = toPublicId(org?.id);
    if (!id) return;
    const label = String(org?.identity?.displayName || org?.name || '').trim();
    orgNameMap.set(id, label || `Unknown Org (#${id})`);
  });
  return orgNameMap;
}

function resolveWeeklyReportsOrgName(orgId = '', orgNameMap = new Map()) {
  const normalizedOrgId = toPublicId(orgId) || '';
  if (!normalizedOrgId) return '';
  if (orgNameMap.has(normalizedOrgId)) return orgNameMap.get(normalizedOrgId);
  return `Unknown Org (#${normalizedOrgId})`;
}

function parseFilterIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toPublicId(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => toPublicId(item.trim()))
    .filter(Boolean);
}

function isActiveAttendanceClass(row = {}) {
  const status = String(row?.status || '').trim().toLowerCase();
  return status === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function roundOneDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function filterSessionsForWeeklyReport({
  sessions = [],
  statusMap = {},
  startDate = '',
  endDate = ''
} = {}) {
  const filtered = [];
  (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(statusMap, {
      status: sessionRow?.status,
      notes: sessionRow?.notes
    })) return;
    const date = String(sessionRow?.date || '').trim();
    if (startDate && date && date < startDate) return;
    if (endDate && date && date > endDate) return;
    filtered.push(sessionRow);
  });
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  return filtered;
}

function countGradebooksInSessions(filteredSessions = []) {
  return (Array.isArray(filteredSessions) ? filteredSessions : []).reduce((sum, sessionRow) => {
    const count = Array.isArray(sessionRow?.gradebooks) ? sessionRow.gradebooks.length : 0;
    return sum + count;
  }, 0);
}

function summarizeClassAttendanceMatrix(matrix = [], sessions = []) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const sessionCount = sessionList.length;
  const studentsPerSession = new Array(sessionCount).fill(0);
  let absenceCount = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;

  (Array.isArray(matrix) ? matrix : []).forEach((row) => {
    (Array.isArray(row?.records) ? row.records : []).forEach((record, index) => {
      if (record?.expectedForSession !== true) return;
      if (index >= 0 && index < studentsPerSession.length) {
        studentsPerSession[index] += 1;
      }

      const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
      if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) {
        absenceCount += 1;
      }
      const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
      if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) {
        lateCount += 1;
      }
      const earlyLeaveMinutes = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
      if (earlyLeaveMinutes > 0) {
        earlyLeaveCount += 1;
      }
    });
  });

  const avgStudentsPerSession = sessionCount
    ? roundOneDecimal(studentsPerSession.reduce((sum, count) => sum + count, 0) / sessionCount)
    : 0;

  const attendanceTotals = weeklyReportsClassMetricsService.summarizeAttendanceFromMatrix(matrix).totals;

  return {
    sessionCount,
    avgStudentsPerSession,
    absenceCount,
    lateCount,
    earlyLeaveCount,
    absenceMinutes: Number(attendanceTotals.absence.minutes || 0),
    lateMinutes: Number(attendanceTotals.late.minutes || 0),
    earlyLeaveMinutes: Number(attendanceTotals.early.minutes || 0)
  };
}

function classMatchesDepartment(row = {}, departmentId = '') {
  const normalizedDepartmentId = toPublicId(departmentId);
  if (!normalizedDepartmentId) return true;
  return idsEqual(toPublicId(row?.deliveryDepartmentId), normalizedDepartmentId);
}

function collectClassProgramIds(row = {}) {
  const ids = new Set();
  (Array.isArray(row?.allowedProgramTerms) ? row.allowedProgramTerms : []).forEach((termRow) => {
    const programId = toPublicId(termRow?.programId);
    if (programId) ids.add(programId);
  });
  return ids;
}

function classMatchesProgram(row = {}, programId = '') {
  const normalizedProgramId = toPublicId(programId);
  if (!normalizedProgramId) return true;
  return collectClassProgramIds(row).has(normalizedProgramId);
}

function isActiveClassInstructor(instructorRow = {}) {
  const status = String(instructorRow?.status || 'active').trim().toLowerCase();
  return status !== 'inactive';
}

function buildTeacherRecordLookup(teachers = []) {
  const teacherIdToPersonId = new Map();
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    const teacherId = toPublicId(row?.id);
    const personId = toPublicId(row?.personId);
    if (teacherId && personId) {
      teacherIdToPersonId.set(teacherId, personId);
    }
  });
  return teacherIdToPersonId;
}

function instructorMatchesTeacherPerson(
  instructorRow = {},
  normalizedTeacherPersonId = '',
  teacherIdToPersonId = null
) {
  if (!normalizedTeacherPersonId || !isActiveClassInstructor(instructorRow)) return false;
  const instructorPersonId = toPublicId(instructorRow?.personId);
  if (instructorPersonId && idsEqual(instructorPersonId, normalizedTeacherPersonId)) {
    return true;
  }
  const lookup = teacherIdToPersonId instanceof Map ? teacherIdToPersonId : null;
  if (!lookup || !lookup.size) return false;
  const linkedTeacherId = toPublicId(instructorRow?.teacherId || instructorRow?.id);
  if (!linkedTeacherId) return false;
  const mappedPersonId = lookup.get(linkedTeacherId);
  return mappedPersonId && idsEqual(mappedPersonId, normalizedTeacherPersonId);
}

function classMatchesTeacher(row = {}, teacherPersonId = '', teacherIdToPersonId = null) {
  const normalizedTeacherPersonId = toPublicId(teacherPersonId);
  if (!normalizedTeacherPersonId) return true;
  const instructors = Array.isArray(row?.instructors) ? row.instructors : [];
  return instructors.some((instructorRow) => instructorMatchesTeacherPerson(
    instructorRow,
    normalizedTeacherPersonId,
    teacherIdToPersonId
  ));
}

function resolvePrimaryInstructor(classRow = {}) {
  const primary = Array.isArray(classRow?.instructors) ? classRow.instructors[0] : null;
  if (!primary) {
    return { teacherPersonId: '', teacherName: 'Unassigned' };
  }
  const teacherPersonId = toPublicId(primary.personId || primary.id || primary.teacherId || '') || '';
  const teacherName = String(primary.name || primary.displayName || classRow?.teacherName || teacherPersonId || 'Unassigned').trim() || 'Unassigned';
  return { teacherPersonId, teacherName };
}

function sumSessionScheduledHours(sessions = []) {
  return roundOneDecimal((Array.isArray(sessions) ? sessions : []).reduce((sum, sessionRow) => {
    const stored = Number(sessionRow?.durationHours);
    const hours = Number.isFinite(stored) && stored > 0
      ? stored
      : activityService.calculateDurationHours(sessionRow?.startTime, sessionRow?.endTime);
    return sum + (Number.isFinite(Number(hours)) ? Number(hours) : 0);
  }, 0));
}

function buildClassBoardRow(classRow = {}, summary = {}, gradebookCount = 0, scheduledHours = 0, operationalMetrics = null, orgNameMap = new Map(), studentCaseItems = []) {
  const classId = toPublicId(classRow?.id);
  const orgId = toPublicId(classRow?.orgId) || '';
  const orgName = resolveWeeklyReportsOrgName(orgId, orgNameMap);
  const departmentId = toPublicId(classRow?.deliveryDepartmentId) || '';
  const departmentName = String(classRow?.deliveryDepartmentName || departmentId || '').trim();
  const instructor = resolvePrimaryInstructor(classRow);
  const metrics = operationalMetrics && typeof operationalMetrics === 'object'
    ? operationalMetrics
    : weeklyReportsClassMetricsService.buildEmptyOperationalMetrics();
  return {
    classId,
    className: String(classRow?.title || classRow?.name || classId || '').trim() || classId,
    orgId,
    orgName,
    departmentId,
    departmentName,
    teacherPersonId: instructor.teacherPersonId,
    teacherName: instructor.teacherName,
    sessionCount: Number(summary.sessionCount || 0),
    scheduledHours: Number(scheduledHours || 0),
    avgStudentsPerSession: Number(summary.avgStudentsPerSession || 0),
    absenceCount: Number(summary.absenceCount || 0),
    lateCount: Number(summary.lateCount || 0),
    earlyLeaveCount: Number(summary.earlyLeaveCount || 0),
    gradebookCount: Number(gradebookCount || 0),
    operationalMetrics: metrics,
    studentCaseItems: Array.isArray(studentCaseItems) ? studentCaseItems : []
  };
}

function countExpectedSessionsFromMatrixRow(matrixRow = {}) {
  return (Array.isArray(matrixRow.records) ? matrixRow.records : [])
    .filter((record) => record?.expectedForSession === true)
    .length;
}

function studentHasScheduledSessionsInWeeklyReport(row = {}) {
  const sessionCount = Number(row.sessionCount || 0);
  if (sessionCount > 0) return true;
  const attendance = row.attendance && typeof row.attendance === 'object' ? row.attendance : {};
  return Number(attendance.sessionCount || 0) > 0;
}

function aggregateMatrixIntoStudentMap(studentMap, classId, matrix = []) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return studentMap;

  (Array.isArray(matrix) ? matrix : []).forEach((row) => {
    const studentId = toPublicId(row?.studentRecordId);
    if (!studentId) return;

    const sessionCount = countExpectedSessionsFromMatrixRow(row);
    const existing = studentMap.get(studentId) || {
      studentId,
      personId: toPublicId(row?.personId),
      name: String(row?.name || '').trim() || studentId,
      sessionCount: 0,
      classIds: new Set()
    };

    existing.sessionCount += sessionCount;
    existing.classIds.add(normalizedClassId);
    if (!existing.name && row?.name) existing.name = String(row.name).trim();
    if (!existing.personId && row?.personId) existing.personId = toPublicId(row.personId);
    studentMap.set(studentId, existing);
  });

  return studentMap;
}

function mapStudentBoardRows(studentMap, studentFilterIds = []) {
  const filterSet = new Set(studentFilterIds.map((id) => toPublicId(id)).filter(Boolean));
  return Array.from(studentMap.values())
    .filter((row) => {
      if (!filterSet.size) return true;
      return filterSet.has(row.studentId) || (row.personId && filterSet.has(row.personId));
    })
    .map((row) => buildWeeklyReportsStudentDetailRow(row))
    .filter((row) => studentHasScheduledSessionsInWeeklyReport(row))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function formatStudentSessionLabel(record = {}) {
  const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
  const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
  const earlyLeaveMinutes = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
  const absenceExcused = attendanceMatrixMetricsService.isAbsenceExcused(record)
    || status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED;
  if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) {
    if (absenceExcused) {
      return status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF ? 'Excused ACF' : 'Excused';
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF) {
      return 'ACF';
    }
    return 'Absent';
  }
  if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(status)) return 'Unmarked';
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) {
    return lateMinutes > 0 ? `Late (${lateMinutes}m)` : 'Late';
  }
  if (earlyLeaveMinutes > 0) return `Present (early leave ${earlyLeaveMinutes}m)`;
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) return 'Present';
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) return 'N/A';
  return status ? String(status) : 'Unmarked';
}

function buildStudentSessionRows(matrixRow = {}, sessions = []) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  return (Array.isArray(matrixRow?.records) ? matrixRow.records : [])
    .map((record, index) => {
      if (record?.expectedForSession !== true) return null;
      const sessionMeta = sessionList[index] || {};
      const sessionId = toPublicId(record?.sessionId || sessionMeta?.id || sessionMeta?.sessionId) || '';
      return {
        sessionId,
        date: String(record?.date || sessionMeta?.date || '').trim(),
        status: attendanceMatrixMetricsService.normalizeStatus(record?.status),
        lateMinutes: Math.max(0, Number(record?.lateMinutes) || 0),
        earlyLeaveMinutes: Math.max(0, Number(record?.earlyLeaveMinutes) || 0),
        label: formatStudentSessionLabel(record)
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function computeStudentAttendanceHealth(matrixRow = {}, classData = {}, orgPolicyLayer = {}) {
  const records = (Array.isArray(matrixRow?.records) ? matrixRow.records : [])
    .filter((record) => record?.expectedForSession === true)
    .map((record) => ({
      status: record?.status,
      lateMinutes: record?.lateMinutes,
      earlyLeaveMinutes: record?.earlyLeaveMinutes,
      absenceExcused: record?.absenceExcused,
      scheduledMinutes: record?.scheduledMinutes
    }));
  if (!records.length) return 100;
  const summary = attendanceMatrixMetricsService.computeStudentMatrixSummary(
    records,
    classData,
    orgPolicyLayer
  );
  if (summary.performancePercent == null) return 100;
  return Math.round(summary.performancePercent);
}

function countStudentAttendanceBuckets(matrixRow = {}) {
  const summary = summarizeStudentAttendanceForWeeklyReport(matrixRow);
  return {
    presentCount: summary.presentCount,
    lateCount: summary.lateCount,
    absenceCount: summary.absenceCount
  };
}

function emptyStudentAttendanceSummary() {
  return {
    sessionCount: 0,
    presentCount: 0,
    lateCount: 0,
    lateMinutes: 0,
    lateExcusedCount: 0,
    lateExcusedMinutes: 0,
    earlyCount: 0,
    earlyMinutes: 0,
    earlyExcusedCount: 0,
    earlyExcusedMinutes: 0,
    absenceCount: 0,
    absenceExcusedCount: 0,
    acfCount: 0,
    acfExcusedCount: 0,
    naCount: 0
  };
}

function mergeStudentAttendanceSummaries(existing = {}, incoming = {}) {
  const base = emptyStudentAttendanceSummary();
  const left = { ...base, ...(existing && typeof existing === 'object' ? existing : {}) };
  const right = incoming && typeof incoming === 'object' ? incoming : {};
  Object.keys(base).forEach((key) => {
    left[key] = Number(left[key] || 0) + Number(right[key] || 0);
  });
  return left;
}

function summarizeStudentAttendanceForWeeklyReport(matrixRow = {}) {
  const summary = emptyStudentAttendanceSummary();
  const ST = attendanceMatrixMetricsService.ATTENDANCE_STATUS;

  const trackEarly = (record, earlyMinutes, earlyExcused) => {
    if (earlyMinutes <= 0) return;
    summary.earlyCount += 1;
    summary.earlyMinutes += earlyMinutes;
    if (earlyExcused) {
      summary.earlyExcusedCount += 1;
      summary.earlyExcusedMinutes += earlyMinutes;
    }
  };

  (Array.isArray(matrixRow?.records) ? matrixRow.records : []).forEach((record) => {
    if (record?.expectedForSession !== true) return;
    summary.sessionCount += 1;

    const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
    const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
    const earlyMinutes = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
    const lateExcused = Boolean(record?.lateExcused);
    const earlyExcused = Boolean(record?.earlyLeaveExcused);
    const absenceExcused = attendanceMatrixMetricsService.isAbsenceExcused(record)
      || status === ST.EXCUSED;

    if (status === ST.NOT_APPLICABLE) {
      summary.naCount += 1;
      return;
    }

    if (status === ST.ACF) {
      if (absenceExcused) summary.acfExcusedCount += 1;
      else summary.acfCount += 1;
      return;
    }

    if (status === ST.ABSENT || attendanceMatrixMetricsService.isAbsentLikeStatus(status)) {
      if (absenceExcused) summary.absenceExcusedCount += 1;
      else summary.absenceCount += 1;
      return;
    }

    if (status === ST.LATE || lateMinutes > 0) {
      summary.lateCount += 1;
      summary.lateMinutes += lateMinutes;
      if (lateExcused) {
        summary.lateExcusedCount += 1;
        summary.lateExcusedMinutes += lateMinutes;
      }
      trackEarly(record, earlyMinutes, earlyExcused);
      return;
    }

    trackEarly(record, earlyMinutes, earlyExcused);

    if (status === ST.PRESENT) {
      summary.presentCount += 1;
    }
  });

  return summary;
}

function buildStudentCaseItems(caseRows = [], personId = '', sessionIdSet = new Set(), classRow = {}, sessions = []) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId || !(sessionIdSet instanceof Set) || !sessionIdSet.size) return [];
  const filtered = (Array.isArray(caseRows) ? caseRows : []).filter((row) => {
    if (!idsEqual(row?.studentPersonId || row?.personId, normalizedPersonId)) return false;
    return sessionIdSet.has(toPublicId(row?.sessionId));
  });
  return weeklyReportsClassMetricsService.buildWeeklyReportCaseItems(filtered, classRow, sessions);
}

function findGradebookItem(session = {}, itemId = '') {
  const arr = Array.isArray(session?.gradebooks) ? session.gradebooks : [];
  const normalizedItemId = String(itemId || '').trim();
  const byId = arr.find((row) => String(row?.id || '').trim() === normalizedItemId);
  if (byId) return byId;
  const match = /^gb_(\d+)$/.exec(normalizedItemId);
  if (match) return arr[Number(match[1])] || null;
  return null;
}

function buildStudentSkillAverages(gradesPayload = {}, personId = '', sessionsById = new Map()) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return [];
  const matrix = Array.isArray(gradesPayload?.matrix) ? gradesPayload.matrix : [];
  const studentRow = matrix.find((row) => idsEqual(row?.personId, normalizedPersonId));
  if (!studentRow) return [];

  const columns = Array.isArray(gradesPayload?.columns) ? gradesPayload.columns : [];
  const cells = Array.isArray(studentRow?.cells) ? studentRow.cells : [];
  const buckets = new Map();

  columns.forEach((column, index) => {
    if (String(column?.kind || '').trim() !== 'gradebook') return;
    if (column?.includeInGradeCalculation === false) return;
    const cell = cells[index];
    if (!cell?.effective || cell.percent == null) return;
    const session = sessionsById.get(toPublicId(column?.sessionId)) || null;
    const gradebook = findGradebookItem(session, column?.itemId);
    const skills = gradebookSkillCatalogService.normalizeGradebookSkillIds(
      gradebookSkillCatalogService.normalizeGradebookActivitySkills(gradebook || {}).skills
    );
    skills.forEach((skillId) => {
      if (!buckets.has(skillId)) buckets.set(skillId, []);
      buckets.get(skillId).push(Number(cell.percent));
    });
  });

  return Array.from(buckets.entries())
    .map(([skillId, percents]) => {
      const sum = percents.reduce((total, value) => total + value, 0);
      const skill = gradebookSkillCatalogService.getGradebookSkillById(skillId);
      return {
        skillId,
        skillLabel: skill?.label || skillId,
        averagePercent: roundOneDecimal(sum / percents.length)
      };
    })
    .sort((a, b) => String(a.skillLabel || '').localeCompare(String(b.skillLabel || '')));
}

function countStudentCases(caseRows = [], personId = '', sessionIdSet = new Set()) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId || !(sessionIdSet instanceof Set) || !sessionIdSet.size) return 0;
  return (Array.isArray(caseRows) ? caseRows : []).filter((row) => {
    if (!idsEqual(row?.studentPersonId || row?.personId, normalizedPersonId)) return false;
    return sessionIdSet.has(toPublicId(row?.sessionId));
  }).length;
}

function mergeSkillAverages(existing = [], incoming = []) {
  const bucketMap = new Map();
  const addRows = (rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const skillId = String(row?.skillId || '').trim();
      if (!skillId) return;
      if (!bucketMap.has(skillId)) {
        bucketMap.set(skillId, {
          skillId,
          skillLabel: row.skillLabel || skillId,
          values: []
        });
      }
      const entry = bucketMap.get(skillId);
      if (row.skillLabel) entry.skillLabel = row.skillLabel;
      entry.values.push(Number(row.averagePercent));
    });
  };
  addRows(existing);
  addRows(incoming);
  return Array.from(bucketMap.values())
    .map((entry) => ({
      skillId: entry.skillId,
      skillLabel: entry.skillLabel,
      averagePercent: roundOneDecimal(
        entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length
      )
    }))
    .sort((a, b) => String(a.skillLabel || '').localeCompare(String(b.skillLabel || '')));
}

function mergeStudentDetailIntoMap(studentMap, classId, detailRow = {}) {
  const normalizedClassId = toPublicId(classId);
  const studentId = toPublicId(detailRow?.studentId);
  if (!studentId) return studentMap;

  const existing = studentMap.get(studentId) || {
    studentId,
    personId: toPublicId(detailRow?.personId),
    name: String(detailRow?.name || '').trim() || studentId,
    sessionCount: 0,
    presentCount: 0,
    lateCount: 0,
    absenceCount: 0,
    attendanceHealth: 100,
    attendance: emptyStudentAttendanceSummary(),
    engagement: { presentMinutes: 0, scheduledMinutes: 0, percent: null },
    sessions: [],
    skillAverages: [],
    caseCount: 0,
    studentCaseItems: [],
    classIds: new Set()
  };

  const incomingSessions = Array.isArray(detailRow?.sessions) ? detailRow.sessions : [];
  const mergedSessions = existing.sessions.concat(incomingSessions)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const mergedSessionCount = mergedSessions.length;
  const mergedHealth = mergedSessionCount
    ? Math.round(
      ((Number(existing.attendanceHealth || 0) * Number(existing.sessionCount || 0))
        + (Number(detailRow.attendanceHealth || 0) * Number(incomingSessions.length || 0)))
      / mergedSessionCount
    )
    : Number(detailRow.attendanceHealth || existing.attendanceHealth || 100);

  existing.personId = existing.personId || toPublicId(detailRow?.personId);
  existing.name = existing.name || String(detailRow?.name || '').trim();
  existing.sessionCount = mergedSessionCount;
  existing.presentCount = Number(existing.presentCount || 0) + Number(detailRow.presentCount || 0);
  existing.lateCount = Number(existing.lateCount || 0) + Number(detailRow.lateCount || 0);
  existing.absenceCount = Number(existing.absenceCount || 0) + Number(detailRow.absenceCount || 0);
  existing.attendance = mergeStudentAttendanceSummaries(existing.attendance, detailRow.attendance);
  existing.engagement = getWeeklyReportsEngagementService().mergeEngagementTotals(
    existing.engagement,
    detailRow.engagement
  );
  existing.attendanceHealth = mergedHealth;
  existing.sessions = mergedSessions;
  existing.skillAverages = mergeSkillAverages(existing.skillAverages, detailRow.skillAverages);
  existing.caseCount = Number(existing.caseCount || 0) + Number(detailRow.caseCount || 0);
  const incomingCases = Array.isArray(detailRow.studentCaseItems) ? detailRow.studentCaseItems : [];
  existing.studentCaseItems = existing.studentCaseItems.concat(incomingCases)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (normalizedClassId) existing.classIds.add(normalizedClassId);
  studentMap.set(studentId, existing);
  return studentMap;
}

function buildWeeklyReportsStudentDetailRow(row = {}) {
  const attendance = row.attendance && typeof row.attendance === 'object'
    ? row.attendance
    : emptyStudentAttendanceSummary();
  const engagement = row.engagement && typeof row.engagement === 'object'
    ? row.engagement
    : { presentMinutes: 0, scheduledMinutes: 0, percent: null };
  return {
    studentId: row.studentId,
    personId: row.personId || '',
    name: row.name || row.studentId,
    sessionCount: Number(row.sessionCount || 0),
    attendanceHealth: Number(row.attendanceHealth || 0),
    presentCount: Number(row.presentCount != null ? row.presentCount : attendance.presentCount || 0),
    lateCount: Number(row.lateCount != null ? row.lateCount : attendance.lateCount || 0),
    absenceCount: Number(row.absenceCount != null ? row.absenceCount : attendance.absenceCount || 0),
    attendance,
    engagement,
    sessions: Array.isArray(row.sessions) ? row.sessions : [],
    skillAverages: Array.isArray(row.skillAverages) ? row.skillAverages : [],
    caseCount: Number(row.caseCount || 0),
    studentCaseItems: Array.isArray(row.studentCaseItems) ? row.studentCaseItems : [],
    classCount: row.classIds instanceof Set ? row.classIds.size : Number(row.classCount || 0),
    classIds: row.classIds instanceof Set ? Array.from(row.classIds) : (Array.isArray(row.classIds) ? row.classIds : [])
  };
}

function buildStudentDetailRowFromClass({
  matrixRow = {},
  sessions = [],
  gradesPayload = {},
  sessionsById = new Map(),
  caseRows = [],
  sessionIdSet = new Set(),
  classData = {},
  orgPolicyLayer = {}
} = {}) {
  const studentId = toPublicId(matrixRow?.studentRecordId);
  const personId = toPublicId(matrixRow?.personId);
  const attendance = summarizeStudentAttendanceForWeeklyReport(matrixRow);
  const engagement = getWeeklyReportsEngagementService().summarizeEngagementFromStudentMatrixRow(
    matrixRow,
    classData,
    orgPolicyLayer
  );
  const studentCaseItems = buildStudentCaseItems(
    caseRows,
    personId,
    sessionIdSet,
    classData,
    sessions
  );
  return buildWeeklyReportsStudentDetailRow({
    studentId,
    personId,
    name: String(matrixRow?.name || '').trim() || studentId,
    sessionCount: countExpectedSessionsFromMatrixRow(matrixRow),
    attendanceHealth: computeStudentAttendanceHealth(matrixRow, classData, orgPolicyLayer),
    presentCount: attendance.presentCount,
    lateCount: attendance.lateCount,
    absenceCount: attendance.absenceCount,
    attendance,
    engagement,
    sessions: buildStudentSessionRows(matrixRow, sessions),
    skillAverages: buildStudentSkillAverages(gradesPayload, personId, sessionsById),
    caseCount: studentCaseItems.length || countStudentCases(caseRows, personId, sessionIdSet),
    studentCaseItems,
    classIds: new Set()
  });
}

function filterClassesForWeeklyReports(rows = [], {
  activeOrgId = '',
  classIds = [],
  departmentId = '',
  programId = '',
  teacherPersonId = '',
  teacherIdToPersonId = null
} = {}) {
  let scoped = (Array.isArray(rows) ? rows : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveAttendanceClass)
    .filter((row) => classMatchesDepartment(row, departmentId))
    .filter((row) => classMatchesProgram(row, programId))
    .filter((row) => classMatchesTeacher(row, teacherPersonId, teacherIdToPersonId));

  if (classIds.length) {
    const classIdSet = new Set(classIds.map((id) => toPublicId(id)).filter(Boolean));
    scoped = scoped.filter((row) => classIdSet.has(toPublicId(row?.id)));
  }

  return scoped.sort((a, b) => String(a?.title || a?.id || '').localeCompare(String(b?.title || b?.id || '')));
}

async function resolveWeeklyReportsDepartmentOptions(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const departments = await schoolDataService.fetchAllData('departments', {}, reqUser);
  return (Array.isArray(departments) ? departments : [])
    .filter((row) => !String(row?.orgId || '').trim() || idsEqual(row?.orgId, activeOrgId))
    .map((row) => ({
      id: toPublicId(row?.id),
      name: String(row?.name || row?.code || row?.id || 'Department').trim()
    }))
    .filter((row) => row.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function resolveWeeklyReportsClasses({
  reqUser,
  classIds = [],
  departmentId = '',
  programId = '',
  teacherPersonId = '',
  activeOrgId = ''
} = {}) {
  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser);
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  const normalizedProgramId = toPublicId(programId) || '';
  const normalizedTeacherPersonId = toPublicId(teacherPersonId) || '';
  let teacherIdToPersonId = null;
  if (normalizedTeacherPersonId) {
    const teachers = await schoolDataService.fetchAllData('teachers', {}, reqUser);
    teacherIdToPersonId = buildTeacherRecordLookup(teachers);
  }
  return filterClassesForWeeklyReports(classes, {
    activeOrgId,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId,
    programId: normalizedProgramId,
    teacherPersonId: normalizedTeacherPersonId,
    teacherIdToPersonId
  });
}

async function resolveWeeklyReportsProgramOptions(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const programs = await schoolDataService.fetchAllData('programs', {}, reqUser);
  return (Array.isArray(programs) ? programs : [])
    .filter((row) => !String(row?.orgId || '').trim() || idsEqual(row?.orgId, activeOrgId))
    .map((row) => {
      const id = toPublicId(row?.id);
      const code = String(row?.code || '').trim();
      const name = String(row?.name || row?.id || 'Program').trim();
      const label = [code, name].filter(Boolean).join(' - ') || name || id;
      return { id, name: label };
    })
    .filter((row) => row.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function resolveWeeklyReportsTeacherOptions(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const teachers = await schoolDataService.fetchAllData('teachers', {}, reqUser);
  const visibleTeachers = (Array.isArray(teachers) ? teachers : []).filter((row) => {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return false;
    return !!toPublicId(row?.personId);
  });
  const personIds = visibleTeachers
    .map((row) => toPublicId(row.personId))
    .filter(Boolean);
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds
  });
  const byPersonId = new Map();
  visibleTeachers.forEach((row) => {
    const personId = toPublicId(row.personId);
    if (!personId || byPersonId.has(personId)) return;
    const person = personById.get(personId);
    const fallback = String(row?.displayName || row?.name || row?.preferredName || '').trim();
    const name = schoolPersonAccessService.formatPersonName(person || {}, fallback || personId);
    byPersonId.set(personId, { id: personId, name: name || personId });
  });
  return Array.from(byPersonId.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function buildWeeklyReportsClassBoard({
  reqUser,
  classIds = [],
  departmentId = '',
  programId = '',
  teacherPersonId = '',
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  const normalizedProgramId = toPublicId(programId) || '';
  const normalizedTeacherPersonId = toPublicId(teacherPersonId) || '';
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  const boardStartedAt = Date.now();
  const classes = await resolveWeeklyReportsClasses({
    reqUser,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId,
    programId: normalizedProgramId,
    teacherPersonId: normalizedTeacherPersonId,
    activeOrgId
  });

  const rows = [];
  const [orgCaches, organizations] = await Promise.all([
    weeklyReportsClassMetricsService.loadWeeklyReportsOrgCaches(reqUser, activeOrgId),
    dataService.fetchData('organizations', {}, reqUser).catch(() => [])
  ]);
  const orgNameMap = buildWeeklyReportsOrgNameMap(organizations);
  const statusMapByOrgKey = new Map();

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    try {
      const allSessions = await schoolDataService.getClassSessions(classId, reqUser);

      const orgKey = String(toPublicId(classRow?.orgId) || activeOrgId || '').trim();
      let statusMap = statusMapByOrgKey.get(orgKey);
      if (!statusMap) {
        statusMap = await sessionStatusPolicyService.getStatusMap(
          classRow?.orgId || activeOrgId,
          { includeInactive: true }
        );
        statusMapByOrgKey.set(orgKey, statusMap);
      }

      const filteredSessions = filterSessionsForWeeklyReport({
        sessions: allSessions,
        statusMap,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate
      });
      if (!filteredSessions.length) {
        continue;
      }

      const payload = await buildAttendanceMatrixPayload({
        user: reqUser,
        query: {
          classId,
          startDate: normalizedStartDate,
          endDate: normalizedEndDate
        }
      }, { applyWindow: false });
      const matrixSessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
      const summary = summarizeClassAttendanceMatrix(payload?.matrix || [], matrixSessions);
      const alignedSessionCount = filteredSessions.length;
      const alignedSummary = {
        ...summary,
        sessionCount: alignedSessionCount
      };
      const gradebookCount = countGradebooksInSessions(filteredSessions);
      const scheduledHours = sumSessionScheduledHours(filteredSessions);
      const weeklyMetrics = weeklyReportsClassMetricsService.buildClassWeeklyMetrics({
        classRow,
        filteredSessions,
        matrixPayload: payload,
        statusMap,
        orgCaches,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate
      });
      const studentCaseItems = weeklyReportsClassMetricsService.buildWeeklyReportCaseItems(
        weeklyMetrics._internal.classCases,
        classRow,
        weeklyMetrics._internal.sessions
      );

      rows.push(buildClassBoardRow(
        classRow,
        alignedSummary,
        gradebookCount,
        scheduledHours,
        weeklyMetrics.metrics,
        orgNameMap,
        studentCaseItems
      ));
    } catch (error) {
      console.warn(`[weeklyReportsHubService] Skipping class ${classId}: ${error.message}`);
    }
  }

  rows.sort((a, b) => String(a.className || '').localeCompare(String(b.className || '')));

  const preparedInMs = Date.now() - boardStartedAt;

  return {
    view: 'classes',
    rows,
    total: rows.length,
    filters: {
      classIds: normalizedClassIds,
      departmentId: normalizedDepartmentId,
      programId: normalizedProgramId,
      teacherPersonId: normalizedTeacherPersonId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate
    },
    refreshedAt: new Date().toISOString(),
    preparedInMs
  };
}

async function buildWeeklyReportsClassDrilldown({
  reqUser,
  classId = '',
  metricKey = '',
  departmentId = '',
  programId = '',
  teacherPersonId = '',
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassId = toPublicId(classId);
  const normalizedMetricKey = String(metricKey || '').trim();
  if (!normalizedClassId) throw new Error('Class ID is required.');
  if (!normalizedMetricKey) throw new Error('Metric key is required.');

  const classes = await resolveWeeklyReportsClasses({
    reqUser,
    classIds: [normalizedClassId],
    departmentId: toPublicId(departmentId) || '',
    programId: toPublicId(programId) || '',
    teacherPersonId: toPublicId(teacherPersonId) || '',
    activeOrgId
  });
  const classRow = classes.find((row) => idsEqual(row?.id, normalizedClassId)) || classes[0];
  if (!classRow) throw new Error('Class not found or not accessible.');

  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();
  const allSessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
  const statusMap = await sessionStatusPolicyService.getStatusMap(
    classRow?.orgId || activeOrgId,
    { includeInactive: true }
  );
  const filteredSessions = filterSessionsForWeeklyReport({
    sessions: allSessions,
    statusMap,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate
  });
  const payload = await buildAttendanceMatrixPayload({
    user: reqUser,
    query: {
      classId: normalizedClassId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate
    }
  }, { applyWindow: false });
  const orgCaches = await weeklyReportsClassMetricsService.loadWeeklyReportsOrgCaches(reqUser, activeOrgId);

  return weeklyReportsClassMetricsService.buildWeeklyReportsDrilldown({
    metricKey: normalizedMetricKey,
    classRow,
    filteredSessions,
    matrixPayload: payload,
    statusMap,
    orgCaches,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate
  });
}

async function buildWeeklyReportsEngagement({
  reqUser,
  classIds = [],
  startDate = '',
  endDate = ''
} = {}) {
  const weeklyReportsEngagementService = require('./weeklyReportsEngagementService');
  const result = await weeklyReportsEngagementService.buildEngagementForClasses({
    reqUser,
    classIds,
    startDate,
    endDate
  });
  return {
    ...result,
    refreshedAt: new Date().toISOString()
  };
}

async function buildWeeklyReportsStudentBoard({
  reqUser,
  classIds = [],
  studentIds = [],
  departmentId = '',
  programId = '',
  teacherPersonId = '',
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedStudentIds = parseFilterIdList(studentIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  const normalizedProgramId = toPublicId(programId) || '';
  const normalizedTeacherPersonId = toPublicId(teacherPersonId) || '';
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  const classes = await resolveWeeklyReportsClasses({
    reqUser,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId,
    programId: normalizedProgramId,
    teacherPersonId: normalizedTeacherPersonId,
    activeOrgId
  });

  const studentMap = new Map();
  let showAcfColumn = false;

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    const enabledStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classRow);
    if (enabledStatuses.includes(attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF)) {
      showAcfColumn = true;
    }

    try {
      const [attendancePayload, gradesPayload, allSessions, caseRows] = await Promise.all([
        buildAttendanceMatrixPayload({
          user: reqUser,
          query: {
            classId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate
          }
        }, { applyWindow: false }),
        buildGradesMatrixPayload(
          { user: reqUser },
          {
            classId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate
          },
          { includeAttendanceInFinal: true }
        ),
        schoolDataService.getClassSessions(classId, reqUser),
        schoolDataService.fetchAllData('sessionStudentCases', {}, reqUser)
      ]);

      const statusMap = await sessionStatusPolicyService.getStatusMap(
        classRow?.orgId || activeOrgId,
        { includeInactive: true }
      );
      const filteredSessions = filterSessionsForWeeklyReport({
        sessions: allSessions,
        statusMap,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate
      });
      if (!filteredSessions.length) {
        continue;
      }
      const sessionsById = new Map(
        filteredSessions.map((sessionRow) => [toPublicId(sessionRow?.sessionId || sessionRow?.id), sessionRow])
      );
      const sessionIdSet = new Set(
        (Array.isArray(attendancePayload?.sessions) ? attendancePayload.sessions : [])
          .map((sessionRow) => toPublicId(sessionRow?.id || sessionRow?.sessionId))
          .filter(Boolean)
      );
      const classCaseRows = (Array.isArray(caseRows) ? caseRows : [])
        .filter((row) => idsEqual(row?.classId, classId));

      const orgPolicyCatalog = await attendanceMatrixPolicyModel.getPolicyCatalogForOrg(
        classRow?.orgId || activeOrgId
      );

      (Array.isArray(attendancePayload?.matrix) ? attendancePayload.matrix : []).forEach((matrixRow) => {
        if (!countExpectedSessionsFromMatrixRow(matrixRow)) return;
        const detailRow = buildStudentDetailRowFromClass({
          matrixRow,
          sessions: attendancePayload?.sessions || [],
          gradesPayload,
          sessionsById,
          caseRows: classCaseRows,
          sessionIdSet,
          classData: classRow,
          orgPolicyLayer: orgPolicyCatalog
        });
        mergeStudentDetailIntoMap(studentMap, classId, detailRow);
      });
    } catch (error) {
      console.warn(`[weeklyReportsHubService] Skipping class ${classId}: ${error.message}`);
    }
  }

  const rows = mapStudentBoardRows(studentMap, normalizedStudentIds);

  return {
    view: 'students',
    rows,
    total: rows.length,
    classContext: { showAcfColumn },
    filters: {
      classIds: normalizedClassIds,
      studentIds: normalizedStudentIds,
      departmentId: normalizedDepartmentId,
      programId: normalizedProgramId,
      teacherPersonId: normalizedTeacherPersonId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate
    },
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  parseFilterIdList,
  classMatchesDepartment,
  classMatchesProgram,
  classMatchesTeacher,
  buildTeacherRecordLookup,
  instructorMatchesTeacherPerson,
  isActiveClassInstructor,
  collectClassProgramIds,
  filterClassesForWeeklyReports,
  filterSessionsForWeeklyReport,
  countGradebooksInSessions,
  summarizeClassAttendanceMatrix,
  resolvePrimaryInstructor,
  sumSessionScheduledHours,
  buildClassBoardRow,
  countExpectedSessionsFromMatrixRow,
  studentHasScheduledSessionsInWeeklyReport,
  aggregateMatrixIntoStudentMap,
  formatStudentSessionLabel,
  buildStudentSessionRows,
  computeStudentAttendanceHealth,
  countStudentAttendanceBuckets,
  emptyStudentAttendanceSummary,
  mergeStudentAttendanceSummaries,
  summarizeStudentAttendanceForWeeklyReport,
  buildStudentCaseItems,
  buildStudentSkillAverages,
  countStudentCases,
  mergeSkillAverages,
  mergeStudentDetailIntoMap,
  buildWeeklyReportsStudentDetailRow,
  buildStudentDetailRowFromClass,
  mapStudentBoardRows,
  resolveWeeklyReportsDepartmentOptions,
  resolveWeeklyReportsProgramOptions,
  resolveWeeklyReportsTeacherOptions,
  resolveWeeklyReportsClasses,
  buildWeeklyReportsClassBoard,
  buildWeeklyReportsClassDrilldown,
  buildWeeklyReportsEngagement,
  buildWeeklyReportsStudentBoard
};
