'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const startupLogger = requireCoreModule('MVC/utils/startupLogger');
const {
  getTodayDateKeyInTimezone,
  getDateTimePartsInTimezone,
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow
} = requireCoreModule('MVC/utils/timezoneUtils');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionNotificationDeliveryService = require('./sessionNotificationDeliveryService');
const classModel = require('../../models/school/classModel');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');

function cleanText(value) {
  return String(value || '').trim();
}

function shouldRunForOrgNow(policy, orgTimeZone, now = new Date()) {
  const notification = policy?.uncompletedSessionNotification || {};
  if (!notification.enabled) return false;
  const parts = getDateTimePartsInTimezone(now.getTime(), orgTimeZone);
  if (!parts) return false;
  const configured = cleanText(notification.sendAtTime).slice(0, 5);
  const current = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return configured === current;
}

function resolveTargetSessionDate(policy, orgTimeZone, now = new Date()) {
  const today = getTodayDateKeyInTimezone(orgTimeZone, now.getTime());
  if (policy?.uncompletedSessionNotification?.sendWhen === 'next_day') {
    return sessionAttendanceEditAccessService.addDaysToDateKey(today, -1);
  }
  return today;
}

async function resolveOrgTimeZone(orgId) {
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgId);
    if (row) return resolveOrganizationTimezoneFromRow(row);
  } catch (_) {
    // Fall back to default timezone when organization lookup is unavailable.
  }
  return resolveDefaultTimezone();
}

async function processOrgNotifications(orgId, now = new Date()) {
  const policy = await sessionAccessPolicyModel.getPolicyForOrg(orgId);
  const orgTimeZone = await resolveOrgTimeZone(orgId);
  if (!shouldRunForOrgNow(policy, orgTimeZone, now)) {
    return { orgId, skipped: true, reason: 'outside_send_window' };
  }

  const targetSessionDate = resolveTargetSessionDate(policy, orgTimeZone, now);
  const sendWhenDate = getTodayDateKeyInTimezone(orgTimeZone, now.getTime());
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const classes = await classModel.getAllClasses();
  const orgClasses = (Array.isArray(classes) ? classes : [])
    .filter((row) => cleanText(row?.orgId) === cleanText(orgId));
  let sentCount = 0;
  let candidateCount = 0;

  for (const classData of orgClasses) {
    const sessions = Array.isArray(classData?.sessions) ? classData.sessions : [];
    for (const session of sessions) {
      if (cleanText(session?.date) !== targetSessionDate) continue;
      if (session?.locked === true) continue;
      const isFinal = sessionStatusPolicyService.isFinalStatusByMap(statusMap, session);
      if (isFinal) continue;
      candidateCount += 1;
      const teacherIds = sessionNotificationDeliveryService.listSessionEditorIds(session);
      for (const teacherId of teacherIds) {
        const teacher = await schoolPersonAccessService.getPersonById(teacherId).catch(() => null);
        if (!teacher) continue;
        const outcomes = await sessionNotificationDeliveryService.notifyTeacherForSession({
          orgId,
          orgName: orgId,
          classData,
          session,
          teacher,
          policy,
          sendWhenDate
        });
        sentCount += outcomes.filter((row) => row.status === 'sent').length;
      }
    }
  }

  return { orgId, skipped: false, candidateCount, sentCount, targetSessionDate, sendWhenDate };
}

async function runNotificationPass(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const doc = await sessionAccessPolicyModel.readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const orgIds = Object.keys(byOrg).filter((orgId) => {
    const row = byOrg[orgId];
    const policy = sessionAccessPolicyService.resolvePolicy(
      sessionAccessPolicyService.normalizePolicyFromStored(row || {})
    );
    return policy?.uncompletedSessionNotification?.enabled === true;
  });

  const results = [];
  for (const orgId of orgIds) {
    try {
      results.push(await processOrgNotifications(orgId, now));
    } catch (error) {
      results.push({
        orgId,
        skipped: true,
        reason: 'error',
        message: cleanText(error?.message || error)
      });
    }
  }

  startupLogger.info('SCHOOL', 'SESSION_NOTIFICATION', 'Notification pass completed.', {
    orgCount: orgIds.length,
    sentCount: results.reduce((sum, row) => sum + Number(row.sentCount || 0), 0)
  });
  return results;
}

module.exports = {
  shouldRunForOrgNow,
  resolveTargetSessionDate,
  processOrgNotifications,
  runNotificationPass
};
