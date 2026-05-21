const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

function setRequireStub(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

async function withStubbedBootstrapService({ backendStatus, counts }, callback) {
  const servicePath = require.resolve('../MVC/services/firstRunBootstrapService');
  const originals = new Map();
  if (!originals.has(servicePath)) originals.set(servicePath, require.cache[servicePath]);
  delete require.cache[servicePath];

  setRequireStub('../MVC/services/dataBackendRuntimeService', {
    getPublicBackendStatus() {
      return backendStatus || {};
    }
  }, originals);

  setRequireStub('../MVC/services/dataService', {
    async fetchData(entityName) {
      const size = Number((counts || {})[entityName] || 0);
      return Array.from({ length: size }, (_item, index) => ({ id: `${entityName}-${index + 1}` }));
    }
  }, originals);

  try {
    const service = require('../MVC/services/firstRunBootstrapService');
    return await callback(service);
  } finally {
    delete require.cache[servicePath];
    originals.forEach((original, resolved) => {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    });
  }
}

function makeRenderResponse() {
  return {
    statusCode: 200,
    rendered: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    }
  };
}

async function withStubbedAccessMiddleware({ bootstrapBypassAllowed, evaluationAllowed }, callback) {
  const middlewarePath = require.resolve('../MVC/middleware/accessMiddleware');
  const originals = new Map();
  if (!originals.has(middlewarePath)) originals.set(middlewarePath, require.cache[middlewarePath]);
  delete require.cache[middlewarePath];

  setRequireStub('../MVC/services/firstRunBootstrapService', {
    async isBypassAllowed() {
      return Boolean(bootstrapBypassAllowed);
    },
    async resolveUserBootstrapContext() {
      return {
        bypassEnabled: Boolean(bootstrapBypassAllowed)
      };
    },
    isBypassSection(sectionId) {
      return String(sectionId || '').toUpperCase() === 'USERS';
    }
  }, originals);

  setRequireStub('../MVC/services/security/index', {
    async evaluateAccess() {
      if (evaluationAllowed) return { allowed: true, limits: {}, scopeId: 'SYSTEM' };
      return { allowed: false, reason: 'Denied in test', deniedCode: 'DENIED' };
    }
  }, originals);

  try {
    const middleware = require('../MVC/middleware/accessMiddleware');
    return await callback(middleware);
  } finally {
    delete require.cache[middlewarePath];
    originals.forEach((original, resolved) => {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    });
  }
}

test('first-run bootstrap is active when Mongo is requested and core registries are missing', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 1, operations: 0, accesses: 0 }
  }, async (service) => {
    const context = await service.resolveUserBootstrapContext({
      isVirtualSuperAdmin: false,
      systemAccessProfileId: 'ACP1001'
    }, { forceRefresh: true });

    assert.equal(context.mongoRequested, true);
    assert.equal(context.active, true);
    assert.equal(context.eligible, true);
    assert.equal(context.bypassEnabled, true);
    assert.deepEqual(context.missingKeys.sort(), ['accesses', 'operations']);
  });
});

test('first-run bootstrap auto-disables after prerequisites exist', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 4, operations: 8, accesses: 2 }
  }, async (service) => {
    const context = await service.resolveUserBootstrapContext({
      isVirtualSuperAdmin: true
    }, { forceRefresh: true });

    assert.equal(context.active, false);
    assert.equal(context.ready, true);
    assert.equal(context.bypassEnabled, false);
    assert.deepEqual(context.missingLabels, []);
  });
});

test('system admin flag is treated as bootstrap-eligible even without systemAccessProfileId', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 0, operations: 0, accesses: 0 }
  }, async (service) => {
    const context = await service.resolveUserBootstrapContext({
      isSystemAdmin: true
    }, { forceRefresh: true });
    assert.equal(context.eligible, true);
    assert.equal(context.bypassEnabled, true);
  });
});

test('profile-switch-capable system users are bootstrap-eligible in local mode', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 0, operations: 0, accesses: 0 }
  }, async (service) => {
    const context = await service.resolveUserBootstrapContext({
      canSwitchProfile: true,
      currentProfileMode: 'LOCAL'
    }, { forceRefresh: true });
    assert.equal(context.eligible, true);
    assert.equal(context.bypassEnabled, true);
  });
});

test('system context users are bootstrap-eligible even when explicit admin flags are missing', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 0, operations: 0, accesses: 0 }
  }, async (service) => {
    const context = await service.resolveUserBootstrapContext({
      activeOrgId: 'SYSTEM',
      currentProfileMode: 'SYSTEM',
      allowedOrgs: [{ orgId: 'SYSTEM' }]
    }, { forceRefresh: true });
    assert.equal(context.eligible, true);
    assert.equal(context.bypassEnabled, true);
  });
});

test('bypass only applies for allowlisted sections and eligible users', async () => {
  await withStubbedBootstrapService({
    backendStatus: { runtime: { requestedMode: 'mongo' }, mode: 'mongo' },
    counts: { sections: 0, operations: 0, accesses: 0 }
  }, async (service) => {
    const allowed = await service.isBypassAllowed({
      user: { systemAccessProfileId: 'ACP1002' },
      sectionId: 'USERS'
    });
    const deniedBySection = await service.isBypassAllowed({
      user: { systemAccessProfileId: 'ACP1002' },
      sectionId: 'PTE'
    });
    const deniedByUser = await service.isBypassAllowed({
      user: { id: 'user-1' },
      sectionId: 'USERS'
    });

    assert.equal(allowed, true);
    assert.equal(deniedBySection, false);
    assert.equal(deniedByUser, false);
  });
});

test('access middleware grants bootstrap bypass before regular access evaluation', async () => {
  await withStubbedAccessMiddleware({
    bootstrapBypassAllowed: true,
    evaluationAllowed: false
  }, async (accessMiddleware) => {
    const req = {
      user: { id: 'user-1' },
      ip: '127.0.0.1',
      headers: {},
      originalUrl: '/users',
      url: '/users'
    };
    const res = {};
    let nextCalled = false;
    await accessMiddleware.requireAccess('USERS', 'READ')(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.bootstrapBypass?.enabled, true);
    assert.equal(req.bootstrapBypass?.reason, 'first_run_bootstrap');
  });
});

test('dashboard bootstrap setup route is registered', () => {
  const dashboardRoutes = require('../MVC/routes/dashboardRoutes');
  const dashboardController = require('../MVC/controllers/dashboardController');
  const routeLayer = dashboardRoutes.stack.find((layer) => (
    layer.route?.path === '/bootstrap-setup'
    && layer.route?.methods?.get
  ));

  assert.ok(routeLayer, 'expected GET /dashboard/bootstrap-setup route to be registered');
  assert.equal(routeLayer.route.stack.at(-1)?.handle, dashboardController.showBootstrapSetup);
});

test('bootstrap setup controller allows superusers', async () => {
  const dashboardController = require('../MVC/controllers/dashboardController');
  const bootstrapService = require('../MVC/services/firstRunBootstrapService');
  const adminCheckersService = require('../MVC/services/adminChekersService');
  const originalResolver = bootstrapService.resolveUserBootstrapContext;
  const originalIsAdmin = adminCheckersService.isAdmin;
  const originalIsSuperAdmin = adminCheckersService.isSuperAdmin;

  try {
    bootstrapService.resolveUserBootstrapContext = async () => ({
      eligible: false,
      active: false,
      bypassEnabled: false,
      requestedMode: 'mongo',
      checks: [{ key: 'sections', label: 'Sections', count: 3, ready: true }],
      missingLabels: []
    });
    adminCheckersService.isAdmin = () => false;
    adminCheckersService.isSuperAdmin = () => true;

    const okRes = makeRenderResponse();
    await dashboardController.showBootstrapSetup({ user: { id: 'super-1' }, websitePolicy: {} }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.rendered?.view, 'dashboard/bootstrapSetup');
  } finally {
    bootstrapService.resolveUserBootstrapContext = originalResolver;
    adminCheckersService.isAdmin = originalIsAdmin;
    adminCheckersService.isSuperAdmin = originalIsSuperAdmin;
  }
});

test('bootstrap setup controller allows global admins', async () => {
  const dashboardController = require('../MVC/controllers/dashboardController');
  const bootstrapService = require('../MVC/services/firstRunBootstrapService');
  const adminCheckersService = require('../MVC/services/adminChekersService');
  const originalResolver = bootstrapService.resolveUserBootstrapContext;
  const originalIsAdmin = adminCheckersService.isAdmin;
  const originalIsSuperAdmin = adminCheckersService.isSuperAdmin;

  try {
    bootstrapService.resolveUserBootstrapContext = async () => ({
      eligible: false,
      active: true,
      missingLabels: ['Sections']
    });
    adminCheckersService.isAdmin = () => true;
    adminCheckersService.isSuperAdmin = () => false;

    const okRes = makeRenderResponse();
    await dashboardController.showBootstrapSetup({ user: { id: 'admin-1' }, websitePolicy: {} }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.rendered?.view, 'dashboard/bootstrapSetup');
  } finally {
    bootstrapService.resolveUserBootstrapContext = originalResolver;
    adminCheckersService.isAdmin = originalIsAdmin;
    adminCheckersService.isSuperAdmin = originalIsSuperAdmin;
  }
});

test('bootstrap setup controller denies non-admin users', async () => {
  const dashboardController = require('../MVC/controllers/dashboardController');
  const bootstrapService = require('../MVC/services/firstRunBootstrapService');
  const adminCheckersService = require('../MVC/services/adminChekersService');
  const originalResolver = bootstrapService.resolveUserBootstrapContext;
  const originalIsAdmin = adminCheckersService.isAdmin;
  const originalIsSuperAdmin = adminCheckersService.isSuperAdmin;

  try {
    bootstrapService.resolveUserBootstrapContext = async () => ({
      eligible: true,
      active: true,
      bypassEnabled: true,
      requestedMode: 'mongo',
      checks: [{ key: 'sections', label: 'Sections', count: 0, ready: false }],
      missingLabels: ['Sections']
    });
    adminCheckersService.isAdmin = () => false;
    adminCheckersService.isSuperAdmin = () => false;

    const blockedRes = makeRenderResponse();
    await dashboardController.showBootstrapSetup({ user: { id: 'user-3' }, websitePolicy: {} }, blockedRes);
    assert.equal(blockedRes.statusCode, 403);
    assert.equal(blockedRes.rendered?.view, 'error');
  } finally {
    bootstrapService.resolveUserBootstrapContext = originalResolver;
    adminCheckersService.isAdmin = originalIsAdmin;
    adminCheckersService.isSuperAdmin = originalIsSuperAdmin;
  }
});

test('dashboard and bootstrap setup views compile with bootstrap locals', () => {
  const dashboardPath = path.join(process.cwd(), 'MVC', 'views', 'dashboard.ejs');
  const dashboardTemplate = fs.readFileSync(dashboardPath, 'utf8');
  const dashboardRender = ejs.compile(dashboardTemplate, { filename: dashboardPath });
  const dashboardHtmlAdmin = dashboardRender({
    user: { username: 'admin', canSwitchProfile: false, activeOrgId: 'SYSTEM' },
    websitePolicy: {},
    dashboardSections: [{ id: 'SEC1', name: 'One' }],
    sectionCategories: [],
    showDashboardSummary: true,
    canViewBootstrapShortcut: true,
    newUrl: 'sections',
    firstRunBootstrap: {
      eligible: false,
      active: true,
      missingLabels: ['Sections', 'Operations']
    },
    stats: {
      sections: 3,
      dashboardSections: 1,
      logCount: 10,
      logSize: '10 KB',
      logHealth: 'success',
      logMessage: '',
      actionStateCount: 4,
      actionStateHealth: 'success',
      actionStateMessage: ''
    },
    access: {
      showLogCard: true,
      showActionStateCard: true
    }
  });
  assert.match(dashboardHtmlAdmin, /Bootstrap Setup/);
  assert.match(dashboardHtmlAdmin, /dashboard\/bootstrap-setup/);
  assert.match(dashboardHtmlAdmin, /id="dashboardAttentionCards"/);
  assert.match(dashboardHtmlAdmin, /collapse mt-2 show/);

  const dashboardHtmlNonAdmin = dashboardRender({
    user: { username: 'member', canSwitchProfile: false, activeOrgId: 'ORG_1' },
    websitePolicy: {},
    dashboardSections: [{ id: 'SEC1', name: 'One' }],
    sectionCategories: [],
    showDashboardSummary: true,
    canViewBootstrapShortcut: false,
    newUrl: 'sections',
    firstRunBootstrap: {
      eligible: false,
      active: true,
      missingLabels: ['Sections', 'Operations']
    },
    stats: {
      sections: 3,
      dashboardSections: 1,
      logCount: 10,
      logSize: '10 KB',
      logHealth: 'success',
      logMessage: '',
      actionStateCount: 4,
      actionStateHealth: 'success',
      actionStateMessage: ''
    },
    access: {
      showLogCard: true,
      showActionStateCard: true
    }
  });
  assert.doesNotMatch(dashboardHtmlNonAdmin, /Bootstrap Setup/);

  const setupPath = path.join(process.cwd(), 'MVC', 'views', 'dashboard', 'bootstrapSetup.ejs');
  const setupTemplate = fs.readFileSync(setupPath, 'utf8');
  const setupRender = ejs.compile(setupTemplate, { filename: setupPath });
  const setupHtml = setupRender({
    firstRunBootstrap: {
      eligible: true,
      active: true,
      bypassEnabled: true,
      requestedMode: 'mongo',
      checks: [{ key: 'sections', label: 'Sections', count: 0, ready: false }],
      missingLabels: ['Sections']
    },
    bootstrapGroups: [
      {
        title: 'Core Setup',
        description: 'desc',
        items: [{ label: 'System Settings', href: '/systemSettings', icon: 'bi-gear', note: 'note' }]
      }
    ]
  });
  assert.match(setupHtml, /Bootstrap Setup Access/);
  assert.match(setupHtml, /System Settings/);
});
