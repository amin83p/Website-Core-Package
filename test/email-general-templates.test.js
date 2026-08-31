const test = require('node:test');
const assert = require('node:assert/strict');

const emailManagementTemplateModel = require('../MVC/models/emailManagementTemplateModel');
const emailManagementService = require('../MVC/services/emailManagementService');
const {
  validateSessionNotificationEmailWrapperTemplate,
  WRAPPER_PLACEHOLDER_TOKENS
} = require('../packages/school/MVC/services/school/sessionNotificationEmailWrapperPlaceholders');

const {
  validateGeneralTemplatePlaceholders,
  resolveTemplateKindFromPayload,
  buildGeneralTemplateDefinition,
  buildTemplateContextForSave,
  decorateTemplateRowWithEvent,
  assertGeneralTemplateNameOrThrow,
  CORE_GENERAL_TEMPLATE_SLOTS
} = emailManagementService.__testables || {};

const ORG_ID = 'ORG_EMAIL_GENERAL_TEST';
const GENERAL_TEMPLATE_ID = 'EMTPL_GENERAL_TEST_001';

test('normalizeTemplateRecord allows general templates without event metadata', () => {
  const normalized = emailManagementTemplateModel.normalizeTemplateRecord({
    orgId: ORG_ID,
    templateKind: 'general',
    templateName: 'School session wrapper',
    senderTemplate: 'noreply@example.com',
    recipientTemplate: '{{TEACHER_NAME}} <teacher@example.com>',
    subjectTemplate: 'Reminder',
    bodyTemplate: 'Hi {{TEACHER_NAME}}\n\n{{BODY_CONTENT}}'
  }, null, true);

  assert.equal(normalized.templateKind, 'general');
  assert.equal(normalized.templateName, 'School session wrapper');
  assert.equal(normalized.eventKey, '');
  assert.equal(normalized.sectionId, '');
  assert.equal(normalized.operationId, '');
  assert.equal(normalized.packageName, 'CORE');
});

test('normalizeTemplateRecord requires templateName for general templates in strict mode', () => {
  assert.throws(
    () => emailManagementTemplateModel.normalizeTemplateRecord({
      orgId: ORG_ID,
      templateKind: 'general',
      senderTemplate: 'noreply@example.com',
      recipientTemplate: '{{TEACHER_NAME}}',
      subjectTemplate: 'Reminder',
      bodyTemplate: '{{BODY_CONTENT}}'
    }, null, true),
    /Template name is required for general templates/i
  );
});

test('buildTemplateContextForSave persists templateName for general templates', () => {
  const normalized = buildTemplateContextForSave({
    templateKind: 'general',
    templateName: 'Manual picker template',
    providerProfileId: 'EMPP_TEST',
    senderTemplate: 'noreply@example.com',
    recipientTemplate: '{{BODY_CONTENT}}',
    subjectTemplate: 'Hello',
    bodyTemplate: '{{BODY_CONTENT}}'
  }, ORG_ID, null);

  assert.equal(normalized.templateKind, 'general');
  assert.equal(normalized.templateName, 'Manual picker template');
  assert.equal(normalized.providerProfileId, 'EMPP_TEST');
});

test('decorateTemplateRowWithEvent uses templateName as eventLabel for general templates', () => {
  const decorated = decorateTemplateRowWithEvent({
    id: 'EMTPL_X',
    templateKind: 'general',
    templateName: 'School notification wrapper'
  });
  assert.equal(decorated.eventLabel, 'School notification wrapper');
});

test('assertGeneralTemplateNameOrThrow rejects empty general template names', () => {
  assert.throws(
    () => assertGeneralTemplateNameOrThrow({ templateKind: 'general', templateName: '' }),
    /Template name is required for general templates/i
  );
});

test('validateGeneralTemplatePlaceholders accepts package-specific tokens at save time', () => {
  const ok = validateGeneralTemplatePlaceholders({
    recipientTemplate: '{{TEACHER_NAME}}',
    subjectTemplate: 'Hello',
    bodyTemplate: '{{BODY_CONTENT}}',
    requireSupported: true
  });
  assert.ok(ok.definition);
  assert.deepEqual(ok.usedPlaceholders, ['TEACHER_NAME', 'BODY_CONTENT']);
});

test('resolveTemplateKindFromPayload treats explicit general kind as general', () => {
  assert.equal(resolveTemplateKindFromPayload({ templateKind: 'general' }), 'general');
  assert.equal(resolveTemplateKindFromPayload({}, { templateKind: 'general' }), 'general');
  assert.equal(resolveTemplateKindFromPayload({ eventKey: 'AUTH_PASSWORD_RESET_CODE' }), 'event');
});

test('resolveTemplateById renders general template from injectedValues without core allowlist', async () => {
  const existing = await emailManagementTemplateModel.getTemplateById(GENERAL_TEMPLATE_ID);
  if (!existing) {
    await emailManagementTemplateModel.addTemplate({
      id: GENERAL_TEMPLATE_ID,
      orgId: ORG_ID,
      templateKind: 'general',
      templateName: 'School session notification wrapper',
      senderTemplate: 'school@example.com',
      recipientTemplate: '{{TEACHER_NAME}} <teacher@example.com>',
      subjectTemplate: 'Reminder: {{SESSION_COUNT}} session(s)',
      bodyTemplate: 'Hi {{TEACHER_NAME}},\n\n{{BODY_CONTENT}}\n\n{{ORG_NAME}}',
      isActive: true
    });
  }

  const rendered = await emailManagementService.resolveTemplateById({
    templateId: GENERAL_TEMPLATE_ID,
    orgId: ORG_ID,
    to: 'teacher@example.com',
    injectedValues: {
      TEACHER_NAME: 'Ada Lovelace',
      ORG_NAME: 'Example School',
      SESSION_COUNT: '2',
      BODY_CONTENT: '- Math 101\n- Science 201'
    }
  });

  assert.equal(rendered.templateId, GENERAL_TEMPLATE_ID);
  assert.equal(rendered.eventKey, '');
  assert.match(rendered.subject, /2 session/);
  assert.match(rendered.text, /Ada Lovelace/);
  assert.match(rendered.text, /Math 101/);
  assert.match(rendered.text, /Example School/);
});

test('resolveTemplateById rejects missing injected values for general templates', async () => {
  const existing = await emailManagementTemplateModel.getTemplateById(GENERAL_TEMPLATE_ID);
  assert.ok(existing);

  await assert.rejects(
    () => emailManagementService.resolveTemplateById({
      templateId: GENERAL_TEMPLATE_ID,
      orgId: ORG_ID,
      to: 'teacher@example.com',
      injectedValues: {
        BODY_CONTENT: 'Only body content'
      }
    }),
    /Missing runtime placeholder values/i
  );
});

test('buildGeneralTemplateDefinition tracks only used placeholders', () => {
  const definition = buildGeneralTemplateDefinition(['BODY_CONTENT', 'TEACHER_NAME']);
  assert.equal(definition.label, 'General template');
  assert.deepEqual(definition.runtime, ['BODY_CONTENT', 'TEACHER_NAME']);
});

test('core documents only BODY_CONTENT as a general template slot', () => {
  assert.deepEqual(CORE_GENERAL_TEMPLATE_SLOTS, ['BODY_CONTENT']);
});

test('school wrapper validation warns about missing BODY_CONTENT and unsupported tokens', () => {
  const missingBody = validateSessionNotificationEmailWrapperTemplate({
    bodyTemplate: 'Hello {{TEACHER_NAME}}'
  });
  assert.equal(missingBody.hasBodyContentSlot, false);
  assert.match(missingBody.warnings.join(' '), /BODY_CONTENT/i);

  const unsupported = validateSessionNotificationEmailWrapperTemplate({
    bodyTemplate: 'Hello {{BODY_CONTENT}}\n{{CUSTOM_TOKEN}}'
  });
  assert.deepEqual(unsupported.unsupportedTokens, ['CUSTOM_TOKEN']);
  assert.match(unsupported.warnings.join(' '), /CUSTOM_TOKEN/);
});

test('school wrapper validation allows custom mapped tokens', () => {
  const result = validateSessionNotificationEmailWrapperTemplate({
    bodyTemplate: 'Hello {{BODY_CONTENT}}\n{{SITE_CONTACT}}\n{{USER_EMAIL}}'
  }, {
    customMappings: [
      { token: 'SITE_CONTACT', valueKind: 'literal', literalValue: 'admin@school.com' }
    ]
  });
  assert.deepEqual(result.unsupportedTokens, []);
  assert.equal(result.hasBodyContentSlot, true);
});

test('school wrapper placeholder list includes teacher and session tokens', () => {
  assert.ok(WRAPPER_PLACEHOLDER_TOKENS.includes('TEACHER_NAME'));
  assert.ok(WRAPPER_PLACEHOLDER_TOKENS.includes('TEACHER_EMAIL'));
  assert.ok(WRAPPER_PLACEHOLDER_TOKENS.includes('USER_EMAIL'));
  assert.ok(WRAPPER_PLACEHOLDER_TOKENS.includes('SESSION_LIST'));
  assert.ok(WRAPPER_PLACEHOLDER_TOKENS.includes('BODY_CONTENT'));
});
