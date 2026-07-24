const schoolDataService = require('./schoolDataService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
const { buildGradesMatrixPayload } = require('../../controllers/school/gradesMatrixController');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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

  return {
    sessionCount,
    avgStudentsPerSession,
    absenceCount,
    lateCount,
    earlyLeaveCount
  };
}

function classMatchesDepartment(row = {}, departmentId = '') {
  const normalizedDepartmentId = toPublicId(departmentId);
  if (!normalizedDepartmentId) return true;
  return idsEqual(toPublicId(row?.deliveryDepartmentId), normalizedDepartmentId);
}

function buildClassBoardRow(classRow = {}, summary = {}, gradebookCount = 0) {
  const classId = toPublicId(classRow?.id);
  const departmentId = toPublicId(classRow?.deliveryDepartmentId) || '';
  const departmentName = String(classRow?.deliveryDepartmentName || departmentId || '').trim();
  return {
    classId,
    className: String(classRow?.title || classRow?.name || classId || '').trim() || classId,
    departmentId,
    departmentName,
    sessionCount: Number(summary.sessionCount || 0),
    avgStudentsPerSession: Number(summary.avgStudentsPerSession || 0),
    absenceCount: Number(summary.absenceCount || 0),
    lateCount: Number(summary.lateCount || 0),
    earlyLeaveCount: Number(summary.earlyLeaveCount || 0),
    gradebookCount: Number(gradebookCount || 0)
  };
}

function countExpectedSessionsFromMatrixRow(matrixRow = {}) {
  return (Array.isArray(matrixRow.records) ? matrixRow.records : [])
    .filter((record) => record?.expectedForSession === true)
    .length;
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
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function formatStudentSessionLabel(record = {}) {
  const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
  const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
  const earlyLeaveMinutes = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
  if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) return 'Absent';
  if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(status)) return 'Unmarked';
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) {
    return lateMinutes > 0 ? `Late (${lateMinutes}m)` : 'Late';
  }
  if (earlyLeaveMinutes > 0) return `Present (early leave ${earlyLeaveMinutes}m)`;
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) return 'Present';
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED) return 'Excused';
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

function scoreStudentAttendanceRecord(record = {}) {
  const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
  const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
  if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) return 0;
  if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(status)) return 35;
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) return 72;
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) return 100;
  if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED) return 85;
  return 55;
}

function computeStudentAttendanceHealth(matrixRow = {}) {
  const records = (Array.isArray(matrixRow?.records) ? matrixRow.records : [])
    .filter((record) => record?.expectedForSession === true);
  if (!records.length) return 100;
  const total = records.reduce((sum, record) => sum + scoreStudentAttendanceRecord(record), 0);
  return Math.round(total / records.length);
}

function countStudentAttendanceBuckets(matrixRow = {}) {
  let presentCount = 0;
  let lateCount = 0;
  let absenceCount = 0;
  (Array.isArray(matrixRow?.records) ? matrixRow.records : []).forEach((record) => {
    if (record?.expectedForSession !== true) return;
    const status = attendanceMatrixMetricsService.normalizeStatus(record?.status);
    const lateMinutes = Math.max(0, Number(record?.lateMinutes) || 0);
    if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) {
      absenceCount += 1;
      return;
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE || lateMinutes > 0) {
      lateCount += 1;
      return;
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT
      || status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED) {
      presentCount += 1;
    }
  });
  return { presentCount, lateCount, absenceCount };
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
    sessions: [],
    skillAverages: [],
    caseCount: 0,
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
  existing.attendanceHealth = mergedHealth;
  existing.sessions = mergedSessions;
  existing.skillAverages = mergeSkillAverages(existing.skillAverages, detailRow.skillAverages);
  existing.caseCount = Number(existing.caseCount || 0) + Number(detailRow.caseCount || 0);
  if (normalizedClassId) existing.classIds.add(normalizedClassId);
  studentMap.set(studentId, existing);
  return studentMap;
}

function buildWeeklyReportsStudentDetailRow(row = {}) {
  return {
    studentId: row.studentId,
    personId: row.personId || '',
    name: row.name || row.studentId,
    sessionCount: Number(row.sessionCount || 0),
    attendanceHealth: Number(row.attendanceHealth || 0),
    presentCount: Number(row.presentCount || 0),
    lateCount: Number(row.lateCount || 0),
    absenceCount: Number(row.absenceCount || 0),
    sessions: Array.isArray(row.sessions) ? row.sessions : [],
    skillAverages: Array.isArray(row.skillAverages) ? row.skillAverages : [],
    caseCount: Number(row.caseCount || 0),
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
  sessionIdSet = new Set()
} = {}) {
  const studentId = toPublicId(matrixRow?.studentRecordId);
  const personId = toPublicId(matrixRow?.personId);
  const attendanceBuckets = countStudentAttendanceBuckets(matrixRow);
  return buildWeeklyReportsStudentDetailRow({
    studentId,
    personId,
    name: String(matrixRow?.name || '').trim() || studentId,
    sessionCount: countExpectedSessionsFromMatrixRow(matrixRow),
    attendanceHealth: computeStudentAttendanceHealth(matrixRow),
    presentCount: attendanceBuckets.presentCount,
    lateCount: attendanceBuckets.lateCount,
    absenceCount: attendanceBuckets.absenceCount,
    sessions: buildStudentSessionRows(matrixRow, sessions),
    skillAverages: buildStudentSkillAverages(gradesPayload, personId, sessionsById),
    caseCount: countStudentCases(caseRows, personId, sessionIdSet),
    classIds: new Set()
  });
}

function filterClassesForWeeklyReports(rows = [], { activeOrgId = '', classIds = [], departmentId = '' } = {}) {
  let scoped = (Array.isArray(rows) ? rows : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveAttendanceClass)
    .filter((row) => classMatchesDepartment(row, departmentId));

  if (classIds.length) {
    const classIdSet = new Set(classIds.map((id) => toPublicId(id)).filter(Boolean));
    scoped = scoped.filter((row) => classIdSet.has(toPublicId(row?.id)));
  }

  return scoped.sort((a, b) => String(a?.title || a?.id || '').localeCompare(String(b?.title || b?.id || '')));
}

async function resolveWeeklyReportsDepartmentOptions(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const departments = await schoolDataService.fetchData('departments', {}, reqUser);
  return (Array.isArray(departments) ? departments : [])
    .filter((row) => !String(row?.orgId || '').trim() || idsEqual(row?.orgId, activeOrgId))
    .map((row) => ({
      id: toPublicId(row?.id),
      name: String(row?.name || row?.code || row?.id || 'Department').trim()
    }))
    .filter((row) => row.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function resolveWeeklyReportsClasses({ reqUser, classIds = [], departmentId = '', activeOrgId = '' } = {}) {
  const classes = await schoolDataService.fetchData('classes', {}, reqUser);
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  return filterClassesForWeeklyReports(classes, {
    activeOrgId,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId
  });
}

async function buildWeeklyReportsClassBoard({
  reqUser,
  classIds = [],
  departmentId = '',
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  const classes = await resolveWeeklyReportsClasses({
    reqUser,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId,
    activeOrgId
  });

  const rows = [];

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    try {
      const payload = await buildAttendanceMatrixPayload({
        user: reqUser,
        query: {
          classId,
          startDate: normalizedStartDate,
          endDate: normalizedEndDate
        }
      });
      const summary = summarizeClassAttendanceMatrix(payload?.matrix || [], payload?.sessions || []);

      const allSessions = await schoolDataService.getClassSessions(classId, reqUser);
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
      const gradebookCount = countGradebooksInSessions(filteredSessions);

      rows.push(buildClassBoardRow(classRow, summary, gradebookCount));
    } catch (error) {
      console.warn(`[weeklyReportsHubService] Skipping class ${classId}: ${error.message}`);
    }
  }

  rows.sort((a, b) => String(a.className || '').localeCompare(String(b.className || '')));

  return {
    view: 'classes',
    rows,
    total: rows.length,
    filters: {
      classIds: normalizedClassIds,
      departmentId: normalizedDepartmentId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate
    },
    refreshedAt: new Date().toISOString()
  };
}

async function buildWeeklyReportsStudentBoard({
  reqUser,
  classIds = [],
  studentIds = [],
  departmentId = '',
  startDate = '',
  endDate = ''
} = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedClassIds = parseFilterIdList(classIds);
  const normalizedStudentIds = parseFilterIdList(studentIds);
  const normalizedDepartmentId = toPublicId(departmentId) || '';
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  const classes = await resolveWeeklyReportsClasses({
    reqUser,
    classIds: normalizedClassIds,
    departmentId: normalizedDepartmentId,
    activeOrgId
  });

  const studentMap = new Map();

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    try {
      const [attendancePayload, gradesPayload, allSessions, caseRows] = await Promise.all([
        buildAttendanceMatrixPayload({
          user: reqUser,
          query: {
            classId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate
          }
        }),
        buildGradesMatrixPayload(
          { user: reqUser },
          {
            classId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate
          }
        ),
        schoolDataService.getClassSessions(classId, reqUser),
        schoolDataService.fetchData('sessionStudentCases', {}, reqUser)
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

      (Array.isArray(attendancePayload?.matrix) ? attendancePayload.matrix : []).forEach((matrixRow) => {
        const detailRow = buildStudentDetailRowFromClass({
          matrixRow,
          sessions: attendancePayload?.sessions || [],
          gradesPayload,
          sessionsById,
          caseRows: classCaseRows,
          sessionIdSet
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
    filters: {
      classIds: normalizedClassIds,
      studentIds: normalizedStudentIds,
      departmentId: normalizedDepartmentId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate
    },
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  parseFilterIdList,
  classMatchesDepartment,
  filterClassesForWeeklyReports,
  filterSessionsForWeeklyReport,
  countGradebooksInSessions,
  summarizeClassAttendanceMatrix,
  buildClassBoardRow,
  countExpectedSessionsFromMatrixRow,
  aggregateMatrixIntoStudentMap,
  formatStudentSessionLabel,
  buildStudentSessionRows,
  computeStudentAttendanceHealth,
  countStudentAttendanceBuckets,
  buildStudentSkillAverages,
  countStudentCases,
  mergeSkillAverages,
  mergeStudentDetailIntoMap,
  buildWeeklyReportsStudentDetailRow,
  buildStudentDetailRowFromClass,
  mapStudentBoardRows,
  resolveWeeklyReportsDepartmentOptions,
  resolveWeeklyReportsClasses,
  buildWeeklyReportsClassBoard,
  buildWeeklyReportsStudentBoard
};
