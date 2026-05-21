const { SECTIONS, OPERATIONS } = require('./accessConstants');

function cleanString(value, { max = 160, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeToken(value = '', { max = 160 } = {}) {
  return cleanString(value, { max, allowEmpty: true }).toUpperCase();
}

function toEventKey(sectionId = '', operationId = '') {
  return `${normalizeToken(sectionId, { max: 120 })}::${normalizeToken(operationId, { max: 120 })}`;
}

function freezeEvent(raw = {}) {
  const eventKey = normalizeToken(raw.eventKey, { max: 120 });
  const sectionId = normalizeToken(raw.sectionId, { max: 120 });
  const operationId = normalizeToken(raw.operationId, { max: 120 });
  const label = cleanString(raw.label, { max: 180, allowEmpty: true });
  const resolverId = cleanString(raw.resolverId, { max: 120, allowEmpty: true });
  const allowedPlaceholders = Array.isArray(raw.allowedPlaceholders)
    ? raw.allowedPlaceholders.map((token) => normalizeToken(token, { max: 120 })).filter(Boolean)
    : [];
  const requiredPlaceholders = Array.isArray(raw.requiredPlaceholders)
    ? raw.requiredPlaceholders.map((token) => normalizeToken(token, { max: 120 })).filter(Boolean)
    : [];
  const isActive = raw.isActive !== false;
  if (!eventKey || !sectionId || !operationId) {
    throw new Error('[emailEventCatalog] Every event must include eventKey, sectionId, and operationId.');
  }

  const allowedSet = new Set(allowedPlaceholders);
  const missingFromAllowed = requiredPlaceholders.filter((token) => !allowedSet.has(token));
  if (missingFromAllowed.length > 0) {
    throw new Error(
      `[emailEventCatalog] Event '${eventKey}' has required placeholders not listed in allowedPlaceholders: ${missingFromAllowed.join(', ')}.`
    );
  }

  return Object.freeze({
    eventKey,
    label: label || eventKey,
    sectionId,
    operationId,
    resolverId: resolverId || '',
    allowedPlaceholders: Object.freeze(Array.from(new Set(allowedPlaceholders))),
    requiredPlaceholders: Object.freeze(Array.from(new Set(requiredPlaceholders))),
    isActive
  });
}

const EMAIL_EVENTS = Object.freeze([
  freezeEvent({
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    label: 'Password Reset Code',
    sectionId: SECTIONS.USERS,
    operationId: OPERATIONS.UPDATE,
    resolverId: 'PASSWORD_RESET',
    allowedPlaceholders: ['USER_EMAIL', 'RESET_CODE', 'RESET_TTL_MINUTES', 'APP_NAME', 'ORG_NAME'],
    requiredPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
    isActive: true
  })
]);

const EVENT_BY_KEY = new Map();
const EVENT_BY_SECTION_OPERATION = new Map();

EMAIL_EVENTS.forEach((event) => {
  if (EVENT_BY_KEY.has(event.eventKey)) {
    throw new Error(`[emailEventCatalog] Duplicate eventKey detected: '${event.eventKey}'.`);
  }
  EVENT_BY_KEY.set(event.eventKey, event);

  const compositeKey = toEventKey(event.sectionId, event.operationId);
  if (EVENT_BY_SECTION_OPERATION.has(compositeKey)) {
    throw new Error(
      `[emailEventCatalog] Duplicate sectionId/operationId mapping detected: '${compositeKey}'.`
    );
  }
  EVENT_BY_SECTION_OPERATION.set(compositeKey, event);
});

function cloneEvent(event = null) {
  if (!event) return null;
  return {
    eventKey: event.eventKey,
    label: event.label,
    sectionId: event.sectionId,
    operationId: event.operationId,
    resolverId: event.resolverId,
    allowedPlaceholders: Array.isArray(event.allowedPlaceholders) ? event.allowedPlaceholders.slice() : [],
    requiredPlaceholders: Array.isArray(event.requiredPlaceholders) ? event.requiredPlaceholders.slice() : [],
    isActive: event.isActive !== false
  };
}

function includeEvent(event = null, { includeInactive = false } = {}) {
  if (!event) return false;
  if (includeInactive) return true;
  return event.isActive !== false;
}

function listSupportedEmailEvents(options = {}) {
  return EMAIL_EVENTS
    .filter((event) => includeEvent(event, options))
    .map((event) => cloneEvent(event));
}

function getEmailEventByKey(eventKey = '', options = {}) {
  const token = normalizeToken(eventKey, { max: 120 });
  if (!token) return null;
  const event = EVENT_BY_KEY.get(token) || null;
  if (!includeEvent(event, options)) return null;
  return cloneEvent(event);
}

function getEmailEventBySectionOperation(sectionId = '', operationId = '', options = {}) {
  const compositeKey = toEventKey(sectionId, operationId);
  if (!compositeKey || compositeKey === '::') return null;
  const event = EVENT_BY_SECTION_OPERATION.get(compositeKey) || null;
  if (!includeEvent(event, options)) return null;
  return cloneEvent(event);
}

module.exports = {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation,
  toEventKey
};

