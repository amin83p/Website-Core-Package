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
    assert.strictEqual(adminAuthorityService.isVirtualSuperAdminAccount({ id: 'ROOT_001' }), true);
    assert.strictEqual(adminAuthorityService.isVirtualSuperAdminAccount({ id: 'SYS_ROOT_001', isVirtualSuperAdmin: false }), true);
    assert.strictEqual(adminAuthorityService.isVirtualSuperAdminAccount({ isVirtualSuperAdmin: true, id: 'USR_1' }), true);
    assert.strictEqual(
      adminAuthorityService.isSuperAdmin({
        id: '728610',
        email: 'apaknejad@equilibrium.ab.ca',
        username: 'apaknejad@equilibrium.ab.ca',
        accessLevel: 1
      }),
      false
    );
    assert.strictEqual(
      adminAuthorityService.isSuperAdmin({ id: 'ROOT_001', isVirtualSuperAdmin: true }),
      true
    );
    assert.strictEqual(
      adminAuthorityService.isSuperAdmin({ id: 'USR_10', accessLevel: 10 }),
      true
    );
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
    const catalogCacheService = require('../MVC/services/cache/sectionsOperationsCatalogCacheService');
    catalogCacheService._catalogCache.set('sections:catalog', [{
      id: '938980',
      name: 'SCHOOL_SCHEDULES',
      category: 'SCHOOL'
    }], 60_000);

    const authority = adminAuthorityService.resolveAdminAuthority({
      user: userWithProfile({
        sections: [{ sectionId: '938980', adminAccess: true }]
      }),
      sectionId: 'SCHOOL_SCHEDULES',
      operationId: 'READ_ALL',
      section: { id: 'SCHOOL_SCHEDULES', category: 'SCHOOL' }
    });
    assert.strictEqual(authority.isGrantAdminAccessForSection, true);
    assert.strictEqual(authority.isRequestAdmin, true);
    assert.strictEqual(authority.sectionId, '938980');
    assert.ok(authority.reasons.includes('SECTION_ADMIN:938980'));
    catalogCacheService.invalidateSectionsCatalog();
  }

  {
    const catalogCacheService = require('../MVC/services/cache/sectionsOperationsCatalogCacheService');
    catalogCacheService._catalogCache.set('sections:catalog', [{
      id: '332230',
      name: 'SCHOOL_STUDENTS',
      category: 'SCHOOL'
    }], 60_000);
    catalogCacheService._catalogCache.set('operations:catalog', [{
      id: 'OP1005',
      name: 'UPDATE'
    }], 60_000);

    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: userWithProfile({
        sections: [{
          sectionId: '332230',
          adminAccess: false,
          operations: [{ operationId: 'OP1005', scopeId: 'SCP_ADMIN' }]
        }]
      }),
      sectionId: 'SCHOOL_STUDENTS',
      operationId: 'UPDATE',
      section: { id: 'SCHOOL_STUDENTS', category: 'SCHOOL' }
    });
    assert.strictEqual(authority.isOperationAdminForRequest, true);
    assert.strictEqual(authority.isRequestAdmin, true);
    catalogCacheService.invalidateAllCatalogs();
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
