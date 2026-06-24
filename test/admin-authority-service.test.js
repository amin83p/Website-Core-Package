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

  {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({ adminCategories: ['SCHOOL'] }),
      sectionId: '445568',
      operationId: 'READ_ALL'
    });
    assert.strictEqual(authority.category, 'SCHOOL');
    assert.strictEqual(authority.isCategoryAdminForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({ adminCategories: [{ name: 'school' }] }),
      sectionId: '445568',
      operationId: 'READ_ALL'
    });
    assert.strictEqual(authority.category, 'SCHOOL');
    assert.strictEqual(authority.isCategoryAdminForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
  }

  {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({ orgId: 'ORG_2', adminCategories: ['SCHOOL'] }),
      sectionId: '445568',
      orgId: 'ORG_1',
      operationId: 'READ_ALL'
    });
    assert.strictEqual(authority.category, 'SCHOOL');
    assert.strictEqual(authority.isCategoryAdminForSection, false);
    assert.strictEqual(authority.isRequestAdmin, false);
  }

  {
    assert.strictEqual(adminAuthorityService.isAdmin(userWithProfile({ adminCategories: ['SCHOOL'] })), false);
  }

  for (const scenario of [
    { category: 'SCHOOL', sectionId: '445568' },
    { category: 'PTE', sectionId: '930102' },
    { category: 'IELTS', sectionId: '669513' },
    { category: 'BENCHPATH', sectionId: '775113' },
    { category: 'CREDIT_LOANS', sectionId: '774671' }
  ]) {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({ adminCategories: [scenario.category.toLowerCase()] }),
      sectionId: scenario.sectionId,
      orgId: 'ORG_1',
      operationId: 'READ_ALL'
    });
    assert.strictEqual(authority.category, scenario.category);
    assert.strictEqual(authority.isCategoryAdminForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);

    const helperResult = await adminAuthorityService.isAdminForRequestAsync(
      userWithProfile({ adminCategories: [{ value: scenario.category }] }),
      scenario.sectionId,
      'READ_ALL',
      { orgId: 'ORG_1' }
    );
    assert.strictEqual(helperResult, true);

    const contextHelperResult = adminAuthorityService.isAdmin(
      userWithProfile({ adminCategories: [scenario.category] }),
      {
        sectionId: scenario.sectionId,
        operationId: 'READ_ALL',
        orgId: 'ORG_1',
        section: { id: scenario.sectionId, category: scenario.category }
      }
    );
    assert.strictEqual(contextHelperResult, true);
  }
  {
    const policy = {
      active: true,
      orgId: 'ORG_1',
      sections: [
        { sectionId: '445568', accessType: 'full_ban' }
      ]
    };
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({ adminCategories: ['SCHOOL'] }, policy),
      sectionId: '445568',
      orgId: 'ORG_1',
      operationId: 'READ_ALL'
    });
    assert.strictEqual(authority.category, 'SCHOOL');
    assert.strictEqual(authority.isCategoryAdminForSection, false);
    assert.strictEqual(authority.isRequestAdmin, false);
  }
  console.log('admin-authority-service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
