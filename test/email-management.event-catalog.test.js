const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listSupportedEmailEvents,
  getEmailEventByKey,
  getEmailEventBySectionOperation
} = require('../config/emailEventCatalog');
const emailManagementService = require('../MVC/services/emailManagementService');
const { clearPackageEmailEventsForTests } = require('../MVC/services/emailEventRegistry');
const { registerSchoolEmailEvents } = require('../packages/school/MVC/services/school/schoolEmailEventRegistration');

const {
  validateTemplatePlaceholders,
  resolveEventForSave,
  normalizeTemplateListQuery
} = emailManagementService.__testables || {};

test('email event catalog helpers return reset event mappings', () => {
  clearPackageEmailEventsForTests();
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

test('event-based list query preserves eventKey filter', () => {
  const out = normalizeTemplateListQuery({
    eventKey__eq: 'AUTH_PASSWORD_RESET_CODE',
    isActive__eq: 'true',
    page: 2,
    limit: 25
  });
  assert.ok(out && out.query);
  assert.equal(out.query.eventKey__eq, 'AUTH_PASSWORD_RESET_CODE');
  assert.equal(out.query.isActive__eq, 'true');
  assert.equal(out.query.page, 2);
  assert.equal(out.query.limit, 25);
});

test('core catalog registers contact and newsletter events', () => {
  const contact = getEmailEventByKey('CONTACT_NOTIFICATION', { includeInactive: true });
  const newsletter = getEmailEventByKey('NEWSLETTER_WELCOME', { includeInactive: true });
  assert.ok(contact);
  assert.ok(newsletter);
  assert.equal(contact.sectionId, 'CONTACT_MESSAGES');
  assert.equal(newsletter.sectionId, 'NEWSLETTERS');
});

test('school package registers uncompleted session email event with runtime placeholders', () => {
  clearPackageEmailEventsForTests();
  registerSchoolEmailEvents();

  const event = getEmailEventByKey('SCHOOL_UNCOMPLETED_SESSION_EMAIL', { includeInactive: true });
  assert.ok(event);
  assert.equal(event.packageName, 'SCHOOL');
  assert.equal(event.sectionId, 'SCHOOL_SESSION_ACCESS');
  assert.equal(event.operationId, 'NOTIFY');
  assert.ok(event.runtimePlaceholders.includes('SESSION_LIST'));
  assert.ok(event.runtimePlaceholders.includes('BODY_CONTENT'));

  const byRoute = getEmailEventBySectionOperation('SCHOOL_SESSION_ACCESS', 'NOTIFY', {
    includeInactive: true,
    packageName: 'SCHOOL'
  });
  assert.equal(byRoute?.eventKey, 'SCHOOL_UNCOMPLETED_SESSION_EMAIL');
});

test('template save context includes packageName from selected event', () => {
  clearPackageEmailEventsForTests();
  registerSchoolEmailEvents();
  const { buildTemplateContextForSave, resolveEventForSave } = emailManagementService.__testables || {};
  const event = resolveEventForSave({ eventKey: 'SCHOOL_UNCOMPLETED_SESSION_EMAIL' });
  const context = buildTemplateContextForSave({
    senderTemplate: 'school@example.com',
    recipientTemplate: '{{TEACHER_NAME}}',
    subjectTemplate: 'Reminder',
    bodyTemplate: 'Hi {{TEACHER_NAME}}\n{{BODY_CONTENT}}'
  }, 'ORG_EVENT_CATALOG_TEST', event);
  assert.equal(context.packageName, 'SCHOOL');
  assert.equal(context.eventKey, 'SCHOOL_UNCOMPLETED_SESSION_EMAIL');
  assert.equal(context.sectionId, 'SCHOOL_SESSION_ACCESS');
  assert.equal(context.operationId, 'NOTIFY');
});
