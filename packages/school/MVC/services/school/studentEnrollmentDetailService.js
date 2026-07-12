const dataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const termRegistrationViewService = require('./termRegistrationViewService');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const { buildGradesMatrixPayload } = require('../../controllers/school/gradesMatrixController');
const { resolveRegistrationSource } = require('./studentAcademicOverviewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const RELATED_LEDGER_ENTRY_LIMIT = 25;

function buildProgramLabel(program, programId) {
  return [String(program?.code || programId || ''), String(program?.name || '')].filter(Boolean).join(' - ');
}

function buildTermLabel(term, termId) {
  return [String(term?.code || termId || ''), String(term?.termName || term?.name || '')].filter(Boolean).join(' - ');
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildLinkedClassEnrollmentSnippet(period, classRow) {
  return {
    enrollmentId: String(period?.id || '').trim(),
    classId: toPublicId(period?.classId),
    classTitle: String(classRow?.title || period?.classId || '').trim(),
    startDate: String(period?.startDate || '').trim(),
    endDate: String(period?.endDate || '').trim(),
    status: String(period?.status || '').trim()
  };
}

function buildTermRegistrationModalPayload(detail, linkedClassEnrollment) {
  const record = detail?.record || {};
  const classRows = Array.isArray(record?.classSummary?.rows) ? record.classSummary.rows : [];
  return {
    id: detail.id,
    status: detail.status,
    verificationStatus: detail.verificationStatus,
    registrationDate: detail.registrationDate,
    studentId: detail.studentId,
    studentName: detail.studentName,
    programId: detail.programId,
    programLabel: detail.programLabel,
    termId: detail.termId,
    termLabel: detail.termLabel,
    feeCategorySnapshot: detail.feeCategorySnapshot || '',
    selectedCredits: Number(detail.selectedCredits || record?.creditSummary?.selectedCredits || 0),
    classCount: Number(detail.classCount || record?.classSummary?.count || classRows.length || 0),
    note: detail.note || '',
    finance: detail.finance || {},
    academic: detail.academic || {},
    selectedClasses: classRows.map((row) => ({
      classId: String(row?.classId || row?.id || '').trim(),
      classTitle: String(row?.classTitle || row?.title || row?.classId || '').trim(),
      credits: row?.credits ?? null,
      status: String(row?.status || '').trim()
    })),
    linkedClassEnrollment,
    recentAcademicEntries: (Array.isArray(detail.academicEntries) ? detail.academicEntries : [])
      .slice(0, RELATED_LEDGER_ENTRY_LIMIT)
      .map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        effectiveDate: entry.effectiveDate,
        status: entry.status,
        memo: entry.memo || ''
      })),
    recentFinancialTransactions: (Array.isArray(detail.financialTransactions) ? detail.financialTransactions : [])
      .slice(0, RELATED_LEDGER_ENTRY_LIMIT)
      .map((row) => ({
        id: row.id,
        status: row.status,
        amount: row.amount,
        memo: row.memo || row.description || ''
      }))
  };
}

function buildGradebookActivities(columns, cells) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeCells = Array.isArray(cells) ? cells : [];
  return safeColumns.map((col, index) => {
    const cell = safeCells[index] || {};
    return {
      sessionId: col.sessionId || '',
      date: col.date || '',
      label: col.label || col.title || col.itemId || '',
      category: col.category || '',
      totalScore: col.totalScore ?? null,
      score: cell.score ?? null,
      percent: cell.percent ?? null,
      attendanceStatus: cell.attendanceStatus || '',
      absent: cell.absent === true,
      includeInGradeCalculation: cell.includeInGradeCalculation === true,
      effective: cell.effective === true
    };
  });
}

function buildAttendanceHistoryFromMatrix(columns, cells) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeCells = Array.isArray(cells) ? cells : [];
  const bySession = new Map();
  safeColumns.forEach((col, index) => {
    const sessionId = String(col?.sessionId || '').trim();
    if (!sessionId || bySession.has(sessionId)) return;
    const cell = safeCells[index] || {};
    bySession.set(sessionId, {
      sessionId,
      date: col.date || '',
      status: cell.attendanceStatus || '',
      lateMinutes: cell.lateMinutes ?? 0,
      earlyLeaveMinutes: cell.earlyLeaveMinutes ?? 0
    });
  });
  return Array.from(bySession.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function loadRelatedLedgerEntries({ studentId, classId, startDate, endDate }) {
  const entries = await schoolRepositories.academicLedger.list({ query: {}, scope: { canViewAll: true } });
  const windowStart = normalizeDateOnly(startDate);
  const windowEnd = normalizeDateOnly(endDate || todayISO());
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => idsEqual(entry?.studentId, studentId))
    .filter((entry) => !classId || idsEqual(entry?.classId, classId))
    .filter((entry) => {
      const effectiveDate = normalizeDateOnly(entry?.effectiveDate);
      if (!effectiveDate) return true;
      if (windowStart && effectiveDate < windowStart) return false;
      if (windowEnd && effectiveDate > windowEnd) return false;
      return true;
    })
    .sort((a, b) => String(b?.effectiveDate || '').localeCompare(String(a?.effectiveDate || '')))
    .slice(0, RELATED_LEDGER_ENTRY_LIMIT)
    .map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      effectiveDate: entry.effectiveDate,
      status: entry.status,
      memo: entry.memo || '',
      subjectId: entry.subjectId || '',
      classId: entry.classId || ''
    }));
}

async function buildClassEnrollmentDetail({
  reqUser,
  activeOrgId,
  student,
  period,
  classRow,
  program,
  term,
  registrationMeta
}) {
  const personId = toPublicId(student?.personId);
  const classId = toPublicId(period?.classId);
  const startDate = String(period?.startDate || '').trim();
  const endDate = String(period?.endDate || '').trim() || todayISO();

  const [progressRows, relatedRecords] = await Promise.all([
    classEnrollmentPeriodProgressService.attachSessionProgressToEnrollmentPeriodRows(
      [period],
      classRow,
      reqUser,
      [student]
    ),
    loadRelatedLedgerEntries({
      studentId: student.id,
      classId,
      startDate,
      endDate
    })
  ]);
  const progress = progressRows[0] || period;

  const matrixPayload = await buildGradesMatrixPayload(
    { user: reqUser },
    { classId, startDate, endDate }
  );
  const matrixRow = (Array.isArray(matrixPayload?.matrix) ? matrixPayload.matrix : [])
    .find((row) => idsEqual(row?.personId, personId)) || null;

  const attendanceHistory = matrixRow
    ? buildAttendanceHistoryFromMatrix(matrixPayload.columns, matrixRow.cells)
    : [];
  const gradebookActivities = matrixRow
    ? buildGradebookActivities(matrixPayload.columns, matrixRow.cells)
    : [];

  return {
    view: 'class_enrollment',
    registrationType: registrationMeta.registrationType,
    registrationLabel: registrationMeta.registrationLabel,
    enrollment: {
      enrollmentId: period.id,
      classId,
      classTitle: String(classRow?.title || classId || '').trim(),
      programId: toPublicId(period?.programId),
      programLabel: buildProgramLabel(program, period?.programId),
      termId: toPublicId(period?.termId),
      termLabel: buildTermLabel(term, period?.termId),
      startDate,
      endDate: String(period?.endDate || '').trim(),
      status: String(period?.status || '').trim(),
      programRegistrationId: String(period?.programRegistrationId || '').trim(),
      enrollmentSource: String(period?.enrollmentSource || '').trim(),
      notes: String(period?.notes || '').trim(),
      reasonStart: String(period?.reasonStart || '').trim(),
      reasonEnd: String(period?.reasonEnd || '').trim(),
      pricing: period?.pricing || null,
      sessions: {
        targetSessionCount: progress?.targetSessionCount ?? null,
        effectiveTargetSessionCount: progress?.effectiveTargetSessionCount ?? null,
        consumedSessionCount: progress?.consumedSessionCount ?? null,
        remainingSessionCount: progress?.remainingSessionCount ?? null,
        windowSessionCount: progress?.windowSessionCount ?? null,
        targetSource: progress?.targetSource || '',
        sessionCompletion: progress?.sessionCompletion || null
      }
    },
    attendanceHistory,
    attendanceSummary: matrixRow?.attendanceSummary || null,
    attendancePercent: matrixRow?.attendancePct ?? null,
    gradebookHistory: {
      activities: gradebookActivities,
      assignmentsPercent: matrixRow?.assignmentsPct ?? null,
      finalPercent: matrixRow?.finalPercent ?? null,
      finalParts: matrixRow?.finalParts || null
    },
    relatedRecords
  };
}

async function buildTermRegistrationDetail({
  reqUser,
  activeOrgId,
  student,
  period,
  classRow,
  registrationMeta
}) {
  const termRegistrationId = toPublicId(registrationMeta.termRegistrationId || registrationMeta.registrationId);
  if (!termRegistrationId) {
    throw new Error('Term registration reference is missing for this enrollment.');
  }

  const detail = await termRegistrationViewService.buildRegistrationDetail(reqUser, activeOrgId, termRegistrationId);
  if (!detail) {
    throw new Error('Term registration not found or inaccessible.');
  }
  if (!idsEqual(detail.studentId, student.id)) {
    throw new Error('Term registration does not belong to this student.');
  }

  return {
    view: 'term_registration',
    registrationType: 'term_registration',
    registrationLabel: 'Term Registration',
    termRegistration: buildTermRegistrationModalPayload(
      detail,
      buildLinkedClassEnrollmentSnippet(period, classRow)
    )
  };
}

async function buildEnrollmentDetail({ reqUser, activeOrgId, studentId, enrollmentId } = {}) {
  const normalizedStudentId = toPublicId(studentId);
  const normalizedEnrollmentId = toPublicId(enrollmentId);
  if (!normalizedStudentId) throw new Error('Student is required.');
  if (!normalizedEnrollmentId) throw new Error('Enrollment is required.');

  const [student, period, termRows] = await Promise.all([
    dataService.getDataById('students', normalizedStudentId, reqUser),
    schoolRepositories.classEnrollmentPeriods.getById(normalizedEnrollmentId),
    termRegistrationViewService.buildRegistrationSummaries(reqUser, activeOrgId, {
      filters: { studentId: normalizedStudentId }
    })
  ]);

  if (!student) throw new Error('Student not found or inaccessible.');
  if (!period) throw new Error('Class enrollment not found.');
  if (!idsEqual(period.orgId, activeOrgId)) throw new Error('Class enrollment is not in the active organization.');
  if (!idsEqual(period.studentId, normalizedStudentId)) throw new Error('Class enrollment does not belong to this student.');

  const knownTermRegistrationIds = new Set(
    (Array.isArray(termRows) ? termRows : []).map((row) => toPublicId(row.id)).filter(Boolean)
  );
  const registrationMeta = resolveRegistrationSource(period, { knownTermRegistrationIds });

  const [classRow, program, term] = await Promise.all([
    dataService.getDataById('classes', period.classId, reqUser),
    period.programId ? dataService.getDataById('programs', period.programId, reqUser) : null,
    period.termId ? dataService.getDataById('terms', period.termId, reqUser) : null
  ]);

  if (registrationMeta.registrationType === 'term_registration') {
    return buildTermRegistrationDetail({
      reqUser,
      activeOrgId,
      student,
      period,
      classRow,
      registrationMeta
    });
  }

  return buildClassEnrollmentDetail({
    reqUser,
    activeOrgId,
    student,
    period,
    classRow,
    program,
    term,
    registrationMeta
  });
}

module.exports = {
  buildEnrollmentDetail,
  buildTermRegistrationModalPayload,
  buildClassEnrollmentDetail,
  buildGradebookActivities,
  buildAttendanceHistoryFromMatrix,
  loadRelatedLedgerEntries
};
