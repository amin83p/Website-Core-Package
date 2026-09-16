'use strict';

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
  zonedWallClockToIso
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

function buildDedupeKey({ orgId, ruleId, runId, recipientPersonId, selectionKeys, sendAtIso }) {
  const sorted = [...selectionKeys].sort().join('|');
  return [
    'nc-email',
    cleanText(orgId),
    cleanText(ruleId),
    cleanText(runId),
    cleanText(recipientPersonId),
    sorted,
    cleanText(sendAtIso)
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
  baseUrl = '',
  req = null
}) {
  const orgKey = cleanText(orgId);
  const timeZone = await resolveOrgTimeZone(orgKey);
  const sendAtIso = parseSendAtLocalInput(sendAtLocal, timeZone);
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

  const dedupeKey = buildDedupeKey({
    orgId: orgKey,
    ruleId: rule.id,
    runId: run.id,
    recipientPersonId: teacherId,
    selectionKeys: notificationCenterRunPresentationService.resolveSelectedItems(run, selectionKeys).selectionKeys,
    sendAtIso
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
  });
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

  return { outboxId: created.id, sendAt: sendAtIso, to, subject: finalSubject };
}

module.exports = {
  NC_META_SOURCE,
  buildPreviewFromSelection,
  scheduleEmail,
  resolveOrgTimeZone,
  parseSendAtLocalInput,
  resolveRequestBaseUrl
};
