const schoolDataService = require('./schoolDataService');
const schoolDependencyService = require('./schoolDependencyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const enrollmentHrefs = Object.freeze({
  enrollments: (id) => `/school/classes/enrollment-periods/${encodeURIComponent(id)}`,
  sessions: (classId, sessionId) => `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`,
  termRegistration: (id) => `/school/students/term-registrations/${encodeURIComponent(id)}`,
  transactions: (id) => `/school/transactions/edit/${encodeURIComponent(id)}`
});

const CARRY_FORWARD_SPLIT_RE = /continuation split from\s+([A-Za-z0-9:_\/-]+)/i;
const CARRY_FORWARD_MOVE_RE = /moved whole period from\s+([A-Za-z0-9:_\/-]+)/i;

const ENROLLMENT_ORIGIN = Object.freeze({
  NATIVE: 'native',
  CARRY_FORWARD: 'carry_forward',
  TERM_REGISTRATION: 'term_registration'
});

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function dateInRange(date, startDate, endDate) {
  const day = normalizeDateOnly(date);
  if (!day) return false;
  const start = normalizeDateOnly(startDate) || '0000-01-01';
  const end = normalizeDateOnly(endDate) || '9999-12-31';
  return day >= start && day <= end;
}

function periodsOverlap(sessionDate, periodStart, periodEnd) {
  return dateInRange(sessionDate, periodStart, periodEnd);
}

function parseOriginClassIdFromReasonStart(reasonStart = '') {
  const text = String(reasonStart || '').trim();
  if (!text) return '';
  const splitMatch = text.match(CARRY_FORWARD_SPLIT_RE);
  if (splitMatch?.[1]) return toPublicId(splitMatch[1]);
  const moveMatch = text.match(CARRY_FORWARD_MOVE_RE);
  if (moveMatch?.[1]) return toPublicId(moveMatch[1]);
  return '';
}

function classifyEnrollmentPeriod(period = {}) {
  const enrollmentSource = String(period?.enrollmentSource || '').trim().toLowerCase();
  if (enrollmentSource === 'term_registration') {
    return ENROLLMENT_ORIGIN.TERM_REGISTRATION;
  }
  const reasonStart = String(period?.reasonStart || '').trim();
  if (CARRY_FORWARD_SPLIT_RE.test(reasonStart) || CARRY_FORWARD_MOVE_RE.test(reasonStart)) {
    return ENROLLMENT_ORIGIN.CARRY_FORWARD;
  }
  return ENROLLMENT_ORIGIN.NATIVE;
}

async function resolveStudentLabel(studentId, reqUser) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) return '';
  const student = await schoolDataService.getDataById('students', normalizedStudentId, reqUser);
  if (!student) return normalizedStudentId;
  return String(student?.displayName || student?.name || student?.fullName || normalizedStudentId).trim();
}

async function resolveUpstreamSummary(period, reqUser) {
  const originClassId = parseOriginClassIdFromReasonStart(period?.reasonStart);
  if (!originClassId) return null;

  const [originClass, upstreamRows] = await Promise.all([
    schoolDataService.getDataById('classes', originClassId, reqUser),
    schoolDataService.fetchData('classEnrollmentPeriods', {
      page: 1,
      classId__eq: originClassId,
      studentId__eq: toPublicId(period?.studentId)
    }, reqUser)
  ]);

  const rows = Array.isArray(upstreamRows) ? upstreamRows : [];
  const reasonStart = String(period?.reasonStart || '').trim();
  const isWholeMove = CARRY_FORWARD_MOVE_RE.test(reasonStart);
  const preferredStatus = isWholeMove ? 'cancelled' : 'completed';

  const upstreamPeriod = rows.find((row) => String(row?.status || '').trim().toLowerCase() === preferredStatus)
    || rows.find((row) => ['completed', 'cancelled'].includes(String(row?.status || '').trim().toLowerCase()))
    || null;

  return {
    originClassId,
    originClassTitle: String(originClass?.title || originClass?.name || originClassId).trim(),
    originCycleNo: Number.parseInt(String(originClass?.cycleNo || ''), 10) || null,
    upstreamPeriodId: toPublicId(upstreamPeriod?.id),
    upstreamStatus: String(upstreamPeriod?.status || preferredStatus).trim().toLowerCase() || preferredStatus,
    upstreamStartDate: normalizeDateOnly(upstreamPeriod?.startDate),
    upstreamEndDate: normalizeDateOnly(upstreamPeriod?.endDate)
  };
}

async function countRelatedEnrollmentRecords(period, classRow, reqUser) {
  const classId = toPublicId(classRow?.id || period?.classId);
  const studentId = toPublicId(period?.studentId);
  const periodStart = normalizeDateOnly(period?.startDate);
  const periodEnd = normalizeDateOnly(period?.endDate);

  const [
    examAssignments,
    examAllocations,
    reportInstances,
    sessionCases
  ] = await Promise.all([
    schoolDataService.fetchData('examAssignments', { page: 1, classId__eq: classId, studentId__eq: studentId }, reqUser),
    schoolDataService.fetchData('examAllocations', { page: 1, classId__eq: classId, studentId__eq: studentId }, reqUser),
    schoolDataService.fetchData('reportInstances', { page: 1, classId__eq: classId, studentId__eq: studentId }, reqUser),
    schoolDataService.fetchData('sessionStudentCases', { page: 1, classId__eq: classId, studentId__eq: studentId }, reqUser)
  ]);

  const inWindow = (row) => {
    const sessionDate = normalizeDateOnly(row?.sessionDate || row?.date);
    if (!sessionDate) return true;
    return periodsOverlap(sessionDate, periodStart, periodEnd);
  };

  return {
    examAssignments: (Array.isArray(examAssignments) ? examAssignments : []).filter(inWindow).length,
    examAllocations: (Array.isArray(examAllocations) ? examAllocations : []).filter(inWindow).length,
    reportInstances: (Array.isArray(reportInstances) ? reportInstances : []).filter(inWindow).length,
    sessionCases: (Array.isArray(sessionCases) ? sessionCases : []).filter(inWindow).length
  };
}

async function findLockedSessionsForEnrollment(period, classRow, reqUser) {
  const classId = toPublicId(classRow?.id || period?.classId);
  const studentId = toPublicId(period?.studentId);
  if (!classId || !studentId) return [];

  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const locked = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!schoolDependencyService.isSessionTimesheetLocked(session)) continue;
    if (String(session?.lockReason || '') !== 'timesheet_approved') continue;
    const sessionDate = normalizeDateOnly(session?.date);
    if (!periodsOverlap(sessionDate, period?.startDate, period?.endDate)) continue;

    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const onRoster = roster.some((entry) => idsEqual(entry?.studentId, studentId) || idsEqual(entry?.personId, studentId));
    if (!onRoster && roster.length) continue;

    locked.push({
      sessionId: toPublicId(session?.sessionId || session?.id),
      date: sessionDate,
      label: `${sessionDate || 'Session'} ${String(session?.startTime || '').trim()}`.trim(),
      href: enrollmentHrefs.sessions(classId, toPublicId(session?.sessionId || session?.id))
    });
  }
  return locked;
}

function buildPostedTransactionBlocker(period) {
  const status = String(period?.status || '').trim().toLowerCase();
  const postedTransactionIds = Array.isArray(period?.transactionSummary?.postedTransactionIds)
    ? period.transactionSummary.postedTransactionIds.map((id) => toPublicId(id)).filter(Boolean)
    : [];
  if (status === 'draft' || !postedTransactionIds.length) return null;
  return {
    code: 'ENROLLMENT_POSTED',
    message: 'Rollback posted enrollment transactions before deleting this period.',
    postedTransactionIds
  };
}

async function assessEnrollmentDeleteEligibility(period, classRow, reqUser) {
  const origin = classifyEnrollmentPeriod(period);
  const periodId = toPublicId(period?.id);
  const warnings = [];
  const relatedCounts = await countRelatedEnrollmentRecords(period, classRow, reqUser);
  const cascadeTotal = Object.values(relatedCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  if (cascadeTotal > 0) {
    warnings.push('Deleting this enrollment will remove related attendance, exam, report, and session-case data on this class during the enrollment window.');
  }

  if (origin === ENROLLMENT_ORIGIN.TERM_REGISTRATION) {
    return {
      canDelete: false,
      origin,
      blockReason: 'This enrollment was created from a term registration. Resolve it through the term registration workflow.',
      blockCode: 'TERM_REGISTRATION',
      warnings,
      relatedCounts,
      upstreamSummary: null,
      termRegistrationHref: enrollmentHrefs.termRegistration(periodId)
    };
  }

  const postedBlocker = buildPostedTransactionBlocker(period);
  if (postedBlocker) {
    return {
      canDelete: false,
      origin,
      blockReason: postedBlocker.message,
      blockCode: postedBlocker.code,
      warnings,
      relatedCounts,
      upstreamSummary: null,
      postedTransactionIds: postedBlocker.postedTransactionIds
    };
  }

  const lockedSessions = await findLockedSessionsForEnrollment(period, classRow, reqUser);
  if (lockedSessions.length) {
    return {
      canDelete: false,
      origin,
      blockReason: 'One or more class sessions overlapping this enrollment are locked by an approved timesheet.',
      blockCode: 'TIMESHEET_LOCKED_SESSION',
      warnings,
      relatedCounts,
      upstreamSummary: null,
      lockedSessions
    };
  }

  let upstreamSummary = null;
  if (origin === ENROLLMENT_ORIGIN.CARRY_FORWARD) {
    upstreamSummary = await resolveUpstreamSummary(period, reqUser);
    warnings.push('Removing this enrollment only unenrolls the student from this cycle. Their previous-cycle record (completed or cancelled) will not be changed.');
  }

  return {
    canDelete: true,
    origin,
    blockReason: '',
    blockCode: '',
    warnings,
    relatedCounts,
    upstreamSummary,
    lockedSessions: []
  };
}

module.exports = {
  ENROLLMENT_ORIGIN,
  classifyEnrollmentPeriod,
  parseOriginClassIdFromReasonStart,
  assessEnrollmentDeleteEligibility,
  countRelatedEnrollmentRecords,
  findLockedSessionsForEnrollment,
  resolveStudentLabel
};
