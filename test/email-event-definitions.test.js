const test = require('node:test');
const assert = require('node:assert/strict');

const emailEventDefinitionService = require('../MVC/services/emailEventDefinitionService');
const emailEventDefinitionRepository = require('../MVC/repositories/emailEventDefinitionRepository');
const { listSupportedEmailEvents } = require('../config/emailEventCatalog');

const {
  catalogEventToDefinition,
  decorateDefinitionRow,
  classifyPlaceholderKind,
  buildPlaceholderRegistrySnapshot,
  buildPlaceholderPickerRows,
  buildGlobalPlaceholderPickerRows
} = emailEventDefinitionService;

test('catalogEventToDefinition normalizes event metadata', () => {
  const out = catalogEventToDefinition({
    eventKey: 'auth_password_reset_code',
    sectionId: 'users',
    operationId: 'update',
    packageName: 'core',
    label: 'Password Reset Code',
    allowedPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
    requiredPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
    runtimePlaceholders: ['BODY_CONTENT']
  });

  assert.equal(out.eventKey, 'AUTH_PASSWORD_RESET_CODE');
  assert.equal(out.sectionId, 'USERS');
  assert.equal(out.operationId, 'UPDATE');
  assert.equal(out.packageName, 'CORE');
  assert.deepEqual(out.allowedPlaceholders, ['USER_EMAIL', 'RESET_CODE']);
});

test('decorateDefinitionRow classifies placeholder kinds', () => {
  const decorated = decorateDefinitionRow({
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    sectionId: 'USERS',
    operationId: 'UPDATE',
    allowedPlaceholders: ['USER_EMAIL', 'RESET_CODE', 'BODY_CONTENT'],
    requiredPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
    runtimePlaceholders: ['BODY_CONTENT']
  });

  const byKey = new Map(decorated.placeholders.map((row) => [row.key, row.kind]));
  assert.equal(byKey.get('USER_EMAIL'), 'resolver');
  assert.equal(byKey.get('RESET_CODE'), 'resolver');
  assert.equal(byKey.get('BODY_CONTENT'), 'runtime');
});

test('classifyPlaceholderKind returns expected kinds', () => {
  const definition = {
    requiredPlaceholders: ['USER_EMAIL'],
    runtimePlaceholders: ['BODY_CONTENT']
  };
  assert.equal(classifyPlaceholderKind('USER_EMAIL', definition), 'resolver');
  assert.equal(classifyPlaceholderKind('BODY_CONTENT', definition), 'runtime');
  assert.equal(classifyPlaceholderKind('OPTIONAL_TOKEN', definition), 'optional');
});

test('buildGlobalPlaceholderPickerRows deduplicates keys across events', () => {
  const snapshot = buildPlaceholderRegistrySnapshot([
    decorateDefinitionRow({
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      sectionId: 'USERS',
      operationId: 'UPDATE',
      label: 'Password Reset Code',
      allowedPlaceholders: ['USER_EMAIL', 'RESET_CODE', 'APP_NAME'],
      requiredPlaceholders: ['USER_EMAIL', 'RESET_CODE'],
      runtimePlaceholders: []
    }),
    decorateDefinitionRow({
      eventKey: 'NEWSLETTER_WELCOME',
      sectionId: 'NEWSLETTERS',
      operationId: 'CREATE',
      label: 'Newsletter Welcome',
      allowedPlaceholders: ['SUBSCRIBER_EMAIL', 'UNSUBSCRIBE_URL'],
      requiredPlaceholders: ['SUBSCRIBER_EMAIL'],
      runtimePlaceholders: []
    })
  ]);

  const rows = buildGlobalPlaceholderPickerRows(snapshot);
  const keys = rows.map((row) => row.key).sort();
  assert.deepEqual(keys, ['APP_NAME', 'RESET_CODE', 'SUBSCRIBER_EMAIL', 'UNSUBSCRIBE_URL', 'USER_EMAIL']);

  const userEmail = rows.find((row) => row.key === 'USER_EMAIL');
  assert.ok(userEmail);
  assert.equal(userEmail.name, '{{USER_EMAIL}}');
  assert.deepEqual(userEmail.eventKeys, ['AUTH_PASSWORD_RESET_CODE']);
  assert.deepEqual(userEmail.eventLabels, ['Password Reset Code']);
  assert.equal(userEmail.description, 'Used in: Password Reset Code');

  const subscriberEmail = rows.find((row) => row.key === 'SUBSCRIBER_EMAIL');
  assert.ok(subscriberEmail);
  assert.equal(subscriberEmail.description, 'Used in: Newsletter Welcome');
});

test('buildPlaceholderPickerRows includes all allowed placeholders for an event', () => {
  const definition = catalogEventToDefinition(listSupportedEmailEvents().find((event) => event.eventKey === 'AUTH_PASSWORD_RESET_CODE'));
  const rows = buildPlaceholderPickerRows(definition, definition.eventKey);
  const keys = rows.map((row) => row.key).sort();
  assert.deepEqual(keys, ['APP_NAME', 'ORG_NAME', 'RESET_CODE', 'RESET_TTL_MINUTES', 'USER_EMAIL']);
  const requiredKeys = rows.filter((row) => row.kind === 'Required').map((row) => row.key).sort();
  assert.deepEqual(requiredKeys, ['RESET_CODE', 'USER_EMAIL']);
});

test('buildPlaceholderRegistrySnapshot keys rows by eventKey', () => {
  const snapshot = buildPlaceholderRegistrySnapshot([
    decorateDefinitionRow({
      eventKey: 'NEWSLETTER_WELCOME',
      sectionId: 'NEWSLETTER',
      operationId: 'CREATE',
      label: 'Newsletter Welcome',
      allowedPlaceholders: ['USER_EMAIL'],
      requiredPlaceholders: ['USER_EMAIL'],
      runtimePlaceholders: []
    })
  ]);

  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].eventKey, 'NEWSLETTER_WELCOME');
  assert.deepEqual(snapshot[0].allowed, ['USER_EMAIL']);
});

test('resolveDefinitionRows falls back to code catalog when registry is empty', async () => {
  const originalList = emailEventDefinitionService.listDefinitions;
  const originalSync = emailEventDefinitionService.syncFromCodeCatalog;

  emailEventDefinitionService.listDefinitions = async () => [];
  emailEventDefinitionService.syncFromCodeCatalog = async () => ({ upserted: 0, total: 0 });

  try {
    const result = await emailEventDefinitionService.resolveDefinitionRows(false);
    assert.ok(Array.isArray(result.rows));
    assert.ok(result.rows.length >= 1);
    assert.equal(result.source, 'code-catalog');
    assert.equal(result.rows[0].eventKey, 'AUTH_PASSWORD_RESET_CODE');
  } finally {
    emailEventDefinitionService.listDefinitions = originalList;
    emailEventDefinitionService.syncFromCodeCatalog = originalSync;
  }
});

test('syncFromCodeCatalog upserts all supported events idempotently', async () => {
  const originalUpsert = emailEventDefinitionRepository.upsertByEventKey;
  const upsertCalls = [];

  emailEventDefinitionRepository.upsertByEventKey = async (payload, options) => {
    upsertCalls.push(payload?.eventKey);
    return payload;
  };

  try {
    const events = listSupportedEmailEvents({ includeInactive: true });
    const first = await emailEventDefinitionService.syncFromCodeCatalog();
    const second = await emailEventDefinitionService.syncFromCodeCatalog();

    assert.equal(first.total, events.length);
    assert.equal(first.upserted, events.length);
    assert.equal(second.total, events.length);
    assert.equal(second.upserted, events.length);
    assert.equal(upsertCalls.length, events.length * 2);
  } finally {
    emailEventDefinitionRepository.upsertByEventKey = originalUpsert;
  }
});
