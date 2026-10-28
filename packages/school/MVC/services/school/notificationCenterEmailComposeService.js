'use strict';

const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const personDisplayNameService = require('./personDisplayNameService');
const notificationRuleModel = require('../../models/school/notificationRuleModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const {
  buildBrandedEmailLayout,
  escapeHtml,
  NC_EMAIL_CLASSES,
  NEWS_INK,
  NEWS_MUTED,
  NEWS_LINE
} = requireCoreModule('MVC/utils/brandedEmailLayout');

function buildSessionRuleBodyHtml(introHtml = '') {
  const prose = NC_EMAIL_CLASSES.prose;
  return [
    `<p class="${prose}" style="margin:0 0 18px;font-size:16px;color:${NEWS_INK};">Hi {{TEACHER_NAME}},</p>`,
    `<p class="${prose}" style="margin:0 0 20px;color:${NEWS_MUTED};">${introHtml}</p>`,
    '{{SESSION_LIST_HTML}}',
    `<p class="${prose}" style="margin:24px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
  ].join('');
}

const PLACEHOLDER_TOKEN_REGEX = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const COMPOSE_PREVIEW_BUILD_VERSION = 3;

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

function camelToSnakeUpper(token = '') {
  return cleanText(token)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase();
}

function resolveTemplateContextValue(token, context = {}) {
  const raw = cleanText(token);
  if (!raw) return undefined;
  if (Object.prototype.hasOwnProperty.call(context, raw)) {
    return context[raw];
  }
  const upper = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(context, upper)) {
    return context[upper];
  }
  const snake = camelToSnakeUpper(raw);
  if (snake !== upper && Object.prototype.hasOwnProperty.call(context, snake)) {
    return context[snake];
  }
  return undefined;
}

function renderTemplate(template, context = {}) {
  const text = String(template || '');
  if (!text) return '';
  return text.replace(PLACEHOLDER_TOKEN_REGEX, (match, token) => {
    const resolved = resolveTemplateContextValue(token, context);
    if (resolved !== undefined) return String(resolved ?? '');
    return match;
  });
}

function countUnrenderedTemplateTokens(text = '') {
  const haystack = String(text || '');
  if (!haystack) return 0;
  const matches = haystack.match(PLACEHOLDER_TOKEN_REGEX);
  return matches ? matches.length : 0;
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
      bodyHtml: buildSessionRuleBodyHtml(
        'The following session(s) still need attendance finalized. Open each session below and complete attendance when you are ready.'
      ),
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
        'The following session(s) are missing a submitted book coverage report. Open each session, go to the Book coverage tab, and use Add Book Report to record coverage for the class book.',
        '',
        '{{SESSION_LIST}}',
        '',
        'Thank you,',
        '{{ORG_NAME}}'
      ].join('\n'),
      bodyHtml: buildSessionRuleBodyHtml(
        `The following session(s) are missing a submitted book coverage report. Open each session, go to the <strong>Book coverage</strong> tab, and use <strong>Add Book Report</strong> to record coverage for the class book.`
      ),
      emailTitle: 'Book coverage reminder',
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
      bodyHtml: buildSessionRuleBodyHtml(
        'The following session(s) are missing session notes. Open each session below and add notes on the Manage Session page when you are ready.'
      ),
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
      bodyHtml: buildSessionRuleBodyHtml(
        'The following session(s) have student cases that need your attention. Review each session below and follow up on the open cases.'
      ),
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
      bodyHtml: buildSessionRuleBodyHtml(
        'The following session(s) have instructional activities that may need your review. Open each session below when you are ready.'
      ),
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
        `<p class="${NC_EMAIL_CLASSES.prose}" style="margin:0 0 18px;font-size:16px;color:${NEWS_INK};">Hi {{TEACHER_NAME}},</p>`,
        `<p class="${NC_EMAIL_CLASSES.prose}" style="margin:0 0 20px;color:${NEWS_MUTED};">The following timesheet period(s) still need to be submitted:</p>`,
        `<div style="padding:14px 16px;border:1px solid ${NEWS_LINE};border-radius:12px;background:#f8fbfd;">{{ITEM_LIST_HTML}}</div>`,
        `<p class="${NC_EMAIL_CLASSES.prose}" style="margin:24px 0 0;color:${NEWS_MUTED};">Thank you,<br><strong style="color:${NEWS_INK};">{{ORG_NAME}}</strong></p>`
      ].join(''),
      emailTitle: 'Timesheet reminder',
      eyebrow: 'School notification',
      smsText: sms,
      useUncompletedBuilder: false
    }
  };

  return templates[type] || templates.session_not_final;
}

function mapItemsToSessionEntries(items = []) {
  const mapped = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (item?.payload?.session) {
      mapped.push({
        ...(item.payload && typeof item.payload === 'object' ? item.payload : {}),
        title: item.title
      });
      return;
    }
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    const classData = payload.classData && typeof payload.classData === 'object' ? payload.classData : {};
    const sessionDate = cleanText(item?.sessionDate);
    const sessionId = cleanText(item?.id);
    if (!sessionDate && !sessionId) return;
    mapped.push({
      classData,
      session: {
        sessionId: sessionId || sessionDate,
        date: sessionDate,
        startTime: cleanText(item?.title).match(/\d{2}:\d{2}/)?.[0] || '',
        endTime: ''
      },
      title: item.title
    });
  });
  return mapped;
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
  const itemCount = String(items.length);
  return {
    TEACHER_NAME: teacherName,
    teacherName,
    ORG_NAME: org,
    orgName: org,
    RULE_LABEL: cleanText(ruleLabel) || 'School reminder',
    ITEM_COUNT: itemCount,
    itemCount,
    SESSION_COUNT: itemCount,
    sessionCount: itemCount,
    SESSION_LIST: sessionList,
    sessionList,
    SESSION_LIST_HTML: sessionListHtml,
    sessionListHtml,
    ITEM_LIST: itemList,
    itemList,
    ITEM_LIST_HTML: itemListHtml,
    itemListHtml,
    APP_NAME: resolveAppDisplayName()
  };
}

function readEmailTemplates(rule = {}) {
  const email = rule?.channels?.email && typeof rule.channels.email === 'object'
    ? rule.channels.email
    : {};
  const legacyBody = cleanText(email.bodyTemplate);
  const legacyPlain = legacyBody && !/<[a-z][\s\S]*>/i.test(legacyBody) ? legacyBody : '';
  const legacyHtml = legacyBody && /<[a-z][\s\S]*>/i.test(legacyBody) ? legacyBody : '';
  return {
    subjectTemplate: cleanText(email.subjectTemplate),
    bodyTextTemplate: cleanText(email.bodyTextTemplate) || legacyPlain,
    bodyHtmlTemplate: cleanText(email.bodyHtmlTemplate) || legacyHtml
  };
}

function hasCustomBodyTemplates(templates = {}) {
  return Boolean(templates.bodyTextTemplate || templates.bodyHtmlTemplate);
}

function usesLegacySessionListBodyTemplate(templates = {}) {
  const html = cleanText(templates.bodyHtmlTemplate);
  if (!html) return false;
  return /\{\{\s*sessionListHtml\s*\}\}/i.test(html)
    || /\{\{\s*SESSION_LIST_HTML\s*\}\}/i.test(html)
    || /\{\{\s*sessionList\s*\}\}/i.test(html)
    || /\{\{\s*SESSION_LIST\s*\}\}/i.test(html);
}

function shouldUseUncompletedRichEmailBody(defaults, custom, sessionEntries, items = []) {
  const sessionCount = sessionEntries.length
    || (Array.isArray(items) ? items.filter((item) => cleanText(item?.id)).length : 0);
  if (!defaults.useUncompletedBuilder || !sessionCount) return false;
  if (!hasCustomBodyTemplates(custom)) return true;
  if (usesLegacySessionListBodyTemplate(custom)) return true;
  const html = cleanText(custom.bodyHtmlTemplate);
  if (html && /\{\{\s*[a-z][a-zA-Z0-9_]*\s*\}\}/.test(html)) return true;
  return false;
}

async function applySessionEmailPreviewFallback(preview, {
  defaults,
  custom,
  sessionEntries,
  items,
  name,
  orgName,
  baseUrl,
  orgId,
  orgTimeZone,
  context,
  ruleLabel
}) {
  const before = countUnrenderedTemplateTokens(preview.htmlBody);
  if (!before) return preview;
  const entries = sessionEntries.length ? sessionEntries : mapItemsToSessionEntries(items);
  if (defaults.useUncompletedBuilder && entries.length) {
    const emailContent = await sessionUncompletedNotificationService.buildTeacherReviewEmailContent({
      teacherName: name,
      orgName,
      entries,
      baseUrl,
      orgId,
      orgTimeZone
    });
    preview.htmlBody = emailContent.htmlBody;
    if (!custom.bodyTextTemplate) preview.plainText = emailContent.plainText;
  } else if (custom.bodyHtmlTemplate) {
    const bodyInner = renderTemplate(custom.bodyHtmlTemplate, context);
    preview.htmlBody = buildBrandedEmailLayout({
      baseUrl,
      eyebrow: defaults.eyebrow,
      title: defaults.emailTitle || ruleLabel,
      preheader: `${ruleLabel} — ${items.length} item(s)`,
      bodyHtml: bodyInner
    });
  }
  return preview;
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
  const useRich = shouldUseUncompletedRichEmailBody(defaults, custom, sessionEntries, items);

  let preview;
  if (useRich) {
    const emailContent = await sessionUncompletedNotificationService.buildTeacherReviewEmailContent({
      teacherName: name,
      orgName,
      entries: sessionEntries.length ? sessionEntries : mapItemsToSessionEntries(items),
      baseUrl,
      orgId,
      orgTimeZone
    });
    const subject = renderTemplate(custom.subjectTemplate || defaults.subject, context);
    preview = {
      recipientPersonId: teacherId,
      recipientName: name,
      subject: subject || `${ruleLabel} (${items.length} item(s))`,
      plainText: custom.bodyTextTemplate
        ? renderTemplate(custom.bodyTextTemplate, context)
        : emailContent.plainText,
      htmlBody: emailContent.htmlBody,
      smsText: renderTemplate(defaults.smsText, context),
      previewBuildVersion: COMPOSE_PREVIEW_BUILD_VERSION
    };
  } else {
    const subjectTemplate = custom.subjectTemplate || defaults.subject;
    const bodyTextTemplate = custom.bodyTextTemplate || defaults.bodyText;
    const bodyHtmlTemplate = custom.bodyHtmlTemplate || defaults.bodyHtml;
    const plainText = renderTemplate(bodyTextTemplate, context);
    const bodyInner = renderTemplate(bodyHtmlTemplate, context);
    preview = {
      recipientPersonId: teacherId,
      recipientName: name,
      subject: renderTemplate(subjectTemplate, context) || `${ruleLabel} (${items.length} item(s))`,
      plainText,
      htmlBody: buildBrandedEmailLayout({
        baseUrl,
        eyebrow: defaults.eyebrow,
        title: defaults.emailTitle || ruleLabel,
        preheader: `${ruleLabel} — ${items.length} item(s)`,
        bodyHtml: bodyInner
      }),
      smsText: renderTemplate(defaults.smsText, context),
      previewBuildVersion: COMPOSE_PREVIEW_BUILD_VERSION
    };
  }

  const unrenderedBefore = countUnrenderedTemplateTokens(preview.htmlBody);
  if (unrenderedBefore > 0) {
    preview = await applySessionEmailPreviewFallback(preview, {
      defaults,
      custom,
      sessionEntries,
      items,
      name,
      orgName,
      baseUrl,
      orgId,
      orgTimeZone,
      context,
      ruleLabel
    });
  }

  return preview;
}

module.exports = {
  PLACEHOLDER_DEFINITIONS,
  renderTemplate,
  resolveTemplateContextValue,
  countUnrenderedTemplateTokens,
  COMPOSE_PREVIEW_BUILD_VERSION,
  shouldUseUncompletedRichEmailBody,
  usesLegacySessionListBodyTemplate,
  buildDefaultTemplates,
  buildEmailPreview,
  buildListContext
};
