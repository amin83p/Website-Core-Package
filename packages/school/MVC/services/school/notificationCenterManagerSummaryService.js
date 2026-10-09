'use strict';

const schoolPersonAccessService = require('./schoolPersonAccessService');
const personDisplayNameService = require('./personDisplayNameService');
const notificationSendLedgerModel = require('../../models/school/notificationSendLedgerModel');
const notificationCenterComposeService = require('./notificationCenterComposeService');
const notificationCenterEmailComposeService = require('./notificationCenterEmailComposeService');
const { NC_META_SOURCE } = require('./notificationCenterComposeService');
const { requireCoreModule } = require('./schoolCoreContracts');
const {
  buildBrandedEmailLayout,
  escapeHtml,
  NEWS_INK,
  NEWS_MUTED,
  NEWS_LINE
} = requireCoreModule('MVC/utils/brandedEmailLayout');
const {
  getTodayDateKeyInTimezone,
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow,
  zonedWallClockToIso
} = requireCoreModule('MVC/utils/timezoneUtils');
const emailOutboxService = requireCoreModule('MVC/services/emailOutboxService');

const DEFAULT_SUBJECT = '{{RULE_LABEL}} — manager summary ({{TEACHER_COUNT}} teachers, {{TOTAL_ITEM_COUNT}} items)';
const DEFAULT_BODY_TEXT = [
  'Hi {{MANAGER_NAME}},',
  '',
  'Summary for {{RULE_LABEL}} as of {{RUN_DATE}}:',
  '',
  '{{TEACHER_SUMMARY_LIST}}',
  '',
  'Thank you,',
  '{{ORG_NAME}}'
].join('\n');

const DEFAULT_BODY_HTML = [
  '<p style="margin:0 0 14px;">Hi {{MANAGER_NAME}},</p>',
  `<p style="margin:0 0 16px;color:${NEWS_MUTED};">Summary for <strong style="color:${NEWS_INK};">{{RULE_LABEL}}</strong> as of {{RUN_DATE}}:</p>`,
  '{{TEACHER_SUMMARY_LIST_HTML}}',
  `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
].join('');

function cleanText(value) {
  return String(value || '').trim();
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
  return notificationCenterComposeService.resolveOrgTimeZone(orgId);
}

function buildSendAtIso(cycleDate, sendAtTime, timeZone) {
  return zonedWallClockToIso(cycleDate, sendAtTime || '18:00', timeZone);
}

function buildManagerSummaryRows(run = {}) {
  const batches = Array.isArray(run?.batches) ? run.batches : [];
  return batches
    .map((batch) => {
      const personId = cleanText(batch?.recipientPersonId);
      if (!personId) return null;
      const items = Array.isArray(batch?.items) ? batch.items : [];
      const itemCount = Number.isFinite(Number(batch?.itemCount))
        ? Number(batch.itemCount)
        : items.length;
      return {
        personId,
        name: cleanText(batch?.recipientName) || personId,
        itemCount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildTeacherSummaryListText(rows = []) {
  if (!rows.length) return 'No teachers in this run.';
  const nameWidth = Math.max(6, ...rows.map((row) => row.name.length));
  const lines = [`${'Teacher'.padEnd(nameWidth)}  Items`, `${'-'.repeat(nameWidth)}  -----`];
  rows.forEach((row) => {
    lines.push(`${row.name.padEnd(nameWidth)}  ${row.itemCount}`);
  });
  return lines.join('\n');
}

function buildTeacherSummaryListHtml(rows = []) {
  if (!rows.length) {
    return `<p style="margin:0;color:${NEWS_MUTED};">No teachers in this run.</p>`;
  }
  const bodyRows = rows.map((row) => (
    `<tr>`
    + `<td style="padding:8px 12px;border-bottom:1px solid ${NEWS_LINE};color:${NEWS_INK};">${escapeHtml(row.name)}</td>`
    + `<td style="padding:8px 12px;border-bottom:1px solid ${NEWS_LINE};text-align:right;color:${NEWS_INK};">${escapeHtml(String(row.itemCount))}</td>`
    + `</tr>`
  )).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${NEWS_LINE};border-radius:8px;overflow:hidden;">`
    + `<thead><tr style="background:#f8f9fa;">`
    + `<th style="padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${NEWS_MUTED};">Teacher</th>`
    + `<th style="padding:8px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${NEWS_MUTED};">Items</th>`
    + `</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function buildManagerSummaryContext({
  run = {},
  rule = {},
  orgName = '',
  managerName = 'Manager',
  rows = []
} = {}) {
  const teacherRows = rows.length ? rows : buildManagerSummaryRows(run);
  const totalItemCount = teacherRows.reduce((sum, row) => sum + Number(row.itemCount || 0), 0);
  return {
    MANAGER_NAME: managerName,
    ORG_NAME: orgName || 'School',
    RULE_LABEL: cleanText(rule?.label) || cleanText(run?.ruleLabel) || 'Notification rule',
    RUN_DATE: cleanText(run?.asOfDate) || getTodayDateKeyInTimezone(resolveDefaultTimezone()),
    TEACHER_COUNT: String(teacherRows.length),
    TOTAL_ITEM_COUNT: String(totalItemCount),
    ITEM_COUNT: String(totalItemCount),
    TEACHER_SUMMARY_LIST: buildTeacherSummaryListText(teacherRows),
    TEACHER_SUMMARY_LIST_HTML: buildTeacherSummaryListHtml(teacherRows)
  };
}

async function buildManagerSummaryPreview({
  run = {},
  rule = {},
  orgId = '',
  managerPersonId = '',
  managerName = '',
  baseUrl = ''
} = {}) {
  const orgKey = cleanText(orgId);
  const orgName = orgKey ? await resolveOrgDisplayName(orgKey) : '';
  const managerId = cleanText(managerPersonId);
  const resolvedManagerName = cleanText(managerName)
    || (managerId ? await personDisplayNameService.resolvePersonDisplayName(managerId, { fallback: managerId }) : 'Manager');
  const rows = buildManagerSummaryRows(run);
  const context = buildManagerSummaryContext({
    run,
    rule,
    orgName,
    managerName: resolvedManagerName,
    rows
  });
  const custom = rule?.managerSummary && typeof rule.managerSummary === 'object' ? rule.managerSummary : {};
  const subjectTemplate = cleanText(custom.subjectTemplate) || DEFAULT_SUBJECT;
  const bodyTextTemplate = cleanText(custom.bodyTextTemplate) || DEFAULT_BODY_TEXT;
  const bodyHtmlTemplate = cleanText(custom.bodyHtmlTemplate) || DEFAULT_BODY_HTML;
  const subject = notificationCenterEmailComposeService.renderTemplate(subjectTemplate, context);
  const plainText = notificationCenterEmailComposeService.renderTemplate(bodyTextTemplate, context);
  const bodyInner = notificationCenterEmailComposeService.renderTemplate(bodyHtmlTemplate, context);
  const htmlBody = buildBrandedEmailLayout({
    baseUrl: cleanText(baseUrl),
    eyebrow: 'Manager summary',
    title: context.RULE_LABEL,
    bodyHtml: bodyInner
  });
  return {
    recipientPersonId: managerId,
    recipientName: resolvedManagerName,
    subject,
    plainText,
    htmlBody,
    rows
  };
}

async function queueManagerSummaryForRun({
  orgId,
  rule,
  run,
  user = null,
  sendAtIso = '',
  baseUrl = '',
  logger = null
} = {}) {
  const orgKey = cleanText(orgId);
  const summaryConfig = rule?.managerSummary;
  if (!summaryConfig?.enabled) return { queued: 0, skipped: 0, reason: 'disabled' };
  const recipientIds = Array.isArray(summaryConfig.recipientPersonIds)
    ? summaryConfig.recipientPersonIds.map((id) => cleanText(id)).filter(Boolean)
    : [];
  const batches = Array.isArray(run?.batches) ? run.batches : [];
  if (!recipientIds.length || !batches.length) {
    return { queued: 0, skipped: recipientIds.length, reason: 'no_recipients_or_batches' };
  }

  const timeZone = await resolveOrgTimeZone(orgKey);
  const cycleDate = getTodayDateKeyInTimezone(timeZone);
  const emailSendTime = cleanText(rule?.channels?.email?.sendAtTime) || '18:00';
  const resolvedSendAt = cleanText(sendAtIso) || buildSendAtIso(cycleDate, emailSendTime, timeZone);
  const cycleKey = resolvedSendAt.slice(0, 10);

  let queued = 0;
  let skipped = 0;
  const reqUser = user || { activeOrgId: orgKey };

  for (const managerId of recipientIds) {
    const preview = await buildManagerSummaryPreview({
      run,
      rule,
      orgId: orgKey,
      managerPersonId: managerId,
      baseUrl
    });
    const manager = await schoolPersonAccessService.getPersonById({
      reqUser,
      personId: managerId
    }).catch(() => null);
    const to = cleanText(schoolPersonAccessService.readPersonEmail(manager || {}));
    if (!to) {
      skipped += 1;
      continue;
    }

    const dedupeKey = notificationSendLedgerModel.buildDedupeKey({
      orgId: orgKey,
      ruleId: rule.id,
      recipientPersonId: managerId,
      channel: 'manager_summary_email',
      cycleDate: cycleKey,
      semanticKey: cleanText(run?.id)
    });
    if (await notificationSendLedgerModel.hasSentEntry(dedupeKey)) {
      skipped += 1;
      continue;
    }

    const created = await emailOutboxService.enqueue({
      orgId: orgKey,
      to,
      subject: preview.subject,
      text: preview.plainText,
      html: preview.htmlBody || undefined,
      sendAt: resolvedSendAt,
      dedupeKey,
      meta: {
        source: NC_META_SOURCE,
        audience: 'manager_summary',
        ruleId: rule.id,
        runId: run.id,
        recipientPersonId: managerId
      }
    });
    if (!created) {
      skipped += 1;
      continue;
    }

    await notificationSendLedgerModel.appendEntry({
      dedupeKey,
      orgId: orgKey,
      ruleId: rule.id,
      runId: run.id,
      batchId: '',
      recipientPersonId: managerId,
      channel: 'manager_summary_email',
      cycleDate: cycleKey,
      status: 'queued',
      recipient: to,
      message: `${preview.rows.length} teacher(s)`
    });
    if (logger) logger.info(`Queued manager summary for ${managerId} rule ${rule.id} run ${run.id}`);
    queued += 1;
  }

  return { queued, skipped };
}

module.exports = {
  buildManagerSummaryRows,
  buildManagerSummaryPreview,
  buildManagerSummaryContext,
  buildTeacherSummaryListText,
  buildTeacherSummaryListHtml,
  queueManagerSummaryForRun
};
