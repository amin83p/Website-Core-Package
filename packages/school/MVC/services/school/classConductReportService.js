'use strict';

const { loadGradesMatrixSharedContext } = require('../../controllers/school/gradesMatrixController');
const conductMatrixService = require('./conductMatrixService');
const conductRatingScaleService = require('./conductRatingScaleService');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const {
  buildDateRangeDays,
  resolveSelectedStudents
} = require('./studentAttendanceReportService');
const sarExportConfigService = require('./sarExportConfigService');
const { runWithConcurrency } = require('../../utils/asyncPool');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const DIM_KEYS = conductMatrixService.CONDUCT_DIMENSIONS.map((d) => d.key);

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseIdList(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isActiveClass(row = {}) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function resolveClassDisplayName(classRow = {}, classId = '') {
  const id = String(classId || classRow?.id || '').trim();
  return String(
    classRow?.title
    || classRow?.name
    || classRow?.className
    || id
  ).trim() || id;
}

function isSessionColumnShown(session = {}) {
  return session?.conductRequiredForReports === true || session?.conductReportStepEnabled === true;
}

function computeConductDimensionAverages(sessions, cells, personId) {
  const sums = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
  const counts = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
  let ratedSessions = 0;
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (!isSessionColumnShown(session)) return;
    const sessionId = String(session?.sessionId || '').trim();
    const cell = cells?.[personId]?.[sessionId];
    if (!cell?.onRoster || !cell?.value?.percents) return;
    if (cell.value.summary) ratedSessions += 1;
    DIM_KEYS.forEach((key) => {
      const raw = cell.value.percents[key];
      if (raw == null || raw === '') return;
      const num = Number(raw);
      if (!Number.isFinite(num)) return;
      sums[key] += num;
      counts[key] += 1;
    });
  });
  const averages = {};
  DIM_KEYS.forEach((key) => {
    averages[key] = counts[key] > 0 ? Math.round((sums[key] / counts[key]) * 10) / 10 : null;
  });
  return { averages, ratedSessions };
}

function buildClassConductDayCells(days = [], sessions = [], personId = '', cells = {}) {
  const shownSessions = (Array.isArray(sessions) ? sessions : []).filter(isSessionColumnShown);
  const sessionsByDate = new Map();
  shownSessions.forEach((session) => {
    const date = normalizeDateOnly(session?.date);
    if (!date) return;
    if (!sessionsByDate.has(date)) sessionsByDate.set(date, []);
    sessionsByDate.get(date).push(session);
  });

  return (Array.isArray(days) ? days : []).map((date) => {
    const daySessions = sessionsByDate.get(normalizeDateOnly(date)) || [];
    if (!daySessions.length) {
      return {
        date,
        hasSession: false,
        sessionId: '',
        onRoster: false,
        value: null,
        multiSessionHint: ''
      };
    }
    const first = daySessions[0];
    const sessionId = String(first?.sessionId || '').trim();
    const cell = cells?.[personId]?.[sessionId] || { onRoster: false, value: null };
    const multiSessionHint = daySessions.length > 1
      ? `${daySessions.length} sessions this day; showing first shown session`
      : '';
    return {
      date,
      hasSession: true,
      sessionId,
      onRoster: Boolean(cell.onRoster),
      value: cell.value || null,
      multiSessionHint
    };
  });
}

function initStudentRow({ personId, name, studentRecordId }) {
  return {
    personId,
    studentRecordId,
    name,
    summary: {
      ratedSessions: 0,
      dimensionAverages: Object.fromEntries(DIM_KEYS.map((k) => [k, null]))
    },
    classes: [],
    _ratedSessionCount: 0,
    _dimSums: Object.fromEntries(DIM_KEYS.map((k) => [k, 0])),
    _dimCounts: Object.fromEntries(DIM_KEYS.map((k) => [k, 0]))
  };
}

function accumulateStudentConductRollup(studentRow, classSummary) {
  studentRow._ratedSessionCount += Number(classSummary?.ratedSessions) || 0;
  DIM_KEYS.forEach((key) => {
    const avg = classSummary?.dimensionAverages?.[key];
    if (avg == null || !Number.isFinite(Number(avg))) return;
    studentRow._dimSums[key] += Number(avg);
    studentRow._dimCounts[key] += 1;
  });
}

function finalizeStudentRow(studentRow = {}) {
  const dimensionAverages = {};
  DIM_KEYS.forEach((key) => {
    const count = studentRow._dimCounts[key];
    dimensionAverages[key] = count > 0
      ? Math.round((studentRow._dimSums[key] / count) * 10) / 10
      : null;
  });
  studentRow.summary = {
    ratedSessions: studentRow._ratedSessionCount,
    dimensionAverages
  };
  delete studentRow._ratedSessionCount;
  delete studentRow._dimSums;
  delete studentRow._dimCounts;
  studentRow.classes.sort((a, b) => String(a.className || '').localeCompare(String(b.className || '')));
  return studentRow;
}

async function resolveConductPolicyForRequest(req) {
  const orgId = String(req.user?.activeOrgId || '').trim();
  const orgPolicy = await conductRatingScalePolicyModel.getPolicyForOrg(orgId);
  return conductRatingScaleService.resolvePolicy(orgPolicy);
}

async function resolveAllDatesReportWindow(req, studentIds, activeOrgId) {
  const today = normalizeDateOnly(new Date().toISOString());
  const { matchesByClassId } = await classEnrollmentReadService.listClassStudentMatchesForReportWindow({
    reqUser: req.user,
    activeOrgId,
    startDate: '1970-01-01',
    endDate: today,
    selectedStudentRecordIds: studentIds,
    canonicalStatuses: classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES
  });
  let minDate = '';
  let maxDate = '';
  const classIds = [...matchesByClassId.keys()];
  await Promise.all(classIds.map(async (classId) => {
    const sessions = await schoolDataService.getClassSessions(classId, req.user);
    (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
      const d = normalizeDateOnly(sessionRow?.date);
      if (!d) return;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });
  }));
  if (!minDate || !maxDate) {
    throw new Error('No sessions found for the selected students in All Dates mode.');
  }
  return { startDate: minDate, endDate: maxDate };
}

async function buildClassConductReportPayload(req, options = {}) {
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  let startDate = normalizeDateOnly(query.startDate || options.startDate);
  let endDate = normalizeDateOnly(query.endDate || options.endDate);
  const studentIds = parseIdList(query.studentIds || query.personIds || options.studentIds);

  if (!studentIds.length) {
    throw new Error('Select at least one student.');
  }

  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  if (!startDate && !endDate) {
    const span = await resolveAllDatesReportWindow(req, studentIds, activeOrgId);
    startDate = span.startDate;
    endDate = span.endDate;
  } else if (!startDate || !endDate) {
    throw new Error('Start date and end date are required.');
  }
  if (endDate < startDate) {
    throw new Error('End date must be on or after start date.');
  }

  const days = buildDateRangeDays(startDate, endDate);
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const selectedStudents = await resolveSelectedStudents(req, studentIds);
  if (!selectedStudents.length) {
    throw new Error('No matching students were found for the current selection.');
  }

  const selectedStudentIdSet = new Set(
    selectedStudents.map((row) => String(row.studentRecordId || '').trim()).filter(Boolean)
  );
  const selectedPersonIdSet = new Set(selectedStudents.map((row) => row.personId));
  const studentMap = new Map(
    selectedStudents.map((row) => [row.personId, initStudentRow(row)])
  );

  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext);
  const activeClasses = (Array.isArray(classes) ? classes : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveClass);

  const conductPolicy = await resolveConductPolicyForRequest(req);
  const canonicalStatuses = classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES;

  const { matchesByClassId } = await classEnrollmentReadService.listClassStudentMatchesForReportWindow({
    reqUser: req.user,
    activeOrgId,
    startDate,
    endDate,
    selectedStudentRecordIds: [...selectedStudentIdSet],
    canonicalStatuses
  });

  const classRowById = new Map(
    activeClasses.map((classRow) => [String(classRow?.id || '').trim(), classRow])
  );

  const matrixJobs = [];
  matchesByClassId.forEach((matchedStudentIdSet, classId) => {
    const classRow = classRowById.get(classId);
    if (!classRow) return;
    const matchedStudentIds = [...matchedStudentIdSet].filter((id) => selectedStudentIdSet.has(id));
    if (!matchedStudentIds.length) return;
    const matchedPersonIds = selectedStudents
      .filter((row) => matchedStudentIds.includes(String(row.studentRecordId || '').trim()))
      .map((row) => row.personId)
      .filter((personId) => selectedPersonIdSet.has(personId));
    if (!matchedPersonIds.length) return;
    matrixJobs.push({ classRow, classId, matchedPersonIds });
  });

  const matrixConcurrency = sarExportConfigService.getExportConcurrency();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const matrixTotal = matrixJobs.length;
  let matrixProcessed = 0;
  if (onProgress) {
    onProgress({ processed: 0, total: matrixTotal, phase: 'classMatrix' });
  }

  const matrixResults = await runWithConcurrency(matrixJobs, matrixConcurrency, async (job) => {
    const { classRow, classId, matchedPersonIds } = job;
    const matrixContext = await loadGradesMatrixSharedContext(req, {
      classId,
      startDate,
      endDate
    });
    const payload = await conductMatrixService.buildConductMatrixPayload(
      req,
      { classId, startDate, endDate },
      matrixContext,
      conductPolicy
    );
    matrixProcessed += 1;
    if (onProgress) {
      onProgress({ processed: matrixProcessed, total: matrixTotal, phase: 'classMatrix' });
    }
    return { classRow, classId, matchedPersonIds, payload };
  });

  matrixResults.forEach(({ classRow, classId, matchedPersonIds, payload }) => {
    const className = resolveClassDisplayName(classRow, classId);
    const teacherName = String(
      classRow?.instructors?.[0]?.name
      || classRow?.instructors?.[0]?.displayName
      || ''
    ).trim();
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const cells = payload?.cells && typeof payload.cells === 'object' ? payload.cells : {};

    matchedPersonIds.forEach((personId) => {
      if (!studentMap.has(personId)) return;
      const studentRow = studentMap.get(personId);
      const { averages, ratedSessions } = computeConductDimensionAverages(sessions, cells, personId);
      const classDays = buildClassConductDayCells(days, sessions, personId, cells);
      const hasAnySession = classDays.some((d) => d.hasSession);
      if (!hasAnySession && ratedSessions === 0) return;

      const classSummary = {
        ratedSessions,
        dimensionAverages: averages
      };
      studentRow.classes.push({
        classId,
        className,
        teacherName,
        summary: classSummary,
        days: classDays
      });
      accumulateStudentConductRollup(studentRow, classSummary);
    });
  });

  const rankByStudentId = new Map();
  studentIds.forEach((studentId, index) => {
    const key = String(studentId || '').trim();
    if (key) rankByStudentId.set(key, index);
  });

  const students = [...studentMap.values()].map((row) => finalizeStudentRow(row));
  students.sort((a, b) => {
    const aKey = String(a.studentRecordId || '').trim();
    const bKey = String(b.studentRecordId || '').trim();
    const aRank = rankByStudentId.has(aKey)
      ? rankByStudentId.get(aKey)
      : rankByStudentId.get(String(a.personId || '').trim());
    const bRank = rankByStudentId.has(bKey)
      ? rankByStudentId.get(bKey)
      : rankByStudentId.get(String(b.personId || '').trim());
    const aIndex = Number.isFinite(Number(aRank)) ? Number(aRank) : 9999;
    const bIndex = Number.isFinite(Number(bRank)) ? Number(bRank) : 9999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    startDate,
    endDate,
    days,
    conductPolicy: conductRatingScaleService.resolvePolicy(conductPolicy),
    dimensions: conductMatrixService.CONDUCT_DIMENSIONS.map(({ key, label }) => ({ key, label })),
    students
  };
}

module.exports = {
  buildClassConductDayCells,
  computeConductDimensionAverages,
  isSessionColumnShown,
  buildClassConductReportPayload,
  resolveConductPolicyForRequest
};
