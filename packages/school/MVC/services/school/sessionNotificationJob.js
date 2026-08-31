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
const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');

const CHANNEL_NAMES = Object.freeze(['email', 'sms']);

function cleanText(value) {
  return String(value || '').trim();
}

function shouldRunChannelNow(channelConfig = {}, orgTimeZone, now = new Date()) {
  if (!channelConfig?.enabled) return false;
  const parts = getDateTimePartsInTimezone(now.getTime(), orgTimeZone);
  if (!parts) return false;
  const configured = cleanText(channelConfig.sendAtTime).slice(0, 5);
  const current = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return configured === current;
}

function shouldRunForOrgNow(policy, orgTimeZone, now = new Date()) {
  const notification = policy?.uncompletedSessionNotification || {};
  if (!notification.enabled) return false;
  const channels = notification.channels || {};
  return CHANNEL_NAMES.some((channelName) => shouldRunChannelNow(channels[channelName], orgTimeZone, now));
}

function resolveTargetSessionDate(channelConfig = {}, orgTimeZone, now = new Date()) {
  const sendWhen = channelConfig?.sendWhen;
  if (sendWhen === 'daily_all') return null;
  const today = getTodayDateKeyInTimezone(orgTimeZone, now.getTime());
  if (sendWhen === 'next_day') {
    return sessionAttendanceEditAccessService.addDaysToDateKey(today, -1);
  }
  return today;
}

async function processChannelDailyDigest({
  orgId,
  policy,
  channel,
  orgTimeZone,
  sendWhenDate,
  statusMap
}) {
  const channelConfig = policy?.uncompletedSessionNotification?.channels?.[channel] || {};
  const sessionDateRange = channelConfig.sessionDateRange || {};
  const { fromDate, throughDate } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId,
    throughDate: sendWhenDate,
    rangeType: sessionDateRange.type,
    daysBeforeToday: sessionDateRange.daysBeforeToday
  });
  const allEntries = await sessionUncompletedNotificationService.listUncompletedSessionsForOrg(orgId, {
    fromDate,
    throughDate,
    statusMap,
    reqUser: { activeOrgId: orgId }
  });
  const teacherPersonMap = await sessionUncompletedNotificationService.loadTeacherPersonMap(orgId, { activeOrgId: orgId });
  const grouped = sessionUncompletedNotificationService.groupSessionsByTeacher(allEntries, { teacherPersonMap });
  let sentCount = 0;

  for (const [teacherId, sessions] of grouped.entries()) {
    const teacher = await schoolPersonAccessService.getPersonById({
      reqUser: { activeOrgId: orgId },
      personId: teacherId
    }).catch(() => null);
    if (!teacher) continue;
    const outcomes = await sessionNotificationDeliveryService.notifyTeacherDigest({
      orgId,
      orgName: orgId,
      teacher,
      sessions,
      policy,
      sendWhenDate,
      channels: [channel]
    });
    sentCount += outcomes.filter((row) => row.status === 'sent').length;
  }

  return {
    channel,
    mode: 'daily_all',
    candidateCount: allEntries.length,
    sentCount,
    fromDate,
    throughDate
  };
}

async function processChannelPerSession({
  orgId,
  policy,
  channel,
  orgTimeZone,
  sendWhenDate,
  statusMap,
  now
}) {
  const channelConfig = policy?.uncompletedSessionNotification?.channels?.[channel] || {};
  const targetSessionDate = resolveTargetSessionDate(channelConfig, orgTimeZone, now);
  const classes = await sessionUncompletedNotificationService.listOrgClasses(orgId, { activeOrgId: orgId });
  let sentCount = 0;
  let candidateCount = 0;

  for (const classData of classes) {
    if (cleanText(classData?.orgId) !== cleanText(orgId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await sessionUncompletedNotificationService.listClassSessions(classData, { activeOrgId: orgId });
    for (const session of sessions) {
      if (cleanText(session?.date) !== targetSessionDate) continue;
      if (session?.locked === true) continue;
      const isFinal = sessionStatusPolicyService.isFinalStatusByMap(statusMap, session);
      if (isFinal) continue;
      candidateCount += 1;
      const teacherIds = sessionNotificationDeliveryService.listSessionEditorIds(session);
      for (const teacherId of teacherIds) {
        const teacher = await schoolPersonAccessService.getPersonById({
      reqUser: { activeOrgId: orgId },
      personId: teacherId
    }).catch(() => null);
        if (!teacher) continue;
        const outcomes = await sessionNotificationDeliveryService.notifyTeacherForSession({
          orgId,
          orgName: orgId,
          classData,
          session,
          teacher,
          policy,
          sendWhenDate,
          channels: [channel]
        });
        sentCount += outcomes.filter((row) => row.status === 'sent').length;
      }
    }
  }

  return {
    channel,
    mode: channelConfig.sendWhen,
    candidateCount,
    sentCount,
    targetSessionDate
  };
}

async function processDailyDigestNotifications(options = {}) {
  const results = [];
  for (const channel of CHANNEL_NAMES) {
    results.push(await processChannelDailyDigest(options));
  }
  const aggregate = results.reduce((acc, row) => ({
    candidateCount: acc.candidateCount + Number(row.candidateCount || 0),
    sentCount: acc.sentCount + Number(row.sentCount || 0)
  }), { candidateCount: 0, sentCount: 0 });
  return {
    orgId: options.orgId,
    skipped: false,
    mode: 'daily_all',
    channels: results,
    ...aggregate,
    targetSessionDate: null,
    sendWhenDate: options.sendWhenDate
  };
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
  const notification = policy?.uncompletedSessionNotification || {};
  if (!notification.enabled) {
    return { orgId, skipped: true, reason: 'notifications_disabled' };
  }

  const sendWhenDate = getTodayDateKeyInTimezone(orgTimeZone, now.getTime());
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const channels = notification.channels || {};
  const channelResults = [];
  let sentCount = 0;
  let candidateCount = 0;
  let anyChannelRan = false;

  for (const channel of CHANNEL_NAMES) {
    const channelConfig = channels[channel] || {};
    if (!shouldRunChannelNow(channelConfig, orgTimeZone, now)) {
      channelResults.push({ channel, skipped: true, reason: 'outside_send_window' });
      continue;
    }
    anyChannelRan = true;
    const result = channelConfig.sendWhen === 'daily_all'
      ? await processChannelDailyDigest({
        orgId,
        policy,
        channel,
        orgTimeZone,
        sendWhenDate,
        statusMap
      })
      : await processChannelPerSession({
        orgId,
        policy,
        channel,
        orgTimeZone,
        sendWhenDate,
        statusMap,
        now
      });
    channelResults.push(result);
    sentCount += Number(result.sentCount || 0);
    candidateCount += Number(result.candidateCount || 0);
  }

  if (!anyChannelRan) {
    return { orgId, skipped: true, reason: 'outside_send_window' };
  }

  return {
    orgId,
    skipped: false,
    channels: channelResults,
    candidateCount,
    sentCount,
    sendWhenDate
  };
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
  CHANNEL_NAMES,
  shouldRunChannelNow,
  shouldRunForOrgNow,
  resolveTargetSessionDate,
  processChannelDailyDigest,
  processChannelPerSession,
  processDailyDigestNotifications,
  processOrgNotifications,
  runNotificationPass
};
