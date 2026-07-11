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

async function buildClassEnrollmentRows({ reqUser, activeOrgId, studentId, programs, terms, classes, subjects }) {
  const programMap = new Map((Array.isArray(programs) ? programs : []).map((row) => [toPublicId(row.id), row]));
  const termMap = new Map((Array.isArray(terms) ? terms : []).map((row) => [toPublicId(row.id), row]));
  const classMap = new Map((Array.isArray(classes) ? classes : []).map((row) => [toPublicId(row.id), row]));
  const subjectMap = new Map((Array.isArray(subjects) ? subjects : []).map((row) => [toPublicId(row.id), row]));

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
      const enrollmentText = `${String(period?.reasonStart || '')} ${String(period?.notes || '')}`;
      const termRegistrationMatch = enrollmentText.match(/term registration\s+([A-Za-z0-9:_-]+)/i);
      const termRegistrationId = String(period?.authorizationRef || (termRegistrationMatch ? termRegistrationMatch[1] : '')).trim();
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
        termRegistrationId,
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
    subjects
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
  registrationSortRank,
  sortRegistrationRows
};
