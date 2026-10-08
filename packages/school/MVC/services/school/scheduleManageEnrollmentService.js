'use strict';

const schoolDataService = require('./schoolDataService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const scheduleEnrollStudentsService = require('./scheduleEnrollStudentsService');
const sessionEnrollmentContextService = require('./sessionEnrollmentContextService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active']);

const STATUS_LABELS = {
  draft: 'Draft',
  planned: 'Planned',
  to_be_confirmed: 'To be Confirmed',
  waiting_list: 'Waiting list',
  active: 'Active'
};

let dependencies = {
  schoolDataService,
  classEnrollmentSessionApplicabilityService,
  schoolPersonAccessService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return '';
}

function sessionIdentity(session = {}) {
  return toPublicId(session.sessionId || session.id || '');
}

function sessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
}

function studentDisplayName(student, fallback) {
  if (!student || typeof student !== 'object') return fallback;
  const displayName = String(student.displayName || '').trim();
  if (displayName) return displayName;
  const name = student.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (name && typeof name === 'object') {
    const full = `${String(name.first || '').trim()} ${String(name.last || '').trim()}`.trim();
    if (full) return full;
  }
  return fallback;
}

function resolveEnrollmentType(period = {}) {
  const targetHours = Number(period?.targetHours) || 0;
  const targetSessionCount = Number(period?.targetSessionCount) || 0;
  const endDate = normalizeDateOnly(period?.endDate);
  if (targetHours > 0) {
    return {
      enrollmentType: 'hour',
      enrollmentTypeLabel: 'Hour',
      enrollmentTypeDetail: `${targetHours} hour${targetHours === 1 ? '' : 's'}`
    };
  }
  if (targetSessionCount > 0) {
    return {
      enrollmentType: 'session',
      enrollmentTypeLabel: 'Session cap',
      enrollmentTypeDetail: `${targetSessionCount} session${targetSessionCount === 1 ? '' : 's'}`
    };
  }
  if (endDate) {
    return {
      enrollmentType: 'end_date',
      enrollmentTypeLabel: 'End date',
      enrollmentTypeDetail: endDate
    };
  }
  return {
    enrollmentType: 'open_ended',
    enrollmentTypeLabel: 'Open-ended',
    enrollmentTypeDetail: 'No end date'
  };
}

function formatStatusLabel(status) {
  const key = String(status || '').trim().toLowerCase();
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  if (!key) return '—';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatDateRange(startDate, endDate) {
  const start = normalizeDateOnly(startDate) || '—';
  const end = normalizeDateOnly(endDate);
  return end ? `${start} → ${end}` : `${start} → Open`;
}

function buildEnrollmentDateFields(period = {}) {
  const startDate = normalizeDateOnly(period.startDate);
  const closingDate = sessionEnrollmentContextService.resolveScheduledClosingDate(period);
  const closedOnDate = sessionEnrollmentContextService.closedOnDateFromPeriod(period);
  const scheduledClose = sessionEnrollmentContextService.isScheduledEnrollmentClose(period);
  const endForRange = closingDate || normalizeDateOnly(period.endDate);
  return {
    startDate,
    closingDate: scheduledClose ? closingDate : normalizeDateOnly(period.endDate),
    closedOnDate,
    dateRangeLabel: formatDateRange(startDate, endForRange)
  };
}

async function resolveStudentLabels(studentIds = [], reqUser) {
  const ids = Array.from(new Set((Array.isArray(studentIds) ? studentIds : []).map(toPublicId).filter(Boolean)));
  const labelByStudentId = new Map();
  if (!ids.length) return labelByStudentId;

  const students = [];
  for (const studentId of ids) {
    try {
      const student = await dependencies.schoolDataService.getDataById('students', studentId, reqUser);
      if (student) students.push(student);
      else labelByStudentId.set(studentId, studentId);
    } catch (_error) {
      labelByStudentId.set(studentId, studentId);
    }
  }

  const personById = await dependencies.schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: students.map((student) => student?.personId)
  });

  students.forEach((student) => {
    const studentId = toPublicId(student?.id);
    if (!studentId) return;
    const personId = toPublicId(student?.personId);
    const person = personById.get(personId);
    const personName = dependencies.schoolPersonAccessService.formatPersonName(person, '');
    const fromStudent = studentDisplayName(student, '');
    const baseName = personName || fromStudent || studentId;
    const label = student?.studentNumber ? `${baseName} (${student.studentNumber})` : baseName;
    labelByStudentId.set(studentId, label);
  });

  return labelByStudentId;
}

function parseSelectedSessions(body = {}) {
  const rows = Array.isArray(body.sessions) ? body.sessions : [];
  const parsed = [];
  const seen = new Set();
  rows.forEach((row) => {
    const sessionId = toPublicId(row?.sessionId || row?.id);
    const classId = toPublicId(row?.classId);
    if (!sessionId || !classId) return;
    const key = `${classId}::${sessionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push({
      sessionId,
      classId,
      date: normalizeDateOnly(row?.date)
    });
  });
  return parsed;
}

function collectCoveringOpenPeriods({ periods = [], selectedDates = [] } = {}) {
  const dates = (Array.isArray(selectedDates) ? selectedDates : []).map(normalizeDateOnly).filter(Boolean);
  const rows = [];
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    const status = String(period?.status || '').trim().toLowerCase();
    if (!OPEN_STATUSES.has(status)) return;
    const covers = dates.some((date) => (
      dependencies.classEnrollmentSessionApplicabilityService.periodCoversSession(period, { date })
    ));
    if (!covers) return;
    rows.push(period);
  });
  return rows;
}

async function buildManageEnrollmentList({
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  const selected = Array.isArray(sessions) ? sessions : [];
  if (!selected.length) {
    throw new Error('Select at least one saved class session.');
  }

  const byClass = new Map();
  selected.forEach((row) => {
    const classId = toPublicId(row.classId);
    const sessionId = toPublicId(row.sessionId);
    if (!classId || !sessionId) return;
    if (!byClass.has(classId)) {
      byClass.set(classId, { sessionIds: new Set(), dates: new Set() });
    }
    const bucket = byClass.get(classId);
    bucket.sessionIds.add(sessionId);
    const date = normalizeDateOnly(row.date);
    if (date) bucket.dates.add(date);
  });

  if (!byClass.size) {
    throw new Error('Select at least one saved class session.');
  }

  const enrollments = [];
  const seenPeriodIds = new Set();

  for (const [classId, bucket] of byClass.entries()) {
    const classData = await dependencies.schoolDataService.getDataById(
      'classes',
      classId,
      reqUser,
      accessContext
    );
    if (!classData) {
      throw new Error(`Class not found: ${classId}`);
    }

    const classSessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    const selectedSessions = (Array.isArray(classSessions) ? classSessions : []).filter((session) => (
      bucket.sessionIds.has(sessionIdentity(session))
    ));
    if (!selectedSessions.length) {
      throw new Error(`Select at least one saved session from class ${String(classData.title || classId)}.`);
    }

    selectedSessions.forEach((session) => {
      const date = sessionDate(session);
      if (date) bucket.dates.add(date);
    });

    const periods = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(
      classId,
      reqUser
    );
    const covering = collectCoveringOpenPeriods({
      periods,
      selectedDates: Array.from(bucket.dates)
    });

    const className = String(classData.title || classData.name || classId).trim();
    const uniqueCovering = covering.filter((period) => {
      const periodId = toPublicId(period.id);
      if (!periodId || seenPeriodIds.has(periodId)) return false;
      seenPeriodIds.add(periodId);
      return true;
    });
    const labelByStudentId = await resolveStudentLabels(
      uniqueCovering.map((period) => period.studentId),
      reqUser
    );

    for (const period of uniqueCovering) {
      const periodId = toPublicId(period.id);
      const studentId = toPublicId(period.studentId);
      const studentLabel = labelByStudentId.get(studentId) || studentId || periodId;
      const status = String(period.status || '').trim().toLowerCase();
      const postedCount = Array.isArray(period?.transactionSummary?.postedTransactionIds)
        ? period.transactionSummary.postedTransactionIds.length
        : 0;
      const enrollmentType = resolveEnrollmentType(period);
      const dateFields = buildEnrollmentDateFields(period);

      enrollments.push({
        periodId,
        classId,
        className,
        studentId,
        studentLabel,
        status,
        statusLabel: formatStatusLabel(status),
        startDate: dateFields.startDate,
        endDate: normalizeDateOnly(period.endDate),
        closingDate: dateFields.closingDate,
        closedOnDate: dateFields.closedOnDate,
        dateRangeLabel: dateFields.dateRangeLabel,
        ...enrollmentType,
        funderId: String(period.funderId || 'self').trim() || 'self',
        funderType: String(period.funderType || 'self').trim() || 'self',
        funderLabel: String(period.funderLabel || '').trim(),
        targetSessionCount: Number(period.targetSessionCount) || 0,
        targetHours: Number(period.targetHours) || 0,
        sessionCapacityType: String(period.sessionCapacityType || 'group').trim() || 'group',
        reasonStart: String(period.reasonStart || '').trim(),
        claimNumber: String(period.claimNumber || period.claimSelectToken || '').trim(),
        hasPostedTransactions: postedCount > 0,
        hasNonNaAttendanceMarkings: period.hasNonNaAttendanceMarkings === true
      });
    }
  }

  enrollments.sort((a, b) => {
    const classCmp = String(a.className || '').localeCompare(String(b.className || ''));
    if (classCmp) return classCmp;
    return String(a.studentLabel || '').localeCompare(String(b.studentLabel || ''));
  });

  return {
    enrollments,
    selectedSessionCount: selected.length,
    classCount: byClass.size
  };
}

async function listFunderOptionsForClass({
  classId,
  reqUser,
  accessContext
} = {}) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) {
    throw new Error('classId is required.');
  }
  const classData = await dependencies.schoolDataService.getDataById(
    'classes',
    normalizedClassId,
    reqUser,
    accessContext
  );
  if (!classData) {
    throw new Error('Class not found.');
  }
  const funderOptions = await scheduleEnrollStudentsService.loadActiveFunderOptions(
    reqUser,
    classData.orgId
  );
  return {
    classId: normalizedClassId,
    funderOptions: Array.isArray(funderOptions) ? funderOptions : []
  };
}

function __setDependenciesForTest(next = {}) {
  dependencies = { ...dependencies, ...next };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    classEnrollmentSessionApplicabilityService,
    schoolPersonAccessService
  };
}

module.exports = {
  OPEN_STATUSES,
  parseSelectedSessions,
  collectCoveringOpenPeriods,
  buildManageEnrollmentList,
  buildEnrollmentDateFields,
  listFunderOptionsForClass,
  formatStatusLabel,
  resolveEnrollmentType,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
