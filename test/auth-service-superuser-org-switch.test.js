const test = require('node:test');
const assert = require('node:assert/strict');

const authService = require('../MVC/services/authService');
const dataService = require('../MVC/services/dataService');

function withDataServiceStubs(stubs, fn) {
  const originals = new Map();
  Object.entries(stubs).forEach(([key, value]) => {
    originals.set(key, dataService[key]);
    dataService[key] = value;
  });

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      originals.forEach((value, key) => {
        dataService[key] = value;
      });
    });
}

test('getUserFromToken marks active organizations selectable for system-profile users without contracts', async () => {
  const loginUser = {
    id: 'USR_SYS_1',
    username: 'system.user',
    email: 'system.user@example.com',
    accessLevel: 'admin',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: false,
    systemAccessProfileId: 'ACP_SYSTEM',
    primaryOrgId: 'SYSTEM',
    organizations: []
  };

  const token = authService.generateToken({
    id: loginUser.id,
    username: loginUser.username,
    accessLevel: loginUser.accessLevel
  }, 60);

  await withDataServiceStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'users' && id === loginUser.id) return { ...loginUser };
      if (entityType === 'accesses' && id === 'ACP_SYSTEM') {
        return { id: 'ACP_SYSTEM', active: true, fullAdmin: true, adminCategories: [] };
      }
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'organizations') {
        return [
          { id: 'ORG_ALPHA', active: true, identity: { displayName: 'Org Alpha' } },
          { id: 'ORG_BETA', active: true, identity: { displayName: 'Org Beta' } }
        ];
      }
      return [];
    },
    OrgHasActiveContract: async () => false,
    updateData: async () => ({})
  }, async () => {
    const userContext = await authService.getUserFromToken(token);
    const alpha = (userContext.allowedOrgs || []).find((org) => String(org.orgId) === 'ORG_ALPHA');
    const beta = (userContext.allowedOrgs || []).find((org) => String(org.orgId) === 'ORG_BETA');

    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(alpha.isSelectable, true);
    assert.equal(beta.isSelectable, true);
    assert.equal(String(alpha.switchDisabledReason || '').trim(), '');
  });
});

test('switchOrganization allows system-profile users to enter active organizations without contracts', async () => {
  const loginUser = {
    id: 'USR_SYS_2',
    username: 'system.switch',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: false,
    systemAccessProfileId: 'ACP_SYSTEM',
    organizations: []
  };

  const updates = [];

  await withDataServiceStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'users' && id === loginUser.id) return { ...loginUser };
      if (entityType === 'organizations' && id === 'ORG_SWITCH') return { id: 'ORG_SWITCH', active: true };
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'userMemberships') return [];
      return [];
    },
    OrgHasActiveContract: async () => false,
    updateData: async (entityType, id, payload) => {
      updates.push({ entityType, id, payload });
      return { id, ...payload };
    }
  }, async () => {
    const result = await authService.switchOrganization(loginUser.id, 'ORG_SWITCH', null);
    assert.equal(result.success, true);
    assert.equal(updates.length > 0, true);
    assert.equal(String(updates[0].payload.primaryOrgId || ''), 'ORG_SWITCH');
  });
});

test('switchOrganization keeps non-superusers contract-gated', async () => {
  const loginUser = {
    id: 'USR_LOCAL_1',
    username: 'local.user',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: false,
    systemAccessProfileId: '',
    personId: 'PER_LOCAL_1',
    organizations: [{ orgId: 'ORG_LOCAL', memberStatus: 'active' }]
  };

  await withDataServiceStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'users' && id === loginUser.id) return { ...loginUser };
      if (entityType === 'organizations' && id === 'ORG_LOCAL') return { id: 'ORG_LOCAL', active: true };
      if (entityType === 'persons' && id === 'PER_LOCAL_1') return { id: 'PER_LOCAL_1', organizations: [] };
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'userMemberships') return [];
      return [];
    },
    OrgHasActiveContract: async () => false,
    updateData: async () => ({})
  }, async () => {
    const result = await authService.switchOrganization(loginUser.id, 'ORG_LOCAL', null);
    assert.equal(result.success, false);
    assert.match(String(result.message || ''), /no active subscription\/contract/i);
  });
});

test('switchOrganization still blocks inactive organizations for superusers', async () => {
  const loginUser = {
    id: 'USR_ROOT_1',
    username: 'root.user',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: true,
    systemAccessProfileId: '',
    organizations: []
  };

  await withDataServiceStubs({
    getDataById: async (entityType, id) => {
      if (entityType === 'users' && id === loginUser.id) return { ...loginUser };
      if (entityType === 'organizations' && id === 'ORG_INACTIVE') return { id: 'ORG_INACTIVE', active: false };
      return null;
    },
    fetchData: async () => [],
    OrgHasActiveContract: async () => false,
    updateData: async () => ({})
  }, async () => {
    const result = await authService.switchOrganization(loginUser.id, 'ORG_INACTIVE', null);
    assert.equal(result.success, false);
    assert.match(String(result.message || ''), /organization is inactive/i);
  });
});
