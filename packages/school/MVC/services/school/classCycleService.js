const schoolRepositories = require('../../repositories/school');
const classEnrollmentPeriodService = require('./classEnrollmentPeriodService');
const classEnrollmentPolicyService = require('./classEnrollmentPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_PERIOD_STATUSES = new Set(['draft', 'planned', 'active']);

let dependencies = {
  repositories: schoolRepositories,
  enrollmentPeriodService: classEnrollmentPeriodService,
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

function normalizeRegistrationMode(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function normalizeCycleNo(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeClassTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripCycleSuffix(title) {
  return String(title || '').replace(/\s*\(cycle\s+\d+\)\s*$/i, '').trim();
}

async function getClassOrThrow(classId, options = {}) {
  const normalizedId = toPublicId(classId);
  if (!normalizedId) throw new Error('classId is required.');
  const classRow = await dependencies.repositories.classes.getById(normalizedId, options);
  if (!classRow) throw new Error(`Class not found: ${normalizedId}`);
  return classRow;
}

async function buildUniqueCycleTitle(currentClass, cycleNo, options = {}) {
  const orgId = toPublicId(currentClass?.orgId);
  const rows = await dependencies.repositories.classes.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true },
    ...options
  });
  const used = new Set((Array.isArray(rows) ? rows : []).map((row) => normalizeClassTitle(row?.title)));
  const base = stripCycleSuffix(currentClass?.title) || String(currentClass?.title || '').trim() || 'Rolling Class';
  let candidate = `${base} (Cycle ${cycleNo})`;
  if (!used.has(normalizeClassTitle(candidate))) return candidate;
  let n = 2;
  while (n < 200) {
    const variant = `${base} (Cycle ${cycleNo}) - ${n}`;
    if (!used.has(normalizeClassTitle(variant))) return variant;
    n += 1;
  }
  return `${base} (Cycle ${cycleNo}) - ${Date.now()}`;
}

function evaluateCycleBoundaryPolicy({ currentCycleEndDate, nextCycleStartDate, policy = {} } = {}) {
  const currentEnd = requireDateOnly(currentCycleEndDate, 'currentCycleEndDate');
  const nextStart = requireDateOnly(nextCycleStartDate, 'cycleStartDate');
  const deltaDays = daysBetween(currentEnd, nextStart);
  const gapDays = deltaDays - 1;
  const maxGapDays = toNonNegativeInt(policy.maxCycleGapDaysBetweenCycles, 0);
  const maxOverlapDays = toNonNegativeInt(policy.maxCycleOverlapDaysBetweenCycles, 0);

  if (gapDays > maxGapDays) {
    throw new Error(
      `Cycle boundary gap is ${gapDays} day(s), but policy allows at most ${maxGapDays}.`
    );
  }
  if (gapDays < 0 && Math.abs(gapDays) > maxOverlapDays) {
    throw new Error(
      `Cycle boundary overlap is ${Math.abs(gapDays)} day(s), but policy allows at most ${maxOverlapDays}.`
    );
  }

  return {
    gapDays,
    maxGapDays,
    maxOverlapDays,
    isContiguous: gapDays === 0
  };
}

function assertCarryForwardAuthorizationWindow(row, boundaryDate) {
  const periodStart = requireDateOnly(row?.startDate, `period.startDate (${row?.id || 'unknown'})`);
  const periodEnd = normalizeDateOnly(row?.endDate);
  if (periodEnd && periodEnd < periodStart) {
    throw new Error(`Enrollment period ${row?.id || ''} has endDate before startDate.`);
  }
  if (periodEnd && periodEnd < boundaryDate) {
    throw new Error(`Enrollment period ${row?.id || ''} authorization window ends before carry-forward boundary ${boundaryDate}.`);
  }
}

function buildCarryForwardPreview(rows = [], boundaryDate = '') {
  const normalizedBoundary = requireDateOnly(boundaryDate, 'boundaryDate');
  const openRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = String(row?.status || '').trim().toLowerCase();
    return OPEN_PERIOD_STATUSES.has(status);
  });

  const issues = [];
  const candidates = [];
  const byStudent = new Map();
  let splitCount = 0;
  let moveWholeCount = 0;
  let ineligibleCount = 0;

  openRows.forEach((row) => {
    const periodId = String(row?.id || '').trim();
    const studentId = String(row?.studentId || '').trim();
    const startDate = normalizeDateOnly(row?.startDate);
    const endDate = normalizeDateOnly(row?.endDate);
    const status = String(row?.status || '').trim().toLowerCase();

    let action = 'none';
    let reason = '';
    let eligible = true;

    if (!startDate) {
      eligible = false;
      action = 'ineligible';
      reason = 'Missing startDate.';
    } else if (endDate && endDate < startDate) {
      eligible = false;
      action = 'ineligible';
      reason = 'endDate is before startDate.';
    } else if (startDate < normalizedBoundary && (!endDate || endDate >= normalizedBoundary)) {
      action = 'split';
      splitCount += 1;
    } else if (startDate >= normalizedBoundary) {
      action = 'move_whole';
      moveWholeCount += 1;
    } else {
      eligible = false;
      action = 'ineligible';
      reason = 'Period ends before boundary.';
    }

    if (eligible) {
      try {
        assertCarryForwardAuthorizationWindow(row, normalizedBoundary);
      } catch (error) {
        eligible = false;
        action = 'ineligible';
        reason = String(error?.message || 'Authorization window check failed.');
      }
    }

    if (!eligible) {
      ineligibleCount += 1;
      issues.push({
        periodId,
        studentId,
        level: 'error',
        message: reason || 'Period is not eligible for carry-forward.'
      });
    }

    const candidateRow = {
      periodId,
      studentId,
      startDate,
      endDate,
      status,
      action,
      eligible,
      reason
    };
    candidates.push(candidateRow);

    if (!studentId) return;
    const current = byStudent.get(studentId) || {
      studentId,
      periodCount: 0,
      splitCount: 0,
      moveWholeCount: 0,
      ineligibleCount: 0
    };
    current.periodCount += 1;
    if (action === 'split') current.splitCount += 1;
    if (action === 'move_whole') current.moveWholeCount += 1;
    if (!eligible) current.ineligibleCount += 1;
    byStudent.set(studentId, current);
  });

  return {
    boundaryDate: normalizedBoundary,
    openPeriodCount: openRows.length,
    splitCount,
    moveWholeCount,
    ineligibleCount,
    candidates,
    issues,
    students: [...byStudent.values()].sort((a, b) => String(a.studentId || '').localeCompare(String(b.studentId || '')))
  };
}

async function closeCycle(classId, input = {}, requestingUser = null, options = {}) {
  const classRow = await getClassOrThrow(classId, options);
  if (normalizeRegistrationMode(classRow?.registrationMode) !== 'rolling') {
    throw new Error('Cycle operations are only valid for rolling classes.');
  }

  const cycleEndDate = requireDateOnly(input.cycleEndDate || classRow?.cycleEndDate, 'cycleEndDate');
  const cycleStartDate = normalizeDateOnly(classRow?.cycleStartDate);
  if (cycleStartDate && cycleEndDate < cycleStartDate) {
    throw new Error('cycleEndDate cannot be before cycleStartDate.');
  }

  const actor = resolveActor(requestingUser);
  return dependencies.repositories.classes.update(classRow.id, {
    cycleEndDate,
    isClosedForNewEnrollment: input.isClosedForNewEnrollment !== false,
    updatedBy: actor
  }, options);
}

async function splitPeriodsCrossingCycleBoundary({
  fromClassId,
  toClassId,
  boundaryDate,
  note = ''
} = {}, requestingUser = null, options = {}) {
  const normalizedBoundary = requireDateOnly(boundaryDate, 'boundaryDate');
  const fromClass = await getClassOrThrow(fromClassId, options);
  const toClass = await getClassOrThrow(toClassId, options);
  if (!idsEqual(fromClass?.orgId, toClass?.orgId)) {
    throw new Error('Source and target class must belong to the same organization.');
  }

  const rows = await dependencies.repositories.classEnrollmentPeriods.findByClassId(fromClass.id, options);
  const crossingRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!OPEN_PERIOD_STATUSES.has(status)) return false;
    const start = normalizeDateOnly(row?.startDate);
    const end = normalizeDateOnly(row?.endDate);
    if (!start || start >= normalizedBoundary) return false;
    return !end || end >= normalizedBoundary;
  });

  const details = [];
  for (const row of crossingRows) {
    assertCarryForwardAuthorizationWindow(row, normalizedBoundary);
    const sourceCloseDate = dayBefore(normalizedBoundary);
    // eslint-disable-next-line no-await-in-loop
    const closedSource = await dependencies.enrollmentPeriodService.closePeriod(
      row.id,
      {
        endDate: sourceCloseDate,
        status: 'completed',
        reasonEnd: String(note || `Closed at cycle boundary ${normalizedBoundary}.`).trim()
      },
      requestingUser,
      options
    );

    // eslint-disable-next-line no-await-in-loop
    const createdTarget = await dependencies.enrollmentPeriodService.createPeriod({
      orgId: row.orgId,
      classId: toClass.id,
      studentId: row.studentId,
      startDate: normalizedBoundary,
      endDate: normalizeDateOnly(row.endDate),
      status: String(row.status || 'active'),
      funderType: String(row.funderType || '').trim(),
      funderId: String(row.funderId || '').trim(),
      authorizationRef: String(row.authorizationRef || '').trim(),
      reasonStart: String(note || `Continuation split from ${fromClass.id} at cycle boundary.`).trim(),
      reasonEnd: String(row.reasonEnd || '').trim()
    }, requestingUser, options);

    details.push({
      sourcePeriodId: row.id,
      sourceClosedAt: closedSource?.endDate || sourceCloseDate,
      targetPeriodId: createdTarget?.period?.id || '',
      studentId: row.studentId
    });
  }

  return {
    boundaryDate: normalizedBoundary,
    sourceClassId: fromClass.id,
    targetClassId: toClass.id,
    totalCrossing: crossingRows.length,
    sourceUpdated: details.length,
    targetCreated: details.length,
    details
  };
}

async function carryForwardEligibleStudents({
  fromClassId,
  toClassId,
  boundaryDate
} = {}, requestingUser = null, options = {}) {
  const normalizedBoundary = requireDateOnly(boundaryDate, 'boundaryDate');
  const splitResult = await splitPeriodsCrossingCycleBoundary({
    fromClassId,
    toClassId,
    boundaryDate: normalizedBoundary,
    note: `Carry-forward split at cycle boundary ${normalizedBoundary}.`
  }, requestingUser, options);

  const rows = await dependencies.repositories.classEnrollmentPeriods.findByClassId(fromClassId, options);
  const moveWholeRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!OPEN_PERIOD_STATUSES.has(status)) return false;
    const start = normalizeDateOnly(row?.startDate);
    return Boolean(start) && start >= normalizedBoundary;
  });

  const movedWhole = [];
  for (const row of moveWholeRows) {
    assertCarryForwardAuthorizationWindow(row, normalizedBoundary);
    // eslint-disable-next-line no-await-in-loop
    await dependencies.repositories.classEnrollmentPeriods.update(row.id, {
      status: 'cancelled',
      reasonEnd: `Moved to cycle ${toClassId} during carry-forward.`,
      updatedBy: resolveActor(requestingUser)
    }, options);

    // eslint-disable-next-line no-await-in-loop
    const createdTarget = await dependencies.enrollmentPeriodService.createPeriod({
      orgId: row.orgId,
      classId: toClassId,
      studentId: row.studentId,
      startDate: normalizeDateOnly(row.startDate),
      endDate: normalizeDateOnly(row.endDate),
      status: String(row.status || 'active'),
      funderType: String(row.funderType || '').trim(),
      funderId: String(row.funderId || '').trim(),
      authorizationRef: String(row.authorizationRef || '').trim(),
      reasonStart: `Moved whole period from ${fromClassId} during carry-forward.`,
      reasonEnd: String(row.reasonEnd || '').trim()
    }, requestingUser, options);

    movedWhole.push({
      sourcePeriodId: row.id,
      targetPeriodId: createdTarget?.period?.id || '',
      studentId: row.studentId
    });
  }

  return {
    ...splitResult,
    wholeMovedCount: movedWhole.length,
    movedWhole
  };
}

async function createNextCycleFromCurrentClassTemplate(currentClassId, input = {}, requestingUser = null, options = {}) {
  const currentClass = await getClassOrThrow(currentClassId, options);
  if (normalizeRegistrationMode(currentClass?.registrationMode) !== 'rolling') {
    throw new Error('Cycle creation is only valid for rolling classes.');
  }

  const cycleStartDate = requireDateOnly(input.cycleStartDate, 'cycleStartDate');
  const cycleEndDate = normalizeDateOnly(input.cycleEndDate);
  if (cycleEndDate && cycleEndDate < cycleStartDate) {
    throw new Error('cycleEndDate cannot be before cycleStartDate.');
  }

  const closeCurrentCycle = input.closeCurrentCycle !== false;
  const carryForwardEligible = input.carryForwardEligibleStudents !== false;
  const cycleGroupId = String(currentClass?.cycleGroupId || currentClass?.id || '').trim();
  const nextCycleNo = normalizeCycleNo(currentClass?.cycleNo) + 1;
  const policy = dependencies.policyService.getPolicy();
  const currentCycleEndDate = requireDateOnly(
    input.currentCycleEndDate || currentClass?.cycleEndDate || dayBefore(cycleStartDate),
    'currentCycleEndDate'
  );
  const cycleBoundary = evaluateCycleBoundaryPolicy({
    currentCycleEndDate,
    nextCycleStartDate: cycleStartDate,
    policy
  });

  let closedCurrentClass = null;
  if (closeCurrentCycle) {
    closedCurrentClass = await closeCycle(currentClass.id, {
      cycleEndDate: currentCycleEndDate,
      isClosedForNewEnrollment: true
    }, requestingUser, options);
  }

  const nextTitle = await buildUniqueCycleTitle(currentClass, nextCycleNo, options);
  const nextPayload = { ...currentClass };
  delete nextPayload.id;
  delete nextPayload._id;
  delete nextPayload.audit;

  nextPayload.title = nextTitle;
  nextPayload.registrationMode = 'rolling';
  nextPayload.cycleGroupId = cycleGroupId;
  nextPayload.cycleNo = nextCycleNo;
  nextPayload.cycleStartDate = cycleStartDate;
  nextPayload.cycleEndDate = cycleEndDate;
  nextPayload.isClosedForNewEnrollment = false;
  nextPayload.previousClassId = currentClass.id;
  nextPayload.nextClassId = '';
  nextPayload.status = String(input.nextCycleStatus || currentClass.status || 'active').trim() || 'active';
  nextPayload.enrollment = {
    ...(currentClass?.enrollment && typeof currentClass.enrollment === 'object' ? currentClass.enrollment : {}),
    students: []
  };
  nextPayload.sessions = [];

  const createdClass = await dependencies.repositories.classes.create(nextPayload, options);

  const actor = resolveActor(requestingUser);
  await dependencies.repositories.classes.update(currentClass.id, {
    nextClassId: createdClass.id,
    cycleGroupId,
    cycleNo: normalizeCycleNo(currentClass?.cycleNo),
    isClosedForNewEnrollment: closeCurrentCycle ? true : currentClass?.isClosedForNewEnrollment === true,
    updatedBy: actor
  }, options);

  let carryForwardResult = null;
  if (carryForwardEligible) {
    carryForwardResult = await carryForwardEligibleStudents({
      fromClassId: currentClass.id,
      toClassId: createdClass.id,
      boundaryDate: cycleStartDate
    }, requestingUser, options);
  }

  return {
    sourceClassId: currentClass.id,
    createdClass,
    closedCurrentClass,
    carryForwardResult,
    cycleBoundary
  };
}

async function previewNextCycleFromCurrentClassTemplate(currentClassId, input = {}, options = {}) {
  const currentClass = await getClassOrThrow(currentClassId, options);
  if (normalizeRegistrationMode(currentClass?.registrationMode) !== 'rolling') {
    throw new Error('Cycle preview is only valid for rolling classes.');
  }

  const cycleStartDate = requireDateOnly(input.cycleStartDate, 'cycleStartDate');
  const cycleEndDate = normalizeDateOnly(input.cycleEndDate);
  if (cycleEndDate && cycleEndDate < cycleStartDate) {
    throw new Error('cycleEndDate cannot be before cycleStartDate.');
  }

  const cycleGroupId = String(currentClass?.cycleGroupId || currentClass?.id || '').trim();
  const nextCycleNo = normalizeCycleNo(currentClass?.cycleNo) + 1;
  const suggestedTitle = await buildUniqueCycleTitle(currentClass, nextCycleNo, options);
  const policy = dependencies.policyService.getPolicy();
  const currentCycleEndDate = requireDateOnly(
    input.currentCycleEndDate || currentClass?.cycleEndDate || dayBefore(cycleStartDate),
    'currentCycleEndDate'
  );

  let cycleBoundary = null;
  let boundaryError = '';
  try {
    cycleBoundary = evaluateCycleBoundaryPolicy({
      currentCycleEndDate,
      nextCycleStartDate: cycleStartDate,
      policy
    });
  } catch (error) {
    boundaryError = String(error?.message || 'Cycle boundary policy check failed.');
  }

  const rows = await dependencies.repositories.classEnrollmentPeriods.findByClassId(currentClass.id, options);
  const carryForwardPreview = buildCarryForwardPreview(rows, cycleStartDate);
  const issues = [...carryForwardPreview.issues];
  if (boundaryError) {
    issues.unshift({
      periodId: '',
      studentId: '',
      level: 'error',
      message: boundaryError
    });
  }

  return {
    sourceClass: {
      id: currentClass.id,
      title: String(currentClass?.title || '').trim(),
      cycleGroupId,
      cycleNo: normalizeCycleNo(currentClass?.cycleNo),
      cycleStartDate: normalizeDateOnly(currentClass?.cycleStartDate),
      cycleEndDate: normalizeDateOnly(currentClass?.cycleEndDate),
      nextClassId: String(currentClass?.nextClassId || '').trim()
    },
    nextCycle: {
      cycleGroupId,
      cycleNo: nextCycleNo,
      titleSuggestion: suggestedTitle,
      cycleStartDate,
      cycleEndDate
    },
    policy,
    boundary: {
      currentCycleEndDate,
      cycleStartDate,
      cycleBoundary,
      hasPolicyViolation: Boolean(boundaryError),
      policyViolationMessage: boundaryError
    },
    carryForwardPreview,
    issues
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
    enrollmentPeriodService: classEnrollmentPeriodService,
    policyService: classEnrollmentPolicyService
  };
}

module.exports = {
  closeCycle,
  createNextCycleFromCurrentClassTemplate,
  previewNextCycleFromCurrentClassTemplate,
  carryForwardEligibleStudents,
  splitPeriodsCrossingCycleBoundary,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
