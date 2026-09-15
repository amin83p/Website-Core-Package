'use strict';

const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
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

function resolveExpectedFinishDate({ period = null, sessions = [], statusMap = {}, enrichedPeriodRow = null } = {}) {
  if (!period) return '';

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
    enrollmentNotes: ''
  };
}

async function buildRosterEnrollmentContextBatch({
  personIds = [],
  session = {},
  classData = {},
  periodRows = [],
  students = [],
  sessions = [],
  reqUser = null,
  registrationMode = ''
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
  people.forEach((personId) => {
    const window = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
      periodRows,
      studentToPersonMap,
      personId,
      session,
      activeOrgId,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
    });
    if (window?.periodId) relevantPeriodIds.add(window.periodId);
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
    map.set(personId, {
      ...clbContext,
      enrollmentPeriodId: periodId,
      enrollmentExpectedFinishDate: resolveExpectedFinishDate({
        period,
        sessions,
        statusMap,
        enrichedPeriodRow: enrichedPeriod
      }),
      enrollmentNotes: String(period.notes || '').trim()
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
  buildRosterEnrollmentContextForPerson,
  buildRosterEnrollmentContextBatch,
  updateEnrollmentPeriodNotes,
  sanitizeEnrollmentNotes,
  emptyEnrollmentContext
};
