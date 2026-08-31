const test = require('node:test');
const assert = require('node:assert/strict');

const emailManagementTemplateRepository = require('../MVC/repositories/emailManagementTemplateRepository');
const emailManagementService = require('../MVC/services/emailManagementService');

const originalGetActiveTemplateByEventKey = emailManagementTemplateRepository.getActiveTemplateByEventKey;

test.after(() => {
  emailManagementTemplateRepository.getActiveTemplateByEventKey = originalGetActiveTemplateByEventKey;
});

test('getActiveTemplateByEventKeyWithFallback prefers org template', async () => {
  emailManagementTemplateRepository.getActiveTemplateByEventKey = async (orgId, eventKey) => {
    if (orgId === 'ORG_A' && eventKey === 'AUTH_PASSWORD_RESET_CODE') {
      return { id: 'EMTPL_ORG', eventKey: 'AUTH_PASSWORD_RESET_CODE', orgId: 'ORG_A' };
    }
    if (orgId === 'SYSTEM') {
      return { id: 'EMTPL_SYS', eventKey: 'AUTH_PASSWORD_RESET_CODE', orgId: 'SYSTEM' };
    }
    return null;
  };

  const result = await emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback(
    'ORG_A',
    'AUTH_PASSWORD_RESET_CODE'
  );

  assert.equal(result.routeSource, 'org_override');
  assert.equal(result.template.id, 'EMTPL_ORG');
});

test('getActiveTemplateByEventKeyWithFallback falls back to SYSTEM template', async () => {
  emailManagementTemplateRepository.getActiveTemplateByEventKey = async (orgId, eventKey) => {
    if (orgId === 'SYSTEM' && eventKey === 'AUTH_PASSWORD_RESET_CODE') {
      return { id: 'EMTPL_SYS', eventKey: 'AUTH_PASSWORD_RESET_CODE', orgId: 'SYSTEM' };
    }
    return null;
  };

  const result = await emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback(
    'ORG_A',
    'AUTH_PASSWORD_RESET_CODE'
  );

  assert.equal(result.routeSource, 'system_default');
  assert.equal(result.template.id, 'EMTPL_SYS');
});

test('getActiveTemplateByEventKeyWithFallback returns unconfigured when no templates exist', async () => {
  emailManagementTemplateRepository.getActiveTemplateByEventKey = async () => null;

  const result = await emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback(
    'ORG_A',
    'AUTH_PASSWORD_RESET_CODE'
  );

  assert.equal(result.routeSource, 'unconfigured');
  assert.equal(result.template, null);
});

test('resolveTemplateForEvent exposes routeSource from active template resolution', async () => {
  const originalWithFallback = emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback;
  const originalResolveById = emailManagementService.resolveTemplateById;

  emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback = async () => ({
    template: {
      id: 'EMTPL_SYS',
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      sectionId: 'USERS',
      operationId: 'UPDATE',
      senderTemplate: 'noreply@example.com',
      recipientTemplate: '{{USER_EMAIL}}',
      subjectTemplate: 'Reset',
      bodyTemplate: 'Code {{RESET_CODE}}'
    },
    routeSource: 'system_default'
  });

  emailManagementService.resolveTemplateById = async () => ({
    from: 'noreply@example.com',
    to: ['user@example.com'],
    subject: 'Reset',
    text: 'Code 123',
    html: '<p>Code 123</p>',
    templateId: 'EMTPL_SYS',
    providerProfileId: '',
    eventKey: 'AUTH_PASSWORD_RESET_CODE'
  });

  try {
    const resolved = await emailManagementService.resolveTemplateForEvent({
      orgId: 'ORG_A',
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      context: {
        userEmail: 'user@example.com',
        resetCode: '123'
      }
    });

    assert.equal(resolved.routeSource, 'system_default');
    assert.equal(resolved.templateId, 'EMTPL_SYS');
  } finally {
    emailManagementTemplateRepository.getActiveTemplateByEventKeyWithFallback = originalWithFallback;
    emailManagementService.resolveTemplateById = originalResolveById;
  }
});
