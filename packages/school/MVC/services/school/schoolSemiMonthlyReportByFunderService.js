'use strict';

const schoolDataService = require('./schoolDataService');
const rollingEnrollmentPeriodFilterService = require('./rollingEnrollmentPeriodFilterService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const reportFunderDocxService = require('./reportFunderDocxService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const TERMINAL_PERIOD_STATUSES = new Set([
  'withdrawn',
  'cancelled',
  'void',
  'archived',
  'error'
]);

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function periodStatusToken(period = {}) {
  return String(period?.status || '').trim().toLowerCase();
}

function periodQualifiesForFunderSelection(period = {}) {
  if (classEnrollmentSessionApplicabilityService.isManualScheduledCloseForAttendance(period)) {
    return true;
  }
  const status = periodStatusToken(period);
  if (status === 'active') return true;
  if (TERMINAL_PERIOD_STATUSES.has(status)) return false;
  return false;
}

function periodOverlapsReportRange(period = {}, rangeStart = '', rangeEnd = '') {
  const start = normalizeDateOnly(period?.startDate);
  const effectiveEnd = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(period);
  const rs = normalizeDateOnly(rangeStart);
  const re = normalizeDateOnly(rangeEnd);
  if (!start || !rs || !re) return false;
  const end = normalizeDateOnly(effectiveEnd) || '9999-12-31';
  return start <= re && end >= rs;
}

function buildCapSummary(period = {}) {
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(
    period?.targetSessionCount
  );
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours);
  const summary = (period?.cycleAttendanceSummary && typeof period.cycleAttendanceSummary === 'object')
    ? period.cycleAttendanceSummary
    : {};
  const parts = [];
  if (targetSessionCount > 0) {
    parts.push(`${targetSessionCount} session cap`);
    const consumed = Number(summary.consumedSessions);
    const remaining = Number(summary.remainingSessions);
    if (Number.isFinite(consumed)) parts.push(`${consumed} consumed`);
    if (Number.isFinite(remaining)) parts.push(`${remaining} remaining`);
  }
  if (targetHours > 0) {
    parts.push(`${targetHours} hour cap`);
    const consumedHours = Number(summary.consumedHours);
    const remainingHours = Number(summary.remainingHours);
    if (Number.isFinite(consumedHours)) parts.push(`${consumedHours}h consumed`);
    if (Number.isFinite(remainingHours)) parts.push(`${remainingHours}h remaining`);
  }
  if (!parts.length) parts.push('No session/hour cap');
  return parts.join(' · ');
}

function serializeClassEnrollmentRow(period = {}, classById = new Map()) {
  const classId = toPublicId(period?.classId) || String(period?.classId || '').trim();
  const classRow = classById.get(classId);
  const className = String(classRow?.name || classRow?.title || classId).trim();
  const effectiveEnd = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(period);
  const claimNumber = String(period?.claimNumber || '').trim();
  return {
    classId,
    className,
    periodId: toPublicId(period?.id) || String(period?.id || '').trim(),
    status: periodStatusToken(period) || 'draft',
    startDate: normalizeDateOnly(period?.startDate),
    effectiveEndDate: normalizeDateOnly(effectiveEnd),
    targetSessionCount: classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(
      period?.targetSessionCount
    ),
    targetHours: classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours),
    claimNumber,
    capSummary: buildCapSummary(period),
    manualScheduledClose: classEnrollmentSessionApplicabilityService.isManualScheduledCloseForAttendance(period)
  };
}

function buildStudentLabelLookup(students = [], personById = new Map()) {
  const byStudentId = new Map();
  (Array.isArray(students) ? students : []).forEach((student) => {
    const studentRecordId = toPublicId(student?.id);
    const personId = toPublicId(student?.personId);
    if (!studentRecordId) return;
    const person = personById.get(personId);
    const name = schoolPersonAccessService.formatPersonName(person, studentRecordId);
    const label = student?.studentNumber ? `${name} (${student.studentNumber})` : name;
    byStudentId.set(studentRecordId, { name: label || name || studentRecordId, personId, studentRecordId });
  });
  return byStudentId;
}

function groupPeriodsByStudent(matchingPeriods = [], classById = new Map(), studentLabelById = new Map()) {
  const byStudent = new Map();
  (Array.isArray(matchingPeriods) ? matchingPeriods : []).forEach((period) => {
    const studentRecordId = toPublicId(period?.studentId) || String(period?.studentId || '').trim();
    if (!studentRecordId) return;
    const classRow = serializeClassEnrollmentRow(period, classById);
    if (!byStudent.has(studentRecordId)) {
      const meta = studentLabelById.get(studentRecordId) || {
        studentRecordId,
        personId: '',
        name: studentRecordId
      };
      byStudent.set(studentRecordId, {
        studentRecordId,
        personId: String(meta.personId || '').trim(),
        name: String(meta.name || studentRecordId).trim(),
        classes: []
      });
    }
    byStudent.get(studentRecordId).classes.push(classRow);
  });
  return [...byStudent.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function isActiveClass(row = {}) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function resolveFunderLabel(funderId = '', funderOptions = []) {
  const token = String(funderId || '').trim();
  const match = (Array.isArray(funderOptions) ? funderOptions : []).find((row) => (
    idsEqual(row?.id, token) || String(row?.id || '').toLowerCase() === token.toLowerCase()
  ));
  return match?.label || (token.toLowerCase() === 'self' ? 'Self Fund' : token);
}

async function buildFunderStudentSelectionPayload(req, options = {}) {
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  const funderId = String(options.funderId || query.funderId || '').trim();
  const startDate = normalizeDateOnly(options.startDate || query.startDate);
  const endDate = normalizeDateOnly(options.endDate || query.endDate);

  if (!funderId) {
    const err = new Error('Choose a funder.');
    err.statusCode = 400;
    throw err;
  }
  if (!startDate || !endDate) {
    const err = new Error('Start date and end date are required.');
    err.statusCode = 400;
    throw err;
  }
  if (endDate < startDate) {
    const err = new Error('End date must be on or after start date.');
    err.statusCode = 400;
    throw err;
  }

  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);

  const [allPeriods, classes, students, activeFunders] = await Promise.all([
    schoolDataService.getAccessibleClassEnrollmentPeriods(req.user),
    schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext),
    schoolDataService.fetchAllData('students', {}, req.user, routeAccessContext),
    activeOrgId
      ? reportFunderDocxService.loadActiveFunderOptions(req.user, activeOrgId).catch(() => [])
      : Promise.resolve([])
  ]);

  const funderPickerOptions = reportFunderDocxService.buildFunderPickerOptions(activeFunders);
  const funderLabel = resolveFunderLabel(funderId, funderPickerOptions);

  const classById = new Map();
  (Array.isArray(classes) ? classes : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveClass)
    .forEach((row) => {
      const id = toPublicId(row?.id);
      if (id) classById.set(id, row);
    });

  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds: (Array.isArray(students) ? students : []).map((row) => row.personId)
  });
  const studentLabelById = buildStudentLabelLookup(students, personById);

  const matchingPeriods = (Array.isArray(allPeriods) ? allPeriods : []).filter((period) => {
    if (activeOrgId && !classBelongsToActiveOrg(period, activeOrgId)) return false;
    if (!rollingEnrollmentPeriodFilterService.matchesFunderFilter(period, funderId)) return false;
    if (!periodQualifiesForFunderSelection(period)) return false;
    if (!periodOverlapsReportRange(period, startDate, endDate)) return false;
    const classId = toPublicId(period?.classId);
    if (!classId || !classById.has(classId)) return false;
    return true;
  });

  const studentsGrouped = groupPeriodsByStudent(matchingPeriods, classById, studentLabelById);

  return {
    funderId,
    funderLabel,
    startDate,
    endDate,
    students: studentsGrouped,
    totalCount: studentsGrouped.length
  };
}

module.exports = {
  buildFunderStudentSelectionPayload,
  periodQualifiesForFunderSelection,
  periodOverlapsReportRange,
  groupPeriodsByStudent,
  serializeClassEnrollmentRow,
  buildCapSummary
};
