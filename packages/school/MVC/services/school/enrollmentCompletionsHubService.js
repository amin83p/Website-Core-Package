const schoolDataService = require('./schoolDataService');
const weeklyReportsHubService = require('./weeklyReportsHubService');
const sessionEnrollmentContextService = require('./sessionEnrollmentContextService');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const personDisplayNameService = require('./personDisplayNameService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const EXCLUDED_PERIOD_STATUSES = new Set([
  'draft',
  'planned',
  'to_be_confirmed',
  'waiting_list',
  'cancelled',
  'archived',
  'error',
  'void',
  'voided',
  'rolled_back'
]);

function hubError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(token);
  return match ? match[1] : '';
}

function parseMonthKey(monthValue = '') {
  const token = String(monthValue || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(token);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const monthStart = `${match[1]}-${match[2]}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
  return { monthKey: token, monthStart, monthEnd, monthLabel };
}

function dateInMonth(dateOnly, monthKey) {
  const date = normalizeDateOnly(dateOnly);
  if (!date || !monthKey) return false;
  return date.slice(0, 7) === String(monthKey).trim();
}

function isRollingClass(classRow = {}) {
  return String(classRow?.registrationMode || '').trim().toLowerCase() === 'rolling';
}

function isIncludedPeriodStatus(period = {}) {
  const status = String(period?.status || '').trim().toLowerCase();
  if (!status) return false;
  return !EXCLUDED_PERIOD_STATUSES.has(status);
}

function formatTeacherNames(classRow = {}, personNameById = new Map()) {
  const instructors = (Array.isArray(classRow?.instructors) ? classRow.instructors : [])
    .filter((row) => weeklyReportsHubService.isActiveClassInstructor(row));
  const names = instructors.map((row) => {
    const personId = toPublicId(row?.personId);
    const fromMap = personId ? String(personNameById.get(personId) || '').trim() : '';
    if (fromMap) return fromMap;
    return String(row?.name || row?.displayName || '').trim();
  }).filter(Boolean);
  return names.length ? names.join(', ') : 'Unassigned';
}

function buildEnrollmentPeriodNotes({
  period = {},
  periodRows = [],
  effectiveFinish = '',
  studentPersonId = '',
  studentToPersonMap = new Map()
} = {}) {
  const parts = [];
  const resolvePerson = classEnrollmentSessionApplicabilityService.resolveStudentPersonId;
  const periodId = toPublicId(period?.id);

  if (period?.enrollmentKind === 'extension' || period?.extensionOfPeriodId) {
    parts.push('Extension enrollment');
  }

  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (!idsEqual(row?.extensionOfPeriodId, periodId)) return;
    if (idsEqual(row?.id, periodId)) return;
    const label = String(row?.enrollmentKind || 'extension').trim();
    parts.push(`Linked extension (${label}) starting ${normalizeDateOnly(row?.startDate) || '—'}`);
  });

  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (idsEqual(row?.id, periodId)) return;
    if (!idsEqual(resolvePerson(row, studentToPersonMap), studentPersonId)) return;
    const start = normalizeDateOnly(row?.startDate);
    if (!start || !effectiveFinish || start <= effectiveFinish) return;
    const kind = String(row?.enrollmentKind || row?.status || 'enrollment').trim();
    parts.push(`Follow-on: ${start} (${kind})`);
  });

  const reasonStart = String(period?.reasonStart || '').trim();
  if (reasonStart) parts.push(reasonStart);
  const notes = String(period?.notes || '').trim();
  if (notes) parts.push(notes.slice(0, 200));

  return parts.join('; ');
}

function formatAttendanceLabel(summary = {}) {
  const sessionCount = Math.max(0, Number(summary?.sessionCount) || 0);
  const presentCount = Math.max(0, Number(summary?.presentCount) || 0);
  if (!sessionCount) return '—';
  const percent = Math.round((presentCount / sessionCount) * 1000) / 10;
  return `${percent}% (${presentCount}/${sessionCount})`;
}

function buildPersonNameMap(students = [], persons = [], teachers = []) {
  const map = new Map();
  (Array.isArray(persons) ? persons : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    map.set(id, personDisplayNameService.buildPersonDisplayName(row, id));
  });
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    const fallback = String(row?.name || row?.fullName || row?.displayName || '').trim();
    map.set(personId, personDisplayNameService.buildPersonDisplayName(row, fallback || personId));
  });
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    const fallback = String(row?.name || row?.displayName || '').trim();
    map.set(personId, personDisplayNameService.buildPersonDisplayName(row, fallback || personId));
  });
  return map;
}

function sortCompletionRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const nameCompare = String(a?.studentName || '').localeCompare(String(b?.studentName || ''));
    if (nameCompare !== 0) return nameCompare;
    return String(a?.className || '').localeCompare(String(b?.className || ''));
  });
}

async function resolveFilterOptions(reqUser = {}) {
  const [departmentOptions, programOptions] = await Promise.all([
    weeklyReportsHubService.resolveWeeklyReportsDepartmentOptions(reqUser),
    weeklyReportsHubService.resolveWeeklyReportsProgramOptions(reqUser)
  ]);
  return { departmentOptions, programOptions };
}

async function summarizeEnrollmentWindowAttendance({
  reqUser,
  classId,
  personId,
  startDate,
  endDate,
  statusMap,
  cache = new Map()
} = {}) {
  const cacheKey = `${classId}|${startDate}|${endDate}`;
  let payload = cache.get(cacheKey);
  if (!payload) {
    payload = await buildAttendanceMatrixPayload({
      user: reqUser,
      query: { classId, startDate, endDate }
    }, { applyWindow: false });
    cache.set(cacheKey, payload);
  }
  const matrixRow = (Array.isArray(payload?.matrix) ? payload.matrix : [])
    .find((row) => idsEqual(row?.personId, personId));
  const summary = weeklyReportsHubService.summarizeStudentAttendanceForWeeklyReport(matrixRow || {});
  return summary;
}

async function buildEnrollmentCompletionsReport({
  reqUser,
  orgToday = '',
  month,
  departmentIds = [],
  programIds = []
} = {}) {
  const parsedMonth = parseMonthKey(month);
  if (!parsedMonth) {
    throw hubError('Choose a valid month (YYYY-MM).');
  }

  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedDepartmentIds = weeklyReportsHubService.parseFilterIdList(departmentIds);
  const normalizedProgramIds = weeklyReportsHubService.parseFilterIdList(programIds);

  const allClasses = await schoolDataService.fetchAllData('classes', {}, reqUser);
  const classes = weeklyReportsHubService
    .filterClassesForEnrollmentCompletions(allClasses, {
      activeOrgId,
      departmentIds: normalizedDepartmentIds,
      programIds: normalizedProgramIds
    })
    .filter(isRollingClass);

  const [students, teachers, persons] = await Promise.all([
    schoolDataService.fetchAllData('students', {}, reqUser),
    schoolDataService.fetchAllData('teachers', {}, reqUser),
    schoolDataService.fetchAllData('persons', {}, reqUser).catch(() => [])
  ]);

  const personNameById = buildPersonNameMap(students, persons, teachers);
  const studentToPersonMap = classEnrollmentSessionApplicabilityService.normalizeStudentToPersonMap(students);
  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
    students,
    activeOrgId
  );

  const statusMapByOrgKey = new Map();
  const matrixCache = new Map();
  const rows = [];
  const studentIdsInReport = new Set();

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
    if (!Array.isArray(periodRows) || !periodRows.length) continue;

    const enrichedPeriods = await classEnrollmentPeriodProgressService.attachSessionProgressToEnrollmentPeriodRows(
      periodRows,
      classRow,
      reqUser,
      students
    );

    const orgKey = String(toPublicId(classRow?.orgId) || activeOrgId || '').trim();
    let statusMap = statusMapByOrgKey.get(orgKey);
    if (!statusMap) {
      statusMap = await sessionStatusPolicyService.getStatusMap(
        classRow?.orgId || activeOrgId,
        { includeInactive: true }
      );
      statusMapByOrgKey.set(orgKey, statusMap);
    }

    const sessions = await schoolDataService.getClassSessions(classId, reqUser);

    for (const period of enrichedPeriods) {
      if (!isIncludedPeriodStatus(period)) continue;

      const enrichedRow = period;
      const effectiveFinish = sessionEnrollmentContextService.resolveExpectedFinishDate({
        period,
        sessions,
        statusMap,
        enrichedPeriodRow: enrichedRow
      });
      if (!dateInMonth(effectiveFinish, parsedMonth.monthKey)) continue;

      const studentPersonId = classEnrollmentSessionApplicabilityService.resolveStudentPersonId(
        period,
        studentToPersonMap
      );
      if (!studentPersonId) continue;

      const startDate = normalizeDateOnly(period?.startDate);
      const attendanceSummary = await summarizeEnrollmentWindowAttendance({
        reqUser,
        classId,
        personId: studentPersonId,
        startDate: startDate || parsedMonth.monthStart,
        endDate: effectiveFinish,
        statusMap,
        cache: matrixCache
      });

      const studentRecordId = schoolStudentProfileLinkService.resolveStudentRecordId({
        personId: studentPersonId,
        personToStudentMap
      });
      const studentName = personNameById.get(studentPersonId)
        || String(period?.studentName || '').trim()
        || studentPersonId;

      studentIdsInReport.add(studentPersonId);

      const enrollmentKind = String(period?.enrollmentKind || '').trim();
      const periodStatus = String(period?.status || '').trim();
      const completionDecision = String(period?.completionDecision || '').trim();

      rows.push({
        enrollmentPeriodId: toPublicId(period?.id),
        studentPersonId,
        studentRecordId,
        studentName,
        classId,
        className: String(classRow?.title || classRow?.name || classId).trim(),
        departmentId: toPublicId(classRow?.deliveryDepartmentId) || '',
        departmentName: String(classRow?.deliveryDepartmentName || '').trim(),
        teacherNames: formatTeacherNames(classRow, personNameById),
        enrollmentStartDate: startDate,
        enrollmentFinishDate: effectiveFinish,
        enrollmentKind,
        enrollmentLabel: startDate && effectiveFinish ? `${startDate} – ${effectiveFinish}` : '—',
        notes: buildEnrollmentPeriodNotes({
          period,
          periodRows: enrichedPeriods,
          effectiveFinish,
          studentPersonId,
          studentToPersonMap
        }),
        attendance: attendanceSummary,
        attendanceLabel: formatAttendanceLabel(attendanceSummary),
        status: periodStatus,
        completionDecision
      });
    }
  }

  const sortedRows = sortCompletionRows(rows);

  return {
    rows: sortedRows,
    filters: {
      month: parsedMonth.monthKey,
      departmentIds: normalizedDepartmentIds,
      programIds: normalizedProgramIds,
      orgToday: String(orgToday || '').trim()
    },
    summary: {
      totalRows: sortedRows.length,
      totalStudents: studentIdsInReport.size
    },
    monthLabel: parsedMonth.monthLabel,
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  EXCLUDED_PERIOD_STATUSES,
  parseMonthKey,
  dateInMonth,
  isRollingClass,
  isIncludedPeriodStatus,
  formatTeacherNames,
  buildEnrollmentPeriodNotes,
  buildPersonNameMap,
  formatAttendanceLabel,
  sortCompletionRows,
  resolveFilterOptions,
  buildEnrollmentCompletionsReport
};