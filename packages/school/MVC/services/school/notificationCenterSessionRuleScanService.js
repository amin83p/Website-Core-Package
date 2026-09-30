'use strict';

const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const schoolDataService = require('./schoolDataService');
const bookCoveringReportService = require('./bookCoveringReportService');
const sessionStudentCaseService = require('./sessionStudentCaseService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

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

function buildFinding({ classData, session, extraPayload = {} }) {
  return {
    id: cleanText(session?.sessionId || session?.id),
    recipientPersonIds: sessionUncompletedNotificationService.listSessionEditorIds(session),
    title: sessionUncompletedNotificationService.buildSessionName(session),
    classTitle: cleanText(classData?.title || classData?.name),
    sessionDate: cleanText(session?.date),
    href: sessionUncompletedNotificationService.buildSessionManagerPath(classData, session),
    payload: { classData, session, ...extraPayload }
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

module.exports = {
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
  loadOrgSessionStudentCases
};
