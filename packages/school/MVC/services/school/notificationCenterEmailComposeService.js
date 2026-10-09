'use strict';

const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const personDisplayNameService = require('./personDisplayNameService');
const notificationRuleModel = require('../../models/school/notificationRuleModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const {
  buildBrandedEmailLayout,
  escapeHtml,
  NEWS_INK,
  NEWS_MUTED,
  NEWS_LINE
} = requireCoreModule('MVC/utils/brandedEmailLayout');

const PLACEHOLDER_TOKEN_REGEX = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const PLACEHOLDER_DEFINITIONS = Object.freeze([
  { token: 'TEACHER_NAME', description: 'Recipient display name.' },
  { token: 'ORG_NAME', description: 'Organization name.' },
  { token: 'RULE_LABEL', description: 'This notification rule label.' },
  { token: 'ITEM_COUNT', description: 'Number of selected items in the email.' },
  { token: 'SESSION_LIST', description: 'Plain-text list of sessions with links.' },
  { token: 'SESSION_LIST_HTML', description: 'HTML table of sessions (for HTML body).' },
  { token: 'ITEM_LIST', description: 'Plain bullet list of item titles (non-session rules).' },
  { token: 'ITEM_LIST_HTML', description: 'HTML bullet list of item titles.' },
  { token: 'APP_NAME', description: 'Application display name from branding.' },
  { token: 'MANAGER_NAME', description: 'Manager recipient display name (manager summary).' },
  { token: 'TEACHER_SUMMARY_LIST', description: 'Plain-text teacher name and item count table (manager summary).' },
  { token: 'TEACHER_SUMMARY_LIST_HTML', description: 'HTML teacher name and item count table (manager summary).' },
  { token: 'TEACHER_COUNT', description: 'Number of teachers in the run (manager summary).' },
  { token: 'TOTAL_ITEM_COUNT', description: 'Total items across all teachers (manager summary).' },
  { token: 'RUN_DATE', description: 'Run as-of date (manager summary).' }
]);

function cleanText(value) {
  return String(value || '').trim();
}

function resolveAppDisplayName() {
  try {
    const appBrandingService = requireCoreModule('MVC/services/appBrandingService');
    const brand = appBrandingService.getBrand?.() || {};
    return cleanText(brand.appName || brand.appShortName) || 'School Portal';
  } catch (_) {
    return 'School Portal';
  }
}

function renderTemplate(template, context = {}) {
  const text = String(template || '');
  if (!text) return '';
  return text.replace(PLACEHOLDER_TOKEN_REGEX, (match, token) => {
    const key = cleanText(token).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return String(context[key] ?? '');
    }
    return match;
  });
}

function buildDefaultTemplates(ruleType = '') {
  const type = cleanText(ruleType).toLowerCase() || 'session_not_final';
  const subject = '{{RULE_LABEL}} ({{ITEM_COUNT}} item(s))';
  const sms = '{{RULE_LABEL}}: {{ITEM_COUNT}} item(s) need attention.';

  const templates = {
    session_not_final: {
      subject,
      bodyText: '',
      bodyHtml: '',
      emailTitle: 'Session completion reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: true
    },
    session_attendance_incomplete: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following session(s) still need attendance finalized. Open each session below and complete attendance when you are ready.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following session(s) still need attendance finalized. Open each session below and complete attendance when you are ready.</p>`,
        '{{SESSION_LIST_HTML}}',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Attendance reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    },
    session_without_book_report: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following session(s) are missing a submitted book covering report. Open each session, go to the Book covering tab, and use Add Book Report to record coverage for the class book.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following session(s) are missing a submitted book covering report. Open each session, go to the <strong>Book covering</strong> tab, and use <strong>Add Book Report</strong> to record coverage for the class book.</p>`,
        '{{SESSION_LIST_HTML}}',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Book covering reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    },
    session_without_notes: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following session(s) are missing session notes. Open each session below and add notes on the Manage Session page when you are ready.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following session(s) are missing session notes. Open each session below and add notes on the Manage Session page when you are ready.</p>`,
        '{{SESSION_LIST_HTML}}',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Session notes reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    },
    session_with_cases: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following session(s) have student cases that need your attention. Review each session below and follow up on the open cases.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following session(s) have student cases that need your attention. Review each session below and follow up on the open cases.</p>`,
        '{{SESSION_LIST_HTML}}',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Student cases reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    },
    session_with_activities: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following session(s) have instructional activities that may need your review. Open each session below when you are ready.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following session(s) have instructional activities that may need your review. Open each session below when you are ready.</p>`,
        '{{SESSION_LIST_HTML}}',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Session activities reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    },
    timesheet_not_submitted: {
      subject,
      bodyText: [
        'Hi {{TEACHER_NAME}},',
        '',
        'The following timesheet period(s) still need to be submitted:',
        '',
        '{{ITEM_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: [
        '<p style="margin:0 0 14px;">Hi {{TEACHER_NAME}},</p>',
        `<p style="margin:0 0 16px;color:${NEWS_MUTED};">The following timesheet period(s) still need to be submitted:</p>`,
        '<div style="padding:14px 16px;border:1px solid {{NEWS_LINE}};">{{ITEM_LIST_HTML}}</div>',
        `<p style="margin:20px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join('').replace(/\{\{NEWS_LINE\}\}/g, NEWS_LINE),
      emailTitle: 'Timesheet reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    }
  };

  return templates[type] || templates.session_not_final;
}

function mapItemsToSessionEntries(items = []) {
  return items
    .filter((item) => item?.payload?.session)
    .map((item) => ({
      ...(item.payload && typeof item.payload === 'object' ? item.payload : {}),
      title: item.title
    }));
}

async function buildListContext({
  items = [],
  sessionEntries = [],
  orgId = '',
  orgTimeZone = 'UTC',
  baseUrl = '',
  teacherName = '',
  orgName = '',
  ruleLabel = ''
} = {}) {
  const timingMap = orgId && sessionEntries.length
    ? await sessionUncompletedNotificationService.buildSessionTimingMap(sessionEntries, { orgId, orgTimeZone })
    : null;
  const sessionList = sessionEntries.length
    ? sessionUncompletedNotificationService.buildSessionListText(sessionEntries, { baseUrl, sessionTimingByKey: timingMap })
    : '';
  const sessionListHtml = sessionEntries.length
    ? sessionUncompletedNotificationService.buildSessionListHtml(sessionEntries, { baseUrl, sessionTimingByKey: timingMap, formal: true })
    : '';
  const itemList = items.map((item) => `- ${cleanText(item?.title) || 'Item'}`).join('\n');
  const itemListHtml = [
    `<ul style="margin:0;padding:0 0 0 20px;color:${NEWS_INK};">`,
    items.map((item) => `<li style="margin:0 0 8px;line-height:1.5;">${escapeHtml(cleanText(item?.title) || 'Item')}</li>`).join(''),
    '</ul>'
  ].join('');
  const org = cleanText(orgName) || 'School';
  return {
    TEACHER_NAME: teacherName,
    ORG_NAME: org,
    RULE_LABEL: cleanText(ruleLabel) || 'School reminder',
    ITEM_COUNT: String(items.length),
    SESSION_LIST: sessionList,
    SESSION_LIST_HTML: sessionListHtml,
    ITEM_LIST: itemList,
    ITEM_LIST_HTML: itemListHtml,
    APP_NAME: resolveAppDisplayName()
  };
}

function readEmailTemplates(rule = {}) {
  const email = rule?.channels?.email && typeof rule.channels.email === 'object'
    ? rule.channels.email
    : {};
  return {
    subjectTemplate: cleanText(email.subjectTemplate),
    bodyTextTemplate: cleanText(email.bodyTextTemplate),
    bodyHtmlTemplate: cleanText(email.bodyHtmlTemplate)
  };
}

function hasCustomTemplates(templates = {}) {
  return Boolean(templates.subjectTemplate || templates.bodyTextTemplate || templates.bodyHtmlTemplate);
}

async function buildEmailPreview({
  rule = {},
  recipientPersonId = '',
  items = [],
  orgId = '',
  baseUrl = '',
  orgTimeZone = 'UTC',
  orgName = ''
} = {}) {
  const teacherId = cleanText(recipientPersonId);
  const name = await personDisplayNameService.resolvePersonDisplayName(teacherId, { fallback: teacherId });
  const ruleType = cleanText(rule?.ruleType).toLowerCase() || 'session_not_final';
  const ruleLabel = cleanText(rule?.label) || notificationRuleModel.formatNotificationTokenLabel(ruleType) || 'School reminder';
  const sessionEntries = mapItemsToSessionEntries(items);
  const custom = readEmailTemplates(rule);
  const defaults = buildDefaultTemplates(ruleType);
  const context = await buildListContext({
    items,
    sessionEntries,
    orgId,
    orgTimeZone,
    baseUrl,
    teacherName: name,
    orgName,
    ruleLabel
  });

  if (defaults.useUncompletedBuilder && !hasCustomTemplates(custom) && sessionEntries.length) {
    const emailContent = await sessionUncompletedNotificationService.buildTeacherReviewEmailContent({
      teacherName: name,
      orgName,
      entries: sessionEntries,
      baseUrl,
      orgId,
      orgTimeZone
    });
    const subject = renderTemplate(custom.subjectTemplate || defaults.subject, context);
    return {
      recipientPersonId: teacherId,
      recipientName: name,
      subject: subject || `${ruleLabel} (${items.length} item(s))`,
      plainText: emailContent.plainText,
      htmlBody: emailContent.htmlBody,
      smsText: renderTemplate(defaults.smsText, context)
    };
  }

  const subjectTemplate = custom.subjectTemplate || defaults.subject;
  const bodyTextTemplate = custom.bodyTextTemplate || defaults.bodyText;
  const bodyHtmlTemplate = custom.bodyHtmlTemplate || defaults.bodyHtml;

  const plainText = renderTemplate(bodyTextTemplate, context);
  const bodyInner = renderTemplate(bodyHtmlTemplate, context);
  const htmlBody = buildBrandedEmailLayout({
    baseUrl,
    eyebrow: defaults.eyebrow,
    title: defaults.emailTitle || ruleLabel,
    bodyHtml: bodyInner
  });

  return {
    recipientPersonId: teacherId,
    recipientName: name,
    subject: renderTemplate(subjectTemplate, context) || `${ruleLabel} (${items.length} item(s))`,
    plainText,
    htmlBody,
    smsText: renderTemplate(defaults.smsText, context)
  };
}

module.exports = {
  PLACEHOLDER_DEFINITIONS,
  renderTemplate,
  buildDefaultTemplates,
  buildEmailPreview,
  buildListContext
};
