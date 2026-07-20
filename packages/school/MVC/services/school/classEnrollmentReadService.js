const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');

const OPEN_PERIOD_STATUSES = new Set(['active', 'planned']);
const REPORT_ROSTER_OPEN_STATUSES = Object.freeze(['active', 'planned', 'to_be_confirmed']);
const HISTORICAL_ROLLING_ROSTER_STATUSES = Object.freeze(['active', 'planned', 'completed']);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function getReferenceDate(referenceDate = '', orgToday = '', reqUser = null) {
  return normalizeDateOnly(referenceDate)
    || normalizeDateOnly(orgToday)
    || resolveOrgTodayFromContext({ orgToday, user: reqUser });
}

function isOpenCanonicalPeriod(row, referenceDate = '') {
  const status = normalizeStatus(row?.status);
  if (!OPEN_PERIOD_STATUSES.has(status)) return false;
  const day = getReferenceDate(referenceDate);
  const start = normalizeDateOnly(row?.startDate);
  const end = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row);
  if (start && start > day && status !== 'planned') return false;
  if (end && end < day) return false;
  return true;
}

function parseWindowDates({
  sessionDates = [],
  startDate = '',
  endDate = '',
  orgToday = ''
} = {}) {
  const candidates = [];
  (Array.isArray(sessionDates) ? sessionDates : []).forEach((value) => {
    const normalized = normalizeDateOnly(value);
    if (normalized) candidates.push(normalized);
  });
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  if (normalizedStart) candidates.push(normalizedStart);
  if (normalizedEnd) candidates.push(normalizedEnd);
  if (!candidates.length) {
    const today = normalizeDateOnly(orgToday) || resolveOrgTodayFromContext({ orgToday });
    return { start: today, end: today };
  }
  candidates.sort();
  return {
    start: normalizedStart || candidates[0],
    end: normalizedEnd || candidates[candidates.length - 1]
  };
}

function periodOverlapsWindow(row, windowStart, windowEnd, allowedStatuses = OPEN_PERIOD_STATUSES) {
  const status = normalizeStatus(row?.status);
  const statusSet = allowedStatuses instanceof Set ? allowedStatuses : OPEN_PERIOD_STATUSES;
  if (!statusSet.has(status)) return false;
  const start = normalizeDateOnly(row?.startDate);
  const end = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row);
  if (!start) return false;
  const normalizedStart = normalizeDateOnly(windowStart);
  const normalizedEnd = normalizeDateOnly(windowEnd);
  if (!normalizedStart || !normalizedEnd) return false;
  return start <= normalizedEnd && end >= normalizedStart;
}

async function loadCanonicalOrgPeriods({ reqUser, activeOrgId }) {
  const targetOrgId = toPublicId(activeOrgId);
  if (!targetOrgId) return [];
  const rows = await schoolDataService.getClassEnrollmentPeriodsByOrg(targetOrgId, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, targetOrgId));
}

function buildCountMapFromCanonical(rows = [], referenceDate = '') {
  const map = new Map();
  (Array.isArray(rows) ? rows : [])
    .filter((row) => isOpenCanonicalPeriod(row, referenceDate))
    .forEach((row) => {
      const classId = toPublicId(row?.classId);
      if (!classId) return;
      map.set(classId, (map.get(classId) || 0) + 1);
    });
  return map;
}

function isRollingClassItem(classItem = {}) {
  return normalizeStatus(classItem?.registrationMode) === 'rolling';
}

function getReportRosterStatusesForClass(classItem = {}) {
  return isRollingClassItem(classItem)
    ? HISTORICAL_ROLLING_ROSTER_STATUSES
    : REPORT_ROSTER_OPEN_STATUSES;
}

const classEnrollmentReadService = {
  HISTORICAL_ROLLING_ROSTER_STATUSES,
  getReportRosterStatusesForClass,

  async listActiveStudentIdsForClass({
    classId,
    classItem = null,
    reqUser,
    activeOrgId = '',
    sessionDates = [],
    startDate = '',
    endDate = '',
    canonicalStatuses = null,
    orgToday = ''
  } = {}) {
    const normalizedClassId = toPublicId(classId || classItem?.id);
    if (!normalizedClassId) return { source: 'none', studentIds: new Set(), usedFallback: false };

    const canonicalRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(normalizedClassId, reqUser);
    const scopedCanonicalRows = (Array.isArray(canonicalRows) ? canonicalRows : []).filter((row) => {
      if (!activeOrgId) return true;
      return idsEqual(row?.orgId, activeOrgId);
    });
    if (!scopedCanonicalRows.length) {
      return { source: 'canonical', studentIds: new Set(), usedFallback: false };
    }

    const window = parseWindowDates({ sessionDates, startDate, endDate, orgToday: orgToday || reqUser?.orgToday });
    const normalizedStatusSet = Array.isArray(canonicalStatuses) && canonicalStatuses.length
      ? new Set(canonicalStatuses.map((value) => normalizeStatus(value)).filter(Boolean))
      : OPEN_PERIOD_STATUSES;
    const canonicalSet = new Set(
      scopedCanonicalRows
        .filter((row) => periodOverlapsWindow(row, window.start, window.end, normalizedStatusSet))
        .map((row) => toPublicId(row?.studentId))
        .filter(Boolean)
    );

    return { source: 'canonical', studentIds: canonicalSet, usedFallback: false };
  },

  async buildClassEnrollmentCountMap({
    classes = [],
    reqUser,
    activeOrgId = '',
    referenceDate = ''
  } = {}) {
    const canonicalRows = await loadCanonicalOrgPeriods({ reqUser, activeOrgId });
    return {
      source: 'canonical',
      map: buildCountMapFromCanonical(canonicalRows, referenceDate),
      usedFallback: false
    };
  },

  async getActiveClassIdsForStudent({
    studentId,
    classes = [],
    reqUser,
    activeOrgId = '',
    referenceDate = ''
  } = {}) {
    const normalizedStudentId = toPublicId(studentId);
    if (!normalizedStudentId) return { source: 'none', classIds: new Set(), usedFallback: false };

    const canonicalRows = await loadCanonicalOrgPeriods({ reqUser, activeOrgId });
    const canonicalSet = new Set(
      canonicalRows
        .filter((row) => idsEqual(row?.studentId, normalizedStudentId))
        .filter((row) => isOpenCanonicalPeriod(row, referenceDate))
        .map((row) => toPublicId(row?.classId))
        .filter(Boolean)
    );

    return { source: 'canonical', classIds: canonicalSet, usedFallback: false };
  },

  async hasActiveEnrollmentForStudentInClass({
    classId,
    studentId,
    classItem = null,
    reqUser,
    activeOrgId = '',
    referenceDate = ''
  } = {}) {
    const normalizedClassId = toPublicId(classId || classItem?.id);
    const normalizedStudentId = toPublicId(studentId);
    if (!normalizedClassId || !normalizedStudentId) return { exists: false, source: 'none', row: null };
    const canonicalRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(normalizedClassId, reqUser);
    const scopedCanonicalRows = (Array.isArray(canonicalRows) ? canonicalRows : []).filter((row) => {
      if (!activeOrgId) return true;
      return idsEqual(row?.orgId, activeOrgId);
    });
    const canonicalMatch = scopedCanonicalRows.find((row) =>
      idsEqual(row?.studentId, normalizedStudentId) &&
      isOpenCanonicalPeriod(row, referenceDate)
    );
    return { exists: Boolean(canonicalMatch), source: 'canonical', row: canonicalMatch || null, usedFallback: false };
  },

  async discoverClassEnrollmentRowsByRegistrationId({
    registrationId,
    reqUser,
    activeOrgId = '',
    classes = []
  } = {}) {
    const normalizedRegistrationId = String(registrationId || '').trim();
    if (!normalizedRegistrationId) return { source: 'none', rows: [] };
    const canonicalRows = await loadCanonicalOrgPeriods({ reqUser, activeOrgId });

    const canonicalMatches = canonicalRows
      .filter((row) =>
        idsEqual(row?.authorizationRef || '', normalizedRegistrationId) ||
        String(row?.reasonStart || '').includes(normalizedRegistrationId) ||
        String(row?.reasonEnd || '').includes(normalizedRegistrationId)
      )
      .map((row) => ({
        classId: String(row?.classId || '').trim(),
        enrollmentId: String(row?.id || '').trim()
      }))
      .filter((row) => row.classId && row.enrollmentId);

    return { source: 'canonical', rows: canonicalMatches, usedFallback: false };
  }
};

module.exports = classEnrollmentReadService;
