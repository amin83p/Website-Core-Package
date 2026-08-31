const test = require('node:test');
const assert = require('node:assert/strict');

const emailDispatchService = require('../MVC/services/emailDispatchService');
const emailManagementService = require('../MVC/services/emailManagementService');
const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
const resendEmailService = require('../MVC/services/resendEmailService');
const emailManagementTemplateRepository = require('../MVC/repositories/emailManagementTemplateRepository');

const originalResolveTemplateForEvent = emailManagementService.resolveTemplateForEvent;
const originalResolveProviderCredentials = emailProviderProfileService.resolveProviderCredentials;
const originalSendEmail = resendEmailService.sendEmail;
const originalGetActiveTemplateByEventKey = emailManagementTemplateRepository.getActiveTemplateByEventKey;

test.after(() => {
  emailManagementService.resolveTemplateForEvent = originalResolveTemplateForEvent;
  emailProviderProfileService.resolveProviderCredentials = originalResolveProviderCredentials;
  resendEmailService.sendEmail = originalSendEmail;
  emailManagementTemplateRepository.getActiveTemplateByEventKey = originalGetActiveTemplateByEventKey;
});

test('sendByEvent resolves template, credentials, validates domain, and sends', async () => {
  let captured = null;

  emailManagementService.resolveTemplateForEvent = async () => ({
    from: 'noreply@example.com',
    to: ['user@example.com'],
    subject: 'Reset code',
    text: '123456',
    html: '<p>123456</p>',
    templateId: 'EMTPL_TEST',
    providerProfileId: 'EMPP_TEST',
    sectionId: 'USERS',
    operationId: 'UPDATE',
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    usedFallback: false
  });

  emailProviderProfileService.resolveProviderCredentials = async () => ({
    provider: 'resend',
    providerProfileId: 'EMPP_TEST',
    apiKey: 're_test_key',
    fromEmail: 'noreply@example.com',
    verifiedDomains: ['example.com'],
    source: 'org_profile'
  });

  resendEmailService.sendEmail = async (payload) => {
    captured = payload;
    return { id: 'resend_msg_1' };
  };

  const result = await emailDispatchService.sendByEvent({
    orgId: 'ORG_TEST_001',
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    context: { userEmail: 'user@example.com', resetCode: '123456' },
    actor: { userId: 'USR_1' }
  });

  assert.equal(result.id, 'resend_msg_1');
  assert.ok(captured);
  assert.equal(captured.from, 'noreply@example.com');
  assert.deepEqual(captured.to, ['user@example.com']);
  assert.equal(captured.credentials.apiKey, 're_test_key');
  assert.equal(captured.meta.eventKey, 'AUTH_PASSWORD_RESET_CODE');
  assert.equal(captured.meta.providerProfileId, 'EMPP_TEST');
});

test('sendByEvent rejects sender outside verified domains', async () => {
  emailManagementService.resolveTemplateForEvent = async () => ({
    from: 'noreply@blocked.com',
    to: ['user@example.com'],
    subject: 'Hello',
    text: 'Hi',
    html: '<p>Hi</p>',
    templateId: '',
    providerProfileId: '',
    eventKey: 'NEWSLETTER_WELCOME',
    usedFallback: true
  });

  emailProviderProfileService.resolveProviderCredentials = async () => ({
    provider: 'resend',
    providerProfileId: 'EMPP_TEST',
    apiKey: 're_test_key',
    fromEmail: 'noreply@blocked.com',
    verifiedDomains: ['example.com'],
    source: 'org_profile'
  });

  resendEmailService.sendEmail = async () => ({ id: 'should-not-send' });

  await assert.rejects(
    () => emailDispatchService.sendByEvent({
      orgId: 'ORG_TEST_001',
      eventKey: 'NEWSLETTER_WELCOME',
      to: 'user@example.com'
    }),
    /not in the verified domains allowlist/i
  );
});

test('sendByEvent does not fall back to platform env credentials', async () => {
  emailManagementService.resolveTemplateForEvent = async () => ({
    from: 'noreply@example.com',
    to: ['user@example.com'],
    subject: 'Hello',
    text: 'Hi',
    html: '<p>Hi</p>',
    templateId: '',
    providerProfileId: '',
    eventKey: 'NEWSLETTER_WELCOME',
    usedFallback: true
  });

  emailProviderProfileService.resolveProviderCredentials = async () => {
    throw new Error('No default email provider profile configured for this organization.');
  };

  resendEmailService.sendEmail = async () => ({ id: 'should-not-send' });

  await assert.rejects(
    () => emailDispatchService.sendByEvent({
      orgId: 'ORG_TEST_001',
      eventKey: 'NEWSLETTER_WELCOME',
      to: 'user@example.com'
    }),
    /No default email provider profile configured/i
  );
});
