const assert = require('assert');
const resolver = require('../MVC/services/security/effectiveAccessResolverService');

async function run() {
  const user = {
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      sections: [
        {
          sectionId: 'PTE_PRACTICE_BY_SKILLS',
          operations: [
            { operationId: 'CREATE', scopeId: 'SCP_OWNER' },
            { operationId: 'READ', scopeId: 'SCP_ADMIN' }
          ]
        }
      ]
    },
    activePolicy: {
      active: true,
      orgId: 'ORG_1',
      sections: [
        {
          sectionId: 'PTE_PRACTICE_BY_SKILLS',
          accessType: 'custom',
          operations: [
            { operationId: 'CREATE', accessType: 'full_ban' },
            { operationId: 'UPDATE', accessType: 'custom', scopeId: 'SCP_ADMIN' }
          ]
        }
      ]
    }
  };

  {
    const row = await resolver.resolveEffectiveAccess({
      user,
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'READ'
    });
    assert.strictEqual(row.section.allowed, true);
    assert.strictEqual(row.section.isBanned, false);
    assert.strictEqual(row.operation.allowed, true);
    assert.strictEqual(row.operation.isOperationAdmin, true);
  }

  {
    const row = await resolver.resolveEffectiveAccess({
      user: {
        id: 'U_100',
        activeOrgId: 'ORG_1',
        activeProfile: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            {
              sectionId: 'PTE_PRACTICE_BY_SKILLS',
              operations: [
                { operationId: 'READ', scopeId: 'SCP_OWNER' }
              ]
            }
          ]
        },
        activePolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            {
              sectionId: 'PTE_PRACTICE_BY_SKILLS',
              accessType: 'full_ban'
            }
          ]
        },
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            {
              sectionId: 'PTE_PRACTICE_BY_SKILLS',
              targetUserIds: ['U_100'],
              accessType: 'full_access'
            }
          ]
        }
      },
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'READ'
    });
    assert.strictEqual(row.decisionSource, 'org_policy_targeted');
    assert.strictEqual(row.section.allowed, true);
    assert.strictEqual(row.section.isSectionAdmin, true);
    assert.strictEqual(row.operation.allowed, true);
    assert.strictEqual(row.operation.isOperationAdmin, true);
  }

  {
    const row = await resolver.resolveEffectiveAccess({
      user: {
        id: 'U_200',
        activeOrgId: 'ORG_1',
        activeProfile: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            {
              sectionId: 'PTE_PRACTICE_BY_SKILLS',
              operations: [
                { operationId: 'READ', scopeId: 'SCP_ADMIN' }
              ]
            }
          ]
        },
        activePolicy: null,
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            {
              sectionId: 'PTE_PRACTICE_BY_SKILLS',
              targetUserIds: ['U_200'],
              accessType: 'custom',
              operations: [
                { operationId: 'CREATE', accessType: 'custom', scopeId: 'SCP_OWNER' }
              ]
            }
          ]
        }
      },
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'READ'
    });
    assert.strictEqual(row.decisionSource, 'org_policy_targeted');
    assert.strictEqual(row.operation.allowed, false);
    assert.strictEqual(row.operation.isBanned, false);
  }

  {
    const row = await resolver.resolveEffectiveAccess({
      user: {
        activeProfile: { active: true, orgId: 'ORG_1', sections: [] },
        activePolicy: {
          active: true,
          orgId: 'ORG_1',
          sections: [
            { sectionId: 'PTE_PRACTICE_BY_SKILLS', accessType: 'custom' }
          ]
        }
      },
      sectionId: 'PTE_PRACTICE_BY_SKILLS'
    });
    assert.strictEqual(row.section.allowed, false);
  }

  {
    const row = await resolver.resolveEffectiveAccess({
      user,
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'CREATE'
    });
    assert.strictEqual(row.operation.isBanned, true);
    assert.strictEqual(row.operation.allowed, false);
  }

  {
    const row = await resolver.resolveEffectiveAccess({
      user,
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'UPDATE'
    });
    assert.strictEqual(row.operation.allowed, true);
    assert.strictEqual(row.operation.isOperationAdmin, true);
    assert.strictEqual(row.operation.scopeId, 'SCP_ADMIN');
  }

  {
    const scope = resolver.resolvePolicySectionScopeOverrides({
      activeProfile: {
        sections: [
          { sectionId: 'D' }
        ]
      },
      activePolicy: {
        active: true,
        sections: [
          { sectionId: 'A', accessType: 'full_access' },
          { sectionId: 'B', accessType: 'custom' },
          { sectionId: 'D', accessType: 'custom', operations: [{ operationId: 'READ', accessType: 'full_ban' }] },
          { sectionId: 'E', accessType: 'custom', operations: [{ operationId: 'READ', accessType: 'custom' }] },
          { sectionId: 'C', accessType: 'full_ban' }
        ]
      }
    });
    assert.deepStrictEqual(scope.grantedSectionIds.sort(), ['A', 'D', 'E']);
    assert.deepStrictEqual(scope.bannedSectionIds.sort(), ['C']);
  }

  {
    const scope = resolver.resolvePolicySectionScopeOverrides({
      id: 'U_300',
      activeOrgId: 'ORG_1',
      activeProfile: {
        sections: [{ sectionId: 'BASE' }]
      },
      activePolicy: null,
      activeOrgPolicy: {
        active: true,
        orgId: 'ORG_1',
        sections: [
          { sectionId: 'BASE', accessType: 'full_ban', targetUserIds: ['U_300'] },
          { sectionId: 'EXTRA', accessType: 'full_access', targetUserIds: ['U_300'] }
        ]
      }
    });
    assert.deepStrictEqual(scope.grantedSectionIds.sort(), ['EXTRA']);
    assert.deepStrictEqual(scope.bannedSectionIds.sort(), ['BASE']);
  }

  {
    const globalContext = await resolver.resolveGlobalPolicyContext({
      user: {
        id: 'U_401',
        activeOrgId: 'ORG_1',
        activePolicy: {
          active: true,
          orgId: 'ORG_1',
          network: { ipWhitelist: ['10.0.0.11'] },
          sessionControl: { maxSessions: 3, maxDuration: 180, idleTimeout: 20 }
        },
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          network: { targetUserIds: ['U_401'], ipWhitelist: ['10.0.0.10'] },
          sessionControl: { targetUserIds: ['U_401'], maxSessions: 0 }
        }
      },
      orgId: 'ORG_1',
      ipAddress: '10.0.0.11',
      websitePolicy: {
        network: {},
        sessionControl: { maxSessions: 8, maxDuration: 600, idleTimeout: 60 }
      }
    });
    assert.strictEqual(globalContext.allowed, true);
    assert.strictEqual(globalContext.orgPolicy.targeted.sessionControl, true);
    assert.strictEqual(globalContext.sessionLimits.maxSessions, 0);
    assert.strictEqual(globalContext.sessionLimits.maxDurationMins, 180);
    assert.strictEqual(globalContext.sessionLimits.idleTimeoutMins, 20);
  }

  {
    const globalContext = await resolver.resolveGlobalPolicyContext({
      user: {
        id: 'U_402',
        activeOrgId: 'ORG_1',
        activePolicy: null,
        activeOrgPolicy: {
          active: true,
          orgId: 'ORG_1',
          requestControl: { targetUserIds: ['U_999'], customRoutes: [{ path: '/x', method: 'GET', enabled: true }] }
        }
      },
      orgId: 'ORG_1',
      ipAddress: '127.0.0.1',
      websitePolicy: {
        requestControl: { enabled: true, routeOverrides: [] },
        sessionControl: { maxSessions: 4, maxDuration: 100, idleTimeout: 10 }
      }
    });
    assert.strictEqual(globalContext.allowed, true);
    assert.strictEqual(globalContext.orgPolicy.targeted.requestControl, false);
    assert.strictEqual(globalContext.requestControl.orgPolicyApplied, false);
    assert.strictEqual(globalContext.requestControl.orgPolicy, null);
  }

  console.log('effective-access-resolver tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
