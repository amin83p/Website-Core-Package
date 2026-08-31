'use strict';

const {
  SECTIONS,
  OPERATIONS,
  freezeEvent,
  cloneEvent,
  includeEvent,
  toEventKey
} = require('./emailEventCatalogCore');
const { listAllRegisteredPackageEvents } = require('../MVC/services/emailEventRegistry');

const CORE_EMAIL_EVENTS = Object.freeze([
  freezeEvent({
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    label: 'Password Reset Code',
    packageName: 'CORE',
    sectionId: SECTIONS.USERS,
    operationId: OPERATIONS.UPDATE,
    resolverId: 'PASSWORD_RESET',
    allowedPlaceholders: ['USER_EMAIL', 'RESET_CODE', 'RESET_TTL_MINUTES', 'APP_NAME', 'ORG_NAME'],
    requiredPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
    runtimePlaceholders: [],
    isActive: true
  }),
  freezeEvent({
    eventKey: 'CONTACT_NOTIFICATION',
    label: 'Contact Form Notification',
    packageName: 'CORE',
    sectionId: SECTIONS.CONTACT_MESSAGES,
    operationId: OPERATIONS.CREATE,
    resolverId: 'CONTACT_NOTIFICATION',
    allowedPlaceholders: [
      'CONTACT_REF_ID',
      'CONTACT_NAME',
      'CONTACT_EMAIL',
      'CONTACT_TYPE',
      'CONTACT_TIMELINE',
      'CONTACT_SUBJECT',
      'CONTACT_MESSAGE'
    ],
    requiredPlaceholders: ['CONTACT_SUBJECT'],
    runtimePlaceholders: [],
    isActive: true
  }),
  freezeEvent({
    eventKey: 'NEWSLETTER_WELCOME',
    label: 'Newsletter Welcome',
    packageName: 'CORE',
    sectionId: SECTIONS.NEWSLETTERS,
    operationId: OPERATIONS.CREATE,
    resolverId: 'NEWSLETTER_WELCOME',
    allowedPlaceholders: ['SUBSCRIBER_EMAIL', 'UNSUBSCRIBE_URL'],
    requiredPlaceholders: ['SUBSCRIBER_EMAIL'],
    runtimePlaceholders: [],
    isActive: true
  })
]);

function buildEventIndexes(events = []) {
  const byKey = new Map();
  const bySectionOperation = new Map();
  events.forEach((event) => {
    if (byKey.has(event.eventKey)) {
      throw new Error(`[emailEventCatalog] Duplicate eventKey detected: '${event.eventKey}'.`);
    }
    byKey.set(event.eventKey, event);
    const compositeKey = toEventKey(event.sectionId, event.operationId);
    if (bySectionOperation.has(compositeKey)) {
      throw new Error(`[emailEventCatalog] Duplicate sectionId/operationId mapping detected: '${compositeKey}'.`);
    }
    bySectionOperation.set(compositeKey, event);
  });
  return { byKey, bySectionOperation };
}

function getMergedEvents({ includeInactive = true } = {}) {
  const packageEvents = listAllRegisteredPackageEvents({ includeInactive });
  return [...CORE_EMAIL_EVENTS, ...packageEvents];
}

function listSupportedEmailEvents(options = {}) {
  return getMergedEvents({ includeInactive: true })
    .filter((event) => includeEvent(event, options))
    .map((event) => cloneEvent(event));
}

function getEmailEventByKey(eventKey = '', options = {}) {
  const token = String(eventKey || '').trim().toUpperCase();
  if (!token) return null;
  const { byKey } = buildEventIndexes(getMergedEvents({ includeInactive: true }));
  const event = byKey.get(token) || null;
  if (!includeEvent(event, options)) return null;
  return cloneEvent(event);
}

function getEmailEventBySectionOperation(sectionId = '', operationId = '', options = {}) {
  const compositeKey = toEventKey(sectionId, operationId);
  if (!compositeKey || compositeKey === '::') return null;
  const packageName = String(options?.packageName || '').trim().toUpperCase();
  const events = getMergedEvents({ includeInactive: true })
    .filter((event) => toEventKey(event.sectionId, event.operationId) === compositeKey);
  const event = packageName
    ? events.find((row) => String(row.packageName || '').toUpperCase() === packageName) || null
    : events[0] || null;
  if (!includeEvent(event, options)) return null;
  return cloneEvent(event);
}

module.exports = {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation,
  toEventKey
};
