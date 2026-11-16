'use strict';

const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const enrollmentFinishAlertPolicyService = require('./enrollmentFinishAlertPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function cleanPersonId(value = '') {
  return toPublicId(value);
}

function buildClbContextFromStudent(studentRecord = null) {
  const entry = reportService.getLatestClbLevelEntry(studentRecord || {});
  if (!entry) {
    return {
      enrollmentClbCurrent: {},
      enrollmentClbGoal: {},
      enrollmentClbRecordedAt: ''
    };
  }
  return {
    enrollmentClbCurrent: entry.current && typeof entry.current === 'object' ? entry.current : {},
    enrollmentClbGoal: entry.goal && typeof entry.goal === 'object' ? entry.goal : {},
    enrollmentClbRecordedAt: String(entry.recordedAt || '').trim()
  };
}

function findStudentByPersonId(students = [], personId = '') {
  const targetPersonId = cleanPersonId(personId);
  if (!targetPersonId) return null;
  return (Array.isArray(students) ? students : []).find((row) => idsEqual(row?.personId, targetPersonId)) || null;
}

const readLastCloseSnapshot = classEnrollmentSessionApplicabilityService.readLastCloseSnapshot;
const resolveScheduledClosingDate = classEnrollmentSessionApplicabilityService.resolveScheduledClosingDate;
const isScheduledEnrollmentClose = classEnrollmentSessionApplicabilityService.isScheduledEnrollmentClose;
const periodCoversSession = classEnrollmentSessionApplicabilityService.periodCoversSession;
const resolveStudentPersonId = classEnrollmentSessionApplicabilityService.resolveStudentPersonId;

const UPCOMING_OPEN_STATUSES = new Set(['active', 'planned', 'to_be_confirmed', 'waiting_list']);
const UPCOMING_EXCLUDED_STATUSES = new Set(['completed', 'cancelled', 'error', 'voided']);

function closedOnDateFromPeriod(period = {}) {
  const snap = readLastCloseSnapshot(period);
  if (!snap?.closedAt) return '';
  return normalizeDateOnly(snap.closedAt);
}

function resolveExpectedFinishDate({ period = null, sessions = [], statusMap = {}, enrichedPeriodRow = null } = {}) {
  if (!period) return '';

  if (isScheduledEnrollmentClose(period)) {
    const closingDate = resolveScheduledClosingDate(period);
    if (closingDate) return closingDate;
  }

  const completionDate = normalizeDateOnly(period.completionDate);
  if (completionDate) return completionDate;

  const progressRow = enrichedPeriodRow || period;
  const sessionCompletionDate = normalizeDateOnly(progressRow?.sessionCompletion?.date);
  if (sessionCompletionDate) return sessionCompletionDate;

  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period.targetHours);

  if (targetSessionCount > 0 || targetHours > 0) {
    const alignment = rollingEnrollmentSessionAlignmentService.evaluateAlignment({
      sessions,
      startDate: period.startDate,
      endDate: period.endDate,
      targetSessionCount,
      targetHours,
      statusMap
    });
    const anticipated = rollingEnrollmentSessionAlignmentService.resolveAnticipatedFinishDate({
      countableSessions: alignment.countableSessions,
      targetSessionCount,
      targetHours
    });
    if (anticipated) return anticipated;
  }

  return normalizeDateOnly(period.endDate);
}

function emptyEnrollmentContext() {
  return {
    enrollmentPeriodId: '',
    enrollmentClbCurrent: {},
    enrollmentClbGoal: {},
    enrollmentClbRecordedAt: '',
    enrollmentExpectedFinishDate: '',
    enrollmentClosingDate: '',
    enrollmentClosedOnDate: '',
    enrollmentNotes: '',
    enrollmentRemainingSessionCount: null,
    enrollmentRemainingHours: null,
    enrollmentFinishAlertActive: false,
    enrollmentFinishAlertReasons: [],
    enrollmentFinishAlertDetails: [],
    enrollmentUpcomingPeriods: []
  };
}

function getSessionDateOnly(session = {}) {
  const token = String(session?.date || session?.sessionDate || '').trim();
  return normalizeDateOnly(token);
}

function isPeriodLinkedAsExtension(period = {}, currentPeriod = {}) {
  const currentId = toPublicId(currentPeriod?.id);
  const periodId = toPublicId(period?.id);
  if (!currentId || !periodId) return false;
  if (idsEqual(period?.extensionOfPeriodId, currentId)) return true;
  const extensions = Array.isArray(currentPeriod?.enrollmentExtensions) ? currentPeriod.enrollmentExtensions : [];
  return extensions.some((row) => idsEqual(row?.extensionPeriodId, periodId));
}

function enrollmentTypeLabel(period = {}, linkedExtension = false) {
  const kind = String(period?.enrollmentKind || 'standard').trim().toLowerCase();
  if (linkedExtension || kind === 'extension') return 'Extension';
  return 'New enrollment';
}

function buildUpcomingSummaryLine({
  remainingSessionCount = null,
  remainingHours = null,
  targetSessionCount = 0,
  targetHours = 0,
  expectedFinishDate = ''
} = {}) {
  const parts = [];
  if (Number.isFinite(remainingSessionCount) && remainingSessionCount !== null) {
    const n = Number(remainingSessionCount);
    parts.push(`${n} session${n === 1 ? '' : 's'} remaining`);
  } else if (targetSessionCount > 0) {
    parts.push(`${targetSessionCount} session target`);
  }
  if (Number.isFinite(remainingHours) && remainingHours !== null) {
    const h = Number(remainingHours);
    parts.push(`${h} hour${h === 1 ? '' : 's'} remaining`);
  } else if (targetHours > 0) {
    parts.push(`${targetHours} hour target`);
  }
  const finish = normalizeDateOnly(expectedFinishDate);
  if (finish) parts.push(`ends ~${finish}`);
  return parts.join(' · ');
}

function mapPeriodToUpcomingDto({
  period = {},
  enrichedPeriod = null,
  currentPeriod = {},
  sessions = [],
  statusMap = {}
} = {}) {
  const periodId = toPublicId(period?.id);
  const enriched = enrichedPeriod || period;
  const linked = isPeriodLinkedAsExtension(period, currentPeriod);
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period?.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours);
  const expectedFinishDate = resolveExpectedFinishDate({
    period,
    sessions,
    statusMap,
    enrichedPeriodRow: enriched
  });
  const remainingSessionCount = enriched?.remainingSessionCount ?? null;
  const remainingHours = enriched?.remainingHours ?? null;
  const startDate = normalizeDateOnly(period?.startDate);
  const endDate = normalizeDateOnly(period?.endDate);
  const closingDate = isScheduledEnrollmentClose(period)
    ? resolveScheduledClosingDate(period)
    : endDate;
  const reasonSnippet = String(period?.reasonStart || period?.notes || '').trim().slice(0, 280);
  return {
    periodId,
    enrollmentKind: String(period?.enrollmentKind || 'standard').trim().toLowerCase() || 'standard',
    typeLabel: enrollmentTypeLabel(period, linked),
    status: String(period?.status || 'active').trim().toLowerCase(),
    startDate,
    endDate,
    closingDate,
    targetSessionCount,
    targetHours,
    remainingSessionCount,
    remainingHours,
    expectedFinishDate,
    summaryLine: buildUpcomingSummaryLine({
      remainingSessionCount,
      remainingHours,
      targetSessionCount,
      targetHours,
      expectedFinishDate
    }),
    reasonSnippet
  };
}

function isRelatedEnrollmentCandidate({
  period = {},
  currentPeriod = {},
  session = {},
  personId = '',
  studentToPersonMap = new Map(),
  classId = '',
  activeOrgId = ''
} = {}) {
  const periodId = toPublicId(period?.id);
  const currentPeriodId = toPublicId(currentPeriod?.id);
  if (!periodId || !currentPeriodId || idsEqual(periodId, currentPeriodId)) return false;
  if (classId && period?.classId && !idsEqual(period.classId, classId)) return false;
  if (activeOrgId && period?.orgId && !idsEqual(period.orgId, activeOrgId)) return false;
  const status = String(period?.status || '').trim().toLowerCase();
  if (UPCOMING_EXCLUDED_STATUSES.has(status)) return false;
  const targetPersonId = cleanPersonId(personId);
  if (!targetPersonId) return false;
  if (!idsEqual(resolveStudentPersonId(period, studentToPersonMap), targetPersonId)) return false;

  if (isPeriodLinkedAsExtension(period, currentPeriod)) return true;

  if (!UPCOMING_OPEN_STATUSES.has(status)) return false;
  const sessionDate = getSessionDateOnly(session);
  const startDate = normalizeDateOnly(period?.startDate);
  if (!startDate || !sessionDate) return false;
  if (startDate < sessionDate) return false;
  if (periodCoversSession(period, session, { honorCompletion: true })) return false;
  return true;
}

function listRelatedEnrollmentsForSession({
  personId = '',
  currentPeriodId = '',
  currentPeriod = null,
  session = {},
  classData = {},
  periodRows = [],
  studentToPersonMap = new Map(),
  sessions = [],
  statusMap = {},
  progressByPeriodId = new Map(),
  activeOrgId = ''
} = {}) {
  const currentId = toPublicId(currentPeriodId);
  const classId = toPublicId(classData?.id);
  const current = currentPeriod
    || (Array.isArray(periodRows) ? periodRows : []).find((row) => idsEqual(row?.id, currentId))
    || null;
  if (!currentId || !current) return [];

  const candidates = (Array.isArray(periodRows) ? periodRows : [])
    .filter((period) => isRelatedEnrollmentCandidate({
      period,
      currentPeriod: current,
      session,
      personId,
      studentToPersonMap,
      classId,
      activeOrgId
    }))
    .map((period) => {
      const periodId = toPublicId(period?.id);
      const enriched = progressByPeriodId.get(periodId) || period;
      return mapPeriodToUpcomingDto({
        period,
        enrichedPeriod: enriched,
        currentPeriod: current,
        sessions,
        statusMap
      });
    })
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));

  return candidates;
}

async function buildRosterEnrollmentContextBatch({
  personIds = [],
  session = {},
  classData = {},
  periodRows = [],
  students = [],
  sessions = [],
  reqUser = null,
  registrationMode = '',
  alertPolicy = null
} = {}) {
  const mode = String(registrationMode || classData?.registrationMode || '').trim().toLowerCase();
  const people = Array.from(personIds instanceof Set ? personIds : new Set(personIds || []))
    .map((id) => cleanPersonId(id))
    .filter(Boolean);
  const map = new Map();
  if (!people.length) return map;

  const studentToPersonMap = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [toPublicId(row?.id), cleanPersonId(row?.personId)])
      .filter(([studentId, personId]) => studentId && personId)
  );

  people.forEach((personId) => {
    const student = findStudentByPersonId(students, personId);
    const clbContext = buildClbContextFromStudent(student);
    map.set(personId, {
      ...emptyEnrollmentContext(),
      ...clbContext
    });
  });

  if (mode !== 'rolling') return map;

  const orgId = toPublicId(classData?.orgId || reqUser?.activeOrgId || '');
  const activeOrgId = String(reqUser?.activeOrgId || orgId || '').trim();
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const progressByPeriodId = new Map();

  const relevantPeriodIds = new Set();
  const currentPeriodIdByPerson = new Map();
  people.forEach((personId) => {
    const window = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
      periodRows,
      studentToPersonMap,
      personId,
      session,
      activeOrgId,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
    });
    const periodToken = toPublicId(window?.periodId);
    if (periodToken) {
      relevantPeriodIds.add(periodToken);
      currentPeriodIdByPerson.set(personId, periodToken);
    }
  });

  currentPeriodIdByPerson.forEach((currentPeriodId, personId) => {
    const currentPeriod = (Array.isArray(periodRows) ? periodRows : []).find((row) => idsEqual(row?.id, currentPeriodId)) || null;
    const upcomingRows = listRelatedEnrollmentsForSession({
      personId,
      currentPeriodId,
      currentPeriod,
      session,
      classData,
      periodRows,
      studentToPersonMap,
      sessions,
      statusMap,
      progressByPeriodId: new Map(),
      activeOrgId
    });
    upcomingRows.forEach((row) => {
      if (row?.periodId) relevantPeriodIds.add(row.periodId);
    });
  });

  const relevantPeriods = (Array.isArray(periodRows) ? periodRows : [])
    .filter((row) => relevantPeriodIds.has(toPublicId(row?.id)));

  if (relevantPeriods.length) {
    const enrichedPeriods = await classEnrollmentPeriodProgressService.attachSessionProgressToEnrollmentPeriodRows(
      relevantPeriods,
      classData,
      reqUser,
      students
    );
    (Array.isArray(enrichedPeriods) ? enrichedPeriods : []).forEach((row) => {
      const periodId = toPublicId(row?.id);
      if (periodId) progressByPeriodId.set(periodId, row);
    });
  }

  people.forEach((personId) => {
    const window = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
      periodRows,
      studentToPersonMap,
      personId,
      session,
      activeOrgId,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
    });
    const periodId = toPublicId(window?.periodId);
    if (!periodId) return;

    const period = (Array.isArray(periodRows) ? periodRows : []).find((row) => idsEqual(row?.id, periodId)) || null;
    if (!period) return;

    const enrichedPeriod = progressByPeriodId.get(periodId) || period;
    const clbContext = map.get(personId) || buildClbContextFromStudent(findStudentByPersonId(students, personId));
    const finishDate = resolveExpectedFinishDate({
      period,
      sessions,
      statusMap,
      enrichedPeriodRow: enrichedPeriod
    });
    const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period?.targetSessionCount);
    const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours);
    const hasSessionTarget = targetSessionCount > 0
      || (targetHours > 0 && enrichedPeriod?.effectiveTargetSessionCount > 0);
    const hasHourTarget = targetHours > 0;
    const remainingSessionCount = enrichedPeriod?.remainingSessionCount ?? null;
    const remainingHours = enrichedPeriod?.remainingHours ?? null;
    const alertEvaluation = enrollmentFinishAlertPolicyService.evaluateAlert({
      policy: alertPolicy || {},
      sessionDate: session?.date,
      finishDate,
      remainingSessionCount,
      remainingHours,
      hasSessionTarget,
      hasHourTarget
    });
    const closingDate = resolveScheduledClosingDate(period);
    const closedOnDate = closedOnDateFromPeriod(period);
    const enrollmentUpcomingPeriods = listRelatedEnrollmentsForSession({
      personId,
      currentPeriodId: periodId,
      currentPeriod: period,
      session,
      classData,
      periodRows,
      studentToPersonMap,
      sessions,
      statusMap,
      progressByPeriodId,
      activeOrgId
    });
    map.set(personId, {
      ...clbContext,
      enrollmentPeriodId: periodId,
      enrollmentExpectedFinishDate: finishDate,
      enrollmentClosingDate: isScheduledEnrollmentClose(period) ? closingDate : normalizeDateOnly(period?.endDate),
      enrollmentClosedOnDate: closedOnDate,
      enrollmentNotes: String(period.notes || '').trim(),
      enrollmentRemainingSessionCount: remainingSessionCount,
      enrollmentRemainingHours: remainingHours,
      enrollmentFinishAlertActive: alertEvaluation.active === true,
      enrollmentFinishAlertReasons: Array.isArray(alertEvaluation.reasons) ? alertEvaluation.reasons : [],
      enrollmentFinishAlertDetails: Array.isArray(alertEvaluation.details) ? alertEvaluation.details : [],
      enrollmentUpcomingPeriods
    });
  });

  return map;
}

async function buildRosterEnrollmentContextForPerson(options = {}) {
  const personId = cleanPersonId(options.personId);
  const batch = await buildRosterEnrollmentContextBatch({
    ...options,
    personIds: personId ? [personId] : []
  });
  return batch.get(personId) || emptyEnrollmentContext();
}

function sanitizeEnrollmentNotes(notes = '') {
  return String(notes || '').trim().slice(0, 1000);
}

async function updateEnrollmentPeriodNotes({ periodId, notes, reqUser, updatedBy = '' } = {}) {
  const periodToken = toPublicId(periodId);
  if (!periodToken) throw new Error('periodId is required.');

  const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodToken, reqUser);
  if (!periodRow) throw new Error('Enrollment period not found.');

  const cleanNotes = sanitizeEnrollmentNotes(notes);
  const updated = await schoolDataService.updateClassEnrollmentPeriod(periodToken, {
    notes: cleanNotes,
    updatedBy: String(updatedBy || reqUser?.id || reqUser?.username || '').trim()
  }, reqUser);

  return {
    periodId: periodToken,
    notes: String(updated?.notes ?? cleanNotes).trim(),
    period: updated || { ...periodRow, notes: cleanNotes }
  };
}

module.exports = {
  buildClbContextFromStudent,
  resolveExpectedFinishDate,
  isScheduledEnrollmentClose,
  resolveScheduledClosingDate,
  closedOnDateFromPeriod,
  readLastCloseSnapshot,
  buildRosterEnrollmentContextForPerson,
  buildRosterEnrollmentContextBatch,
  listRelatedEnrollmentsForSession,
  updateEnrollmentPeriodNotes,
  sanitizeEnrollmentNotes,
  emptyEnrollmentContext
};
