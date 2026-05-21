const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation
} = require('../config/emailEventCatalog');
const emailManagementService = require('../MVC/services/emailManagementService');

const {
  validateTemplatePlaceholders,
  resolveEventForSave,
  normalizeTemplateListQuery
} = emailManagementService.__testables || {};

test('email event catalog helpers return reset event mappings', () => {
  const rows = listSupportedEmailEvents({ includeInactive: true });
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 1);

  const resetByKey = getEmailEventByKey('AUTH_PASSWORD_RESET_CODE', { includeInactive: true });
  assert.ok(resetByKey);
  assert.equal(resetByKey.sectionId, 'USERS');
  assert.equal(resetByKey.operationId, 'UPDATE');

  const resetByRoute = getEmailEventBySectionOperation('users', 'update', { includeInactive: true });
  assert.ok(resetByRoute);
  assert.equal(resetByRoute.eventKey, 'AUTH_PASSWORD_RESET_CODE');
});

test('placeholder validation accepts valid reset template placeholders', () => {
  const out = validateTemplatePlaceholders({
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    recipientTemplate: '{{USER_EMAIL}}',
    subjectTemplate: 'Code {{RESET_CODE}}',
    bodyTemplate: 'TTL {{RESET_TTL_MINUTES}}',
    requireSupported: true,
    requireActive: true
  });
  assert.ok(out.definition);
  assert.equal(out.definition.eventKey, 'AUTH_PASSWORD_RESET_CODE');
});

test('placeholder validation rejects unknown placeholder token', () => {
  assert.throws(() => {
    validateTemplatePlaceholders({
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      recipientTemplate: '{{USER_EMAIL}}',
      subjectTemplate: '{{RESET_CODE}}',
      bodyTemplate: 'Bad {{NOT_ALLOWED}}',
      requireSupported: true
    });
  }, /Unknown placeholders/i);
});

test('placeholder validation rejects missing required placeholders', () => {
  assert.throws(() => {
    validateTemplatePlaceholders({
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      recipientTemplate: '{{USER_EMAIL}}',
      subjectTemplate: 'No code here',
      bodyTemplate: 'Still no code',
      requireSupported: true
    });
  }, /Missing required placeholders/i);
});

test('resolveEventForSave rejects unknown backend event key', () => {
  assert.throws(() => {
    resolveEventForSave({
      eventKey: 'NOT_SUPPORTED_EVENT',
      sectionId: 'USERS',
      operationId: 'UPDATE'
    });
  }, /not supported/i);
});

test('event-based list query maps event key to section/operation filters', () => {
  const out = normalizeTemplateListQuery({
    eventKey__eq: 'AUTH_PASSWORD_RESET_CODE',
    isActive__eq: 'true',
    page: 2,
    limit: 25
  });
  assert.ok(out && out.query);
  assert.equal(out.query.sectionId__eq, 'USERS');
  assert.equal(out.query.operationId__eq, 'UPDATE');
  assert.equal(out.query.eventKey__eq, undefined);
  assert.equal(out.query.isActive__eq, 'true');
  assert.equal(out.query.page, 2);
  assert.equal(out.query.limit, 25);
});
