const schoolDataService = require('./schoolDataService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const weeklyReportsHubService = require('./weeklyReportsHubService');
const weeklyReportsEngagementService = require('./weeklyReportsEngagementService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const studentPunctualityMetricsService = require('./studentPunctualityMetricsService');
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
const { buildGradesMatrixPayload } = require('../../controllers/school/gradesMatrixController');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');

// A Monday–Sunday snap of one calendar year can cover 54 weeks.
const MAX_STUDENT_PROGRESS_WEEKS = 54;

function progressError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeProgressDateKey(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim());
  return match ? match[1] : '';
}

function isoDateKeyToUtcDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function utcDateToIsoDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(iso, days) {
  const date = isoDateKeyToUtcDate(iso);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToIsoDateKey(date);
}

function snapDateKeyToWeekStart(value) {
  const iso = normalizeProgressDateKey(value);
  const date = isoDateKeyToUtcDate(iso);
  if (!date) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return utcDateToIsoDateKey(date);
}

function snapDateKeyToWeekEnd(value) {
  const start = snapDateKeyToWeekStart(value);
  if (!start) return '';
  return addUtcDays(start, 6);
}

function dateKeyInRange(value, startDate, endDate) {
  const date = normalizeProgressDateKey(value);
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function snapStudentProgressRange(startDate, endDate) {
  const snappedStart = snapDateKeyToWeekStart(startDate);
  const snappedEnd = snapDateKeyToWeekEnd(endDate);
  if (!snappedStart || !snappedEnd) {
    throw progressError('Choose a start date and an end date.', 400);
  }
  if (snappedEnd < snappedStart) {
    throw progressError('The end date must be on or after the start date.', 400);
  }

  const startUtc = isoDateKeyToUtcDate(snappedStart);
  const endUtc = isoDateKeyToUtcDate(snappedEnd);
  const daySpan = Math.round((endUtc.getTime() - startUtc.getTime()) / 86400000);
  const weekCount = Math.floor(daySpan / 7) + 1;
  if (weekCount > MAX_STUDENT_PROGRESS_WEEKS) {
    throw progressError('Choose a range of 54 weeks or fewer.', 400);
  }

  const weeks = [];
  let cursor = snappedStart;
  while (cursor <= snappedEnd) {
    weeks.push({
      startDate: cursor,
      endDate: addUtcDays(cursor, 6)
    });
    cursor = addUtcDays(cursor, 7);
  }

  return {
    startDate: snappedStart,
    endDate: snappedEnd,
    weeks
  };
}

function clipStudentProgressRange(range, today) {
  const todayKey = normalizeProgressDateKey(today);
  const sourceWeeks = Array.isArray(range?.weeks) ? range.weeks : [];
  const weeks = todayKey
    ? sourceWeeks.filter((week) => week.startDate <= todayKey)
    : sourceWeeks.slice();
  const currentWeekEnd = todayKey ? snapDateKeyToWeekEnd(todayKey) : '';
  let loadEndDate = String(range?.endDate || '');
  if (currentWeekEnd && loadEndDate && currentWeekEnd < loadEndDate) {
    loadEndDate = currentWeekEnd;
  }
  if (weeks.length) {
    loadEndDate = weeks[weeks.length - 1].endDate;
  }

  return {
    startDate: weeks.length ? weeks[0].startDate : String(range?.startDate || ''),
    endDate: weeks.length ? weeks[weeks.length - 1].endDate : String(range?.endDate || ''),
    loadEndDate,
    weeks,
    noStartedWeeks: weeks.length === 0
  };
}

function averageGradebookActivityPercent({ columns = [], cells = [], week } = {}) {
  const percents = [];
  (Array.isArray(columns) ? columns : []).forEach((column, index) => {
    if (String(column?.kind || '').trim() !== 'gradebook') return;
    if (column?.includeInGradeCalculation === false) return;
    if (!dateKeyInRange(column?.date, week?.startDate, week?.endDate)) return;
    const cell = Array.isArray(cells) ? cells[index] : null;
    if (!cell?.effective || cell.percent == null) return;
    const percent = Number(cell.percent);
    if (!Number.isFinite(percent)) return;
    percents.push(percent);
  });
  if (!percents.length) return null;
  const sum = percents.reduce((total, value) => total + value, 0);
  return Math.round((sum / percents.length) * 10) / 10;
}

function idInList(list, id) {
  const target = toPublicId(id);
  if (!target) return false;
  const values = list instanceof Set
    ? Array.from(list)
    : (Array.isArray(list) ? list : []);
  return values.some((value) => idsEqual(value, target));
}

function readClassName(classRow, classId) {
  return String(classRow?.title || classRow?.name || classId || '').trim() || classId;
}

function classShowsAcf(classRow) {
  return attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classRow)
    .includes(attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF);
}

function sliceMatrixRowToWeek(matrixRow, sessions, week) {
  const records = Array.isArray(matrixRow?.records) ? matrixRow.records : [];
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const slicedRecords = [];
  const slicedSessions = [];
  records.forEach((record, index) => {
    const sessionMeta = sessionList[index] || {};
    const date = normalizeProgressDateKey(record?.date || sessionMeta?.date);
    if (!dateKeyInRange(date, week.startDate, week.endDate)) return;
    slicedRecords.push(record);
    slicedSessions.push(sessionMeta);
  });
  return {
    matrixRow: {
      ...matrixRow,
      records: slicedRecords
    },
    sessions: slicedSessions
  };
}

function sessionIdsInWeek(sessions, week) {
  const ids = new Set();
  (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
    if (!dateKeyInRange(sessionRow?.date, week.startDate, week.endDate)) return;
    const sessionId = toPublicId(sessionRow?.id || sessionRow?.sessionId);
    if (sessionId) ids.add(sessionId);
  });
  return ids;
}

function findGradesRowForPerson(matrix, personId) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return null;
  return (Array.isArray(matrix) ? matrix : []).find((row) => idsEqual(row?.personId, normalizedPersonId)) || null;
}

function buildStudentProgressWeekRow({
  matrixRow,
  sessions,
  week,
  classRow,
  orgPolicyLayer,
  caseRows,
  gradesColumns,
  gradesCells,
  statusMap = null
} = {}) {
  const sliced = sliceMatrixRowToWeek(matrixRow, sessions, week);
  const attendance = weeklyReportsHubService.summarizeStudentAttendanceForWeeklyReport(sliced.matrixRow);
  if (!Number(attendance.sessionCount || 0)) return null;

  const punctuality = studentPunctualityMetricsService.buildStudentPunctualityFromMatrixRow(sliced.matrixRow, {
    classData: classRow,
    orgPolicyLayer,
    sessions: sliced.sessions,
    statusMap
  });

  return {
    startDate: week.startDate,
    endDate: week.endDate,
    engagement: weeklyReportsEngagementService.summarizeEngagementFromStudentMatrixRow(
      sliced.matrixRow,
      classRow,
      orgPolicyLayer
    ),
    attendance,
    punctuality,
    activityAveragePercent: averageGradebookActivityPercent({
      columns: gradesColumns,
      cells: gradesCells,
      week
    }),
    caseCount: weeklyReportsHubService.countStudentCases(
      caseRows,
      matrixRow?.personId,
      sessionIdsInWeek(sessions, week)
    ),
    sessions: weeklyReportsHubService.buildStudentSessionRows(sliced.matrixRow, sliced.sessions)
  };
}

function findMatrixRowForStudent(matrix, studentId) {
  return (Array.isArray(matrix) ? matrix : []).find((row) => (
    idsEqual(row?.studentRecordId, studentId) || idsEqual(row?.studentId, studentId)
  )) || null;
}

function assembleStudentProgressReport({
  studentIds = [],
  weeks = [],
  classes = []
} = {}) {
  const normalizedStudentIds = weeklyReportsHubService.parseFilterIdList(studentIds);
  const classBundles = Array.isArray(classes) ? classes : [];
  const weekWindows = Array.isArray(weeks) ? weeks : [];

  return normalizedStudentIds.map((studentId) => {
    let personId = '';
    let name = '';
    const studentClasses = [];

    classBundles.forEach((bundle) => {
      const classRow = bundle?.classRow || {};
      const classId = toPublicId(classRow?.id || bundle?.classId);
      if (!classId) return;
      if (bundle?.studentIds && !idInList(bundle.studentIds, studentId)) return;

      const matrixRow = findMatrixRowForStudent(bundle?.matrix, studentId);
      if (!matrixRow) return;
      if (!name) name = String(matrixRow?.name || '').trim();
      if (!personId) personId = toPublicId(matrixRow?.personId);
      const gradesRow = findGradesRowForPerson(bundle?.gradesMatrix, personId || matrixRow?.personId);

      const classWeeks = weekWindows
        .map((week) => buildStudentProgressWeekRow({
          matrixRow,
          sessions: bundle?.sessions,
          week,
          classRow,
          orgPolicyLayer: bundle?.orgPolicyLayer || {},
          caseRows: bundle?.caseRows,
          gradesColumns: bundle?.gradesColumns,
          gradesCells: gradesRow?.cells,
          statusMap: bundle?.statusMap || null
        }))
        .filter(Boolean);
      if (!classWeeks.length) return;

      const punctuality = classWeeks.reduce(
        (merged, weekRow) => studentPunctualityMetricsService.mergeStudentPunctualitySummaries(
          merged,
          weekRow.punctuality
        ),
        studentPunctualityMetricsService.emptyStudentPunctualitySummary()
      );

      studentClasses.push({
        classId,
        className: readClassName(classRow, classId),
        showAcfColumn: classShowsAcf(classRow),
        punctuality,
        weeks: classWeeks
      });
    });

    studentClasses.sort((left, right) => (
      String(left.className || '').localeCompare(String(right.className || ''))
      || String(left.classId || '').localeCompare(String(right.classId || ''))
    ));

    return {
      studentId,
      personId,
      name,
      classes: studentClasses
    };
  });
}

function enrollmentSetForClass(matchesByClassId, classId) {
  if (!(matchesByClassId instanceof Map)) return new Set();
  if (matchesByClassId.has(classId)) return matchesByClassId.get(classId);
  for (const [key, value] of matchesByClassId.entries()) {
    if (idsEqual(key, classId)) return value instanceof Set ? value : new Set();
  }
  return new Set();
}

async function buildStudentProgressReport({
  reqUser,
  studentIds = [],
  startDate = '',
  endDate = '',
  orgToday = ''
} = {}) {
  const normalizedStudentIds = weeklyReportsHubService.parseFilterIdList(studentIds);
  if (!normalizedStudentIds.length) {
    throw progressError('Select at least one student.', 400);
  }

  const range = snapStudentProgressRange(startDate, endDate);
  const today = resolveOrgTodayFromContext({ orgToday, user: reqUser });
  const clipped = clipStudentProgressRange(range, today);
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  if (clipped.noStartedWeeks) {
    return {
      students: assembleStudentProgressReport({
        studentIds: normalizedStudentIds,
        weeks: [],
        classes: []
      }),
      range: {
        startDate: clipped.startDate,
        endDate: clipped.endDate
      },
      noStartedWeeks: true,
      refreshedAt: new Date().toISOString()
    };
  }
  const enrollment = await classEnrollmentReadService.listClassStudentMatchesForReportWindow({
    reqUser,
    activeOrgId,
    startDate: clipped.startDate,
    endDate: clipped.loadEndDate,
    selectedStudentRecordIds: normalizedStudentIds
  });
  const classIds = Array.from(enrollment.matchesByClassId.keys());
  const classes = classIds.length
    ? await weeklyReportsHubService.resolveWeeklyReportsClasses({
      reqUser,
      classIds,
      activeOrgId
    })
    : [];

  const allCaseRows = classes.length
    ? await schoolDataService.fetchAllData('sessionStudentCases', {}, reqUser)
    : [];
  const policyCache = new Map();
  const statusMapCache = new Map();
  const classBundles = [];

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    const orgId = toPublicId(classRow?.orgId) || activeOrgId;
    try {
      let statusMap = statusMapCache.get(orgId);
      if (!statusMap) {
        statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
        statusMapCache.set(orgId, statusMap);
      }
      const [attendancePayload, gradesPayload] = await Promise.all([
        buildAttendanceMatrixPayload({
          user: reqUser,
          query: {
            classId,
            startDate: clipped.startDate,
            endDate: clipped.loadEndDate
          }
        }, { applyWindow: false }),
        buildGradesMatrixPayload(
          { user: reqUser },
          {
            classId,
            startDate: clipped.startDate,
            endDate: clipped.loadEndDate
          },
          { includeAttendanceInFinal: true }
        )
      ]);
      let orgPolicyLayer = {};
      if (policyCache.has(orgId)) {
        orgPolicyLayer = policyCache.get(orgId);
      } else {
        orgPolicyLayer = await attendanceMatrixPolicyModel.getPolicyCatalogForOrg(orgId);
        policyCache.set(orgId, orgPolicyLayer || {});
      }
      classBundles.push({
        classRow,
        studentIds: enrollmentSetForClass(enrollment.matchesByClassId, classId),
        matrix: Array.isArray(attendancePayload?.matrix) ? attendancePayload.matrix : [],
        sessions: Array.isArray(attendancePayload?.sessions) ? attendancePayload.sessions : [],
        caseRows: (Array.isArray(allCaseRows) ? allCaseRows : [])
          .filter((row) => idsEqual(row?.classId, classId)),
        orgPolicyLayer: orgPolicyLayer || {},
        statusMap,
        gradesColumns: Array.isArray(gradesPayload?.columns) ? gradesPayload.columns : [],
        gradesMatrix: Array.isArray(gradesPayload?.matrix) ? gradesPayload.matrix : []
      });
    } catch (error) {
      console.warn(`[studentProgressReportService] Skipping class ${classId}: ${error.message}`);
    }
  }

  return {
    students: assembleStudentProgressReport({
      studentIds: normalizedStudentIds,
      weeks: clipped.weeks,
      classes: classBundles
    }),
    range: {
      startDate: clipped.startDate,
      endDate: clipped.endDate
    },
    noStartedWeeks: false,
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  MAX_STUDENT_PROGRESS_WEEKS,
  snapDateKeyToWeekStart,
  snapDateKeyToWeekEnd,
  snapStudentProgressRange,
  clipStudentProgressRange,
  averageGradebookActivityPercent,
  sliceMatrixRowToWeek,
  assembleStudentProgressReport,
  buildStudentProgressReport
};
