const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const reportPeriodBasePolicy = require('./reportPeriodBasePolicy');

function normalizeDateOnly(value) {
  return reportPeriodBasePolicy.normalizeDateOnly(value);
}

function periodCoversSessionDate(period = {}, sessionDate = '', classData = {}) {
  const date = normalizeDateOnly(sessionDate);
  if (!date) return false;
  const start = normalizeDateOnly(period?.startDate);
  const end = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(period);
  if (!start) return false;
  const status = String(period?.status || '').trim().toLowerCase();
  const allowed = classEnrollmentReadService.getReportRosterStatusesForClass(classData);
  const statusSet = new Set(
    (Array.isArray(allowed) ? allowed : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  );
  if (!statusSet.has(status)) return false;
  return start <= date && end >= date;
}

async function resolveStudentRecordIdForPerson(personId, reqUser) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) return '';
  const allStudents = await schoolDataService.fetchAllData('students', {}, reqUser);
  const match = (Array.isArray(allStudents) ? allStudents : []).find((row) => toPublicId(row?.personId) === targetPersonId);
  return toPublicId(match?.id);
}

async function resolveEnrollmentStartForPerson({
  classData,
  sessionDate,
  personId,
  reqUser
} = {}) {
  const classId = toPublicId(classData?.id);
  const studentId = await resolveStudentRecordIdForPerson(personId, reqUser);
  if (!classId || !studentId) return '';
  const periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
  const covering = (Array.isArray(periods) ? periods : [])
    .filter((row) => toPublicId(row?.studentId) === studentId)
    .filter((row) => periodCoversSessionDate(row, sessionDate, classData))
    .map((row) => normalizeDateOnly(row?.startDate))
    .filter(Boolean)
    .sort();
  return covering[0] || '';
}

async function resolveSuggestedReportStartDate({
  template = {},
  sessionDate = '',
  classData = null,
  reqUser = null,
  reportScope = 'class',
  targetStudentIds = []
} = {}) {
  const session = normalizeDateOnly(sessionDate);
  if (!session) return '';
  const { reportPeriodBase: base, reportPeriodOffset: offset } = reportPeriodBasePolicy.resolveReportPeriodFields(template);

  if (base === 'enrollment') {
    if (!reportPeriodBasePolicy.isStudentScopedReportScope(reportScope)) {
      return session;
    }
    const ids = (Array.isArray(targetStudentIds) ? targetStudentIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean);
    if (ids.length !== 1 || !classData || !reqUser) {
      return session;
    }
    const enrollmentStart = await resolveEnrollmentStartForPerson({
      classData,
      sessionDate: session,
      personId: ids[0],
      reqUser
    });
    return enrollmentStart || session;
  }

  return reportPeriodBasePolicy.computeSuggestedReportStartDateSync({
    reportPeriodBase: base,
    reportPeriodOffset: offset,
    sessionDate: session
  });
}

module.exports = {
  periodCoversSessionDate,
  resolveEnrollmentStartForPerson,
  resolveSuggestedReportStartDate
};
