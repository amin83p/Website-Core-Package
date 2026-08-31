const test = require('node:test');
const assert = require('node:assert/strict');

const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
const emailProviderProfileModel = require('../MVC/models/emailProviderProfileModel');
const emailProviderProfileRepository = require('../MVC/repositories/emailProviderProfileRepository');

const {
  buildProfileContextForSave,
  extractEmailDomain,
  validateSenderDomain,
  getPlatformVerifiedDomains
} = emailProviderProfileService.__testables || {};

test('provider profile model encrypts api key and masks on read', () => {
  const normalized = emailProviderProfileModel.normalizeProfileRecord({
    orgId: 'ORG_TEST_001',
    label: 'Primary Resend',
    provider: 'resend',
    defaultFromEmail: 'noreply@example.com',
    verifiedDomains: ['example.com'],
    apiKey: 're_test_secret_key_1234',
    isActive: true,
    isDefault: true
  }, null, true);

  assert.ok(normalized.apiKeyEncrypted);
  assert.ok(normalized.apiKeyHint);
  assert.equal(normalized.apiKeyEncrypted.includes(':'), true);

  const sanitized = emailProviderProfileModel.sanitizeProfileForRead(normalized);
  assert.equal(sanitized.hasApiKey, true);
  assert.ok(sanitized.apiKeyMasked);
  assert.equal(sanitized.apiKeyEncrypted, undefined);
});

test('buildProfileContextForSave normalizes verified domains input', () => {
  const out = buildProfileContextForSave({
    label: 'Org Resend',
    verifiedDomains: 'example.com, school.org',
    apiKey: 'secret'
  }, 'ORG_TEST_001');
  assert.deepEqual(out.verifiedDomains, ['example.com', 'school.org']);
  assert.equal(out.orgId, 'ORG_TEST_001');
});

test('validateSenderDomain rejects unverified sender domain', () => {
  assert.throws(() => {
    validateSenderDomain('noreply@blocked.com', ['example.com']);
  }, /not in the verified domains allowlist/i);
});

test('validateSenderDomain allows matching domain', () => {
  assert.doesNotThrow(() => {
    validateSenderDomain('Team <noreply@example.com>', ['example.com']);
  });
});

test('extractEmailDomain parses angle-bracket addresses', () => {
  assert.equal(extractEmailDomain('App <noreply@school.org>'), 'school.org');
});

test('resolveProviderCredentials throws when org default profile is missing', async () => {
  const originalGetDefaultProfile = emailProviderProfileRepository.getDefaultProfile;
  emailProviderProfileRepository.getDefaultProfile = async () => null;
  try {
    await assert.rejects(
      () => emailProviderProfileService.resolveProviderCredentials('ORG_MISSING', ''),
      /No default email provider profile configured/i
    );
  } finally {
    emailProviderProfileRepository.getDefaultProfile = originalGetDefaultProfile;
  }
});

test('getPlatformVerifiedDomains reads explicit env domain list', () => {
  const originalList = process.env.RESEND_VERIFIED_DOMAINS;
  process.env.RESEND_VERIFIED_DOMAINS = 'example.com, school.org';
  try {
    const domains = getPlatformVerifiedDomains();
    assert.deepEqual(domains, ['example.com', 'school.org']);
  } finally {
    if (originalList === undefined) delete process.env.RESEND_VERIFIED_DOMAINS;
    else process.env.RESEND_VERIFIED_DOMAINS = originalList;
  }
});

test('getPlatformVerifiedDomains returns empty when only RESEND_FROM_EMAIL is set', () => {
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  const originalList = process.env.RESEND_VERIFIED_DOMAINS;
  delete process.env.RESEND_VERIFIED_DOMAINS;
  process.env.RESEND_FROM_EMAIL = 'noreply@platform.test';
  try {
    const domains = getPlatformVerifiedDomains();
    assert.deepEqual(domains, []);
  } finally {
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
    if (originalList === undefined) delete process.env.RESEND_VERIFIED_DOMAINS;
    else process.env.RESEND_VERIFIED_DOMAINS = originalList;
  }
});
