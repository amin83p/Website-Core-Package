const adminChekersService = require('./adminChekersService');
const dataService = require('./dataService');
const emailManagementTemplateRepository = require('../repositories/emailManagementTemplateRepository');
const appBrandingService = require('./appBrandingService');
const startupLogger = require('../utils/startupLogger');
const { toPublicId } = require('../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../utils/orgContextUtils');
const {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation
} = require('../../config/emailEventCatalog');

const RESET_TEMPLATE_EVENT_KEY = 'AUTH_PASSWORD_RESET_CODE';

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

function buildDefinitionFromEvent(event = null) {
  if (!event) return null;
  return {
    key: `${normalizeKeyToken(event.sectionId)}::${normalizeKeyToken(event.operationId)}`,
    eventKey: normalizeKeyToken(event.eventKey),
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
    resolve(context = {}) {
      return resolveValuesByResolverId(event.resolverId, context);
    }
  };
}

function resolveDefinition(sectionId = '', operationId = '', { includeInactive = true } = {}) {
  const event = getEmailEventBySectionOperation(sectionId, operationId, { includeInactive });
  return buildDefinitionFromEvent(event);
}

function resolveEventForSave(payload = {}, { requireActive = true } = {}) {
  const eventKeyToken = normalizeKeyToken(payload?.eventKey || '');
  let event = null;
  if (eventKeyToken) {
    event = getEmailEventByKey(eventKeyToken, { includeInactive: true });
  } else {
    event = getEmailEventBySectionOperation(payload?.sectionId, payload?.operationId, { includeInactive: true });
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
  sectionId = '',
  operationId = '',
  senderTemplate = '',
  recipientTemplate = '',
  subjectTemplate = '',
  bodyTemplate = '',
  requireSupported = false,
  requireActive = true
} = {}) {
  const event = normalizeKeyToken(eventKey)
    ? getEmailEventByKey(eventKey, { includeInactive: true })
    : getEmailEventBySectionOperation(sectionId, operationId, { includeInactive: true });
  if (event && requireActive && event.isActive === false) {
    throw new Error('Selected email event is currently disabled.');
  }

  const definition = buildDefinitionFromEvent(event);
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

function buildTemplateContextForSave(payload = {}, activeOrgId = '', event = null) {
  const sectionId = event ? normalizeKeyToken(event.sectionId) : normalizeKeyToken(payload?.sectionId || '');
  const operationId = event ? normalizeKeyToken(event.operationId) : normalizeKeyToken(payload?.operationId || '');
  return {
    orgId: toPublicId(activeOrgId || payload?.orgId) || '',
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
  const event = getEmailEventBySectionOperation(row.sectionId, row.operationId, { includeInactive: true });
  return {
    ...row,
    eventKey: cleanString(event?.eventKey, { max: 120, allowEmpty: true }) || '',
    eventLabel: cleanString(event?.label, { max: 180, allowEmpty: true }) || '',
    eventIsActive: event ? event.isActive !== false : false
  };
}

function normalizeTemplateListQuery(query = {}) {
  const source = query && typeof query === 'object' ? { ...query } : {};
  const eventKeyFilter = normalizeKeyToken(source.eventKey__eq || '');
  delete source.eventKey__eq;

  if (eventKeyFilter) {
    const event = getEmailEventByKey(eventKeyFilter, { includeInactive: true });
    if (!event) {
      return {
        query: {
          ...source,
          id__eq: '__NO_MATCH_EMAIL_EVENT__'
        }
      };
    }
    source.sectionId__eq = normalizeKeyToken(event.sectionId);
    source.operationId__eq = normalizeKeyToken(event.operationId);
  }

  return { query: source };
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
        sectionId: normalizeKeyToken(event.sectionId),
        operationId: normalizeKeyToken(event.operationId),
        resolverId: normalizeKeyToken(event.resolverId),
        allowedPlaceholders: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
        requiredPlaceholders: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
        isActive: event.isActive !== false
      }))
      .sort((a, b) => String(a.label || a.eventKey).localeCompare(String(b.label || b.eventKey)));
    return rows;
  },

  getPlaceholderRegistrySnapshot() {
    return this.getSupportedEventCatalog({ includeInactive: true }).map((event) => ({
      key: `${event.sectionId}::${event.operationId}`,
      eventKey: event.eventKey,
      sectionId: event.sectionId,
      operationId: event.operationId,
      label: event.label,
      allowed: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
      required: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : []
    }));
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
    const activeOrgId = await assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'email templates' });

    const event = resolveEventForSave(payload, { requireActive: true });
    const normalized = buildTemplateContextForSave(payload, activeOrgId, event);
    validateTemplatePlaceholders({
      eventKey: event.eventKey,
      ...normalized,
      requireSupported: true,
      requireActive: true
    });
    const creator = buildCreator(requestingUser, activeOrgId);

    try {
      return await dataService.addData('emailManagementTemplates', {
        ...normalized,
        orgId: activeOrgId,
        creator
      }, requestingUser);
    } catch (error) {
      if (emailManagementTemplateRepository.isUniqueConflict(error)) {
        throw new Error('A template for this section/operation already exists in this organization.');
      }
      throw error;
    }
  },

  async updateTemplate(id, payload = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const existing = await dataService.getDataById('emailManagementTemplates', id, requestingUser);
    if (!existing) throw new Error('Email template not found.');

    const event = resolveEventForSave(
      {
        ...existing,
        ...(payload || {})
      },
      { requireActive: true }
    );
    const normalized = buildTemplateContextForSave(
      {
        ...existing,
        ...(payload || {})
      },
      existing.orgId,
      event
    );
    validateTemplatePlaceholders({
      eventKey: event.eventKey,
      ...normalized,
      requireSupported: true,
      requireActive: true
    });
    const creator = buildCreator(requestingUser, existing.orgId);

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
        throw new Error('A template for this section/operation already exists in this organization.');
      }
      throw error;
    }
  },

  async deleteTemplate(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    return dataService.deleteData('emailManagementTemplates', id, requestingUser);
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

  __testables: Object.freeze({
    validateTemplatePlaceholders,
    resolveEventForSave,
    normalizeTemplateListQuery,
    buildTemplateContextForSave,
    decorateTemplateRowWithEvent
  })
};

module.exports = emailManagementService;
