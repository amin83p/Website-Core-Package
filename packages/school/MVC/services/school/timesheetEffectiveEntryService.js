'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const { buildReportReflectionLiveSessions } = require('./reportTimesheetReflectionService');
const activityService = require('./activityService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const timesheetSessionStudentLabelService = require('./timesheetSessionStudentLabelService');
const deadlineReconciliationService = require('./timesheetDeadlineReconciliationService');

function buildTimesheetMakeupMeta(sessionRow, classRow, sessionsByClassId = null) {
  const isMakeupSession = sessionRow?.makeup?.isMakeup === true;
  if (!isMakeupSession) {
    return {
      isMakeupSession: false,
      makeupOriginalSessionId: '',
      makeupOriginalClassId: '',
      makeupOriginalDate: '',
      makeupOriginalStartTime: '',
      makeupOriginalEndTime: ''
    };
  }

  const makeupOriginalSessionId = String(sessionRow?.makeup?.originalSessionId || '').trim();
  const makeupOriginalClassId = String(sessionRow?.makeup?.originalClassId || classRow?.id || '').trim();
  let makeupOriginalDate = '';
  let makeupOriginalStartTime = '';
  let makeupOriginalEndTime = '';
  const classSessions = sessionsByClassId instanceof Map
    ? (sessionsByClassId.get(makeupOriginalClassId) || [])
    : [];
  if (makeupOriginalSessionId && Array.isArray(classSessions)) {
    const originalSession = classSessions.find((row) => idsEqual(row?.sessionId || row?.id, makeupOriginalSessionId));
    if (originalSession) {
      makeupOriginalDate = String(originalSession.date || '').trim();
      makeupOriginalStartTime = String(originalSession.startTime || '').trim();
      makeupOriginalEndTime = String(originalSession.endTime || '').trim();
    }
  }

  return {
    isMakeupSession: true,
    makeupOriginalSessionId,
    makeupOriginalClassId,
    makeupOriginalDate,
    makeupOriginalStartTime,
    makeupOriginalEndTime
  };
}

async function buildEffectiveTimesheetEntries({ period, personId, activeOrgId, reqUser }) {
  const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(
    period.orgId || activeOrgId || '',
    { includeInactive: true }
  );
  const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
  const [classes, existing, departments] = await Promise.all([
    schoolDataService.fetchAllData('classes', {}, reqUser),
    schoolDataService.getTimesheetByPeriodAndTeacher(period.id, personId, reqUser),
    schoolDataService.fetchAllData('departments', {}, reqUser)
  ]);

  const classRows = (Array.isArray(classes) ? classes : [])
    .filter((row) => idsEqual(row?.orgId, activeOrgId));
  const liveSessionBuilders = [];
  const sessionsByClassId = new Map();

  for (const classRow of classRows) {
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classRow.id, reqUser);
    sessionsByClassId.set(String(classRow.id || '').trim(), Array.isArray(sessions) ? sessions : []);
    (Array.isArray(sessions) ? sessions : [])
      .filter((sessionRow) => (
        sessionDeliveryTeamService.isPersonOnSessionDelivery(sessionRow, personId)
        && String(sessionRow?.date || '') >= String(period.startDate || '')
        && String(sessionRow?.date || '') <= String(period.endDate || '')
      ))
      .forEach((sessionRow) => {
        const rawDurationHours = parseFloat(sessionRow?.durationHours) || 0;
        const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(
          sessionRow?.status,
          sessionRow?.notes
        );
        const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
          status: sessionRow?.status,
          notes: sessionRow?.notes
        });
        const isBlockingNonFinal = deadlineReconciliationService.isBlockingNonFinalSession({
          period,
          sessionDate: sessionRow?.date,
          isFinalStatus
        });
        if (isBlockingNonFinal) return;
        const formulaTimesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
          status: sessionRow?.status,
          notes: sessionRow?.notes,
          durationHours: rawDurationHours,
          session: sessionRow
        });
        const isCoTeacherSession = !sessionDeliveryTeamService.isPersonSessionMainTeacher(sessionRow, personId)
          && sessionDeliveryTeamService.isPersonOnSessionDelivery(sessionRow, personId);
        const coTeacherEntry = isCoTeacherSession
          ? sessionDeliveryTeamService.findCoTeacherEntry(sessionRow, personId)
          : null;
        const timesheetHours = sessionDeliveryTeamService.resolveCoTeacherTimesheetHours({
          session: sessionRow,
          personId,
          formulaHours: formulaTimesheetHours
        });
        liveSessionBuilders.push({
          classId: String(classRow?.id || ''),
          sessionRow,
          payload: deadlineReconciliationService.applySessionClassification({
            sessionId: sessionRow?.sessionId,
            classId: String(classRow?.id || ''),
            className: String(classRow?.title || classRow?.name || ''),
            deliveryDepartmentId: classRow?.deliveryDepartmentId || '',
            deliveryDepartmentName: classRow?.deliveryDepartmentName || '',
            date: sessionRow?.date,
            startTime: sessionRow?.startTime,
            endTime: sessionRow?.endTime,
            durationHours: rawDurationHours,
            timesheetHours,
            status: normalizedStatus,
            notes: sessionRow?.notes || '',
            room: sessionRow?.room || '',
            isFinalStatus,
            isManual: false,
            isCoTeacherSession,
            coTeacherRoleLabel: isCoTeacherSession
              ? String(coTeacherEntry?.roleLabel || 'Co-Teacher')
              : '',
            coTeacherPaid: isCoTeacherSession ? coTeacherEntry?.paid !== false : false,
            coTeacherPaidHours: isCoTeacherSession && coTeacherEntry?.paid !== false
              ? (sessionDeliveryTeamService.normalizePaidHours(coTeacherEntry?.paidHours) ?? timesheetHours)
              : 0,
            ...buildTimesheetMakeupMeta(sessionRow, classRow, sessionsByClassId)
          }, { period, isFinalStatus })
        });
      });
  }

  const [students, personPayload] = await Promise.all([
    schoolDataService.fetchData('students', { orgId__eq: activeOrgId }, reqUser),
    schoolIdentityLookupService.listSchoolPersonRecords({
      reqUser,
      requireSchoolRole: false,
      query: { limit: 5000 }
    })
  ]);
  const persons = personPayload?.allRows || personPayload?.rows || [];
  const liveSessions = await timesheetSessionStudentLabelService.enrichClassLiveSessions({
    classRows,
    sessionsByClassId,
    liveSessionBuilders,
    students,
    persons,
    departments,
    statusMap,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    activeOrgId,
    reqUser
  });

  const reportReflectionSessions = await buildReportReflectionLiveSessions({
    teacherPersonId: personId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    activeOrgId,
    reqUser
  });
  const activityEntries = await activityService.getTimesheetEntriesForPerson({
    orgId: activeOrgId,
    personId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    reqUser
  });

  const existingEntries = Array.isArray(existing?.entries) ? existing.entries : [];
  const deletedAutoSessionIds = new Set(existingEntries
    .filter((entry) => entry?.isDeleted === true)
    .map((entry) => String(entry?.sessionId || '').trim())
    .filter(Boolean));
  const savedComments = new Map();
  existingEntries.forEach((entry) => {
    if (!entry || entry.isDeleted || entry.isManual) return;
    const sessionId = String(entry.sessionId || '').trim();
    if (sessionId) savedComments.set(sessionId, String(entry.comment || ''));
  });

  const manualEntries = existingEntries
    .filter((entry) => entry?.isManual === true && entry?.isDeleted !== true)
    .map((entry) => ({ ...entry, isManual: true }));
  const liveEntries = [...liveSessions, ...reportReflectionSessions, ...(Array.isArray(activityEntries) ? activityEntries : [])];
  const autoEntries = liveEntries
    .filter((entry) => !deletedAutoSessionIds.has(String(entry?.sessionId || '').trim()))
    .map((entry) => ({
      ...entry,
      // The timesheet comment is user-authored timesheet data. Never seed it from
      // class-session or activity notes carried by the authoritative live entry.
      comment: savedComments.get(String(entry?.sessionId || '').trim()) || '',
      isManual: false
    }));

  return {
    entries: [...manualEntries, ...autoEntries],
    liveEntries,
    classes: classRows,
    departments: Array.isArray(departments) ? departments : [],
    timesheet: existing || null
  };
}

module.exports = {
  buildEffectiveTimesheetEntries,
  buildTimesheetMakeupMeta
};
