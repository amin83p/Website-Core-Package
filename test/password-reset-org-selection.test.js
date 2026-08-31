const test = require('node:test');
const assert = require('node:assert/strict');

const userOrgAccessService = require('../MVC/services/userOrgAccessService');
const emailOrgCapabilityService = require('../MVC/services/emailOrgCapabilityService');
const passwordResetOrgService = require('../MVC/services/passwordResetOrgService');
const emailManagementService = require('../MVC/services/emailManagementService');
const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
const contactNotificationService = require('../MVC/services/contactNotificationService');
const settingService = require('../MVC/services/settingService');

const originalListActiveOrgs = userOrgAccessService.listActiveMemberOrganizationsForUser;
const originalCanOrgSendEmail = emailOrgCapabilityService.canOrgSendEmail;
const originalResolveTemplateForEvent = emailManagementService.resolveTemplateForEvent;
const originalResolveProviderCredentials = emailProviderProfileService.resolveProviderCredentials;
const originalGetValue = settingService.getValue;

test.after(() => {
  userOrgAccessService.listActiveMemberOrganizationsForUser = originalListActiveOrgs;
  emailOrgCapabilityService.canOrgSendEmail = originalCanOrgSendEmail;
  emailManagementService.resolveTemplateForEvent = originalResolveTemplateForEvent;
  emailProviderProfileService.resolveProviderCredentials = originalResolveProviderCredentials;
  settingService.getValue = originalGetValue;
});

test('listEligibleResetOrgsForUser returns only orgs that can send reset email', async () => {
  userOrgAccessService.listActiveMemberOrganizationsForUser = async () => ([
    { orgId: 'ORG_A', name: 'Alpha School' },
    { orgId: 'ORG_B', name: 'Beta School' },
    { orgId: 'ORG_C', name: 'Gamma School' }
  ]);
  const canSendMock = async (orgId) => orgId === 'ORG_A' || orgId === 'ORG_C';
  emailOrgCapabilityService.canOrgSendEmail = canSendMock;

  const eligible = await passwordResetOrgService.listEligibleResetOrgsForUser({ id: 'USR_1' });
  assert.deepEqual(eligible, [
    { orgId: 'ORG_A', name: 'Alpha School' },
    { orgId: 'ORG_C', name: 'Gamma School' }
  ]);
  emailOrgCapabilityService.canOrgSendEmail = originalCanOrgSendEmail;
});

test('listEligibleResetOrgsForUser returns empty when no org can send email', async () => {
  userOrgAccessService.listActiveMemberOrganizationsForUser = async () => ([
    { orgId: 'ORG_A', name: 'Alpha School' }
  ]);
  emailOrgCapabilityService.canOrgSendEmail = async () => false;

  const eligible = await passwordResetOrgService.listEligibleResetOrgsForUser({ id: 'USR_1' });
  assert.deepEqual(eligible, []);
  emailOrgCapabilityService.canOrgSendEmail = originalCanOrgSendEmail;
});

test('canOrgSendEmail returns true when provider and template resolve', async () => {
  emailProviderProfileService.resolveProviderCredentials = async () => ({
    provider: 'resend',
    providerProfileId: 'EMPP_TEST',
    apiKey: 're_test_key',
    fromEmail: 'noreply@example.com',
    verifiedDomains: ['example.com'],
    source: 'org_profile'
  });
  emailManagementService.resolveTemplateForEvent = async () => ({
    from: 'noreply@example.com',
    to: ['user@example.com'],
    subject: 'Reset',
    text: '123456',
    html: '<p>123456</p>',
    templateId: 'EMTPL_TEST',
    providerProfileId: 'EMPP_TEST'
  });

  const canSend = await emailOrgCapabilityService.canOrgSendEmail('ORG_A', {
    eventKey: 'AUTH_PASSWORD_RESET_CODE'
  });
  assert.equal(canSend, true);
});

test('canOrgSendEmail returns false when provider profile is missing', async () => {
  emailProviderProfileService.resolveProviderCredentials = async () => {
    throw new Error('No default email provider profile configured for this organization.');
  };

  const canSend = await emailOrgCapabilityService.canOrgSendEmail('ORG_A', {
    eventKey: 'AUTH_PASSWORD_RESET_CODE'
  });
  assert.equal(canSend, false);
});

test('getContactNotifyRecipients prefers persisted settings over env', () => {
  const originalEnv = process.env.RESEND_CONTACT_TO;
  process.env.RESEND_CONTACT_TO = 'legacy@example.com';
  settingService.getValue = (section, key) => {
    if (section === 'contact' && key === 'notifyRecipients') return 'ops@example.com, alerts@example.com';
    return '';
  };

  try {
    const recipients = contactNotificationService.getContactNotifyRecipients();
    assert.deepEqual(recipients, ['ops@example.com', 'alerts@example.com']);
  } finally {
    settingService.getValue = originalGetValue;
    if (originalEnv === undefined) delete process.env.RESEND_CONTACT_TO;
    else process.env.RESEND_CONTACT_TO = originalEnv;
  }
});
