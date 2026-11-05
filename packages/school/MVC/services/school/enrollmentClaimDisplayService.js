'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security/index');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const attendanceOperationPolicyService = require('./attendanceOperationPolicyService');
const { userCanMarkAttendanceExcused } = require('./attendanceMatrixAccessService');
const schoolDataService = require('./schoolDataService');
const {
  resolveClaimEntriesForEnrollmentPeriods,
  formatClaimNumbersDisplay
} = require('./studentAttendanceReportService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');

const CLAIM_DISPLAY_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const MAX_STUDENTS = 500;

const PAGES = Object.freeze({
  ATTENDANCE_MATRIX: 'attendance-matrix',
  ATTENDANCE_REPORT: 'attendance-report',
  GRADES_MATRIX: 'grades-matrix',
  SEMI_MONTHLY: 'semi-monthly',
  CONDUCT_MATRIX: 'conduct-matrix',
  CONDUCT_REPORT: 'conduct-report'
});

const PAGE_ACCESS = Object.freeze({
  [PAGES.ATTENDANCE_MATRIX]: { kind: 'attendance' },
  [PAGES.ATTENDANCE_REPORT]: { kind: 'attendance' },
  [PAGES.GRADES_MATRIX]: {
    kind: 'section',
    sectionId: SECTIONS.SCHOOL_GRADEBOOK,
    operationId: OPERATIONS.READ_ALL
  },
  [PAGES.SEMI_MONTHLY]: {
    kind: 'section',
    sectionId: SECTIONS.SCHOOL_SEMI_MONTHLY_REPORT,
    operationId: OPERATIONS.READ
  },
  [PAGES.CONDUCT_MATRIX]: {
    kind: 'section',
    sectionId: SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX,
    operationId: OPERATIONS.READ_ALL
  },
  [PAGES.CONDUCT_REPORT]: {
    kind: 'section',
    sectionId: SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT,
    operationId: OPERATIONS.READ
  }
});

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function periodsOverlappingWindow(periodRows = [], startDate = '', endDate = '') {
  const ws = normalizeDateOnly(startDate) || '0000-01-01';
  const we = normalizeDateOnly(endDate) || '9999-12-31';
  return (Array.isArray(periodRows) ? periodRows : []).filter((row) => {
    const start = normalizeDateOnly(row?.startDate);
    if (!start) return false;
    const effectiveEnd = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row) || '9999-12-31';
    return start <= we && effectiveEnd >= ws;
  });
}

function scopeAllowsClaimDisplay(scopeId) {
  const mode = attendanceOperationPolicyService.normalizeScopeMode(scopeId);
  return Boolean(mode && CLAIM_DISPLAY_SCOPES.includes(mode));
}

function normalizeStudentList(students = []) {
  const list = Array.isArray(students) ? students : [];
  const seen = new Set();
  const out = [];
  list.forEach((row) => {
    const personId = normalizeId(row?.personId);
    const studentRecordId = normalizeId(row?.studentRecordId || row?.id);
    if (!personId && !studentRecordId) return;
    const key = `${personId}|${studentRecordId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ personId, studentRecordId });
  });
  return out.slice(0, MAX_STUDENTS);
}

async function canShowOnAttendancePages(user, ipAddress, deps = {}) {
  const check = deps.userCanMarkAttendanceExcused || userCanMarkAttendanceExcused;
  return Boolean(await check(user, ipAddress));
}

async function canShowOnSectionPage(user, sectionId, options = {}, deps = {}) {
  const operationId = normalizeId(options.operationId) || OPERATIONS.READ_ALL;
  const ipAddress = options.ipAddress;
  if (!user || !normalizeId(sectionId)) return false;

  const isAdminFn = deps.isAdminForRequestAsync
    || ((adminUser, adminSectionId, adminOperationId) => (
      schoolAdminAccessService.isAdminForRequestAsync(adminUser, adminSectionId, adminOperationId)
    ));
  try {
    if (await isAdminFn(user, sectionId, operationId)) return true;
  } catch (_err) {
    /* fall through to scoped read */
  }

  const evaluateFn = deps.evaluateAccess || ((payload) => accessService.evaluateAccess(payload));
  let evaluation = { allowed: false };
  try {
    evaluation = await evaluateFn({
      user,
      sectionId,
      operationId,
      ipAddress
    });
  } catch (_err) {
    return false;
  }
  return Boolean(evaluation?.allowed && scopeAllowsClaimDisplay(evaluation.scopeId));
}

async function canShowForPage(user, page, ipAddress, deps = {}) {
  const spec = PAGE_ACCESS[normalizeId(page)];
  if (!spec) return false;
  if (spec.kind === 'attendance') {
    return canShowOnAttendancePages(user, ipAddress, deps);
  }
  return canShowOnSectionPage(user, spec.sectionId, {
    operationId: spec.operationId,
    ipAddress
  }, deps);
}

async function loadPeriodRows({
  classId,
  students,
  requestingUser,
  dataService
}) {
  const cid = normalizeId(classId);
  if (cid) {
    const rows = await dataService.getClassEnrollmentPeriodsByClassId(cid, requestingUser).catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }
  const studentIds = Array.from(new Set(
    (Array.isArray(students) ? students : [])
      .map((row) => normalizeId(row?.studentRecordId))
      .filter(Boolean)
  ));
  const collected = [];
  for (const studentId of studentIds) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await dataService.getClassEnrollmentPeriodsByStudentId(studentId, requestingUser).catch(() => []);
    if (Array.isArray(rows) && rows.length) collected.push(...rows);
  }
  return collected;
}

function resolveStudentRecord(studentMaps, personId, studentRecordId) {
  if (studentRecordId && studentMaps.byId.has(studentRecordId)) {
    return studentMaps.byId.get(studentRecordId);
  }
  if (personId && studentMaps.byPersonId.has(personId)) {
    return studentMaps.byPersonId.get(personId);
  }
  return null;
}

function buildStudentMaps(allStudents = []) {
  const byId = new Map();
  const byPersonId = new Map();
  const studentToPersonMap = new Map();
  (Array.isArray(allStudents) ? allStudents : []).forEach((row) => {
    const id = normalizeId(row?.id || row?.studentRecordId);
    const personId = normalizeId(row?.personId || row?.userId);
    if (id) byId.set(id, row);
    if (personId) byPersonId.set(personId, row);
    if (id && personId) studentToPersonMap.set(id, personId);
  });
  return { byId, byPersonId, studentToPersonMap };
}

async function loadClaimsForWindow({
  orgId: _orgId,
  classId,
  startDate,
  endDate,
  students,
  requestingUser
} = {}, deps = {}) {
  const dataService = deps.schoolDataService || schoolDataService;
  const requested = normalizeStudentList(students);
  const claims = {};
  if (!requested.length) return claims;

  const [periodRows, allStudents] = await Promise.all([
    loadPeriodRows({
      classId,
      students: requested,
      requestingUser,
      dataService
    }),
    dataService.fetchAllData('students', {}, requestingUser).catch(() => [])
  ]);
  const studentMaps = buildStudentMaps(allStudents);
  const studentToPersonMap = studentMaps.studentToPersonMap;
  const overlappingPeriods = periodsOverlappingWindow(periodRows, startDate, endDate);

  requested.forEach((row) => {
    let studentRecordId = normalizeId(row.studentRecordId);
    const personId = normalizeId(row.personId);
    const student = resolveStudentRecord(studentMaps, personId, studentRecordId);
    if (!studentRecordId) {
      studentRecordId = normalizeId(student?.id || student?.studentRecordId);
    }
    const entries = resolveClaimEntriesForEnrollmentPeriods({
      periodRows: overlappingPeriods,
      studentToPersonMap,
      personId,
      studentRecordId,
      windowStart: startDate,
      windowEnd: endDate,
      student
    });
    const displayLine = formatClaimNumbersDisplay(entries);
    const payload = { displayLine, entries };
    if (personId) claims[personId] = payload;
    if (studentRecordId && studentRecordId !== personId) claims[studentRecordId] = payload;
  });

  return claims;
}

module.exports = {
  PAGES,
  PAGE_ACCESS,
  CLAIM_DISPLAY_SCOPES,
  canShowOnAttendancePages,
  canShowOnSectionPage,
  canShowForPage,
  loadClaimsForWindow,
  scopeAllowsClaimDisplay,
  normalizeStudentList
};
