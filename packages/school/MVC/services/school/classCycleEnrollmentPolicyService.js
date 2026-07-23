const OPEN_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active']);
const PROMOTION_SOURCE_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'error']);

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isOpenPeriodStatus(value) {
  return OPEN_STATUSES.has(normalizeStatus(value));
}

function isRollingClass(classRow) {
  return String(classRow?.registrationMode || '').trim().toLowerCase() === 'rolling';
}

function normalizeCycleWindow(classRow) {
  return {
    cycleStartDate: normalizeDateOnly(classRow?.cycleStartDate),
    cycleEndDate: normalizeDateOnly(classRow?.cycleEndDate),
    isClosedForNewEnrollment: classRow?.isClosedForNewEnrollment === true
      || String(classRow?.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true'
  };
}

function assertEnrollmentDatesWithinCycle({ classRow, startDate, endDate }) {
  if (!isRollingClass(classRow)) return;
  const window = normalizeCycleWindow(classRow);
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);

  if (window.cycleStartDate && normalizedStart && normalizedStart < window.cycleStartDate) {
    throw new Error(`Enrollment start date (${normalizedStart}) cannot be before the class cycle start (${window.cycleStartDate}).`);
  }
  if (window.cycleEndDate && normalizedStart && normalizedStart > window.cycleEndDate) {
    throw new Error(`Enrollment start date (${normalizedStart}) cannot be after the class cycle end (${window.cycleEndDate}).`);
  }
}

function assertProgramRegistrationDateWithinCycle({ classRow, registrationDate }) {
  if (!isRollingClass(classRow)) return;
  const window = normalizeCycleWindow(classRow);
  const regDate = normalizeDateOnly(registrationDate);
  if (!regDate) return;

  // Existing program registrations often predate a later class cycle. Only reject
  // registrations that happen after the cycle has already ended.
  if (window.cycleEndDate && regDate > window.cycleEndDate) {
    throw new Error(`Program registration date (${regDate}) cannot be after the class cycle end (${window.cycleEndDate}).`);
  }
}

function assertNewEnrollmentAllowed({ classRow, targetStatus }) {
  if (!isRollingClass(classRow)) return;
  const window = normalizeCycleWindow(classRow);
  if (!window.isClosedForNewEnrollment) return;
  if (isOpenPeriodStatus(targetStatus)) {
    throw new Error('Class cycle is closed for new enrollment.');
  }
}

function assertEnrollmentNotBeforeProgramRegistration({ enrollmentStartDate, programRegistrationDate }) {
  const start = normalizeDateOnly(enrollmentStartDate);
  const regDate = normalizeDateOnly(programRegistrationDate);
  if (!start || !regDate) return;
  if (start < regDate) {
    throw new Error(`Enrollment start date (${start}) cannot be before the linked program registration date (${regDate}).`);
  }
}

function isPromotionToActive(previousStatus, nextStatus) {
  const prev = normalizeStatus(previousStatus);
  const next = normalizeStatus(nextStatus);
  return PROMOTION_SOURCE_STATUSES.has(prev) && next === 'active';
}

function isNewOpenEnrollmentTransition(previousStatus, nextStatus) {
  const prev = normalizeStatus(previousStatus);
  const next = normalizeStatus(nextStatus);
  if (next === 'draft') return false;
  if (isOpenPeriodStatus(prev)) return false;
  return isOpenPeriodStatus(next);
}

function assertClosedCycleEnrollmentTransitionAllowed({ classRow, previousStatus, nextStatus }) {
  if (!isRollingClass(classRow)) return;
  const window = normalizeCycleWindow(classRow);
  if (!window.isClosedForNewEnrollment) return;

  if (isPromotionToActive(previousStatus, nextStatus)) {
    throw new Error('Class cycle is closed for new enrollment.');
  }
  if (isNewOpenEnrollmentTransition(previousStatus, nextStatus)) {
    throw new Error('Class cycle is closed for new enrollment.');
  }
}

function collectCycleEnrollmentViolations({
  classRow,
  enrollmentStartDate,
  enrollmentEndDate,
  programRegistrationDate,
  targetStatus,
  previousStatus,
  skipClosedCheck = false
} = {}) {
  const issues = [];
  if (!isRollingClass(classRow)) return issues;

  const pushIssue = (error) => {
    const message = String(error?.message || error || '').trim();
    if (message) issues.push(message);
  };

  try {
    assertEnrollmentDatesWithinCycle({
      classRow,
      startDate: enrollmentStartDate,
      endDate: enrollmentEndDate
    });
  } catch (error) {
    pushIssue(error);
  }

  try {
    assertProgramRegistrationDateWithinCycle({
      classRow,
      registrationDate: programRegistrationDate
    });
  } catch (error) {
    pushIssue(error);
  }

  try {
    assertEnrollmentNotBeforeProgramRegistration({
      enrollmentStartDate,
      programRegistrationDate
    });
  } catch (error) {
    pushIssue(error);
  }

  if (!skipClosedCheck) {
    try {
      if (previousStatus !== undefined && previousStatus !== null && String(previousStatus).trim()) {
        assertClosedCycleEnrollmentTransitionAllowed({
          classRow,
          previousStatus,
          nextStatus: targetStatus
        });
      } else {
        assertNewEnrollmentAllowed({ classRow, targetStatus });
      }
    } catch (error) {
      pushIssue(error);
    }
  }

  return issues;
}

function isProgramRegistrationDateWithinCycle(classRow, registrationDate) {
  if (!isRollingClass(classRow)) return true;
  try {
    assertProgramRegistrationDateWithinCycle({ classRow, registrationDate });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  normalizeDateOnly,
  normalizeCycleWindow,
  isRollingClass,
  isOpenPeriodStatus,
  assertEnrollmentDatesWithinCycle,
  assertProgramRegistrationDateWithinCycle,
  assertNewEnrollmentAllowed,
  assertEnrollmentNotBeforeProgramRegistration,
  assertClosedCycleEnrollmentTransitionAllowed,
  collectCycleEnrollmentViolations,
  isProgramRegistrationDateWithinCycle
};
