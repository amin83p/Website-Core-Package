'use strict';

const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');
const schoolDataService = require('./schoolDataService');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function cleanText(value) {
  return String(value || '').trim();
}

function rosterAttendanceUnmarked(row = {}) {
  return !cleanText(row?.attendanceStatus || row?.attendance);
}

async function evaluateSessionNotFinal({ orgId, rule, asOfDate, reqUser }) {
  const criteria = rule?.criteria || {};
  const range = criteria.sessionDateRange || {};
  const throughDate = cleanText(asOfDate) || cleanText(new Date().toISOString().slice(0, 10));
  const { fromDate, throughDate: resolvedThrough } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId,
    throughDate,
    rangeType: range.type || 'this_week',
    daysBeforeToday: range.daysBeforeToday
  });
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const entries = await sessionUncompletedNotificationService.listUncompletedSessionsForOrg(orgId, {
    fromDate,
    throughDate: resolvedThrough,
    statusMap,
    reqUser: reqUser || { activeOrgId: orgId }
  });
  const findings = entries.map((entry) => ({
    id: cleanText(entry?.session?.sessionId || entry?.session?.id),
    recipientPersonIds: sessionUncompletedNotificationService.listSessionEditorIds(entry?.session || {}),
    title: sessionUncompletedNotificationService.buildSessionName(entry?.session || {}),
    classTitle: cleanText(entry?.classData?.title || entry?.classData?.name),
    sessionDate: cleanText(entry?.session?.date),
    href: sessionUncompletedNotificationService.buildSessionManagerPath(entry?.classData, entry?.session),
    payload: entry
  }));
  return { findings, metadata: { fromDate, throughDate: resolvedThrough } };
}

function groupFindingsByRecipient(findings = []) {
  const grouped = new Map();
  (Array.isArray(findings) ? findings : []).forEach((finding) => {
    const ids = Array.isArray(finding.recipientPersonIds) ? finding.recipientPersonIds : [];
    ids.forEach((personId) => {
      const key = toPublicId(personId);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(finding);
    });
  });
  return grouped;
}

async function evaluateSessionAttendanceIncomplete({ orgId, rule, asOfDate, reqUser }) {
  const criteria = rule?.criteria || {};
  const range = criteria.sessionDateRange || {};
  const throughDate = cleanText(asOfDate) || cleanText(new Date().toISOString().slice(0, 10));
  const { fromDate, throughDate: resolvedThrough } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId,
    throughDate,
    rangeType: range.type || 'this_week',
    daysBeforeToday: range.daysBeforeToday
  });
  const scopedUser = reqUser || { activeOrgId: orgId };
  const classRows = await sessionUncompletedNotificationService.listOrgClasses(orgId, scopedUser);
  const findings = [];
  for (const classData of classRows) {
    const sessions = await sessionUncompletedNotificationService.listClassSessions(classData, scopedUser);
    for (const session of sessions) {
      const sessionDate = cleanText(session?.date);
      if (!sessionDate) continue;
      if (sessionDate < fromDate || sessionDate > resolvedThrough) continue;
      if (session?.locked === true && criteria.includeLockedSessions !== true) continue;
      const roster = Array.isArray(session?.roster) ? session.roster : [];
      const unmarked = roster.filter(rosterAttendanceUnmarked);
      const minCount = Number(criteria.minUnmarkedCount) || 1;
      if (unmarked.length < minCount) continue;
      findings.push({
        id: cleanText(session?.sessionId || session?.id),
        recipientPersonIds: sessionUncompletedNotificationService.listSessionEditorIds(session),
        title: sessionUncompletedNotificationService.buildSessionName(session),
        classTitle: cleanText(classData?.title || classData?.name),
        sessionDate,
        unmarkedCount: unmarked.length,
        href: sessionUncompletedNotificationService.buildSessionManagerPath(classData, session),
        payload: { classData, session, unmarkedCount: unmarked.length }
      });
    }
  }
  return { findings, metadata: { fromDate, throughDate: resolvedThrough } };
}

async function evaluateTimesheetNotSubmitted({ orgId, rule, reqUser }) {
  const criteria = rule?.criteria || {};
  const statuses = new Set((Array.isArray(criteria.statuses) ? criteria.statuses : ['draft', 'not_started']).map((s) => cleanText(s).toLowerCase()));
  const periodId = cleanText(criteria.timesheetPeriodId);
  const deadline = cleanText(criteria.submissionDeadlineDate);
  const today = cleanText(new Date().toISOString().slice(0, 10));
  if (deadline && today < deadline) {
    return { findings: [], metadata: { skipped: 'before_deadline' } };
  }
  const scopedUser = reqUser || { activeOrgId: orgId };
  const rows = await schoolDataService.fetchAllData('timesheets', {}, scopedUser).catch(() => []);
  const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (cleanText(row?.orgId) !== cleanText(orgId)) return false;
    if (periodId && cleanText(row?.periodId) !== periodId) return false;
    return true;
  });
  const findings = [];
  for (const timesheet of filteredRows) {
    const status = cleanText(timesheet?.status).toLowerCase() || 'draft';
    if (!statuses.has(status)) continue;
    const teacherId = toPublicId(timesheet?.teacherId);
    if (!teacherId) continue;
    const periodLabel = cleanText(timesheet?.periodName || timesheet?.periodId);
    findings.push({
      id: cleanText(timesheet?.id),
      recipientPersonIds: [teacherId],
      title: `Timesheet not submitted: ${periodLabel || 'period'}`,
      classTitle: '',
      sessionDate: '',
      href: periodId && teacherId
        ? `/school/timesheets/editor/${encodeURIComponent(periodId)}?teacherId=${encodeURIComponent(teacherId)}`
        : '/school/timesheets',
      payload: { timesheet }
    });
  }
  return { findings, metadata: { periodId, deadline } };
}

const EVALUATORS = Object.freeze({
  session_not_final: {
    evaluate: evaluateSessionNotFinal,
    groupFindings: groupFindingsByRecipient
  },
  session_attendance_incomplete: {
    evaluate: evaluateSessionAttendanceIncomplete,
    groupFindings: groupFindingsByRecipient
  },
  timesheet_not_submitted: {
    evaluate: evaluateTimesheetNotSubmitted,
    groupFindings: groupFindingsByRecipient
  }
});

function getEvaluator(ruleType = '') {
  const key = cleanText(ruleType).toLowerCase();
  return EVALUATORS[key] || null;
}

async function buildBatchPreview({
  recipientPersonId,
  items = [],
  rule = {},
  orgId = '',
  baseUrl = '',
  orgTimeZone = 'UTC',
  orgName = ''
} = {}) {
  const name = await personDisplayNameService.resolvePersonDisplayName(recipientPersonId, {
    fallback: recipientPersonId
  });
  const sessionEntries = items
    .filter((item) => item?.payload?.session)
    .map((item) => ({
      ...(item.payload && typeof item.payload === 'object' ? item.payload : {}),
      title: item.title
    }));
  if (sessionEntries.length) {
    const emailContent = await sessionUncompletedNotificationService.buildTeacherReviewEmailContent({
      teacherName: name,
      orgName,
      entries: sessionEntries,
      baseUrl,
      orgId,
      orgTimeZone
    });
    return {
      recipientPersonId,
      recipientName: name,
      subject: `${rule.label || 'School reminder'} (${items.length} item(s))`,
      plainText: emailContent.plainText,
      htmlBody: emailContent.htmlBody,
      smsText: `${rule.label || 'Reminder'}: ${items.length} item(s) need attention.`
    };
  }
  const listText = items.map((item) => `- ${item.title}`).join('\n');
  const listHtml = `<ul>${items.map((item) => `<li>${item.title}</li>`).join('')}</ul>`;
  const intro = `You have ${items.length} item(s) that need your attention. Please review and complete them when you are ready.`;
  return {
    recipientPersonId,
    recipientName: name,
    subject: `${rule.label || 'School reminder'} (${items.length} item(s))`,
    plainText: `Hi ${name},\n\n${intro}\n\n${listText}\n\nThank you,\n${orgName || 'School'}\n`,
    htmlBody: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;"><p>Hi ${name},</p><p>${intro}</p>${listHtml}<p>Thank you,<br>${orgName || 'School'}</p></div>`,
    smsText: `${rule.label || 'Reminder'}: ${items.length} item(s) need attention.`
  };
}

module.exports = {
  getEvaluator,
  buildBatchPreview,
  evaluateSessionNotFinal,
  evaluateSessionAttendanceIncomplete,
  evaluateTimesheetNotSubmitted,
  groupFindingsByRecipient
};
