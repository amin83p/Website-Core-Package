const test = require('node:test');
const assert = require('node:assert/strict');

const emailManagementTemplateRepository = require('../MVC/repositories/emailManagementTemplateRepository');
const emailManagementService = require('../MVC/services/emailManagementService');
const adminChekersService = require('../MVC/services/adminChekersService');

const {
  buildDuplicateEventTemplateError,
  assertUniqueEventTemplateOrThrow
} = emailManagementService.__testables || {};

const originalFindTemplateByOrgAndEventKey = emailManagementTemplateRepository.findTemplateByOrgAndEventKey;
const originalListTemplates = emailManagementService.listTemplates;
const originalIsOrgAdmin = adminChekersService.isOrgAdmin;
const originalIsSuperAdmin = adminChekersService.isSuperAdmin;

test.after(() => {
  emailManagementTemplateRepository.findTemplateByOrgAndEventKey = originalFindTemplateByOrgAndEventKey;
  emailManagementService.listTemplates = originalListTemplates;
  adminChekersService.isOrgAdmin = originalIsOrgAdmin;
  adminChekersService.isSuperAdmin = originalIsSuperAdmin;
});

test('buildDuplicateEventTemplateError includes event key and existing template id', () => {
  const message = buildDuplicateEventTemplateError('AUTH_PASSWORD_RESET_CODE', {
    id: 'EMTPL_EXISTING_001'
  });
  assert.match(message, /AUTH_PASSWORD_RESET_CODE/);
  assert.match(message, /EMTPL_EXISTING_001/);
  assert.match(message, /Edit the existing template/i);
});

test('assertUniqueEventTemplateOrThrow rejects when another template owns the event', async () => {
  emailManagementTemplateRepository.findTemplateByOrgAndEventKey = async () => ({
    id: 'EMTPL_EXISTING_001',
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    orgId: 'ORG_A'
  });

  await assert.rejects(
    () => assertUniqueEventTemplateOrThrow({
      orgId: 'ORG_A',
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      excludeTemplateId: ''
    }),
    /EMTPL_EXISTING_001/
  );
});

test('assertUniqueEventTemplateOrThrow allows same template on update', async () => {
  emailManagementTemplateRepository.findTemplateByOrgAndEventKey = async (orgId, eventKey, options = {}) => {
    const row = {
      id: 'EMTPL_CURRENT',
      eventKey: 'AUTH_PASSWORD_RESET_CODE',
      orgId: 'ORG_A'
    };
    if (options.excludeId === 'EMTPL_CURRENT') return null;
    return row;
  };

  await assert.doesNotReject(() => assertUniqueEventTemplateOrThrow({
    orgId: 'ORG_A',
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    excludeTemplateId: 'EMTPL_CURRENT'
  }));
});

test('assertUniqueEventTemplateOrThrow passes when no assignment exists', async () => {
  emailManagementTemplateRepository.findTemplateByOrgAndEventKey = async () => null;

  await assert.doesNotReject(() => assertUniqueEventTemplateOrThrow({
    orgId: 'ORG_A',
    eventKey: 'AUTH_PASSWORD_RESET_CODE',
    excludeTemplateId: ''
  }));
});

test('findTemplateByOrgAndEventKey returns first match and honors excludeId', async () => {
  emailManagementTemplateRepository.findTemplateByOrgAndEventKey = originalFindTemplateByOrgAndEventKey;
  const rows = [
    { id: 'EMTPL_A', orgId: 'ORG_A', eventKey: 'AUTH_PASSWORD_RESET_CODE' },
    { id: 'EMTPL_B', orgId: 'ORG_A', eventKey: 'AUTH_PASSWORD_RESET_CODE' }
  ];
  const originalList = emailManagementTemplateRepository.list;
  emailManagementTemplateRepository.list = async () => rows;

  try {
    const found = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
      'ORG_A',
      'AUTH_PASSWORD_RESET_CODE'
    );
    assert.equal(found.id, 'EMTPL_A');

    const excluded = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
      'ORG_A',
      'AUTH_PASSWORD_RESET_CODE',
      { excludeId: 'EMTPL_A' }
    );
    assert.equal(excluded.id, 'EMTPL_B');

    const empty = await emailManagementTemplateRepository.findTemplateByOrgAndEventKey(
      '',
      'AUTH_PASSWORD_RESET_CODE'
    );
    assert.equal(empty, null);
  } finally {
    emailManagementTemplateRepository.list = originalList;
  }
});

test('getEventAssignmentsForOrg maps eventKey to template metadata', async () => {
  adminChekersService.isOrgAdmin = () => true;
  adminChekersService.isSuperAdmin = () => true;
  emailManagementService.listTemplates = async () => ({
    rows: [
      {
        id: 'EMTPL_A',
        eventKey: 'AUTH_PASSWORD_RESET_CODE',
        subjectTemplate: 'Reset your password',
        isActive: true
      },
      {
        id: 'EMTPL_B',
        eventKey: 'NEWSLETTER_WELCOME',
        subjectTemplate: 'Welcome aboard',
        isActive: false
      }
    ]
  });

  const result = await emailManagementService.getEventAssignmentsForOrg({
    id: 'USR_ADMIN',
    activeOrgId: 'SYSTEM'
  });

  assert.equal(result.orgId, 'SYSTEM');
  assert.equal(result.assignments.AUTH_PASSWORD_RESET_CODE.id, 'EMTPL_A');
  assert.equal(result.assignments.AUTH_PASSWORD_RESET_CODE.subjectTemplate, 'Reset your password');
  assert.equal(result.assignments.NEWSLETTER_WELCOME.isActive, false);
});
