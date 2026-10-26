'use strict';

const crypto = require('crypto');
const dataService = require('./dataService');
const personRepository = require('../repositories/personRepository');
const emailOutboxService = require('./emailOutboxService');
const appPublicUrlService = require('./appPublicUrlService');
const roleRegistryService = require('./person/roleRegistryService');
const { buildPersonScope } = require('./security/dataScopeBuilder');
const {
  CORE_MEMBERSHIP_TOKENS,
  collectMembershipRoleTokens,
  isActiveMembership,
  isActivePerson,
  membershipOrgId
} = require('./person/packageRoleAssignmentService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { normalizeTimezoneToken, resolveDefaultTimezone } = require('../utils/timezoneUtils');
const { isTruthySendNow, resolveSendAtForSchedule } = require('../utils/scheduleSendAtUtils');
const { readPersonEmail, formatPersonDisplayName, isValidEmailAddress } = require('../utils/personContactUtils');
const { buildBrandedEmailLayout, escapeHtml, NC_EMAIL_CLASSES, NEWS_INK, NEWS_MUTED } = require('../utils/brandedEmailLayout');

function toTitleCase(value = '') {
  return String(value || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanText(value, max = 4000) {
  const token = String(value ?? '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function resolveRegistryContext(registry = null) {
  return registry || roleRegistryService.getRoleRegistrySnapshot();
}

function isSkippedMembershipToken(token = '') {
  const normalized = roleRegistryService.normalizeRoleToken(token);
  const underscored = normalized.replace(/-/g, '_');
  return CORE_MEMBERSHIP_TOKENS.has(normalized)
    || CORE_MEMBERSHIP_TOKENS.has(underscored)
    || normalized === 'user'
    || normalized === 'users'
    || normalized === 'all';
}

function canonicalizeRoleKey(value = '', registry = null) {
  const reg = resolveRegistryContext(registry);
  const normalized = roleRegistryService.normalizeRoleToken(value);
  if (!normalized) return '';
  const underscored = normalized.replace(/-/g, '_');
  const alias = reg.audienceAliasToCanonical?.[normalized]
    || reg.audienceAliasToCanonical?.[underscored]
    || reg.systemRoleAlias?.[normalized]
    || reg.systemRoleAlias?.[underscored];
  const key = String(alias || underscored || normalized).trim();
  if (!key || key === 'all' || isSkippedMembershipToken(key)) return '';
  if (roleRegistryService.isDeprecatedRoleKey(key)) return '';
  return key;
}

function normalizeRoleKey(value = '', registry = null) {
  return canonicalizeRoleKey(value, registry);
}

function buildRoleLabelMap(registry = null) {
  const reg = resolveRegistryContext(registry);
  const map = new Map();
  (Array.isArray(reg.activeRoles) ? reg.activeRoles : []).forEach((row) => {
    if (!row?.key) return;
    map.set(row.key, String(row.label || toTitleCase(row.key)).trim() || toTitleCase(row.key));
  });
  return map;
}

function roleLabelForKey(key = '', registry = null) {
  const token = cleanText(key, 120);
  if (!token) return '';
  const labels = buildRoleLabelMap(registry);
  return labels.get(token) || toTitleCase(token);
}

function normalizeRoleKeys(roleKeys = [], options = {}) {
  const registry = resolveRegistryContext(options.registry);
  const allowed = options.allowedKeys
    ? new Set((Array.isArray(options.allowedKeys) ? options.allowedKeys : []).map((key) => canonicalizeRoleKey(key, registry)).filter(Boolean))
    : null;
  const normalized = [...new Set((Array.isArray(roleKeys) ? roleKeys : [])
    .map((key) => canonicalizeRoleKey(key, registry))
    .filter(Boolean))];
  if (!allowed || !allowed.size) return normalized;
  return normalized.filter((key) => allowed.has(key));
}

async function resolveOrgNotifyRoleCatalog({ orgId, user }) {
  const orgKey = toPublicId(orgId);
  if (!orgKey) return [];

  const registry = await roleRegistryService.getRoleRegistry();
  const activeByKey = new Map(
    (Array.isArray(registry.activeRoles) ? registry.activeRoles : []).map((row) => [row.key, row])
  );
  const persons = await personRepository.list({
    scope: buildPersonScope(user),
    enrichment: { includeSchoolRoles: false },
    roleRegistry: registry
  });

  const memberCounts = new Map();

  (Array.isArray(persons) ? persons : []).forEach((person) => {
    if (!isActivePerson(person)) return;
    const memberships = (Array.isArray(person.organizations) ? person.organizations : [])
      .filter((membership) => isActiveMembership(membership) && idsEqual(membershipOrgId(membership), orgKey));
    if (!memberships.length) return;

    const personKeys = new Set();
    memberships.forEach((membership) => {
      collectMembershipRoleTokens(membership).forEach((token) => {
        const key = canonicalizeRoleKey(token, registry);
        if (key) personKeys.add(key);
      });
    });
    personKeys.forEach((key) => {
      memberCounts.set(key, (memberCounts.get(key) || 0) + 1);
    });
  });

  return [...memberCounts.entries()]
    .map(([key, memberCount]) => {
      const meta = activeByKey.get(key);
      return {
        key,
        label: meta?.label || toTitleCase(key),
        packageName: String(meta?.packageName || meta?.domain || 'CORE').trim().toUpperCase() || 'CORE',
        domain: String(meta?.domain || 'core').trim().toLowerCase() || 'core',
        memberCount: Number(memberCount) || 0
      };
    })
    .sort((a, b) => a.packageName.localeCompare(b.packageName) || a.label.localeCompare(b.label));
}

function resolveActiveOrgId(user = {}) {
  const token = toPublicId(user?.activeOrgId);
  if (!token || String(token).toUpperCase() === 'SYSTEM') return '';
  return token;
}

function membershipMatchesRoleKeys(membership = {}, orgId = '', selectedRoleKeys = [], registry = null) {
  if (!isActiveMembership(membership)) return false;
  if (!idsEqual(membershipOrgId(membership), orgId)) return false;
  const reg = resolveRegistryContext(registry);
  const selected = new Set(
    (Array.isArray(selectedRoleKeys) ? selectedRoleKeys : []).map((key) => canonicalizeRoleKey(key, reg)).filter(Boolean)
  );
  const tokens = collectMembershipRoleTokens(membership)
    .map((token) => canonicalizeRoleKey(token, reg))
    .filter(Boolean);
  return tokens.some((token) => selected.has(token));
}

function collectPersonRoleLabels(membership = {}, selectedRoleKeys = [], registry = null) {
  const reg = resolveRegistryContext(registry);
  const selected = new Set(
    (Array.isArray(selectedRoleKeys) ? selectedRoleKeys : []).map((key) => canonicalizeRoleKey(key, reg)).filter(Boolean)
  );
  const labels = new Set();
  collectMembershipRoleTokens(membership).forEach((token) => {
    const key = canonicalizeRoleKey(token, reg);
    if (selected.has(key)) {
      labels.add(roleLabelForKey(key, reg));
    }
  });
  return [...labels];
}

function dedupeRecipientsByEmail(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const email = cleanText(row?.email, 320).toLowerCase();
    if (!email || !isValidEmailAddress(email)) return;
    const existing = map.get(email);
    const roles = [...new Set([...(existing?.roles || []), ...(row?.roles || [])])];
    map.set(email, {
      personId: existing?.personId || cleanText(row?.personId, 120),
      displayName: existing?.displayName || cleanText(row?.displayName, 200),
      email: cleanText(row?.email, 320),
      roles,
      manual: !!(existing?.manual || row?.manual),
      included: row?.included !== false
    });
  });
  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function buildOutboxDedupeKey({ orgId, articleId, email, resend = false }) {
  const base = [
    'news-article',
    cleanText(orgId, 120),
    cleanText(articleId, 120),
    crypto.createHash('sha256').update(cleanText(email, 320).toLowerCase()).digest('hex').slice(0, 24)
  ].join('::');
  if (resend) {
    return `${base}::resend::${Date.now()}`;
  }
  return base;
}

async function resolveOrgTimeZone(orgId, user) {
  try {
    const org = await dataService.getDataById('organizations', orgId, user);
    const tz = org?.settings?.timeZone || org?.settings?.timezone || '';
    return normalizeTimezoneToken(tz, resolveDefaultTimezone());
  } catch (_) {
    return resolveDefaultTimezone();
  }
}

async function resolveOrgDisplayName(orgId, user) {
  try {
    const org = await dataService.getDataById('organizations', orgId, user);
    return cleanText(org?.name || org?.displayName || org?.meta?.title, 200) || 'Your organization';
  } catch (_) {
    return 'Your organization';
  }
}

async function resolveRecipients({ orgId, roleKeys = [], user }) {
  const orgKey = toPublicId(orgId);
  const registry = await roleRegistryService.getRoleRegistry();
  const catalog = await resolveOrgNotifyRoleCatalog({ orgId: orgKey, user });
  const allowedKeys = catalog.map((row) => row.key);
  const selected = normalizeRoleKeys(roleKeys, { registry, allowedKeys });
  if (!orgKey || !selected.length) return [];
  const persons = await personRepository.list({
    scope: buildPersonScope(user),
    enrichment: { includeSchoolRoles: false },
    roleRegistry: registry
  });

  const rows = [];
  (Array.isArray(persons) ? persons : []).forEach((person) => {
    if (!isActivePerson(person)) return;
    const email = readPersonEmail(person);
    if (!email || !isValidEmailAddress(email)) return;

    const memberships = Array.isArray(person.organizations) ? person.organizations : [];
    const matching = memberships.filter((membership) => membershipMatchesRoleKeys(membership, orgKey, selected, registry));
    if (!matching.length) return;

    const roleLabels = new Set();
    matching.forEach((membership) => {
      collectPersonRoleLabels(membership, selected, registry).forEach((label) => roleLabels.add(label));
    });

    rows.push({
      personId: toPublicId(person.id),
      displayName: formatPersonDisplayName(person, 'Member'),
      email,
      roles: [...roleLabels],
      manual: false,
      included: true
    });
  });

  return dedupeRecipientsByEmail(rows);
}

function buildArticleUrl(article = {}, baseUrl = '') {
  const slug = cleanText(article?.meta?.slug, 200);
  const id = cleanText(article?.id, 120);
  const token = slug || id;
  const path = token ? `/news/article/${encodeURIComponent(token)}` : '/news';
  const base = cleanText(baseUrl).replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

function buildArticleEmailContent({ article = {}, articleUrl = '', orgName = '' } = {}) {
  const title = cleanText(article?.meta?.title, 500) || 'News update';
  const summary = cleanText(article?.content?.summary, 2000);
  const orgLabel = cleanText(orgName, 200) || 'Your school';
  const link = cleanText(articleUrl, 2000);
  const prose = NC_EMAIL_CLASSES.prose;

  const bodyHtml = [
    `<p class="${prose}" style="margin:0 0 16px;font-size:16px;color:${NEWS_INK};">`,
    `There is a new article from <strong>${escapeHtml(orgLabel)}</strong>.`,
    '</p>',
    summary
      ? `<p class="${prose}" style="margin:0 0 20px;color:${NEWS_MUTED};">${escapeHtml(summary)}</p>`
      : '',
    link
      ? `<p style="margin:0 0 8px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#087f8c;color:#ffffff;text-decoration:none;font-weight:700;">Read article</a></p>`
      : '',
    `<p class="${prose}" style="margin:20px 0 0;color:${NEWS_MUTED};font-size:14px;">`,
    `Article: <strong style="color:${NEWS_INK};">${escapeHtml(title)}</strong>`,
    '</p>'
  ].filter(Boolean).join('');

  const text = [
    `There is a new article from ${orgLabel}.`,
    '',
    title,
    summary,
    link ? `Read: ${link}` : ''
  ].filter(Boolean).join('\n');

  const html = buildBrandedEmailLayout({
    baseUrl: link.replace(/\/news\/article\/.*$/i, ''),
    eyebrow: 'News',
    title,
    preheader: summary || title,
    bodyHtml
  });

  return {
    subject: `News: ${title}`,
    html,
    text
  };
}

function parseNotifyRecipientsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => ({
      personId: cleanText(row?.personId, 120),
      displayName: cleanText(row?.displayName, 200),
      email: cleanText(row?.email, 320),
      roles: Array.isArray(row?.roles) ? row.roles.map((r) => cleanText(r, 80)).filter(Boolean) : [],
      manual: !!row?.manual,
      included: row?.included !== false
    })).filter((row) => row.email && isValidEmailAddress(row.email));
  } catch (_) {
    return [];
  }
}

async function validateSubmittedRecipients({
  orgId,
  roleKeys = [],
  submitted = [],
  user
}) {
  const registry = await roleRegistryService.getRoleRegistry();
  const catalog = await resolveOrgNotifyRoleCatalog({ orgId, user });
  const normalizedRoleKeys = normalizeRoleKeys(roleKeys, {
    registry,
    allowedKeys: catalog.map((row) => row.key)
  });
  const resolved = await resolveRecipients({ orgId, roleKeys: normalizedRoleKeys, user });
  const allowedEmails = new Set(resolved.map((row) => row.email.toLowerCase()));
  const validated = [];
  (Array.isArray(submitted) ? submitted : []).forEach((row) => {
    if (row.included === false) return;
    const email = cleanText(row.email, 320);
    if (!isValidEmailAddress(email)) return;
    const lower = email.toLowerCase();
    if (!row.manual && !allowedEmails.has(lower)) return;
    validated.push({
      personId: cleanText(row.personId, 120),
      displayName: cleanText(row.displayName, 200),
      email,
      roles: Array.isArray(row.roles) ? row.roles : [],
      manual: !!row.manual,
      included: true
    });
  });
  return dedupeRecipientsByEmail(validated);
}

function buildNotificationsAudit({ roleKeys = [], recipientCount = 0, existing = null, registry = null } = {}) {
  const prior = existing?.notifications && typeof existing.notifications === 'object'
    ? existing.notifications
    : {};
  return {
    ...prior,
    lastConfiguredAt: new Date().toISOString(),
    roleKeys: normalizeRoleKeys(roleKeys, { registry }),
    recipientCount: Number(recipientCount) || 0
  };
}

async function scheduleArticleNotifications({
  orgId,
  article = {},
  recipients = [],
  sendAtIso,
  user,
  resend = false,
  roleKeys = [],
  req = null
}) {
  const orgKey = toPublicId(orgId);
  const articleId = cleanText(article?.id, 120);
  const included = dedupeRecipientsByEmail(recipients).filter((row) => row.included !== false);
  if (!orgKey || !articleId || !included.length) {
    return { queued: 0, skipped: 0, outboxIds: [] };
  }

  const baseUrl = appPublicUrlService.resolvePublicSiteUrl({ req });
  const orgName = await resolveOrgDisplayName(orgKey, user);
  const articleUrl = buildArticleUrl(article, baseUrl);
  const content = buildArticleEmailContent({ article, articleUrl, orgName });
  const sendAt = cleanText(sendAtIso) || new Date(Date.now() + 60_000).toISOString();
  const registry = await roleRegistryService.getRoleRegistry();
  const normalizedRoleKeys = normalizeRoleKeys(roleKeys, { registry });

  const entries = included.map((recipient) => ({
    orgId: orgKey,
    eventKey: 'NEWS_ARTICLE_NOTIFY',
    to: recipient.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    sendAt,
    dedupeKey: buildOutboxDedupeKey({
      orgId: orgKey,
      articleId,
      email: recipient.email,
      resend
    }),
    meta: {
      purpose: 'news_article_notification',
      newsArticleId: articleId,
      newsSlug: cleanText(article?.meta?.slug, 200),
      personId: recipient.personId || '',
      roleKeys: normalizedRoleKeys,
      manual: !!recipient.manual
    }
  }));

  const created = await emailOutboxService.enqueueBatch(entries);
  const rows = Array.isArray(created) ? created : [];
  return {
    queued: rows.length,
    skipped: Math.max(0, included.length - rows.length),
    outboxIds: rows.map((row) => row.id).filter(Boolean),
    sendAt
  };
}

function isTruthyFlag(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function parseNotifyRequestBody(body = {}) {
  const notifyEnabled = isTruthyFlag(body.notifyEnabled);
  const notifyResend = isTruthyFlag(body.notifyResend);
  let roleKeys = [];
  if (Array.isArray(body.notifyRoleKeys)) {
    roleKeys = body.notifyRoleKeys;
  } else if (body.notifyRoleKeys) {
    roleKeys = String(body.notifyRoleKeys).split(',').map((t) => t.trim());
  } else if (body.notifyRoleKeysHidden) {
    roleKeys = String(body.notifyRoleKeysHidden).split(',').map((t) => t.trim());
  }
  const recipients = parseNotifyRecipientsJson(body.notifyRecipientsJson);
  return {
    notifyEnabled,
    notifyResend,
    roleKeys: normalizeRoleKeys(roleKeys),
    recipients,
    sendNow: body.notifySendNow,
    sendAtLocal: body.notifySendAtLocal
  };
}

module.exports = {
  canonicalizeRoleKey,
  normalizeRoleKey,
  normalizeRoleKeys,
  resolveOrgNotifyRoleCatalog,
  roleLabelForKey,
  resolveActiveOrgId,
  membershipMatchesRoleKeys,
  dedupeRecipientsByEmail,
  buildOutboxDedupeKey,
  resolveRecipients,
  buildArticleEmailContent,
  buildArticleUrl,
  parseNotifyRecipientsJson,
  validateSubmittedRecipients,
  buildNotificationsAudit,
  scheduleArticleNotifications,
  parseNotifyRequestBody,
  resolveOrgTimeZone,
  resolveSendAtForSchedule,
  isTruthySendNow
};
