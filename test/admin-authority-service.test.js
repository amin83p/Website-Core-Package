const assert = require('assert');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');

function userWithProfile(profile, policy = null) {
  return {
    id: 'USER_1',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      fullAdmin: false,
      adminCategories: [],
      sections: [],
      ...profile
    },
    activePolicy: policy
  };
}

async function run() {
  const section = { id: 'PTE_QUESTIONS_BANK', category: 'PTE' };

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: { isVirtualSuperAdmin: true },
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isSuperAdmin, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({ fullAdmin: true }),
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isSystemAdmin, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({ adminCategories: ['PTE'] }),
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isCategoryAdminForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{ sectionId: section.id, adminAccess: true }]
      }),
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{ id: section.id, adminAccess: 'true' }]
      }),
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{
          sectionId: section.id,
          adminAccess: false,
          operations: [
            { operationId: 'UPDATE', scopeId: 'SCP_ADMIN' },
            { operationId: 'READ', scopeId: 'SCP_OWNER' }
          ]
        }]
      }),
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isOperationAdminForRequest, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({
        sections: [{
          sectionId: section.id,
          adminAccess: false,
          operations: [
            { operationId: 'UPDATE', accessType: 'custom', scopeId: 'SCP_ADMIN' }
          ]
        }]
      }),
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isOperationAdminForRequest, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const policy = {
      active: true,
      orgId: 'ORG_1',
      sections: [
        { sectionId: section.id, accessType: 'full_ban' }
      ]
    };
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{ sectionId: section.id, adminAccess: true }]
      }, policy),
      sectionId: section.id,
      operationId: 'UPDATE',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, false);
    assert.strictEqual(authority.isOperationAdminForRequest, false);
  }

  {
    const policy = {
      active: true,
      orgId: 'ORG_1',
      sections: [
        { sectionId: section.id, accessType: 'full_access' }
      ]
    };
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({ sections: [] }, policy),
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const policy = {
      active: true,
      orgId: 'ORG_1',
      sections: [
        {
          sectionId: section.id,
          accessType: 'custom',
          operations: [
            { operationId: 'READ', accessType: 'full_ban' }
          ]
        }
      ]
    };
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{
          sectionId: section.id,
          operations: [{ operationId: 'READ', scopeId: 'SCP_ADMIN' }]
        }]
      }, policy),
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isOperationAdminForRequest, false);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: {
        ...userWithProfile({ sections: [] }),
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            { sectionId: section.id, accessType: 'full_access', targetUserIds: ['USER_1'] }
          ]
        }
      },
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = adminAuthorityService.resolveAdminAuthority({
      user: {
        ...userWithProfile({
          sections: [{ sectionId: section.id, adminAccess: true }]
        }),
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            { sectionId: section.id, accessType: 'full_ban', targetUserIds: ['USER_1'] }
          ]
        }
      },
      sectionId: section.id,
      operationId: 'READ',
      section
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, false);
    assert.strictEqual(authority.isOperationAdminForRequest, false);
  }

  console.log('admin-authority-service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
