const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const schoolAiUsageLimitService = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiUsageLimitService'));
const limitDataSvc = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiUserUsageLimitDataService'));
const assignmentDs = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiServiceAssignmentDataService'));
const providerDs = require(path.join(ROOT, 'packages/school/MVC/services/school/schoolAiProviderDataService'));

const SERVICE_KEY = 'school.word_of_day_autofill';

function stubRoutingConfigured() {
  const origAssignment = assignmentDs.getAssignmentForService;
  const origProvider = providerDs.getRawProviderById;
  assignmentDs.getAssignmentForService = async () => ({
    providerRecordId: 'PROV1',
    modelEntryId: 'MOD1',
    isActive: true
  });
  providerDs.getRawProviderById = async () => ({
    id: 'PROV1',
    isActive: true,
    models: [{ id: 'MOD1', modelId: 'gemini-test', isActive: true }]
  });
  return () => {
    assignmentDs.getAssignmentForService = origAssignment;
    providerDs.getRawProviderById = origProvider;
  };
}

test('super admin bypasses evaluateServiceAccess without usage limit rows', async () => {
  const restoreRouting = stubRoutingConfigured();
  const original = limitDataSvc.listActiveLimitsForUser;
  limitDataSvc.listActiveLimitsForUser = async () => [];
  try {
    const gate = await schoolAiUsageLimitService.evaluateServiceAccess({
      orgId: '900000',
      userId: 'ROOT_001',
      serviceKey: SERVICE_KEY,
      requestingUser: { id: 'ROOT_001', activeOrgId: '900000', isSuperAdmin: true }
    });
    assert.strictEqual(gate.allowed, true);
    assert.strictEqual(gate.superAdminBypass, true);
    assert.strictEqual(gate.hasAssignedLimit, true);
  } finally {
    limitDataSvc.listActiveLimitsForUser = original;
    restoreRouting();
  }
});

test('super admin can open AI UI when service has no provider assignment', async () => {
  const originalAssignment = assignmentDs.getAssignmentForService;
  assignmentDs.getAssignmentForService = async () => null;
  try {
    const gate = await schoolAiUsageLimitService.evaluateServiceAccess({
      orgId: '900000',
      userId: 'ROOT_001',
      serviceKey: SERVICE_KEY,
      requestingUser: { id: 'ROOT_001', activeOrgId: '900000', isSuperAdmin: true }
    });
    assert.strictEqual(gate.allowed, true);
    assert.strictEqual(gate.serviceAssignmentConfigured, false);
    assert.match(gate.serviceAssignmentMessage, /Service assignments/i);
  } finally {
    assignmentDs.getAssignmentForService = originalAssignment;
  }
});

test('normal user still denied when no usage limit assigned', async () => {
  const restoreRouting = stubRoutingConfigured();
  const original = limitDataSvc.listActiveLimitsForUser;
  limitDataSvc.listActiveLimitsForUser = async () => [];
  try {
    const gate = await schoolAiUsageLimitService.evaluateServiceAccess({
      orgId: '900000',
      userId: '646044',
      serviceKey: SERVICE_KEY,
      requestingUser: { id: '646044', activeOrgId: '900000', accessLevel: 3 }
    });
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.code, 'AI_USAGE_LIMIT_NOT_ASSIGNED');
    assert.notEqual(gate.superAdminBypass, true);
  } finally {
    limitDataSvc.listActiveLimitsForUser = original;
    restoreRouting();
  }
});

test('Family A style admin without super admin flag still requires usage limit', async () => {
  const restoreRouting = stubRoutingConfigured();
  const original = limitDataSvc.listActiveLimitsForUser;
  limitDataSvc.listActiveLimitsForUser = async () => [];
  try {
    const gate = await schoolAiUsageLimitService.evaluateServiceAccess({
      orgId: '900000',
      userId: 'ADMIN_01',
      serviceKey: SERVICE_KEY,
      requestingUser: {
        id: 'ADMIN_01',
        activeOrgId: '900000',
        accessLevel: 5,
        isSuperAdmin: false,
        activeProfile: { fullAdmin: true }
      }
    });
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.code, 'AI_USAGE_LIMIT_NOT_ASSIGNED');
  } finally {
    limitDataSvc.listActiveLimitsForUser = original;
    restoreRouting();
  }
});

test('super admin assertWithinLimit does not throw without limits', async () => {
  const original = limitDataSvc.listActiveLimitsForUser;
  limitDataSvc.listActiveLimitsForUser = async () => [
    {
      appliesTo: SERVICE_KEY,
      periodType: 'weekly',
      maxTotalTokens: 0,
      maxRequestCount: 0,
      isActive: true
    }
  ];
  try {
    await schoolAiUsageLimitService.assertWithinLimit({
      orgId: '900000',
      userId: 'ROOT_001',
      serviceKey: SERVICE_KEY,
      requestingUser: { id: 'ROOT_001', activeOrgId: '900000', isSuperAdmin: true }
    });
  } finally {
    limitDataSvc.listActiveLimitsForUser = original;
  }
});