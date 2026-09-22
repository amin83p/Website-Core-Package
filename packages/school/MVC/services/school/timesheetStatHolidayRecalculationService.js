'use strict';

const dataService = require('./schoolDataService');
const activityService = require('./activityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const timesheetSessionStudentLabelService = require('./timesheetSessionStudentLabelService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const statutoryHolidayTimesheetLifecycleService = require('./statutoryHolidayTimesheetLifecycleService');
const deadlineReconciliationService = require('./timesheetDeadlineReconciliationService');
const timesheetPrintService = require('./timesheetPrintService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

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

function calculatePayableTimesheetTotal(entries = []) {
  const total = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    if (!entry || entry.isDeleted === true) return sum;
    return sum + timesheetPrintService.resolvePayableHours(entry);
  }, 0);
  return Number(total.toFixed(2));
}

function mapActivitySessionsById(activityLiveSessions = []) {
  const map = new Map();
  (Array.isArray(activityLiveSessions) ? activityLiveSessions : []).forEach((row) => {
    const key = String(row?.sessionId || '').trim();
    if (key) map.set(key, row);
  });
  return map;
}

async function buildSupplementalLiveSessionsForStatHoliday({
  activeOrgId,
  period,
  teacherContext,
  reqUser,
  timesheetParametersPolicy = null
} = {}) {
  const policy = timesheetParametersPolicy
    || await timesheetParametersPolicyModel.getPolicyForOrg(activeOrgId);
  const sessionStatusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
  const statusMap = sessionStatusPolicyService.getStatusMetaMap(sessionStatusMeta);
  const [classes, departments] = await Promise.all([
    dataService.fetchAllData('classes', {}, reqUser),
    dataService.fetchAllData('departments', {}, reqUser)
  ]);
  const scopedClasses = (Array.isArray(classes) ? classes : []).filter((row) => idsEqual(row?.orgId, activeOrgId));
  const liveSessionBuilders = [];
  const sessionsByClassId = new Map();

  for (const classRow of scopedClasses || []) {
    const sessions = await dataService.getClassSessions(classRow.id, reqUser);
    sessionsByClassId.set(String(classRow?.id || '').trim(), Array.isArray(sessions) ? sessions : []);
    (sessions || []).forEach((sessionRow) => {
      if (!sessionDeliveryTeamService.isPersonOnSessionDelivery(sessionRow, teacherContext.targetTeacherId)) return;
      if (sessionRow.date < period.startDate || sessionRow.date > period.endDate) return;
      const key = String(sessionRow?.sessionId || '').trim();
      if (!key) return;
      const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      });
      const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes);
      const durationHours = Number(parseFloat(sessionRow?.durationHours) || 0);
      const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes,
        durationHours,
        session: sessionRow
      });
      const deadlineClassification = deadlineReconciliationService.classifySession({
        period,
        sessionDate: sessionRow?.date,
        isFinalStatus,
        baselineStatus: normalizedStatus,
        baselineHours: timesheetHours
      });
      liveSessionBuilders.push({
        classId: String(classRow?.id || ''),
        sessionRow,
        payload: {
          sessionId: key,
          classId: String(classRow?.id || ''),
          className: String(classRow?.title || classRow?.name || ''),
          deliveryDepartmentId: String(classRow?.deliveryDepartmentId || ''),
          deliveryDepartmentName: String(classRow?.deliveryDepartmentName || ''),
          date: String(sessionRow?.date || ''),
          startTime: String(sessionRow?.startTime || ''),
          endTime: String(sessionRow?.endTime || ''),
          status: normalizedStatus,
          notes: sessionRow?.notes,
          durationHours,
          timesheetHours,
          isFinalStatus,
          ...deadlineClassification,
          ...buildTimesheetMakeupMeta(sessionRow, classRow, sessionsByClassId)
        }
      });
    });
  }

  const [students, personPayload] = await Promise.all([
    dataService.fetchData('students', { orgId__eq: activeOrgId }, reqUser),
    schoolIdentityLookupService.listSchoolPersonRecords({
      reqUser,
      requireSchoolRole: false,
      query: { limit: 5000 }
    })
  ]);
  const trustedLiveSessions = timesheetParametersPolicyService.applyEmptyEnrollmentSessionsPolicy(
    await timesheetSessionStudentLabelService.enrichClassLiveSessions({
      classRows: scopedClasses,
      sessionsByClassId,
      liveSessionBuilders,
      students,
      persons: personPayload?.allRows || personPayload?.rows || [],
      departments,
      statusMap,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      activeOrgId,
      reqUser
    }),
    policy
  );

  const activityLiveSessions = await activityService.getTimesheetEntriesForPerson({
    orgId: activeOrgId,
    personId: teacherContext.targetTeacherId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    reqUser
  });

  const supplementalLiveSessions = [
    ...trustedLiveSessions,
    ...(Array.isArray(activityLiveSessions) ? activityLiveSessions : [])
  ];

  return {
    timesheetParametersPolicy: policy,
    trustedLiveSessions,
    activityLiveSessions,
    supplementalLiveSessions
  };
}

async function materializeStatHolidayForEntryRows({
  activeOrgId,
  period,
  teacherContext,
  entryRows,
  existing,
  existingEntriesBySessionId,
  reqUser,
  timesheetParametersPolicy,
  payrollContext,
  supplementalLiveSessions,
  materializeMode = 'reviewer',
  reviewerEdit = false
} = {}) {
  if (!statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled(timesheetParametersPolicy)) {
    return {
      entryRows,
      statHolidayMaterialization: null,
      refreshedActivityLiveSessions: []
    };
  }

  const activeEntryRows = (Array.isArray(entryRows) ? entryRows : []).filter((entry) => entry && entry.isDeleted !== true);
  const periodWorkdayEntries = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries(
    activeEntryRows,
    supplementalLiveSessions
  );
  const allHolidays = await dataService.fetchAllData('holidays', {}, reqUser);
  const allowStatHolidayOverride = await statutoryHolidayTimesheetLifecycleService.resolveStatHolidayOverridePermission({
    reqUser,
    timesheet: existing,
    period,
    reviewerEdit: reviewerEdit || materializeMode === 'reviewer'
  });

  const materializeContext = {
    orgId: activeOrgId,
    personId: teacherContext.targetTeacherId,
    personName: payrollContext?.personName || '',
    period,
    policy: timesheetParametersPolicy,
    holidays: allHolidays,
    periodEntries: periodWorkdayEntries,
    existingEntries: activeEntryRows,
    reqUser,
    allowManagerOverride: allowStatHolidayOverride
  };

  let statHolidayMaterialization;
  if (materializeMode === 'submit') {
    statHolidayMaterialization = await statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit(materializeContext);
  } else {
    statHolidayMaterialization = await statutoryHolidayTimesheetLifecycleService.updateStatHolidayOnReviewerSave({
      ...materializeContext,
      allowManagerOverride: allowStatHolidayOverride
    });
  }

  const statHolidayBlockingErrors = Array.isArray(statHolidayMaterialization?.blockingErrors)
    ? statHolidayMaterialization.blockingErrors.filter(Boolean)
    : [];
  if (statHolidayBlockingErrors.length) {
    const error = new Error(statHolidayBlockingErrors.join(' '));
    error.statusCode = 400;
    throw error;
  }

  const mergedEntryRows = statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries({
    entries: entryRows,
    statHolidayRows: statHolidayMaterialization?.rows || [],
    usesActivityMode: statHolidayMaterialization?.usesActivityMode === true,
    existingEntriesBySessionId
  });

  const refreshedActivityLiveSessions = await activityService.getTimesheetEntriesForPerson({
    orgId: activeOrgId,
    personId: teacherContext.targetTeacherId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    reqUser
  });

  return {
    entryRows: mergedEntryRows,
    statHolidayMaterialization,
    refreshedActivityLiveSessions
  };
}

async function runStatHolidayMaterializationForTimesheetSave({
  activeOrgId,
  period,
  teacherContext,
  entryRows,
  existing,
  existingEntriesBySessionId,
  reqUser,
  timesheetParametersPolicy,
  payrollContext,
  supplementalLiveSessions,
  shouldPersistStatHoliday,
  nextStatus,
  reviewerEdit
} = {}) {
  if (!shouldPersistStatHoliday) {
    return {
      entryRows,
      statHolidayMaterialization: null,
      refreshedActivityLiveSessions: []
    };
  }

  const materializeMode = nextStatus === 'submitted' && !reviewerEdit ? 'submit' : 'reviewer';
  return materializeStatHolidayForEntryRows({
    activeOrgId,
    period,
    teacherContext,
    entryRows,
    existing,
    existingEntriesBySessionId,
    reqUser,
    timesheetParametersPolicy,
    payrollContext,
    supplementalLiveSessions,
    materializeMode,
    reviewerEdit
  });
}

module.exports = {
  buildSupplementalLiveSessionsForStatHoliday,
  materializeStatHolidayForEntryRows,
  runStatHolidayMaterializationForTimesheetSave,
  calculatePayableTimesheetTotal,
  mapActivitySessionsById
};
