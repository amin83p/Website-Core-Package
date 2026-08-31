const adminChekersService = require('./adminChekersService');
const dataService = require('./dataService');
const emailManagementTemplateRepository = require('../repositories/emailManagementTemplateRepository');
const emailEventDefinitionService = require('./emailEventDefinitionService');
const emailProviderProfileService = require('./emailProviderProfileService');
const appBrandingService = require('./appBrandingService');
const startupLogger = require('../utils/startupLogger');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../utils/orgContextUtils');
const { resolveEmailTemplateOrgContext } = require('../utils/emailTemplateOrgContext');
const paginate = require('../utils/paginationHelper');
const { applyGenericFilter } = require('../utils/queryEngine');
const {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation
} = require('../../config/emailEventCatalog');

const RESET_TEMPLATE_EVENT_KEY = 'AUTH_PASSWORD_RESET_CODE';

const CORE_GENERAL_TEMPLATE_SLOTS = Object.freeze([
  'BODY_CONTENT'
]);

const EVENT_ROUTING_SEARCH_FIELDS = Object.freeze([
  'eventKey',
  'eventLabel',
  'packageName',
  'sectionId',
  'operationId',
  'orgTemplateId',
  'orgTemplateSubject',
  'systemTemplateId',
  'systemTemplateSubject',
  'effectiveRoute'
]);

const PLACEHOLDER_TOKEN_REGEX = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const EMAIL_EVENT_RESOLVERS = Object.freeze({
  PASSWORD_RESET(context = {}) {
    return {
      USER_EMAIL: cleanString(context.userEmail || context.email, { max: 320, allowEmpty: true }),
      RESET_CODE: cleanString(context.resetCode, { max: 60, allowEmpty: true }),
      RESET_TTL_MINUTES: String(Number(context.resetTtlMinutes || 15) || 15),
      APP_NAME: cleanString(
        context.appName || appBrandingService.getBrand().appName || process.env.APP_NAME || 'Application',
        { max: 200, allowEmpty: true }
      ),
      ORG_NAME: cleanString(context.orgName, { max: 200, allowEmpty: true })
    };
  },
  CONTACT_NOTIFICATION(context = {}) {
    return {
      CONTACT_REF_ID: cleanString(context.contactRefId || context.refId || context.id, { max: 120, allowEmpty: true }),
      CONTACT_NAME: cleanString(context.contactName || context.name, { max: 200, allowEmpty: true }),
      CONTACT_EMAIL: cleanString(context.contactEmail || context.email, { max: 320, allowEmpty: true }),
      CONTACT_TYPE: cleanString(context.contactType || context.type, { max: 120, allowEmpty: true }),
      CONTACT_TIMELINE: cleanString(context.contactTimeline || context.timeline, { max: 120, allowEmpty: true }),
      CONTACT_SUBJECT: cleanString(context.contactSubject || context.subject, { max: 260, allowEmpty: true }),
      CONTACT_MESSAGE: cleanString(context.contactMessage || context.message, { max: 20000, allowEmpty: true })
    };
  },
  NEWSLETTER_WELCOME(context = {}) {
    return {
      SUBSCRIBER_EMAIL: cleanString(context.subscriberEmail || context.toEmail || context.email, { max: 320, allowEmpty: true }),
      UNSUBSCRIBE_URL: cleanString(context.unsubscribeUrl, { max: 2000, allowEmpty: true })
    };
  }
});

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseAddressList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/[;,]+/g)
    .map((item) => cleanString(item, { max: 320, allowEmpty: true }))
    .filter(Boolean);
}

function extractPlaceholders(...chunks) {
  const found = new Set();
  (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
    const text = String(chunk || '');
    if (!text) return;
    let match = PLACEHOLDER_TOKEN_REGEX.exec(text);
    while (match) {
      const token = cleanString(match[1], { max: 120, allowEmpty: true });
      if (token) found.add(token);
      match = PLACEHOLDER_TOKEN_REGEX.exec(text);
    }
    PLACEHOLDER_TOKEN_REGEX.lastIndex = 0;
  });
  return Array.from(found);
}

function ensureOrgAdmin(requestingUser = null) {
  if (!adminChekersService.isOrgAdmin(requestingUser)) {
    throw new Error('Access denied. Organization admin access is required.');
  }
}

function resolveValuesByResolverId(resolverId = '', context = {}) {
  const token = cleanString(resolverId, { max: 120, allowEmpty: true }).toUpperCase();
  if (!token) return {};
  const resolver = EMAIL_EVENT_RESOLVERS[token];
  if (typeof resolver !== 'function') return {};
  return resolver(context || {});
}

function normalizeTemplateKind(value = '', fallback = 'event') {
  const token = cleanString(value, { max: 20, allowEmpty: true }).toLowerCase();
  if (token === 'general') return 'general';
  if (token === 'event') return 'event';
  return fallback === 'general' ? 'general' : 'event';
}

function isGeneralTemplate(payload = {}) {
  return normalizeTemplateKind(payload?.templateKind, '') === 'general'
    || (normalizeTemplateKind(payload?.templateKind, 'event') === 'general');
}

function resolveTemplateKindFromPayload(payload = {}, existing = null) {
  if (payload && hasOwn(payload, 'templateKind')) {
    return normalizeTemplateKind(payload.templateKind);
  }
  if (existing && normalizeTemplateKind(existing.templateKind, '') === 'general') {
    return 'general';
  }
  if (normalizeKeyToken(payload?.eventKey || existing?.eventKey || '')) {
    return 'event';
  }
  return 'event';
}

function buildGeneralTemplateDefinition(usedPlaceholders = []) {
  const runtime = (Array.isArray(usedPlaceholders) ? usedPlaceholders : [])
    .map((token) => normalizeKeyToken(token))
    .filter(Boolean);
  return {
    key: 'GENERAL::MANUAL',
    eventKey: '',
    packageName: 'CORE',
    sectionId: '',
    operationId: '',
    label: 'General template',
    allowed: runtime,
    required: [],
    runtime,
    resolve() {
      return {};
    }
  };
}

function validateGeneralTemplatePlaceholders({
  senderTemplate = '',
  recipientTemplate = '',
  subjectTemplate = '',
  bodyTemplate = '',
  requireSupported = false
} = {}) {
  const usedPlaceholders = extractPlaceholders(senderTemplate, recipientTemplate, subjectTemplate, bodyTemplate);
  if (requireSupported && !Array.isArray(usedPlaceholders)) {
    throw new Error('General template placeholders are not configured.');
  }
  return {
    definition: buildGeneralTemplateDefinition(usedPlaceholders),
    usedPlaceholders
  };
}

function normalizePackageName(value = '') {
  return normalizeKeyToken(value || 'CORE') || 'CORE';
}

function normalizeInjectedValues(values = {}) {
  const source = values && typeof values === 'object' ? values : {};
  const output = {};
  Object.keys(source).forEach((key) => {
    const token = normalizeKeyToken(key);
    if (!token) return;
    output[token] = source[key];
  });
  return output;
}

function buildDefinitionFromEvent(event = null) {
  if (!event) return null;
  return {
    key: `${normalizeKeyToken(event.sectionId)}::${normalizeKeyToken(event.operationId)}`,
    eventKey: normalizeKeyToken(event.eventKey),
    packageName: normalizePackageName(event.packageName || 'CORE'),
    sectionId: normalizeKeyToken(event.sectionId),
    operationId: normalizeKeyToken(event.operationId),
    label: cleanString(event.label, { max: 160, allowEmpty: true })
      || normalizeKeyToken(event.eventKey)
      || 'Email Event',
    allowed: Array.isArray(event.allowedPlaceholders)
      ? event.allowedPlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    required: Array.isArray(event.requiredPlaceholders)
      ? event.requiredPlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    runtime: Array.isArray(event.runtimePlaceholders)
      ? event.runtimePlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    resolve(context = {}) {
      return resolveValuesByResolverId(event.resolverId, context);
    }
  };
}

function buildDefinitionFromStored(stored = null, event = null) {
  if (!stored) return buildDefinitionFromEvent(event);
  const resolverId = cleanString(stored.resolverId || event?.resolverId, { max: 120, allowEmpty: true }) || '';
  return {
    key: `${normalizeKeyToken(stored.sectionId)}::${normalizeKeyToken(stored.operationId)}`,
    eventKey: normalizeKeyToken(stored.eventKey || event?.eventKey),
    packageName: normalizePackageName(stored.packageName || event?.packageName || 'CORE'),
    sectionId: normalizeKeyToken(stored.sectionId || event?.sectionId),
    operationId: normalizeKeyToken(stored.operationId || event?.operationId),
    label: cleanString(stored.label || event?.label, { max: 160, allowEmpty: true })
      || normalizeKeyToken(stored.eventKey)
      || 'Email Event',
    allowed: Array.isArray(stored.allowedPlaceholders)
      ? stored.allowedPlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    required: Array.isArray(stored.requiredPlaceholders)
      ? stored.requiredPlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    runtime: Array.isArray(stored.runtimePlaceholders)
      ? stored.runtimePlaceholders.map((token) => normalizeKeyToken(token)).filter(Boolean)
      : [],
    resolve(context = {}) {
      return resolveValuesByResolverId(resolverId, context);
    }
  };
}

async function resolveDefinitionForValidation(payload = {}, { requireActive = true } = {}) {
  const event = resolveEventForSave(payload, { requireActive });
  const stored = await emailEventDefinitionService.getDefinitionByEventKey(event.eventKey);
  if (stored) return buildDefinitionFromStored(stored, event);
  return buildDefinitionFromEvent(event);
}

function resolveDefinition(sectionId = '', operationId = '', { includeInactive = true, packageName = '' } = {}) {
  const event = getEmailEventBySectionOperation(sectionId, operationId, { includeInactive, packageName });
  return buildDefinitionFromEvent(event);
}

function resolveEventForSave(payload = {}, { requireActive = true } = {}) {
  const eventKeyToken = normalizeKeyToken(payload?.eventKey || '');
  const packageName = normalizePackageName(payload?.packageName || '');
  let event = null;
  if (eventKeyToken) {
    event = getEmailEventByKey(eventKeyToken, { includeInactive: true });
  } else {
    event = getEmailEventBySectionOperation(payload?.sectionId, payload?.operationId, {
      includeInactive: true,
      packageName
    });
  }
  if (!event) {
    throw new Error('Selected email event is not supported by backend.');
  }
  if (requireActive && event.isActive === false) {
    throw new Error('Selected email event is currently disabled.');
  }
  return event;
}

function validateTemplatePlaceholders({
  eventKey = '',
  packageName = '',
  sectionId = '',
  operationId = '',
  senderTemplate = '',
  recipientTemplate = '',
  subjectTemplate = '',
  bodyTemplate = '',
  requireSupported = false,
  requireActive = true,
  definitionOverride = null
} = {}) {
  const event = normalizeKeyToken(eventKey)
    ? getEmailEventByKey(eventKey, { includeInactive: true })
    : getEmailEventBySectionOperation(sectionId, operationId, {
      includeInactive: true,
      packageName
    });
  if (event && requireActive && event.isActive === false) {
    throw new Error('Selected email event is currently disabled.');
  }

  const definition = definitionOverride || buildDefinitionFromEvent(event);
  const usedPlaceholders = extractPlaceholders(senderTemplate, recipientTemplate, subjectTemplate, bodyTemplate);
  const usedSet = new Set(usedPlaceholders);

  if (!definition) {
    if (requireSupported) {
      throw new Error('Selected email event is not supported by backend.');
    }
    if (usedPlaceholders.length > 0) {
      throw new Error('This section/operation does not support placeholders yet. Remove placeholders or choose a supported operation.');
    }
    return {
      definition: null,
      usedPlaceholders
    };
  }

  const allowedSet = new Set(definition.allowed || []);
  const unknown = usedPlaceholders.filter((token) => !allowedSet.has(token));
  if (unknown.length > 0) {
    throw new Error(`Unknown placeholders: ${unknown.join(', ')}.`);
  }

  const missingRequired = (definition.required || []).filter((token) => !usedSet.has(token));
  if (missingRequired.length > 0) {
    throw new Error(`Missing required placeholders: ${missingRequired.join(', ')}.`);
  }

  return {
    definition,
    usedPlaceholders
  };
}

function applyPlaceholderValues(template = '', values = {}) {
  const source = String(template || '');
  return source.replace(PLACEHOLDER_TOKEN_REGEX, (full, rawToken) => {
    const token = cleanString(rawToken, { max: 120, allowEmpty: true });
    if (!token) return '';
    const value = hasOwn(values, token) ? values[token] : '';
    return String(value == null ? '' : value);
  });
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function buildFallbackPasswordResetTemplate() {
  return {
    senderTemplate: '',
    recipientTemplate: '{{USER_EMAIL}}',
    subjectTemplate: 'Password reset code',
    bodyTemplate: 'Your password reset code is {{RESET_CODE}}.\nThis code expires in {{RESET_TTL_MINUTES}} minutes.\n\nIf you did not request this, please ignore this email.',
    isFallback: true
  };
}

function buildFallbackContactTemplate() {
  return {
    senderTemplate: '',
    recipientTemplate: '',
    subjectTemplate: '[Contact] {{CONTACT_SUBJECT}} ({{CONTACT_REF_ID}})',
    bodyTemplate: [
      'New Contact Message',
      'Reference: {{CONTACT_REF_ID}}',
      'Name: {{CONTACT_NAME}}',
      'Email: {{CONTACT_EMAIL}}',
      'Type: {{CONTACT_TYPE}}',
      'Timeline: {{CONTACT_TIMELINE}}',
      'Subject: {{CONTACT_SUBJECT}}',
      '',
      '{{CONTACT_MESSAGE}}'
    ].join('\n'),
    isFallback: true
  };
}

function buildFallbackNewsletterTemplate() {
  return {
    senderTemplate: '',
    recipientTemplate: '{{SUBSCRIBER_EMAIL}}',
    subjectTemplate: 'Welcome to our newsletter',
    bodyTemplate: [
      'Welcome to our newsletter.',
      'Thanks for subscribing. We will send practical updates when new content is available.',
      '{{UNSUBSCRIBE_URL}}'
    ].join('\n'),
    isFallback: true
  };
}

function buildFallbackTemplateForEvent(eventKey = '') {
  const token = normalizeKeyToken(eventKey);
  if (token === RESET_TEMPLATE_EVENT_KEY) return buildFallbackPasswordResetTemplate();
  if (token === 'CONTACT_NOTIFICATION') return buildFallbackContactTemplate();
  if (token === 'NEWSLETTER_WELCOME') return buildFallbackNewsletterTemplate();
  return null;
}

function buildTemplateContextForSave(payload = {}, activeOrgId = '', event = null) {
  const templateKind = event
    ? 'event'
    : resolveTemplateKindFromPayload(payload);
  if (templateKind === 'general') {
    return {
      orgId: toPublicId(activeOrgId || payload?.orgId) || '',
      templateKind: 'general',
      templateName: cleanString(payload?.templateName, { max: 180, allowEmpty: true }) || '',
      eventKey: '',
      providerProfileId: cleanString(payload?.providerProfileId, { max: 120, allowEmpty: true }) || '',
      packageName: 'CORE',
      sectionId: '',
      operationId: '',
      senderTemplate: cleanString(payload?.senderTemplate, { max: 320, allowEmpty: true }) || '',
      recipientTemplate: cleanString(payload?.recipientTemplate, { max: 600, allowEmpty: true }) || '',
      subjectTemplate: cleanString(payload?.subjectTemplate, { max: 260, allowEmpty: true }) || '',
      bodyTemplate: cleanString(payload?.bodyTemplate, { max: 30000, allowEmpty: true }) || '',
      isActive: normalizeBoolean(payload?.isActive, true)
    };
  }
  const sectionId = event ? normalizeKeyToken(event.sectionId) : normalizeKeyToken(payload?.sectionId || '');
  const operationId = event ? normalizeKeyToken(event.operationId) : normalizeKeyToken(payload?.operationId || '');
  const packageName = event
    ? normalizePackageName(event.packageName || 'CORE')
    : normalizePackageName(payload?.packageName || 'CORE');
  const eventKey = event
    ? normalizeKeyToken(event.eventKey)
    : normalizeKeyToken(payload?.eventKey || '');
  return {
    orgId: toPublicId(activeOrgId || payload?.orgId) || '',
    templateKind: 'event',
    templateName: '',
    eventKey,
    providerProfileId: cleanString(payload?.providerProfileId, { max: 120, allowEmpty: true }) || '',
    packageName,
    sectionId,
    operationId,
    senderTemplate: cleanString(payload?.senderTemplate, { max: 320, allowEmpty: true }) || '',
    recipientTemplate: cleanString(payload?.recipientTemplate, { max: 600, allowEmpty: true }) || '',
    subjectTemplate: cleanString(payload?.subjectTemplate, { max: 260, allowEmpty: true }) || '',
    bodyTemplate: cleanString(payload?.bodyTemplate, { max: 30000, allowEmpty: true }) || '',
    isActive: normalizeBoolean(payload?.isActive, true)
  };
}

function decorateTemplateRowWithEvent(row = null) {
  if (!row || typeof row !== 'object') return row;
  const templateKind = resolveTemplateKindFromPayload(row, row);
  if (templateKind === 'general') {
    const templateName = cleanString(row.templateName, { max: 180, allowEmpty: true }) || '';
    return {
      ...row,
      templateKind: 'general',
      templateName,
      eventKey: '',
      packageName: 'CORE',
      sectionId: '',
      operationId: '',
      providerProfileId: cleanString(row.providerProfileId, { max: 120, allowEmpty: true }) || '',
      eventLabel: templateName || 'General template',
      eventIsActive: true
    };
  }
  const storedEventKey = normalizeKeyToken(row.eventKey || '');
  const event = storedEventKey
    ? getEmailEventByKey(storedEventKey, { includeInactive: true })
    : getEmailEventBySectionOperation(row.sectionId, row.operationId, {
      includeInactive: true,
      packageName: row.packageName
    });
  return {
    ...row,
    templateKind: 'event',
    eventKey: storedEventKey || cleanString(event?.eventKey, { max: 120, allowEmpty: true }) || '',
    packageName: normalizePackageName(row.packageName || event?.packageName || 'CORE'),
    sectionId: normalizeKeyToken(row.sectionId || event?.sectionId || ''),
    operationId: normalizeKeyToken(row.operationId || event?.operationId || ''),
    providerProfileId: cleanString(row.providerProfileId, { max: 120, allowEmpty: true }) || '',
    eventLabel: cleanString(event?.label, { max: 180, allowEmpty: true }) || '',
    eventIsActive: event ? event.isActive !== false : false
  };
}

function normalizeTemplateListQuery(query = {}) {
  const source = query && typeof query === 'object' ? { ...query } : {};
  const eventKeyFilter = normalizeKeyToken(source.eventKey__eq || '');
  if (eventKeyFilter) {
    source.eventKey__eq = eventKeyFilter;
  }
  return { query: source };
}

function buildDuplicateEventTemplateError(eventKey = '', existingTemplate = null) {
  const token = normalizeKeyToken(eventKey);
  const existingId = cleanString(existingTemplate?.id, { max: 120, allowEmpty: true }) || 'unknown';
  return `This organization already has a template for event '${token}' (ID: ${existingId}). Edit the existing template or choose a different event.`;
}

function assertGeneralTemplateNameOrThrow(normalized = {}) {
  const templateName = cleanString(normalized?.templateName, { max: 180, allowEmpty: true });
  if (!templateName) {
    throw new Error('Template name is required for general templates.');
  }
}

async function assertUniqueEventTemplateOrThrow({
  orgId = '',
  eventKey = '',
  excludeTemplateId = ''
} = {}) {
  const conflict = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
    orgId,
    eventKey,
    { excludeId: excludeTemplateId }
  );
  if (conflict) {
    throw new Error(buildDuplicateEventTemplateError(eventKey, conflict));
  }
}

async function assertTemplateProviderSenderOrThrow({
  orgId = '',
  providerProfileId = '',
  senderTemplate = ''
} = {}) {
  const profileId = cleanString(providerProfileId, { max: 120, allowEmpty: true });
  if (!profileId) return;
  const profile = await emailProviderProfileService.resolveSelectableProviderProfile(profileId, orgId);
  if (!profile) {
    throw new Error('Email provider profile is not available for this organization.');
  }
  if (!Array.isArray(profile.verifiedDomains) || !profile.verifiedDomains.length) {
    throw new Error('Selected provider profile has no verified domains configured.');
  }
  emailProviderProfileService.validateSenderDomain(senderTemplate, profile.verifiedDomains);
}

function buildCreator(requestingUser = null, orgId = '') {
  const userId = toPublicId(requestingUser?.id) || '';
  return {
    type: userId ? 'user' : 'system',
    userId,
    username: cleanString(requestingUser?.username, { max: 120, allowEmpty: true }) || '',
    displayName: cleanString(requestingUser?.name, { max: 180, allowEmpty: true }) || userId || 'System',
    email: cleanString(requestingUser?.email, { max: 220, allowEmpty: true }) || '',
    orgId: toPublicId(orgId || requestingUser?.activeOrgId || '') || ''
  };
}

function buildTemplatePreviewHtml(text = '') {
  return escapeHtml(String(text || '')).replace(/\r?\n/g, '<br>');
}

function looksLikeHtmlTemplate(value = '') {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function decodeCommonHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToPlainText(html = '') {
  const source = String(html || '');
  if (!source.trim()) return '';
  return decodeCommonHtmlEntities(
    source
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
      .replace(/<\s*\/\s*div\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<\s*\/\s*li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildRuntimeBodyOutputs(value = '') {
  const raw = cleanString(value, { max: 60000, allowEmpty: true });
  if (!raw) return { text: '', html: '' };

  if (looksLikeHtmlTemplate(raw)) {
    return {
      text: htmlToPlainText(raw),
      html: raw
    };
  }

  return {
    text: raw,
    html: buildTemplatePreviewHtml(raw)
  };
}

const emailManagementService = {
  getResetTemplateKey() {
    const event = getEmailEventByKey(RESET_TEMPLATE_EVENT_KEY, { includeInactive: true });
    if (!event) {
      return {
        sectionId: 'USERS',
        operationId: 'UPDATE'
      };
    }
    return {
      sectionId: normalizeKeyToken(event.sectionId),
      operationId: normalizeKeyToken(event.operationId)
    };
  },

  getSupportedEventCatalog({ includeInactive = false } = {}) {
    const rows = listSupportedEmailEvents({ includeInactive })
      .map((event) => ({
        eventKey: normalizeKeyToken(event.eventKey),
        label: cleanString(event.label, { max: 180, allowEmpty: true }) || normalizeKeyToken(event.eventKey),
        packageName: normalizePackageName(event.packageName || 'CORE'),
        sectionId: normalizeKeyToken(event.sectionId),
        operationId: normalizeKeyToken(event.operationId),
        resolverId: normalizeKeyToken(event.resolverId),
        allowedPlaceholders: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
        requiredPlaceholders: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
        runtimePlaceholders: Array.isArray(event.runtimePlaceholders) ? event.runtimePlaceholders.slice() : [],
        isActive: event.isActive !== false
      }))
      .sort((a, b) => {
        const packageCmp = String(a.packageName || '').localeCompare(String(b.packageName || ''));
        if (packageCmp !== 0) return packageCmp;
        return String(a.label || a.eventKey).localeCompare(String(b.label || b.eventKey));
      });
    return rows;
  },

  getPlaceholderRegistrySnapshot() {
    return this.getSupportedEventCatalog({ includeInactive: true }).map((event) => ({
      key: event.eventKey,
      eventKey: event.eventKey,
      packageName: event.packageName,
      sectionId: event.sectionId,
      operationId: event.operationId,
      label: event.label,
      allowed: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
      required: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
      runtime: Array.isArray(event.runtimePlaceholders) ? event.runtimePlaceholders.slice() : []
    }));
  },

  async getAccessibleEventDefinitions(requestingUser = null, options = {}) {
    return emailEventDefinitionService.getAccessibleEventDefinitions(requestingUser, options);
  },

  async getAccessiblePlaceholderRegistry(requestingUser = null, options = {}) {
    return emailEventDefinitionService.getAccessiblePlaceholderRegistry(requestingUser, options);
  },

  async syncEventDefinitionsFromCatalog() {
    return emailEventDefinitionService.syncFromCodeCatalog();
  },

  async listTemplates(query = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const normalizedQueryResult = normalizeTemplateListQuery(query);
    const normalizedQuery = normalizedQueryResult.query || {};
    const pagination = {
      page: Math.max(1, Number.parseInt(String(normalizedQuery?.page || '1'), 10) || 1),
      limit: Math.max(1, Number.parseInt(String(normalizedQuery?.limit || '20'), 10) || 20)
    };
    const result = await dataService.fetchDataPaged('emailManagementTemplates', normalizedQuery, requestingUser, {
      pagination
    });
    if (Array.isArray(result?.rows)) {
      return {
        ...result,
        rows: result.rows.map((row) => decorateTemplateRowWithEvent(row))
      };
    }
    if (Array.isArray(result)) {
      return result.map((row) => decorateTemplateRowWithEvent(row));
    }
    return result;
  },

  async getTemplateById(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const row = await dataService.getDataById('emailManagementTemplates', id, requestingUser);
    return decorateTemplateRowWithEvent(row) || null;
  },

  async createTemplate(payload = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const activeOrgId = await resolveEmailTemplateOrgContext(requestingUser, { scopeLabel: 'email templates' });
    const templateKind = resolveTemplateKindFromPayload(payload);
    let normalized;
    if (templateKind === 'general') {
      normalized = buildTemplateContextForSave(payload, activeOrgId, null);
      assertGeneralTemplateNameOrThrow(normalized);
      validateGeneralTemplatePlaceholders({
        ...normalized,
        requireSupported: true
      });
    } else {
      const event = resolveEventForSave(payload, { requireActive: true });
      normalized = buildTemplateContextForSave(payload, activeOrgId, event);
      const definition = await resolveDefinitionForValidation(payload, { requireActive: true });
      validateTemplatePlaceholders({
        eventKey: event.eventKey,
        ...normalized,
        requireSupported: true,
        requireActive: true,
        definitionOverride: definition
      });
      await assertUniqueEventTemplateOrThrow({
        orgId: activeOrgId,
        eventKey: normalized.eventKey,
        excludeTemplateId: ''
      });
    }
    const creator = buildCreator(requestingUser, activeOrgId);

    await assertTemplateProviderSenderOrThrow({
      orgId: activeOrgId,
      providerProfileId: normalized.providerProfileId,
      senderTemplate: normalized.senderTemplate
    });

    try {
      return await dataService.addData('emailManagementTemplates', {
        ...normalized,
        orgId: activeOrgId,
        creator
      }, requestingUser);
    } catch (error) {
      if (emailManagementTemplateRepository.isUniqueConflict(error)) {
        const conflict = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
          activeOrgId,
          normalized.eventKey
        );
        throw new Error(buildDuplicateEventTemplateError(normalized.eventKey, conflict));
      }
      throw error;
    }
  },

  async updateTemplate(id, payload = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const existing = await dataService.getDataById('emailManagementTemplates', id, requestingUser);
    if (!existing) throw new Error('Email template not found.');

    const mergedPayload = { ...existing, ...(payload || {}) };
    const templateKind = resolveTemplateKindFromPayload(payload, existing);
    let normalized;
    if (templateKind === 'general') {
      normalized = buildTemplateContextForSave(mergedPayload, existing.orgId, null);
      assertGeneralTemplateNameOrThrow(normalized);
      validateGeneralTemplatePlaceholders({
        ...normalized,
        requireSupported: true
      });
    } else {
      const event = resolveEventForSave(mergedPayload, { requireActive: true });
      normalized = buildTemplateContextForSave(mergedPayload, existing.orgId, event);
      const definition = await resolveDefinitionForValidation(mergedPayload, { requireActive: true });
      validateTemplatePlaceholders({
        eventKey: event.eventKey,
        ...normalized,
        requireSupported: true,
        requireActive: true,
        definitionOverride: definition
      });
      await assertUniqueEventTemplateOrThrow({
        orgId: existing.orgId,
        eventKey: normalized.eventKey,
        excludeTemplateId: existing.id
      });
    }
    const creator = buildCreator(requestingUser, existing.orgId);

    await assertTemplateProviderSenderOrThrow({
      orgId: existing.orgId,
      providerProfileId: normalized.providerProfileId,
      senderTemplate: normalized.senderTemplate
    });

    try {
      return await dataService.updateData('emailManagementTemplates', id, {
        ...normalized,
        orgId: existing.orgId,
        creator,
        audit: {
          ...(existing.audit || {}),
          lastUpdateUser: creator.userId || 'System',
          lastUpdateDateTime: new Date().toISOString()
        }
      }, requestingUser);
    } catch (error) {
      if (emailManagementTemplateRepository.isUniqueConflict(error)) {
        const conflict = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
          existing.orgId,
          normalized.eventKey,
          { excludeId: existing.id }
        );
        throw new Error(buildDuplicateEventTemplateError(normalized.eventKey, conflict));
      }
      throw error;
    }
  },

  async deleteTemplate(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    return dataService.deleteData('emailManagementTemplates', id, requestingUser);
  },

  async resolveTemplateForEvent({
    orgId = '',
    eventKey = '',
    to = '',
    context = {},
    injectedValues = {},
    templateId = ''
  } = {}) {
    const activeOrgId = toPublicId(orgId) || 'SYSTEM';
    const token = normalizeKeyToken(eventKey);
    if (!token) throw new Error('Event key is required.');

    const event = getEmailEventByKey(token, { includeInactive: true });
    if (!event) throw new Error('Selected email event is not supported by backend.');
    if (event.isActive === false) throw new Error('Selected email event is currently disabled.');

    if (templateId) {
      return this.resolveTemplateById({
        templateId,
        orgId: activeOrgId,
        to,
        context,
        injectedValues
      });
    }

    const { template: activeTemplate, routeSource } = await emailManagementTemplateRepository
      .getActiveTemplateByEventKeyWithFallback(activeOrgId, token);
    if (!activeTemplate) {
      const fallback = buildFallbackTemplateForEvent(token);
      if (!fallback) {
        throw new Error(`No active email template configured for event '${token}'.`);
      }

      const templateContext = {
        eventKey: token,
        sectionId: normalizeKeyToken(event.sectionId),
        operationId: normalizeKeyToken(event.operationId),
        senderTemplate: fallback.senderTemplate,
        recipientTemplate: fallback.recipientTemplate,
        subjectTemplate: fallback.subjectTemplate,
        bodyTemplate: fallback.bodyTemplate
      };
      const storedDefinition = await emailEventDefinitionService.getDefinitionByEventKey(token);
      const definition = storedDefinition
        ? buildDefinitionFromStored(storedDefinition, event)
        : buildDefinitionFromEvent(event);
      const resolverValues = definition ? definition.resolve(context || {}) : {};
      const mergedValues = {
        ...resolverValues,
        ...normalizeInjectedValues(injectedValues)
      };
      const renderedFrom = cleanString(applyPlaceholderValues(templateContext.senderTemplate, mergedValues), { max: 320, allowEmpty: true });
      const overrideRecipient = cleanString(to, { max: 320, allowEmpty: true });
      const renderedTo = overrideRecipient || applyPlaceholderValues(templateContext.recipientTemplate, mergedValues);
      const recipients = parseAddressList(renderedTo);
      if (!recipients.length) {
        throw new Error('Resolved recipient list is empty.');
      }
      const renderedSubject = applyPlaceholderValues(templateContext.subjectTemplate, mergedValues);
      const renderedBody = applyPlaceholderValues(templateContext.bodyTemplate, mergedValues);
      const subject = cleanString(renderedSubject, { max: 260, allowEmpty: true });
      if (!subject) throw new Error('Resolved email subject is empty.');
      const bodyOutputs = buildRuntimeBodyOutputs(renderedBody);
      const bodyText = cleanString(bodyOutputs.text, { max: 60000, allowEmpty: true });
      const bodyHtml = cleanString(bodyOutputs.html, { max: 60000, allowEmpty: true });
      if (!bodyText || !bodyHtml) throw new Error('Resolved email body is empty.');

      return {
        from: renderedFrom || '',
        to: recipients,
        subject,
        text: bodyText,
        html: bodyHtml,
        body: bodyText,
        templateId: '',
        providerProfileId: '',
        packageName: normalizePackageName(event.packageName || 'CORE'),
        sectionId: templateContext.sectionId,
        operationId: templateContext.operationId,
        eventKey: token,
        routeSource: 'code_fallback',
        usedFallback: true
      };
    }

    const resolved = await this.resolveTemplateById({
      templateId: activeTemplate.id,
      orgId: activeOrgId,
      to,
      context,
      injectedValues
    });
    return {
      ...resolved,
      routeSource: routeSource || 'org_override'
    };
  },

  resolveTemplateForRuntime({ orgId = '', sectionId = '', operationId = '', context = {} } = {}) {
    return (async () => {
      const activeTemplate = await emailManagementTemplateRepository.getActiveTemplate(orgId, sectionId, operationId);
      const template = activeTemplate || buildFallbackPasswordResetTemplate();
      startupLogger.info('EMAIL_MGMT', 'RESOLVE_RUNTIME_TEMPLATE', 'Resolving runtime email template.', {
        orgId: String(orgId || ''),
        sectionId: String(sectionId || ''),
        operationId: String(operationId || ''),
        usedFallbackTemplate: Boolean(!activeTemplate),
        templateId: String(activeTemplate?.id || '')
      });
      const templateContext = {
        sectionId: normalizeKeyToken(sectionId || activeTemplate?.sectionId || ''),
        operationId: normalizeKeyToken(operationId || activeTemplate?.operationId || ''),
        senderTemplate: cleanString(template?.senderTemplate, { max: 320, allowEmpty: true }) || '',
        recipientTemplate: cleanString(template?.recipientTemplate, { max: 600, allowEmpty: true }) || '',
        subjectTemplate: cleanString(template?.subjectTemplate, { max: 260, allowEmpty: true }) || '',
        bodyTemplate: cleanString(template?.bodyTemplate, { max: 30000, allowEmpty: true }) || ''
      };

      const { definition } = validateTemplatePlaceholders(templateContext);
      const values = definition ? definition.resolve(context || {}) : {};

      if (definition) {
        const unresolved = (definition.required || []).filter((token) => !cleanString(values?.[token], { max: 2000, allowEmpty: true }));
        if (unresolved.length > 0) {
          startupLogger.error('EMAIL_MGMT', 'RESOLVE_RUNTIME_TEMPLATE', 'Missing required runtime placeholder values.', {
            requiredCount: Array.isArray(definition?.required) ? definition.required.length : 0,
            missingTokens: unresolved.join(',')
          });
          throw new Error(`Runtime template context is missing required values: ${unresolved.join(', ')}.`);
        }
      }

      const renderedFrom = cleanString(applyPlaceholderValues(templateContext.senderTemplate, values), { max: 320, allowEmpty: true });
      const renderedTo = applyPlaceholderValues(templateContext.recipientTemplate, values);
      const renderedSubject = applyPlaceholderValues(templateContext.subjectTemplate, values);
      const renderedBody = applyPlaceholderValues(templateContext.bodyTemplate, values);
      const recipients = parseAddressList(renderedTo);
      if (!recipients.length) {
        startupLogger.error('EMAIL_MGMT', 'RESOLVE_RUNTIME_TEMPLATE', 'Resolved recipients are empty.', {
          sectionId: String(sectionId || ''),
          operationId: String(operationId || '')
        });
        throw new Error('Resolved recipient list is empty.');
      }
      const subject = cleanString(renderedSubject, { max: 260, allowEmpty: true });
      if (!subject) {
        startupLogger.error('EMAIL_MGMT', 'RESOLVE_RUNTIME_TEMPLATE', 'Resolved email subject is empty.');
        throw new Error('Resolved email subject is empty.');
      }
      const bodyOutputs = buildRuntimeBodyOutputs(renderedBody);
      const bodyText = cleanString(bodyOutputs.text, { max: 60000, allowEmpty: true });
      const bodyHtml = cleanString(bodyOutputs.html, { max: 60000, allowEmpty: true });
      if (!bodyText || !bodyHtml) {
        startupLogger.error('EMAIL_MGMT', 'RESOLVE_RUNTIME_TEMPLATE', 'Resolved email body is empty.');
        throw new Error('Resolved email body is empty.');
      }

      return {
        from: renderedFrom || '',
        to: recipients,
        subject,
        text: bodyText,
        html: bodyHtml,
        body: bodyText,
        eventKey: cleanString(definition?.eventKey, { max: 120, allowEmpty: true }) || '',
        usedFallback: !activeTemplate,
        templateId: cleanString(activeTemplate?.id, { max: 120, allowEmpty: true }) || ''
      };
    })();
  },

  async resolveTemplateById({
    templateId = '',
    orgId = '',
    to = '',
    context = {},
    injectedValues = {}
  } = {}) {
    const token = cleanString(templateId, { max: 120, allowEmpty: true });
    if (!token) throw new Error('Email template id is required.');

    const activeOrgId = toPublicId(orgId) || '';
    if (!activeOrgId) throw new Error('Organization id is required.');

    const row = await emailManagementTemplateRepository.getById(token, {
      scope: { canViewAll: true }
    });
    if (!row) throw new Error('Email template not found.');
    if (!idsEqual(row.orgId, activeOrgId)) {
      throw new Error('Email template does not belong to this organization.');
    }
    if (row.isActive === false) {
      throw new Error('Email template is not active.');
    }

    const isGeneral = resolveTemplateKindFromPayload(row, row) === 'general';
    const templateContext = {
      templateKind: isGeneral ? 'general' : 'event',
      eventKey: normalizeKeyToken(row.eventKey || ''),
      providerProfileId: cleanString(row.providerProfileId, { max: 120, allowEmpty: true }) || '',
      packageName: normalizePackageName(row.packageName || 'CORE'),
      sectionId: normalizeKeyToken(row.sectionId || ''),
      operationId: normalizeKeyToken(row.operationId || ''),
      senderTemplate: cleanString(row.senderTemplate, { max: 320, allowEmpty: true }) || '',
      recipientTemplate: cleanString(row.recipientTemplate, { max: 600, allowEmpty: true }) || '',
      subjectTemplate: cleanString(row.subjectTemplate, { max: 260, allowEmpty: true }) || '',
      bodyTemplate: cleanString(row.bodyTemplate, { max: 30000, allowEmpty: true }) || ''
    };

    let definition;
    let event = null;
    if (!isGeneral) {
      event = getEmailEventBySectionOperation(templateContext.sectionId, templateContext.operationId, {
        includeInactive: true,
        packageName: templateContext.packageName
      });
      if (!event && templateContext.eventKey) {
        event = getEmailEventByKey(templateContext.eventKey, { includeInactive: true });
      }
      definition = buildDefinitionFromEvent(event);
    }
    const resolverValues = definition ? definition.resolve(context || {}) : {};
    const mergedValues = {
      ...resolverValues,
      ...normalizeInjectedValues(injectedValues)
    };

    const usedPlaceholders = extractPlaceholders(
      templateContext.senderTemplate,
      templateContext.recipientTemplate,
      templateContext.subjectTemplate,
      templateContext.bodyTemplate
    );

    if (isGeneral) {
      const missingRuntime = usedPlaceholders.filter((token) => (
        !cleanString(mergedValues?.[token], { max: 60000, allowEmpty: true })
      ));
      if (missingRuntime.length > 0) {
        throw new Error(`Missing runtime placeholder values: ${missingRuntime.join(', ')}.`);
      }
    } else if (definition) {
      const allowedSet = new Set(definition.allowed || []);
      const unknown = usedPlaceholders.filter((token) => !allowedSet.has(token));
      if (unknown.length > 0) {
        throw new Error(`Unknown placeholders: ${unknown.join(', ')}.`);
      }

      const runtimeSet = new Set(definition.runtime || []);
      const missingRuntime = usedPlaceholders.filter((token) => {
        if (!runtimeSet.has(token)) return false;
        return !cleanString(mergedValues?.[token], { max: 60000, allowEmpty: true });
      });
      if (missingRuntime.length > 0) {
        throw new Error(`Missing runtime placeholder values: ${missingRuntime.join(', ')}.`);
      }
    } else if (usedPlaceholders.length > 0) {
      throw new Error('This template event does not support placeholders.');
    }

    const renderedFrom = cleanString(
      applyPlaceholderValues(templateContext.senderTemplate, mergedValues),
      { max: 320, allowEmpty: true }
    );
    const renderedSubject = applyPlaceholderValues(templateContext.subjectTemplate, mergedValues);
    const renderedBody = applyPlaceholderValues(templateContext.bodyTemplate, mergedValues);
    const overrideRecipient = cleanString(to, { max: 320, allowEmpty: true });
    const renderedTo = overrideRecipient
      || applyPlaceholderValues(templateContext.recipientTemplate, mergedValues);
    const recipients = parseAddressList(renderedTo);
    if (!recipients.length) {
      throw new Error('Resolved recipient list is empty.');
    }

    const subject = cleanString(renderedSubject, { max: 260, allowEmpty: true });
    if (!subject) throw new Error('Resolved email subject is empty.');

    const bodyOutputs = buildRuntimeBodyOutputs(renderedBody);
    const bodyText = cleanString(bodyOutputs.text, { max: 60000, allowEmpty: true });
    const bodyHtml = cleanString(bodyOutputs.html, { max: 60000, allowEmpty: true });
    if (!bodyText || !bodyHtml) throw new Error('Resolved email body is empty.');

    return {
      from: renderedFrom || '',
      to: recipients,
      subject,
      text: bodyText,
      html: bodyHtml,
      body: bodyText,
      templateId: token,
      providerProfileId: templateContext.providerProfileId,
      packageName: templateContext.packageName,
      sectionId: templateContext.sectionId,
      operationId: templateContext.operationId,
      eventKey: cleanString(definition?.eventKey || event?.eventKey || templateContext.eventKey, { max: 120, allowEmpty: true }) || '',
      usedFallback: false
    };
  },

  async listEventRoutingCoverage(query = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const activeOrgId = toPublicId(requestingUser?.activeOrgId) || 'SYSTEM';
    const forceEventKeys = cleanString(query?.eventKey__eq, { max: 120, allowEmpty: true }).toUpperCase();

    const definitions = await this.getAccessibleEventDefinitions(requestingUser, {
      includeInactive: false,
      forceEventKeys: forceEventKeys ? [forceEventKeys] : []
    });

    const orgTemplateResult = await this.listTemplates({
      ...(query || {}),
      isActive__eq: 'true',
      page: 1,
      limit: 5000
    }, requestingUser);
    const orgTemplates = Array.isArray(orgTemplateResult?.rows) ? orgTemplateResult.rows : [];
    const orgByEvent = new Map(
      orgTemplates.map((row) => [normalizeKeyToken(row.eventKey), row])
    );

    let systemTemplates = await emailManagementTemplateRepository.list({
      scope: { canViewAll: true },
      query: { orgId__eq: 'SYSTEM', isActive__eq: 'true', page: 1, limit: 5000 }
    });
    const systemByEvent = new Map(
      systemTemplates.map((row) => [normalizeKeyToken(row.eventKey), row])
    );

    const routeFilter = cleanString(query?.effectiveRoute__eq, { max: 40, allowEmpty: true }).toLowerCase();

    let rows = definitions.map((definition) => {
      const eventKey = normalizeKeyToken(definition.eventKey);
      const orgTemplate = orgByEvent.get(eventKey) || null;
      const systemTemplate = systemByEvent.get(eventKey) || null;
      let effectiveRoute = 'unconfigured';
      let routeSource = 'unconfigured';
      if (orgTemplate) {
        effectiveRoute = 'org_override';
        routeSource = 'org_override';
      } else if (systemTemplate) {
        effectiveRoute = 'system_default';
        routeSource = 'system_default';
      }
      return {
        eventKey,
        eventLabel: definition.label || eventKey,
        packageName: definition.packageName || 'CORE',
        sectionId: definition.sectionId || '',
        operationId: definition.operationId || '',
        orgTemplateId: orgTemplate?.id || '',
        orgTemplateSubject: orgTemplate?.subjectTemplate || '',
        systemTemplateId: systemTemplate?.id || '',
        systemTemplateSubject: systemTemplate?.subjectTemplate || '',
        effectiveRoute,
        routeSource,
        readOnly: definition.readOnly === true
      };
    });

    if (routeFilter) {
      rows = rows.filter((row) => String(row?.effectiveRoute || '').toLowerCase() === routeFilter);
    }

    rows = applyGenericFilter(rows, query || {}, {
      defaultSearchFields: EVENT_ROUTING_SEARCH_FIELDS
    });

    const pagination = paginate(rows, query?.page, query?.limit);
    return {
      rows: pagination.data,
      pagination: pagination.pagination
    };
  },

  async listTemplatesForPicker(query = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const source = query && typeof query === 'object' ? { ...query } : {};
    if (!source.isActive__eq) source.isActive__eq = 'true';
    const result = await this.listTemplates(source, requestingUser);
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    return rows.map((row) => {
      const isGeneral = resolveTemplateKindFromPayload(row, row) === 'general';
      const labelPrefix = isGeneral
        ? (cleanString(row.templateName, { max: 180, allowEmpty: true }) || 'General template')
        : (row.eventLabel || row.eventKey || row.id);
      return {
        id: row.id,
        label: [
          labelPrefix,
          row.subjectTemplate ? `— ${String(row.subjectTemplate).slice(0, 80)}` : ''
        ].join(' ').trim(),
        name: isGeneral
          ? (cleanString(row.templateName, { max: 180, allowEmpty: true }) || 'General template')
          : (row.eventLabel || row.eventKey || row.id),
        templateName: cleanString(row.templateName, { max: 180, allowEmpty: true }) || '',
        templateKind: isGeneral ? 'general' : 'event',
        packageName: normalizePackageName(row.packageName || 'CORE'),
        eventKey: row.eventKey || '',
        providerProfileId: row.providerProfileId || '',
        subjectTemplate: row.subjectTemplate || '',
        isActive: row.isActive !== false
      };
    });
  },

  async getEventAssignmentsForOrg(requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const activeOrgId = await resolveEmailTemplateOrgContext(requestingUser, { scopeLabel: 'email templates' });
    const result = await this.listTemplates({ page: 1, limit: 5000 }, requestingUser);
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const assignments = {};
    rows.forEach((row) => {
      const eventKey = normalizeKeyToken(row?.eventKey || '');
      if (!eventKey) return;
      assignments[eventKey] = {
        id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
        subjectTemplate: cleanString(row?.subjectTemplate, { max: 260, allowEmpty: true }) || '',
        isActive: row?.isActive !== false
      };
    });
    return { orgId: activeOrgId, assignments };
  },

  __testables: Object.freeze({
    validateTemplatePlaceholders,
    validateGeneralTemplatePlaceholders,
    resolveEventForSave,
    resolveTemplateKindFromPayload,
    normalizeTemplateKind,
    buildGeneralTemplateDefinition,
    CORE_GENERAL_TEMPLATE_SLOTS,
    normalizeTemplateListQuery,
    buildTemplateContextForSave,
    decorateTemplateRowWithEvent,
    assertGeneralTemplateNameOrThrow,
    EVENT_ROUTING_SEARCH_FIELDS,
    normalizeInjectedValues,
    applyPlaceholderValues,
    buildRuntimeBodyOutputs,
    extractPlaceholders,
    buildDefinitionFromEvent,
    buildDefinitionFromStored,
    resolveDefinitionForValidation,
    buildDuplicateEventTemplateError,
    assertUniqueEventTemplateOrThrow,
    assertTemplateProviderSenderOrThrow
  })
};

module.exports = emailManagementService;
