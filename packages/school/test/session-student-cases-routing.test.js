const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function readSchool(relativePath) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, relativePath), 'utf8');
}

function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('routing policy normalizes categories and assignees', () => {
  const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');
  const normalized = routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [
          { personId: 'PER-1', personName: 'Alex' },
          { personId: 'PER-1', personName: 'Alex Duplicate' },
          { personId: 'PER-2', personName: 'Sam' }
        ]
      },
      invalid_category: {
        active: true,
        assignees: [{ personId: 'PER-3', personName: 'Pat' }]
      }
    }
  });

  assert.equal(normalized.categories.behavior.assignees.length, 2);
  assert.equal(normalized.categories.behavior.assignees[0].personId, 'PER-1');
  assert.equal(normalized.categories.other.assignees[0].personId, 'PER-3');
});

test('isCaseRoutedToPerson matches active category assignees only', () => {
  const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');
  const policy = routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [{ personId: 'PER-1', personName: 'Alex' }]
      },
      learning: {
        active: false,
        assignees: [{ personId: 'PER-1', personName: 'Alex' }]
      }
    }
  });

  assert.equal(routingService.isCaseRoutedToPerson({ category: 'behavior' }, 'PER-1', policy), true);
  assert.equal(routingService.isCaseRoutedToPerson({ category: 'learning' }, 'PER-1', policy), false);
  assert.equal(routingService.isCaseRoutedToPerson({ category: 'behavior' }, 'PER-9', policy), false);
});

test('filterCasesByAccessScope unions routed category cases for assignment scope', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
  const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');

  const originalResolve = schoolRecordAccessService.resolveAccessFromRequest;
  const originalIsOrgWide = schoolRecordAccessService.isOrgWideScope;
  const originalIsOwned = schoolRecordAccessService.isRecordOwnedByUser;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;

  schoolRecordAccessService.resolveAccessFromRequest = () => ({
    scopeMode: 'ASSIGNMENT',
    userId: 'USR-1',
    personId: 'PER-REVIEWER'
  });
  schoolRecordAccessService.isOrgWideScope = () => false;
  schoolRecordAccessService.isRecordOwnedByUser = () => false;
  schoolDataService.fetchAllData = async () => [];
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [{ personId: 'PER-REVIEWER', personName: 'Reviewer' }]
      }
    }
  });

  delete require.cache[require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService')];
  const workspaceService = require('../MVC/services/school/sessionStudentCaseWorkspaceService');

  const rows = [
    { id: 'SSC-1', classId: 'CLS-OUT', category: 'behavior', teacherPersonId: 'TEA-OTHER' },
    { id: 'SSC-2', classId: 'CLS-OUT', category: 'learning', teacherPersonId: 'TEA-OTHER' }
  ];

  try {
    const scoped = await workspaceService.filterCasesByAccessScope({
      rows,
      req: { user: { id: 'USR-1', personId: 'PER-REVIEWER', activeOrgId: 'ORG-1' } },
      applyAccessScope: true
    });
    const ids = scoped.map((row) => row.id).sort();
    assert.deepEqual(ids, ['SSC-1']);
  } finally {
    schoolRecordAccessService.resolveAccessFromRequest = originalResolve;
    schoolRecordAccessService.isOrgWideScope = originalIsOrgWide;
    schoolRecordAccessService.isRecordOwnedByUser = originalIsOwned;
    schoolDataService.fetchAllData = originalFetchAll;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
    delete require.cache[require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService')];
  }
});

test('routed reviewer with RESOLVE can resolve without session mutation access', async () => {
  const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
  const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');
  const securityPath = require.resolve('../../../MVC/services/security/index');
  const accessPath = require.resolve('../MVC/services/school/sessionStudentCaseAccessService');

  const originalSessionAccessible = schoolRecordAccessService.isSessionAccessible;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  const originalSecurity = require.cache[securityPath];
  const originalAccess = require.cache[accessPath];

  schoolRecordAccessService.isSessionAccessible = () => false;
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [{ personId: 'PER-REVIEWER', personName: 'Reviewer' }]
      }
    }
  });

  const allowedOps = new Set(['RESOLVE', 'READ']);
  require.cache[securityPath] = {
    id: securityPath,
    filename: securityPath,
    loaded: true,
    exports: {
      evaluateAccess: async ({ operationId }) => ({ allowed: allowedOps.has(operationId) })
    }
  };
  delete require.cache[accessPath];
  const accessService = require('../MVC/services/school/sessionStudentCaseAccessService');

  try {
    const capabilities = await accessService.resolveCaseCapabilities(
      { user: { id: 'USR-1', personId: 'PER-REVIEWER', activeOrgId: 'ORG-1' }, ip: '127.0.0.1' },
      {
        classData: { id: 'CLS-1' },
        session: { sessionId: 'SES-1' },
        caseRow: { id: 'SSC-1', category: 'behavior' }
      }
    );
    assert.equal(capabilities.canRead, true);
    assert.equal(capabilities.canResolve, true);
    assert.equal(capabilities.canUpdate, false);
  } finally {
    schoolRecordAccessService.isSessionAccessible = originalSessionAccessible;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
    if (originalSecurity === undefined) delete require.cache[securityPath];
    else require.cache[securityPath] = originalSecurity;
    if (originalAccess === undefined) delete require.cache[accessPath];
    else require.cache[accessPath] = originalAccess;
  }
});

test('student case routing routes and admin gate are registered', () => {
  const routeSource = readSchool('MVC/routes/sessionStudentCaseRoutes.js');
  const guardSource = readSchool('MVC/routes/sessionStudentCaseRouteGuards.js');
  const adminSource = readSchool('MVC/services/school/schoolAdminAccessService.js');
  const listView = readSchool('MVC/views/school/sessionStudentCase/sessionStudentCaseList.ejs');
  const routingView = readSchool('MVC/views/school/sessionStudentCase/sessionStudentCaseRouting.ejs');

  assert.match(routeSource, /router\.get\('\/routing'/);
  assert.match(routeSource, /router\.post\('\/api\/routing'/);
  assert.match(routeSource, /router\.get\('\/api\/routing\/eligible-persons'/);
  assert.match(routeSource, /requireCaseRoutingAdmin/);
  assert.match(routeSource, /requireCaseSectionOperationAny\(\[OPERATIONS\.READ, OPERATIONS\.READ_ALL\]\)/);
  assert.match(guardSource, /requireCaseRoutingAdmin/);
  assert.match(guardSource, /isStudentCaseRoutingAdminViewer/);
  assert.match(adminSource, /isStudentCaseRoutingAdminViewer/);
  assert.match(adminSource, /SCHOOL_SESSION_STUDENT_CASES/);
  assert.match(adminSource, /OPERATIONS\.CONFIGURE/);
  assert.match(listView, /session-student-cases\/routing/);
  assert.match(listView, /canConfigureRouting/);
  assert.match(routingView, /studentCaseRoutingForm/);
  assert.match(routingView, /student-case-routing-pick/);
  assert.match(routingView, /showMessageModal/);
  assert.doesNotMatch(routingView, /window\.alert/);
  assert.match(readSchool('MVC/controllers/school/sessionStudentCaseController.js'), /includeModal:\s*true/);
});

test('routing policy model file path exists in package', () => {
  assert.match(
    readSchool('MVC/models/school/sessionStudentCaseRoutingPolicyModel.js'),
    /sessionStudentCaseRoutingPolicy\.json/
  );
});
