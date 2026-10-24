'use strict';

const crypto = require('crypto');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const notificationCenterEvaluatorRegistry = require('./notificationCenterEvaluatorRegistry');
const notificationCenterRunPresentationService = require('./notificationCenterRunPresentationService');
const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const notificationSendLedgerModel = require('../../models/school/notificationSendLedgerModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const emailOutboxService = requireCoreModule('MVC/services/emailOutboxService');
const appPublicUrlService = requireCoreModule('MVC/services/appPublicUrlService');
const {
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow,
  zonedWallClockToIso,
  getTodayDateKeyInTimezone,
  formatMsToDateTimeLocalInput,
  formatInstantInTimezone
} = requireCoreModule('MVC/utils/timezoneUtils');

const NC_META_SOURCE = 'school.notificationCenter';

function cleanText(value) {
  return String(value || '').trim();
}

function resolveRequestBaseUrl(req) {
  return appPublicUrlService.resolvePublicSiteUrl({ req });
}

async function resolveOrgDisplayName(orgId) {
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgId);
    return cleanText(row?.name || row?.displayName || row?.title);
  } catch (_) {
    return '';
  }
}

async function resolveOrgTimeZone(orgId) {
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgId);
    if (row) return resolveOrganizationTimezoneFromRow(row);
  } catch (_) {
    // fall through
  }
  return resolveDefaultTimezone();
}

function parseRuleEmailSendAtTime(rule) {
  const raw = cleanText(rule?.channels?.email?.sendAtTime).slice(0, 8);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '18:00';
  const hour = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, '0');
  const minute = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, '0');
  return `${hour}:${minute}`;
}

function nextDateKey(dateKey = '') {
  const token = cleanText(dateKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const anchor = new Date(`${token}T12:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return token;
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return anchor.toISOString().slice(0, 10);
}

function isTruthySendNow(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function buildImmediateSendAtIso() {
  return new Date(Date.now() + 60_000).toISOString();
}

function parseSendAtLocalInput(sendAtLocal, timeZone) {
  const raw = cleanText(sendAtLocal);
  if (!raw) throw new Error('Send date and time are required.');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) throw new Error('Invalid send date/time format.');
  const iso = zonedWallClockToIso(match[1], match[2], timeZone);
  if (!iso) throw new Error('Could not resolve send time in organization timezone.');
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid send date/time.');
  if (parsed.getTime() < Date.now() - 60000) {
    throw new Error('Send time must be in the future.');
  }
  return iso;
}

function resolveSendAtForSchedule({ sendAtLocal, sendNow, timeZone } = {}) {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  if (isTruthySendNow(sendNow)) return buildImmediateSendAtIso();
  return parseSendAtLocalInput(sendAtLocal, tz);
}

function resolveDefaultSendAtIso({ rule, timeZone, cycleDate } = {}) {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(cycleDate))
    ? cleanText(cycleDate)
    : getTodayDateKeyInTimezone(tz);
  const sendAtTime = parseRuleEmailSendAtTime(rule);
  let iso = zonedWallClockToIso(baseDate, sendAtTime, tz);
  if (!iso) {
    return new Date(Date.now() + 3600000).toISOString();
  }
  if (new Date(iso).getTime() < Date.now() + 60_000) {
    const rolled = zonedWallClockToIso(nextDateKey(baseDate), sendAtTime, tz);
    if (rolled) iso = rolled;
  }
  return iso;
}

function resolveDefaultSendAtLocal({ rule, timeZone, cycleDate } = {}) {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const iso = resolveDefaultSendAtIso({ rule, timeZone: tz, cycleDate });
  return formatMsToDateTimeLocalInput(new Date(iso).getTime(), tz);
}

function formatScheduledSendAtLabel(sendAtIso, timeZone) {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const iso = cleanText(sendAtIso);
  if (!iso) return '';
  return formatInstantInTimezone(iso, tz, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

async function buildPreviewFromSelection({
  run,
  rule,
  recipientPersonId,
  selectionKeys = [],
  orgId = '',
  baseUrl = '',
  orgTimeZone = '',
  orgName = ''
} = {}) {
  const { items, recipientPersonId: resolvedRecipient } = notificationCenterRunPresentationService.resolveSelectedItems(
    run,
    selectionKeys
  );
  const teacherId = cleanText(recipientPersonId || resolvedRecipient);
  if (!teacherId) throw new Error('Select at least one session.');
  if (resolvedRecipient && teacherId !== resolvedRecipient) {
    throw new Error('Select sessions for a single teacher only.');
  }
  if (!items.length) throw new Error('Select at least one session.');
  const orgKey = cleanText(orgId);
  const timeZone = orgTimeZone || (orgKey ? await resolveOrgTimeZone(orgKey) : resolveDefaultTimezone());
  const resolvedOrgName = cleanText(orgName) || (orgKey ? await resolveOrgDisplayName(orgKey) : '');
  const preview = await notificationCenterEvaluatorRegistry.buildBatchPreview({
    recipientPersonId: teacherId,
    items,
    rule,
    orgId: orgKey,
    baseUrl: cleanText(baseUrl),
    orgTimeZone: timeZone,
    orgName: resolvedOrgName
  });
  return { preview, items, recipientPersonId: teacherId, timeZone, orgName: resolvedOrgName };
}

function hashSelectionKeys(selectionKeys = []) {
  const sorted = [...selectionKeys].map((key) => cleanText(key)).filter(Boolean).sort();
  return crypto.createHash('sha256').update(sorted.join('|'), 'utf8').digest('hex').slice(0, 32);
}

/** Stable outbox key per org/rule/run/recipient/selection (send time is not part of the key). */
function buildDedupeKey({ orgId, ruleId, runId, recipientPersonId, selectionKeys }) {
  return [
    'nc-email',
    cleanText(orgId),
    cleanText(ruleId),
    cleanText(runId),
    cleanText(recipientPersonId),
    hashSelectionKeys(selectionKeys)
  ].join('::');
}

async function scheduleEmail({
  orgId,
  user,
  run,
  rule,
  recipientPersonId,
  selectionKeys = [],
  subject,
  bodyText,
  bodyHtml,
  sendAtLocal,
  sendNow = false,
  baseUrl = '',
  req = null
}) {
  const orgKey = cleanText(orgId);
  const timeZone = await resolveOrgTimeZone(orgKey);
  const sendAtIso = resolveSendAtForSchedule({ sendAtLocal, sendNow, timeZone });
  const resolvedBaseUrl = cleanText(baseUrl) || appPublicUrlService.resolvePublicSiteUrl({ req });
  const { preview, items, recipientPersonId: teacherId } = await buildPreviewFromSelection({
    run,
    rule,
    recipientPersonId,
    selectionKeys,
    orgId: orgKey,
    baseUrl: resolvedBaseUrl,
    orgTimeZone: timeZone
  });

  if (rule?.channels?.email?.enabled !== true) {
    throw new Error('Email is not enabled for this rule.');
  }

  let teacher = await schoolPersonAccessService.getPersonById({
    reqUser: user || { activeOrgId: orgKey },
    personId: teacherId
  }).catch(() => null);
  let to = cleanText(schoolPersonAccessService.readPersonEmail(teacher || {}));
  if (!to) {
    const teacherIdentityService = require('./teacherIdentityService');
    const teacherPersonMap = await sessionUncompletedNotificationService.loadTeacherPersonMap(
      orgKey,
      user || { activeOrgId: orgKey }
    );
    const mappedPersonId = cleanText(teacherIdentityService.resolveTeacherPersonId(teacherId, teacherPersonMap));
    if (mappedPersonId && mappedPersonId !== teacherId) {
      teacher = await schoolPersonAccessService.getPersonById({
        reqUser: user || { activeOrgId: orgKey },
        personId: mappedPersonId
      }).catch(() => null);
      to = cleanText(schoolPersonAccessService.readPersonEmail(teacher || {}));
    }
  }

  if (!to) throw new Error('Teacher does not have an email address on file.');

  const finalSubject = cleanText(subject) || cleanText(preview.subject) || cleanText(rule.label) || 'School reminder';
  const finalText = cleanText(bodyText) || cleanText(preview.plainText);
  const finalHtml = cleanText(preview.htmlBody) || cleanText(bodyHtml);
  if (!finalText && !finalHtml) throw new Error('Email body is required.');

  const resolvedSelectionKeys = notificationCenterRunPresentationService
    .resolveSelectedItems(run, selectionKeys).selectionKeys;
  const dedupeKey = buildDedupeKey({
    orgId: orgKey,
    ruleId: rule.id,
    runId: run.id,
    recipientPersonId: teacherId,
    selectionKeys: resolvedSelectionKeys
  });

  const cycleDate = sendAtIso.slice(0, 10);
  const created = await emailOutboxService.enqueue({
    orgId: orgKey,
    to,
    subject: finalSubject,
    text: finalText,
    html: finalHtml || undefined,
    sendAt: sendAtIso,
    dedupeKey,
    meta: {
      source: NC_META_SOURCE,
      ruleId: rule.id,
      runId: run.id,
      recipientPersonId: teacherId,
      findingIds: items.map((item) => cleanText(item.id)).filter(Boolean)
    }
  }, { replaceActiveQueued: true });
  if (!created) throw new Error('Email was not queued (duplicate or blocked).');

  await notificationSendLedgerModel.appendEntry({
    dedupeKey,
    orgId: orgKey,
    ruleId: rule.id,
    runId: run.id,
    batchId: '',
    recipientPersonId: teacherId,
    channel: 'email',
    cycleDate,
    status: 'queued',
    recipient: to,
    message: `${items.length} session(s)`
  });

  return {
    outboxId: created.id,
    sendAt: sendAtIso,
    sendAtLabel: formatScheduledSendAtLabel(sendAtIso, timeZone),
    sendNow: isTruthySendNow(sendNow),
    to,
    subject: finalSubject
  };
}

module.exports = {
  NC_META_SOURCE,
  buildPreviewFromSelection,
  scheduleEmail,
  resolveOrgTimeZone,
  parseSendAtLocalInput,
  resolveSendAtForSchedule,
  resolveDefaultSendAtLocal,
  resolveDefaultSendAtIso,
  formatScheduledSendAtLabel,
  isTruthySendNow,
  buildImmediateSendAtIso,
  resolveRequestBaseUrl,
  buildDedupeKey,
  hashSelectionKeys
};
