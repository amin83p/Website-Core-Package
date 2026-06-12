const test = require('node:test');
const assert = require('node:assert/strict');

const delegation = require('../MVC/services/security/delegation');
const accessRepository = require('../MVC/repositories/accessRepository');
const scopeRepository = require('../MVC/repositories/scopeRepository');

async function withStub(target, methodName, replacement, fn) {
  const original = target[methodName];
  target[methodName] = replacement;
  try {
    return await fn();
  } finally {
    target[methodName] = original;
  }
}

test('validateDelegation loads target and modifier profiles in target org scope', async () => {
  const calls = [];
  const profiles = new Map([
    ['TARGET_PROFILE', {
      id: 'TARGET_PROFILE',
      orgId: '900000',
      sections: [{
        sectionId: 'SCHOOL_STUDENTS',
        operations: [{ operationId: 'OP1002', scopeId: 'SCP_OWNER' }]
      }]
    }],
    ['MODIFIER_PROFILE', {
      id: 'MODIFIER_PROFILE',
      orgId: '900000',
      sections: [{
        sectionId: 'SCHOOL_STUDENTS',
        operations: [{ operationId: 'OP1002', scopeId: 'SCP_ORG' }]
      }]
    }]
  ]);

  await withStub(accessRepository, 'list', async (options = {}) => {
    calls.push(options);
    const id = options?.query?.id__eq;
    const row = profiles.get(id);
    return row ? [row] : [];
  }, async () => {
    await withStub(scopeRepository, 'list', async () => [
      { id: 'SCP_OWNER', level: 1 },
      { id: 'SCP_ORG', level: 2 }
    ], async () => {
      const result = await delegation.validateDelegation({
        id: 'ADMIN_1',
        activeOrgId: 'OTHER_ORG',
        allowedOrgs: [{
          orgId: '900000',
          accessProfileIds: ['MODIFIER_PROFILE']
        }]
      }, 'TARGET_PROFILE', '900000');

      assert.equal(result.allowed, true);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls.map((call) => call.scope?.orgId), ['900000', '900000']);
    });
  });
});
