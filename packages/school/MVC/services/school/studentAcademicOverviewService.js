const dataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const programRegistrationViewService = require('./programRegistrationViewService');
const termRegistrationViewService = require('./termRegistrationViewService');
const programWithdrawalService = require('./withdrawal/programWithdrawalService');

const ACTIVE_REGISTRATION_STATUSES = new Set(['registered', 'draft', 'error', 'planned', 'active']);

function registrationSortRank(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (ACTIVE_REGISTRATION_STATUSES.has(normalized)) return 0;
  if (normalized === 'completed') return 1;
  if (normalized === 'withdrawn' || normalized === 'cancelled' || normalized === 'archived') return 2;
  if (normalized === 'rolled_back') return 3;
  return 4;
}

function sortRegistrationRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const rankDiff = registrationSortRank(a?.status) - registrationSortRank(b?.status);
    if (rankDiff !== 0) return rankDiff;
    const aDate = String(a?.registrationDate || a?.startDate || '');
    const bDate = String(b?.registrationDate || b?.startDate || '');
    return bDate.localeCompare(aDate) || String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

function buildProgramLabel(program, programId) {
  return [String(program?.code || programId || ''), String(program?.name || '')].filter(Boolean).join(' - ');
}

function buildTermLabel(term, termId) {
  return [String(term?.code || termId || ''), String(term?.termName || term?.name || '')].filter(Boolean).join(' - ');
}

function resolveClassSubjectLabel(classRow, subjectMap) {
  const subjects = Array.isArray(classRow?.subjects) ? classRow.subjects : [];
  const labels = subjects.map((row) => {
    const subjectId = toPublicId(row?.subjectId || '');
    const subject = subjectId ? subjectMap.get(subjectId) : null;
    return String(subject?.code || subject?.name || row?.code || row?.subjectId || '').trim();
  }).filter(Boolean);
  if (labels.length) return labels.join(', ');
  return String(classRow?.title || '').trim();
}

function enrichProgramRows(rows) {
  return sortRegistrationRows(rows).map((row) => ({
    ...row,
    detailUrl: `/school/programs/registrations/${encodeURIComponent(row.id)}`
  }));
}

function enrichTermRows(rows) {
  return sortRegistrationRows(rows).map((row) => ({
    ...row,
    detailUrl: `/school/programs/term-registrations/${encodeURIComponent(row.id)}`
  }));
}

function buildKnownTermRegistrationIdSet(termRows) {
  const ids = new Set();
  (Array.isArray(termRows) ? termRows : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) ids.add(id);
  });
  return ids;
}

function resolveRegistrationSource(period, options = {}) {
  const knownTermRegistrationIds = options.knownTermRegistrationIds instanceof Set
    ? options.knownTermRegistrationIds
    : new Set();
  const enrollmentSource = String(period?.enrollmentSource || '').trim().toLowerCase();
  const enrollmentText = `${String(period?.reasonStart || '')} ${String(period?.notes || '')}`;
  const termRegistrationMatch = enrollmentText.match(/term registration\s+([A-Za-z0-9:_-]+)/i);
  const authorizationRef = String(period?.authorizationRef || '').trim();
  const regexTermRegistrationId = termRegistrationMatch ? String(termRegistrationMatch[1] || '').trim() : '';
  const termRegistrationId = authorizationRef || regexTermRegistrationId;

  const isTermRegistration = enrollmentSource === 'term_registration'
    || (authorizationRef && knownTermRegistrationIds.has(authorizationRef))
    || Boolean(regexTermRegistrationId)
    || (authorizationRef && /term registration/i.test(enrollmentText));

  if (isTermRegistration) {
    return {
      registrationType: 'term_registration',
      registrationId: termRegistrationId || authorizationRef,
      registrationLabel: 'Term Registration',
      termRegistrationId: termRegistrationId || authorizationRef
    };
  }

  const rollingSource = enrollmentSource === 'rolling_enrollment';
  return {
    registrationType: 'class_enrollment',
    registrationId: String(period?.id || '').trim(),
    registrationLabel: rollingSource ? 'Rolling Enrollment' : 'Class Enrollment',
    termRegistrationId: ''
  };
}

function buildRegistrationSummary(period, registrationMeta, termRowById) {
  if (registrationMeta.registrationType === 'term_registration') {
    const termRow = termRowById?.get(toPublicId(registrationMeta.termRegistrationId)) || null;
    const status = String(termRow?.status || termRow?.verificationStatus || '').trim() || 'unknown';
    const date = String(termRow?.registrationDate || period?.startDate || '').trim();
    return [status, date].filter(Boolean).join(' · ') || 'Term registration';
  }
  const status = String(period?.status || '').trim() || 'unknown';
  const startDate = String(period?.startDate || '').trim();
  return [status, startDate].filter(Boolean).join(' · ') || registrationMeta.registrationLabel;
}

function buildEnrollmentDetailApiUrl(studentId, enrollmentId) {
  const normalizedStudentId = toPublicId(studentId);
  const normalizedEnrollmentId = toPublicId(enrollmentId);
  if (!normalizedStudentId || !normalizedEnrollmentId) return '';
  return `/school/academic-ledger/student-overview/${encodeURIComponent(normalizedStudentId)}/enrollment-detail/${encodeURIComponent(normalizedEnrollmentId)}`;
}

async function buildClassEnrollmentRows({
  reqUser,
  activeOrgId,
  studentId,
  programs,
  terms,
  classes,
  subjects,
  termRows = []
}) {
  const programMap = new Map((Array.isArray(programs) ? programs : []).map((row) => [toPublicId(row.id), row]));
  const termMap = new Map((Array.isArray(terms) ? terms : []).map((row) => [toPublicId(row.id), row]));
  const classMap = new Map((Array.isArray(classes) ? classes : []).map((row) => [toPublicId(row.id), row]));
  const subjectMap = new Map((Array.isArray(subjects) ? subjects : []).map((row) => [toPublicId(row.id), row]));
  const knownTermRegistrationIds = buildKnownTermRegistrationIdSet(termRows);
  const termRowById = new Map((Array.isArray(termRows) ? termRows : []).map((row) => [toPublicId(row.id), row]));

  const periods = await dataService.getClassEnrollmentPeriodsByStudentId(studentId, reqUser);
  const rows = (Array.isArray(periods) ? periods : [])
    .filter((row) => idsEqual(row?.orgId, activeOrgId))
    .map((period) => {
      const classId = toPublicId(period?.classId || '');
      const programId = toPublicId(period?.programId || '');
      const termId = toPublicId(period?.termId || '');
      const classRow = classMap.get(classId) || null;
      const program = programMap.get(programId) || null;
      const term = termMap.get(termId) || null;
      const registrationMeta = resolveRegistrationSource(period, { knownTermRegistrationIds });
      return {
        id: period.id,
        enrollmentId: period.id,
        classId,
        classTitle: String(classRow?.title || classId || '').trim(),
        subjectLabel: resolveClassSubjectLabel(classRow, subjectMap),
        programId,
        programLabel: buildProgramLabel(program, programId),
        termId,
        termLabel: buildTermLabel(term, termId),
        startDate: String(period?.startDate || '').trim(),
        endDate: String(period?.endDate || '').trim(),
        status: String(period?.status || '').trim(),
        termRegistrationId: registrationMeta.termRegistrationId || '',
        registrationType: registrationMeta.registrationType,
        registrationId: registrationMeta.registrationId,
        registrationLabel: registrationMeta.registrationLabel,
        registrationSummary: buildRegistrationSummary(period, registrationMeta, termRowById),
        detailApiUrl: buildEnrollmentDetailApiUrl(studentId, period.id),
        programRegistrationId: String(period?.programRegistrationId || '').trim(),
        editUrl: classId ? `/school/classes/edit/${encodeURIComponent(classId)}` : ''
      };
    });

  return sortRegistrationRows(rows);
}

async function buildStudentAcademicOverview({ reqUser, activeOrgId, studentId } = {}) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) {
    throw new Error('Student is required.');
  }

  const student = await dataService.getDataById('students', normalizedStudentId, reqUser);
  if (!student) {
    throw new Error('Student not found or inaccessible.');
  }

  const person = student.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser, personId: student.personId })
    : null;
  const studentName = schoolPersonAccessService.formatPersonName(person, String(student.id || ''));

  const [programRows, termRows, programs, terms, classes, subjects, integrity] = await Promise.all([
    programRegistrationViewService.buildRegistrationSummaries(reqUser, activeOrgId, {
      filters: { studentId: normalizedStudentId }
    }),
    termRegistrationViewService.buildRegistrationSummaries(reqUser, activeOrgId, {
      filters: { studentId: normalizedStudentId }
    }),
    dataService.fetchData('programs', {}, reqUser),
    dataService.fetchData('terms', {}, reqUser),
    dataService.fetchData('classes', {}, reqUser),
    dataService.fetchData('subjects', {}, reqUser),
    programWithdrawalService.getStudentWithdrawalStatus(normalizedStudentId, activeOrgId, reqUser)
  ]);

  const classRows = await buildClassEnrollmentRows({
    reqUser,
    activeOrgId,
    studentId: normalizedStudentId,
    programs,
    terms,
    classes,
    subjects,
    termRows
  });

  const programsEnriched = enrichProgramRows(programRows);
  const termsEnriched = enrichTermRows(termRows);

  return {
    student: {
      id: student.id,
      personId: student.personId || '',
      studentNumber: student.studentNumber || '',
      name: studentName
    },
    person,
    summary: {
      programCount: programsEnriched.length,
      termCount: termsEnriched.length,
      classCount: classRows.length
    },
    warnings: Array.isArray(integrity?.warnings) ? integrity.warnings : [],
    reviewRequired: integrity?.reviewRequired === true,
    programs: programsEnriched,
    terms: termsEnriched,
    classes: classRows
  };
}

module.exports = {
  buildStudentAcademicOverview,
  buildClassEnrollmentRows,
  buildEnrollmentDetailApiUrl,
  resolveRegistrationSource,
  registrationSortRank,
  sortRegistrationRows
};
