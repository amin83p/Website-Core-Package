const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const classEnrollmentPolicyService = require('./classEnrollmentPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const TERMINAL_STATUSES = new Set(['cancelled', 'archived', 'error']);
const OPEN_STATUSES = new Set(['draft', 'planned', 'active']);

let dependencies = {
  repositories: schoolRepositories,
  policyService: classEnrollmentPolicyService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function requireDateOnly(value, fieldName) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) throw new Error(`${fieldName} is required (YYYY-MM-DD).`);
  return normalized;
}

function addDays(dateOnly, days) {
  const normalized = requireDateOnly(dateOnly, 'date');
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function dayBefore(dateOnly) {
  return addDays(dateOnly, -1);
}

function daysBetween(startDate, endDate) {
  const start = requireDateOnly(startDate, 'startDate');
  const end = requireDateOnly(endDate, 'endDate');
  const a = new Date(`${start}T00:00:00.000Z`).getTime();
  const b = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = requireDateOnly(startA, 'startA');
  const bStart = requireDateOnly(startB, 'startB');
  const aEnd = normalizeDateOnly(endA) || '9999-12-31';
  const bEnd = normalizeDateOnly(endB) || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

function resolveActor(requestingUser, fallback = 'system') {
  const candidate = String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    requestingUser?.email ||
    fallback
  ).trim();
  return candidate || fallback;
}

function normalizeStatus(value, fallback = 'active') {
  const token = String(value || '').trim().toLowerCase();
  return token || fallback;
}

function isOpenPeriodStatus(value) {
  return OPEN_STATUSES.has(normalizeStatus(value));
}

async function getClassOrThrow(classId, options = {}) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) throw new Error('classId is required.');
  const classRow = await dependencies.repositories.classes.getById(normalizedClassId, options);
  if (!classRow) throw new Error(`Class not found: ${normalizedClassId}`);
  return classRow;
}

async function listStudentClassPeriods(classId, studentId, options = {}) {
  const normalizedClassId = toPublicId(classId);
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedClassId || !normalizedStudentId) return [];
  const rows = await dependencies.repositories.classEnrollmentPeriods.findByClassId(normalizedClassId, options);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.studentId, normalizedStudentId));
}

async function checkOverlap({
  classId,
  studentId,
  startDate,
  endDate = '',
  excludePeriodId = '',
  statuses = []
} = {}, options = {}) {
  const normalizedClassId = toPublicId(classId);
  const normalizedStudentId = toPublicId(studentId);
  const normalizedStart = requireDateOnly(startDate, 'startDate');
  const normalizedEnd = normalizeDateOnly(endDate);
  const lookupEnd = normalizedEnd || '9999-12-31';
  const excludedId = toPublicId(excludePeriodId);

  const rows = await dependencies.repositories.classEnrollmentPeriods.findByClassIdInRange(
    normalizedClassId,
    normalizedStart,
    lookupEnd,
    { ...options, statuses }
  );

  const matches = (Array.isArray(rows) ? rows : [])
    .filter((row) => idsEqual(row?.studentId, normalizedStudentId))
    .filter((row) => !excludedId || !idsEqual(row?.id, excludedId))
    .filter((row) => !TERMINAL_STATUSES.has(normalizeStatus(row?.status)))
    .filter((row) => rangesOverlap(row?.startDate, row?.endDate, normalizedStart, normalizedEnd));

  return {
    hasOverlap: matches.length > 0,
    overlaps: matches
  };
}

async function evaluateReentryRules({
  classId,
  studentId,
  startDate,
  excludePeriodId = ''
} = {}, options = {}) {
  const normalizedStartDate = requireDateOnly(startDate, 'startDate');
  const excludedId = toPublicId(excludePeriodId);
  const policy = dependencies.policyService.getPolicy();
  const rows = await listStudentClassPeriods(classId, studentId, options);
  const effectiveRows = rows.filter((row) => !excludedId || !idsEqual(row?.id, excludedId));

  const violations = [];
  const maxPeriods = Number(policy.maxPeriodsPerStudentPerClass || 0);
  if (maxPeriods > 0 && effectiveRows.length >= maxPeriods) {
    violations.push(`maxPeriodsPerStudentPerClass reached (${maxPeriods}).`);
  }

  const previousEndedPeriods = effectiveRows
    .filter((row) => normalizeDateOnly(row?.endDate))
    .filter((row) => normalizeDateOnly(row?.endDate) < normalizedStartDate)
    .sort((a, b) => String(normalizeDateOnly(b?.endDate)).localeCompare(String(normalizeDateOnly(a?.endDate))));

  const previousEnded = previousEndedPeriods[0] || null;
  const requiredGapDays = policy.allowImmediateReentry
    ? Number(policy.minGapDaysBetweenPeriods || 0)
    : Math.max(1, Number(policy.minGapDaysBetweenPeriods || 0));

  let actualGapDays = null;
  if (previousEnded && requiredGapDays > 0) {
    const priorEnd = normalizeDateOnly(previousEnded.endDate);
    if (priorEnd) {
      actualGapDays = Math.max(0, daysBetween(priorEnd, normalizedStartDate) - 1);
      if (actualGapDays < requiredGapDays) {
        violations.push(`Minimum re-entry gap is ${requiredGapDays} day(s); actual gap is ${actualGapDays}.`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    policy,
    previousEndedPeriod: previousEnded,
    actualGapDays,
    requiredGapDays
  };
}

async function createPeriod(input = {}, requestingUser = null, options = {}) {
  const classRow = await getClassOrThrow(input.classId, options);
  const actor = resolveActor(requestingUser);
  const orgId = toPublicId(input.orgId || classRow.orgId);
  if (!orgId) throw new Error('orgId is required.');
  if (!idsEqual(orgId, classRow?.orgId)) {
    throw new Error('orgId does not match the class organization.');
  }

  const studentId = toPublicId(input.studentId);
  if (!studentId) throw new Error('studentId is required.');
  const startDate = requireDateOnly(input.startDate, 'startDate');
  const endDate = normalizeDateOnly(input.endDate);
  if (endDate && endDate < startDate) throw new Error('endDate cannot be before startDate.');
  const requestedStatus = normalizeStatus(input.status, 'active');
  const sessionCap = classEnrollmentSessionApplicabilityService.sanitizeSessionCapFields(input);

  if (
    String(classRow?.registrationMode || '').trim().toLowerCase() === 'rolling' &&
    classRow?.isClosedForNewEnrollment === true &&
    isOpenPeriodStatus(requestedStatus)
  ) {
    throw new Error('Class cycle is closed for new enrollment.');
  }

  const overlapCheck = await checkOverlap({
    classId: classRow.id,
    studentId,
    startDate,
    endDate,
    excludePeriodId: input.excludePeriodId
  }, options);
  if (overlapCheck.hasOverlap && input.allowOverlap !== true) {
    const sampleIds = overlapCheck.overlaps.slice(0, 5).map((row) => row.id).filter(Boolean).join(', ');
    throw new Error(`Overlapping enrollment period exists${sampleIds ? `: ${sampleIds}` : ''}.`);
  }

  const reentryCheck = await evaluateReentryRules({
    classId: classRow.id,
    studentId,
    startDate,
    excludePeriodId: input.excludePeriodId
  }, options);
  if (!reentryCheck.ok) throw new Error(reentryCheck.violations.join(' '));

  const existingRows = await listStudentClassPeriods(classRow.id, studentId, options);
  const maxSequenceNo = existingRows.reduce((max, row) => {
    const parsed = Number.parseInt(String(row?.sequenceNo || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
  const explicitSequence = Number.parseInt(String(input.sequenceNo || '').trim(), 10);
  const sequenceNo = Number.isFinite(explicitSequence) && explicitSequence > 0 ? explicitSequence : (maxSequenceNo + 1);

  let inferredProgramId = toPublicId(input.programId);
  let inferredTermId = toPublicId(input.termId);
  const explicitProgramId = Boolean(inferredProgramId);

  if (!inferredProgramId || !inferredTermId) {
    const elig = Array.isArray(classRow?.eligibility) ? classRow.eligibility : [];
    const first = elig.find((row) => toPublicId(row?.programId));
    if (!inferredProgramId) inferredProgramId = toPublicId(first?.programId);
    if (!inferredTermId) inferredTermId = toPublicId(first?.termId);
  }
  if (!inferredProgramId || !inferredTermId) {
    const apt = Array.isArray(classRow?.allowedProgramTerms) ? classRow.allowedProgramTerms : [];
    if (explicitProgramId && inferredProgramId) {
      const candidates = apt.filter((row) => idsEqual(row?.programId, inferredProgramId));
      let pick = null;
      if (inferredTermId) {
        pick = candidates.find((row) => idsEqual(row?.termId, inferredTermId));
      }
      if (!pick) pick = candidates.find((row) => !toPublicId(row?.termId));
      if (!pick) pick = candidates[0];
      if (pick) {
        if (!inferredTermId) inferredTermId = toPublicId(pick.termId);
      }
    } else {
      const aptRow = apt.find((row) => toPublicId(row?.programId));
      if (!inferredProgramId) inferredProgramId = toPublicId(aptRow?.programId);
      if (!inferredTermId) inferredTermId = toPublicId(aptRow?.termId);
    }
  }

  const created = await dependencies.repositories.classEnrollmentPeriods.create({
    orgId,
    classId: classRow.id,
    studentId,
    personId: toPublicId(input.personId),
    status: requestedStatus,
    startDate,
    endDate,
    programId: inferredProgramId,
    termId: inferredTermId,
    programRegistrationId: toPublicId(input.programRegistrationId),
    enrollmentSource: String(input.enrollmentSource || '').trim(),
    feeCategory: String(input.feeCategory || '').trim(),
    pricing: (input.pricing && typeof input.pricing === 'object')
      ? { ...input.pricing }
      : {},
    targetSessionCount: sessionCap.targetSessionCount,
    sessionCountPolicy: sessionCap.sessionCountPolicy,
    completionDate: sessionCap.completionDate,
    completionSessionId: sessionCap.completionSessionId,
    completionReason: sessionCap.completionReason,
    funderType: String(input.funderType || '').trim(),
    funderId: String(input.funderId || '').trim(),
    authorizationRef: String(input.authorizationRef || '').trim(),
    reasonStart: String(input.reasonStart || '').trim(),
    reasonEnd: String(input.reasonEnd || '').trim(),
    notes: String(input.notes || '').trim(),
    transactionSummary: (input.transactionSummary && typeof input.transactionSummary === 'object')
      ? input.transactionSummary
      : {},
    sequenceNo,
    createdBy: actor,
    updatedBy: actor
  }, options);

  return {
    period: created,
    overlapCheck,
    reentryCheck
  };
}

async function closePeriod(periodId, input = {}, requestingUser = null, options = {}) {
  const normalizedPeriodId = toPublicId(periodId);
  if (!normalizedPeriodId) throw new Error('periodId is required.');
  const actor = resolveActor(requestingUser);

  const existing = await dependencies.repositories.classEnrollmentPeriods.getById(normalizedPeriodId, options);
  if (!existing) throw new Error('Enrollment period not found.');

  await getClassOrThrow(existing.classId, options);
  const periodStart = requireDateOnly(existing.startDate, 'startDate');
  const closeDate = normalizeDateOnly(input.endDate) || normalizeDateOnly(existing.endDate) || new Date().toISOString().slice(0, 10);
  if (closeDate < periodStart) throw new Error('close endDate cannot be before period startDate.');

  const nextStatus = normalizeStatus(
    input.status,
    OPEN_STATUSES.has(normalizeStatus(existing.status)) ? 'completed' : normalizeStatus(existing.status, 'completed')
  );

  const updated = await dependencies.repositories.classEnrollmentPeriods.update(normalizedPeriodId, {
    endDate: closeDate,
    status: nextStatus,
    reasonEnd: String(input.reasonEnd || existing.reasonEnd || '').trim(),
    updatedBy: actor
  }, options);

  return updated;
}

async function reopenViaNewPeriod(periodId, input = {}, requestingUser = null, options = {}) {
  const normalizedPeriodId = toPublicId(periodId);
  if (!normalizedPeriodId) throw new Error('periodId is required.');
  const existing = await dependencies.repositories.classEnrollmentPeriods.getById(normalizedPeriodId, options);
  if (!existing) throw new Error('Enrollment period not found.');

  const desiredStartDate = normalizeDateOnly(input.startDate) || addDays(normalizeDateOnly(existing.endDate) || new Date().toISOString().slice(0, 10), 1);
  let closedPeriod = null;
  if (OPEN_STATUSES.has(normalizeStatus(existing.status))) {
    const closeAt = dayBefore(desiredStartDate);
    const safeCloseAt = closeAt < normalizeDateOnly(existing.startDate) ? normalizeDateOnly(existing.startDate) : closeAt;
    closedPeriod = await closePeriod(normalizedPeriodId, {
      endDate: safeCloseAt,
      status: 'completed',
      reasonEnd: String(input.closeReason || 'Closed automatically before reopening via new period.').trim()
    }, requestingUser, options);
  }

  const created = await createPeriod({
    orgId: existing.orgId,
    classId: existing.classId,
    studentId: existing.studentId,
    startDate: desiredStartDate,
    endDate: normalizeDateOnly(input.endDate),
    status: normalizeStatus(input.status, 'active'),
    programId: toPublicId(existing.programId),
    termId: toPublicId(existing.termId),
    programRegistrationId: toPublicId(input.programRegistrationId || existing.programRegistrationId),
    personId: toPublicId(input.personId || existing.personId),
    enrollmentSource: String(input.enrollmentSource || existing.enrollmentSource || '').trim(),
    feeCategory: String(input.feeCategory || existing.feeCategory || '').trim(),
    pricing: (input.pricing && typeof input.pricing === 'object')
      ? { ...input.pricing }
      : ((existing.pricing && typeof existing.pricing === 'object') ? { ...existing.pricing } : {}),
    funderType: String(input.funderType || existing.funderType || '').trim(),
    funderId: String(input.funderId || existing.funderId || '').trim(),
    authorizationRef: String(input.authorizationRef || existing.authorizationRef || '').trim(),
    reasonStart: String(input.reasonStart || `Reopened after period ${existing.id}.`).trim(),
    reasonEnd: String(input.reasonEnd || '').trim(),
    allowOverlap: input.allowOverlap === true
  }, requestingUser, options);

  return {
    closedPeriod,
    newPeriod: created.period,
    overlapCheck: created.overlapCheck,
    reentryCheck: created.reentryCheck
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = {
    ...dependencies,
    ...nextDeps
  };
}

function __resetDependenciesForTest() {
  dependencies = {
    repositories: schoolRepositories,
    policyService: classEnrollmentPolicyService
  };
}

module.exports = {
  createPeriod,
  closePeriod,
  reopenViaNewPeriod,
  checkOverlap,
  evaluateReentryRules,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
