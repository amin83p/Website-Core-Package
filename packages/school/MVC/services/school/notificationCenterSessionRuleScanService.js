'use strict';

const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const schoolDataService = require('./schoolDataService');
const bookCoveringReportService = require('./bookCoveringReportService');
const sessionStudentCaseService = require('./sessionStudentCaseService');
const reportViewService = require('./reportViewService');
const sessionReportInstanceService = require('./sessionReportInstanceService');
const sessionConductService = require('./sessionConductService');
const { requireCoreModule } = require('./schoolCoreContracts');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PENDING_REPORTS_PAYLOAD_CAP = 20;

function cleanText(value) {
  return String(value || '').trim();
}

function sessionHasInstructionalActivities(session = {}) {
  const gradebooks = Array.isArray(session?.gradebooks) ? session.gradebooks : [];
  const quizzes = Array.isArray(session?.quizzes) ? session.quizzes : [];
  const assignments = Array.isArray(session?.assignments) ? session.assignments : [];
  return gradebooks.length > 0 || quizzes.length > 0 || assignments.length > 0;
}

function sessionNotesEmpty(session = {}) {
  return !cleanText(session?.notes);
}

function buildCaseSessionKey(classId, sessionId) {
  return sessionStudentCaseService.getSessionCaseSummaryKey(classId, sessionId);
}

function buildCaseCountIndex(caseRows = []) {
  const index = new Map();
  (Array.isArray(caseRows) ? caseRows : []).forEach((row) => {
    const key = buildCaseSessionKey(row?.classId, row?.sessionId);
    if (!key) return;
    index.set(key, (index.get(key) || 0) + 1);
  });
  return index;
}

function sessionHasCases({ classData, session, caseCountIndex }) {
  const key = buildCaseSessionKey(classData?.id, session?.sessionId || session?.id);
  return key && (caseCountIndex.get(key) || 0) > 0;
}

function slimClassDataForFinding(classData = {}) {
  return {
    id: cleanText(classData?.id),
    orgId: cleanText(classData?.orgId),
    title: cleanText(classData?.title || classData?.name),
    name: cleanText(classData?.name || classData?.title)
  };
}

function slimSessionForFinding(session = {}) {
  return {
    sessionId: cleanText(session?.sessionId || session?.id),
    id: cleanText(session?.id || session?.sessionId),
    date: cleanText(session?.date),
    startTime: cleanText(session?.startTime),
    endTime: cleanText(session?.endTime),
    room: cleanText(session?.room),
    status: session?.status,
    sessionStatus: session?.sessionStatus,
    notes: session?.notes,
    statusNotes: session?.statusNotes,
    locked: session?.locked === true
  };
}

function slimSessionFindingPayload({ classData, session, ...rest } = {}) {
  const out = { ...rest };
  if (classData) out.classData = slimClassDataForFinding(classData);
  if (session) out.session = slimSessionForFinding(session);
  return out;
}

function buildFinding({ classData, session, extraPayload = {} }) {
  return {
    id: cleanText(session?.sessionId || session?.id),
    recipientPersonIds: sessionUncompletedNotificationService.listSessionEditorIds(session),
    title: sessionUncompletedNotificationService.buildSessionName(session),
    classTitle: cleanText(classData?.title || classData?.name),
    sessionDate: cleanText(session?.date),
    href: sessionUncompletedNotificationService.buildSessionManagerPath(classData, session),
    payload: slimSessionFindingPayload({ classData, session, ...extraPayload })
  };
}

async function loadOrgBookCoveringReports(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser).catch(() => []);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
}

async function loadOrgSessionStudentCases(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('sessionStudentCases', {}, reqUser).catch(() => []);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
}

async function resolveSessionDateWindow({ orgId, rule, asOfDate }) {
  const criteria = rule?.criteria || {};
  const range = criteria.sessionDateRange || {};
  const throughDate = cleanText(asOfDate) || cleanText(new Date().toISOString().slice(0, 10));
  const { fromDate, throughDate: resolvedThrough } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId,
    throughDate,
    rangeType: range.type || 'this_week',
    daysBeforeToday: range.daysBeforeToday
  });
  return { fromDate, throughDate: resolvedThrough, criteria };
}

async function evaluateSessionsByPredicate({
  orgId,
  rule,
  asOfDate,
  reqUser,
  predicate,
  prefetch = {}
} = {}) {
  if (typeof predicate !== 'function') {
    throw new Error('Session rule evaluation requires a predicate.');
  }
  const { fromDate, throughDate: resolvedThrough, criteria } = await resolveSessionDateWindow({ orgId, rule, asOfDate });
  const scopedUser = reqUser || { activeOrgId: orgId };

  const orgBookRows = prefetch.orgBookRows !== undefined
    ? prefetch.orgBookRows
    : await loadOrgBookCoveringReports(orgId, scopedUser);
  const orgCaseRows = prefetch.orgCaseRows !== undefined
    ? prefetch.orgCaseRows
    : await loadOrgSessionStudentCases(orgId, scopedUser);
  const caseCountIndex = buildCaseCountIndex(orgCaseRows);

  const classRows = await sessionUncompletedNotificationService.listOrgClasses(orgId, scopedUser);
  const findings = [];

  for (const classData of classRows) {
    const sessions = await sessionUncompletedNotificationService.listClassSessions(classData, scopedUser);
    for (const session of sessions) {
      const sessionDate = cleanText(session?.date);
      if (!sessionDate) continue;
      if (sessionDate < fromDate || sessionDate > resolvedThrough) continue;
      if (session?.locked === true && criteria.includeLockedSessions !== true) continue;

      const context = {
        classData,
        session,
        orgBookRows,
        caseCountIndex,
        reqUser: scopedUser
      };
      if (!predicate(context)) continue;
      findings.push(buildFinding({ classData, session }));
    }
  }

  return { findings, metadata: { fromDate, throughDate: resolvedThrough } };
}

function evaluateSessionWithoutBookReport(context) {
  return !bookCoveringReportService.hasSubmittedBookReportForSession({
    classData: context.classData,
    session: context.session,
    orgRows: context.orgBookRows,
    reqUser: context.reqUser
  });
}

function evaluateSessionWithoutNotes(context) {
  return sessionNotesEmpty(context.session);
}

function evaluateSessionWithCases(context) {
  return sessionHasCases(context);
}

function evaluateSessionWithActivities(context) {
  return sessionHasInstructionalActivities(context.session);
}

function buildSessionContext(classData = {}, session = {}) {
  return {
    classId: cleanText(classData?.id),
    sessionId: cleanText(session?.sessionId || session?.id),
    sessionDate: cleanText(session?.date)
  };
}

function filterInstanceRowsForSession(instanceRows = [], sessionContext = {}) {
  const classId = cleanText(sessionContext?.classId);
  return (Array.isArray(instanceRows) ? instanceRows : []).filter((row) => (
    idsEqual(row?.classId, classId)
    && sessionReportInstanceService.instanceRowMatchesSession(row, sessionContext)
  ));
}

function sessionMatchedReportAssignments(assignments = [], sessionContext = {}) {
  return (Array.isArray(assignments) ? assignments : []).filter((assignment) => (
    reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)
  ));
}

function sessionHasAssignedReports({ assignments = [], instanceRows = [], sessionContext = {} } = {}) {
  if (sessionMatchedReportAssignments(assignments, sessionContext).length > 0) return true;
  return filterInstanceRowsForSession(instanceRows, sessionContext).length > 0;
}

function listUnsubmittedReportRowsForSession({
  instanceRows = [],
  sessionContext = {},
  assignmentMap = new Map()
} = {}) {
  return filterInstanceRowsForSession(instanceRows, sessionContext)
    .map((row) => sessionReportInstanceService.mapRowToDto(row, assignmentMap))
    .filter((row) => !sessionReportInstanceService.isReportRowSubmitted({
      ...row,
      isPendingAssignment: row.isPending
    }));
}

function slimPendingReportsForPayload(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, PENDING_REPORTS_PAYLOAD_CAP)
    .map((row) => sessionReportInstanceService.mapPendingReportDto(row));
}

async function loadClassReportPrefetch(classData = {}, reqUser = {}) {
  const classId = cleanText(classData?.id);
  if (!classId) {
    return { assignments: [], assignmentMap: new Map(), instanceRows: [] };
  }
  const assignmentResult = await schoolDataService.fetchData(
    'reportAssignments',
    { classId__eq: classId },
    reqUser
  );
  const assignments = Array.isArray(assignmentResult) ? assignmentResult : [];
  const assignmentMap = new Map(
    assignments
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const instanceRows = await reportViewService.buildInstanceListRows({
    reqUser,
    classIds: [classId],
    prefetchedClass: classData
  });
  return {
    assignments,
    assignmentMap,
    instanceRows: Array.isArray(instanceRows) ? instanceRows : []
  };
}

function evaluateSessionAssignedReportsNotSubmitted(context = {}) {
  const sessionContext = context.sessionContext || buildSessionContext(context.classData, context.session);
  const prefetch = context.classReportPrefetch || {};
  const { assignments = [], assignmentMap = new Map(), instanceRows = [] } = prefetch;
  if (!sessionHasAssignedReports({ assignments, instanceRows, sessionContext })) return null;
  const unsubmitted = listUnsubmittedReportRowsForSession({ instanceRows, sessionContext, assignmentMap });
  if (!unsubmitted.length) return null;
  return {
    pendingReportCount: unsubmitted.length,
    pendingReports: slimPendingReportsForPayload(unsubmitted)
  };
}

function evaluateSessionClassConductNotCompleted(context = {}) {
  const sessionContext = context.sessionContext || buildSessionContext(context.classData, context.session);
  const prefetch = context.classReportPrefetch || {};
  const { assignments = [], assignmentMap = new Map(), instanceRows = [] } = prefetch;
  const sessionMatchedAssignments = sessionMatchedReportAssignments(assignments, sessionContext);
  const instanceDtos = filterInstanceRowsForSession(instanceRows, sessionContext)
    .map((row) => sessionReportInstanceService.mapRowToDto(row, assignmentMap));
  const conductRequiredByAssignment = sessionConductService.resolveSessionHasConductRequiredReports({
    instanceRows: instanceDtos,
    sessionMatchedAssignments,
    sessionContext
  });
  if (!sessionConductService.sessionShowsReportConductStep(context.session, conductRequiredByAssignment)) {
    return null;
  }
  if (sessionConductService.isSessionConductReady(context.session)) return null;
  return {};
}

async function evaluateSessionsByReportPredicate({
  orgId,
  rule,
  asOfDate,
  reqUser,
  predicate
} = {}) {
  if (typeof predicate !== 'function') {
    throw new Error('Session report rule evaluation requires a predicate.');
  }
  const { fromDate, throughDate: resolvedThrough, criteria } = await resolveSessionDateWindow({ orgId, rule, asOfDate });
  const scopedUser = reqUser || { activeOrgId: orgId };
  const classRows = await sessionUncompletedNotificationService.listOrgClasses(orgId, scopedUser);
  const findings = [];

  for (const classData of classRows) {
    const classReportPrefetch = await loadClassReportPrefetch(classData, scopedUser);
    const sessions = await sessionUncompletedNotificationService.listClassSessions(classData, scopedUser);
    for (const session of sessions) {
      const sessionDate = cleanText(session?.date);
      if (!sessionDate) continue;
      if (sessionDate < fromDate || sessionDate > resolvedThrough) continue;
      if (session?.locked === true && criteria.includeLockedSessions !== true) continue;

      const sessionContext = buildSessionContext(classData, session);
      const extraPayload = predicate({
        classData,
        session,
        sessionContext,
        classReportPrefetch,
        reqUser: scopedUser
      });
      if (!extraPayload) continue;
      findings.push(buildFinding({
        classData,
        session,
        extraPayload: typeof extraPayload === 'object' ? extraPayload : {}
      }));
    }
  }

  return { findings, metadata: { fromDate, throughDate: resolvedThrough } };
}

module.exports = {
  slimClassDataForFinding,
  slimSessionForFinding,
  slimSessionFindingPayload,
  sessionHasInstructionalActivities,
  sessionNotesEmpty,
  sessionHasCases,
  buildCaseCountIndex,
  evaluateSessionsByPredicate,
  evaluateSessionWithoutBookReport,
  evaluateSessionWithoutNotes,
  evaluateSessionWithCases,
  evaluateSessionWithActivities,
  loadOrgBookCoveringReports,
  loadOrgSessionStudentCases,
  buildSessionContext,
  filterInstanceRowsForSession,
  sessionHasAssignedReports,
  listUnsubmittedReportRowsForSession,
  loadClassReportPrefetch,
  evaluateSessionsByReportPredicate,
  evaluateSessionAssignedReportsNotSubmitted,
  evaluateSessionClassConductNotCompleted
};
