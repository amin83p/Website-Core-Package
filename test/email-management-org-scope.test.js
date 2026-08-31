const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActiveOrgEmailScope,
  buildEmailManagementTemplateScope,
  buildEmailProviderProfileScope
} = require('../MVC/services/security/dataScopeBuilder');
const emailLedgerRepository = require('../MVC/repositories/emailLedgerRepository');
const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');
const emailManagementService = require('../MVC/services/emailManagementService');
const emailManagementTemplateRepository = require('../MVC/repositories/emailManagementTemplateRepository');
const dataService = require('../MVC/services/dataService');
const adminChekersService = require('../MVC/services/adminChekersService');
const {
  resolveEmailManagementOrgContext,
  canManageEmailManagementInActiveOrg
} = require('../MVC/utils/emailTemplateOrgContext');

const originalAddData = dataService.addData;
const originalIsSuperAdmin = adminChekersService.isSuperAdmin;
const originalIsOrgAdmin = adminChekersService.isOrgAdmin;
const originalLedgerList = emailLedgerRepository.list;
const originalTemplateRepoList = emailManagementTemplateRepository.list;
const originalListTemplates = emailManagementService.listTemplates;
const originalGetDefinitions = emailManagementService.getAccessibleEventDefinitions;

test.after(() => {
  dataService.addData = originalAddData;
  adminChekersService.isSuperAdmin = originalIsSuperAdmin;
  adminChekersService.isOrgAdmin = originalIsOrgAdmin;
  emailLedgerRepository.list = originalLedgerList;
  emailManagementTemplateRepository.list = originalTemplateRepoList;
  emailManagementService.listTemplates = originalListTemplates;
  emailManagementService.getAccessibleEventDefinitions = originalGetDefinitions;
});

test('buildActiveOrgEmailScope pins super admin to active org only', () => {
  const scope = buildActiveOrgEmailScope({
    id: 'ROOT_001',
    isVirtualSuperAdmin: true,
    activeOrgId: '900000'
  });
  assert.deepEqual(scope, { canViewAll: false, orgIds: ['900000'] });
});

test('buildEmailManagementTemplateScope and provider scope use active org', () => {
  const user = { id: 'USR_1', activeOrgId: 'ORG_A' };
  assert.deepEqual(buildEmailManagementTemplateScope(user), { canViewAll: false, orgIds: ['ORG_A'] });
  assert.deepEqual(buildEmailProviderProfileScope(user), { canViewAll: false, orgIds: ['ORG_A'] });
});

test('email ledger repository scopes to active org for super admin', async () => {
  let capturedScope = null;
  emailLedgerRepository.list = async ({ scope } = {}) => {
    capturedScope = scope;
    return [];
  };
  adminChekersService.isOrgAdmin = () => true;
  emailLedgerRepository.count = async () => 0;

  const emailLedgerService = require('../MVC/services/emailLedgerService');
  await emailLedgerService.listEntries({}, {
    id: 'ROOT_001',
    isVirtualSuperAdmin: true,
    activeOrgId: '900000'
  });

  assert.deepEqual(capturedScope, { canViewAll: false, orgIds: ['900000'] });
});

test('resolveEmailManagementOrgContext allows SYSTEM for super admin', async () => {
  adminChekersService.isSuperAdmin = () => true;
  const orgId = await resolveEmailManagementOrgContext(
    { id: 'ROOT_001', activeOrgId: 'SYSTEM' },
    { scopeLabel: 'email provider profiles' }
  );
  assert.equal(orgId, 'SYSTEM');
});

test('resolveEmailManagementOrgContext rejects SYSTEM for non-super-admin', async () => {
  adminChekersService.isSuperAdmin = () => false;
  await assert.rejects(
    () => resolveEmailManagementOrgContext(
      { id: 'USR_1', activeOrgId: 'SYSTEM' },
      { scopeLabel: 'email provider profiles' }
    ),
    /Only platform administrators/i
  );
});

test('canManageEmailManagementInActiveOrg is true for super admin in SYSTEM mode', async () => {
  adminChekersService.isSuperAdmin = () => true;
  const canManage = await canManageEmailManagementInActiveOrg(
    { id: 'ROOT_001', activeOrgId: 'SYSTEM' },
    { scopeLabel: 'email provider profiles' }
  );
  assert.equal(canManage, true);
});

test('createProfile succeeds in SYSTEM mode for super admin', async () => {
  adminChekersService.isOrgAdmin = () => true;
  adminChekersService.isSuperAdmin = () => true;
  let captured = null;
  dataService.addData = async (entity, payload) => {
    captured = { entity, payload };
    return { id: 'EMPP_TEST', ...payload };
  };

  const created = await emailProviderProfileService.createProfile({
    label: 'Platform Resend',
    apiKey: 're_test_key',
    defaultFromEmail: 'noreply@example.com',
    verifiedDomains: 'example.com'
  }, { id: 'ROOT_001', activeOrgId: 'SYSTEM' });

  assert.equal(created.orgId, 'SYSTEM');
  assert.equal(captured.entity, 'emailProviderProfiles');
  assert.equal(captured.payload.orgId, 'SYSTEM');
});

test('listEventRoutingCoverage includes SYSTEM template metadata for org admin', async () => {
  adminChekersService.isOrgAdmin = () => true;
  adminChekersService.isSuperAdmin = () => false;

  emailManagementService.listTemplates = async () => ({ rows: [] });
  emailManagementService.getAccessibleEventDefinitions = async () => ([
    {
      eventKey: 'NEWSLETTER_WELCOME',
      label: 'Newsletter Welcome',
      sectionId: 'NEWSLETTER',
      operationId: 'SUBSCRIBE',
      packageName: 'CORE'
    }
  ]);
  emailManagementTemplateRepository.list = async () => ([
    {
      id: 'EMTPL_SYS',
      eventKey: 'NEWSLETTER_WELCOME',
      subjectTemplate: 'Welcome to the platform',
      orgId: 'SYSTEM',
      isActive: true
    }
  ]);

  const result = await emailManagementService.listEventRoutingCoverage({}, {
    id: 'USR_1',
    activeOrgId: '900000'
  });

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const match = rows.find((row) => row.eventKey === 'NEWSLETTER_WELCOME');
  assert.ok(match);
  assert.equal(match.effectiveRoute, 'system_default');
  assert.equal(match.systemTemplateSubject, 'Welcome to the platform');
});
