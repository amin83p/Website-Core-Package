const test = require('node:test');
const assert = require('node:assert/strict');

const emailProviderProfileRepository = require('../MVC/repositories/emailProviderProfileRepository');
const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
const emailManagementService = require('../MVC/services/emailManagementService');

const {
  mapProfileOptionRow,
  buildProviderOptionsForOrgId,
  parseSenderTemplateParts,
  composeSenderTemplate,
  validateSenderDomain
} = emailProviderProfileService.__testables || {};

const { assertTemplateProviderSenderOrThrow } = emailManagementService.__testables || {};

const originalList = emailProviderProfileRepository.list;
const originalGetById = emailProviderProfileRepository.getById;

test.after(() => {
  emailProviderProfileRepository.list = originalList;
  emailProviderProfileRepository.getById = originalGetById;
});

test('mapProfileOptionRow normalizes verified domains', () => {
  const row = mapProfileOptionRow({
    id: 'EMPP_1',
    label: 'Primary',
    verifiedDomains: ['Example.COM', 'example.com', 'school.org'],
    isDefault: true
  }, 'org');
  assert.equal(row.id, 'EMPP_1');
  assert.equal(row.label, 'Primary');
  assert.deepEqual(row.verifiedDomains, ['example.com', 'school.org']);
  assert.equal(row.source, 'org');
});

test('parseSenderTemplateParts and composeSenderTemplate round-trip simple address', () => {
  const parsed = parseSenderTemplateParts('noreply@example.com');
  assert.equal(parsed.localPart, 'noreply');
  assert.equal(parsed.domain, 'example.com');
  assert.equal(composeSenderTemplate('noreply', 'example.com'), 'noreply@example.com');
});

test('buildProviderOptionsForOrgId returns org profiles when available', async () => {
  emailProviderProfileRepository.list = async (options = {}) => {
    const orgId = String(options?.query?.orgId__eq || '').toUpperCase();
    if (orgId === 'ORG_A') {
      return [{
        id: 'EMPP_ORG',
        orgId: 'ORG_A',
        label: 'Org Resend',
        verifiedDomains: ['example.com'],
        isActive: true,
        isDefault: true
      }];
    }
    return [];
  };

  const result = await buildProviderOptionsForOrgId('ORG_A');
  assert.equal(result.source, 'org');
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].id, 'EMPP_ORG');
});

test('buildProviderOptionsForOrgId falls back to SYSTEM profiles', async () => {
  emailProviderProfileRepository.list = async (options = {}) => {
    const orgId = String(options?.query?.orgId__eq || '').toUpperCase();
    if (orgId === 'SYSTEM') {
      return [{
        id: 'EMPP_SYS',
        orgId: 'SYSTEM',
        label: 'Platform Resend',
        verifiedDomains: ['platform.test'],
        isActive: true
      }];
    }
    return [];
  };

  const result = await buildProviderOptionsForOrgId('ORG_A');
  assert.equal(result.source, 'system');
  assert.equal(result.profiles[0].id, 'EMPP_SYS');
});

test('resolveSelectableProviderProfile allows SYSTEM profile when org has none', async () => {
  emailProviderProfileRepository.getById = async () => ({
    id: 'EMPP_SYS',
    orgId: 'SYSTEM',
    label: 'Platform Resend',
    verifiedDomains: ['platform.test'],
    isActive: true
  });
  emailProviderProfileRepository.list = async () => [];

  const profile = await emailProviderProfileService.resolveSelectableProviderProfile('EMPP_SYS', 'ORG_A');
  assert.equal(profile.id, 'EMPP_SYS');
  assert.equal(profile.source, 'system');
});

test('validateSenderDomain rejects domain outside allowlist', () => {
  assert.throws(() => {
    validateSenderDomain('noreply@blocked.com', ['example.com']);
  }, /not in the verified domains allowlist/i);
});

test('assertTemplateProviderSenderOrThrow rejects invalid sender domain for selected profile', async () => {
  emailProviderProfileRepository.getById = async () => ({
    id: 'EMPP_ORG',
    orgId: 'ORG_A',
    label: 'Org Resend',
    verifiedDomains: ['example.com'],
    isActive: true
  });
  emailProviderProfileRepository.list = async () => [];

  await assert.rejects(
    () => assertTemplateProviderSenderOrThrow({
      orgId: 'ORG_A',
      providerProfileId: 'EMPP_ORG',
      senderTemplate: 'noreply@blocked.com'
    }),
    /verified domains allowlist/i
  );
});
