const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';

const authImpersonationService = require('../MVC/services/authImpersonationService');
const { sanitizeAppReturnUrl } = require('../MVC/utils/pagePathUtils');
const sessionService = require('../MVC/services/SessionService');
const authService = require('../MVC/services/authService');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');

const root = path.resolve(__dirname, '..');

function superAdmin(overrides = {}) {
  return { id: 'SA_1', accessLevel: 10, active: true, status: 'active', ...overrides };
}

function regularUser(overrides = {}) {
  return { id: 'USR_2', accessLevel: 2, active: true, status: 'active', ...overrides };
}

test('assertSuperAdminCanImpersonate blocks non-super-admin actors', () => {
  assert.throws(
    () => authImpersonationService.assertSuperAdminCanImpersonate(regularUser(), regularUser({ id: 'USR_3' })),
    (error) => error.statusCode === 403
  );
});

test('assertSuperAdminCanImpersonate blocks self, inactive, and super-admin targets', () => {
  const actor = superAdmin();
  assert.throws(
    () => authImpersonationService.assertSuperAdminCanImpersonate(actor, actor),
    (error) => error.statusCode === 400
  );
  assert.throws(
    () => authImpersonationService.assertSuperAdminCanImpersonate(actor, { id: 'USR_X', active: false, status: 'inactive' }),
    (error) => error.statusCode === 400
  );
  assert.throws(
    () => authImpersonationService.assertSuperAdminCanImpersonate(actor, superAdmin({ id: 'SA_2' })),
    (error) => error.statusCode === 403
  );
  assert.doesNotThrow(() => authImpersonationService.assertSuperAdminCanImpersonate(actor, regularUser({ id: 'USR_OK' })));
});

test('sanitizeAppReturnUrl keeps pathname and query for same-page return', () => {
  assert.equal(sanitizeAppReturnUrl('/school/classes/1?view=week'), '/school/classes/1?view=week');
  assert.equal(sanitizeAppReturnUrl('https://evil.test/steal'), '');
  assert.equal(sanitizeAppReturnUrl('/logout'), '/logout');
});

test('impersonation logout and restore honor returnTo query', () => {
  const req = {
    originalUrl: '/school/schedule/person?week=2026-10-14',
    query: { returnTo: '/school/schedule/person?week=2026-10-14' }
  };
  assert.match(
    authImpersonationService.buildImpersonationLogoutHref(req),
    /^\/logout\?returnTo=/
  );
  assert.equal(
    authImpersonationService.resolveImpersonationReturnUrl(req),
    '/school/schedule/person?week=2026-10-14'
  );
  assert.equal(authImpersonationService.resolveImpersonationReturnUrl({ query: { returnTo: '/logout' } }), '');
});

test('impersonation bypasses target user active session count limit', () => {
  const serviceSource = fs.readFileSync(path.join(root, 'MVC/services/authImpersonationService.js'), 'utf8');
  assert.doesNotMatch(serviceSource, /checkLoginEligibility/);
});

test('impersonation sessions are excluded from user session limit counts', () => {
  const sessions = [
    { id: 's1', userId: 'USR_2' },
    { id: 's2', userId: 'USR_2', impersonatedByUserId: 'SA_1' },
    { id: 's3', userId: 'USR_2' }
  ];
  assert.equal(sessionService.isImpersonationSessionRecord(sessions[1]), true);
  assert.equal(sessionService.isImpersonationSessionRecord(sessions[0]), false);
  assert.equal(authImpersonationService.countSessionsTowardUserLimit(sessions), 2);
});

test('beginImpersonation rejects nested impersonation', async () => {
  const req = {
    user: superAdmin(),
    cookies: {
      auth_impersonator_token: 'existing',
      auth_token: 'current'
    }
  };
  const res = { cookie() {}, clearCookie() {} };
  await assert.rejects(
    () => authImpersonationService.beginImpersonation(req, res, 'USR_2'),
    (error) => error.statusCode === 409
  );
});

test('endImpersonationIfActive restores admin auth_token and clears impersonator cookie', async () => {
  const cleared = [];
  const setCookies = {};
  const res = {
    clearCookie(name) {
      cleared.push(name);
      delete setCookies[name];
    },
    cookie(name, value) {
      setCookies[name] = value;
    },
    redirect(url) {
      res._redirect = url;
    }
  };
  const req = {
    cookies: {
      auth_impersonator_token: 'admin.jwt.token',
      auth_token: 'target.jwt.impersonationSession'
    },
    user: regularUser(),
    headers: {}
  };

  const originalValidate = authService.validateToken;
  const originalTerminate = sessionService.terminateSession;
  authService.validateToken = (token) => token === 'admin.jwt.token';
  sessionService.terminateSession = async () => {};

  try {
    const handled = await authImpersonationService.endImpersonationIfActive(req, res);
    assert.equal(handled, true);
    assert.equal(setCookies.auth_token, 'admin.jwt.token');
    assert.equal(setCookies.auth_impersonator_token, undefined);
    assert.ok(cleared.includes(authImpersonationService.IMPERSONATOR_COOKIE));
    assert.equal(res._redirect, '/dashboard');
  } finally {
    authService.validateToken = originalValidate;
    sessionService.terminateSession = originalTerminate;
  }
});

test('endImpersonationIfActive returns false when not impersonating', async () => {
  const res = { clearCookie() {}, cookie() {}, redirect() {} };
  const handled = await authImpersonationService.endImpersonationIfActive({ cookies: {}, headers: {} }, res);
  assert.equal(handled, false);
});

test('resolveImpersonationLocals exposes menu and banner flags', async () => {
  const originalGetUser = authService.getUserFromToken;
  authService.getUserFromToken = async () => ({ id: 'SA_1', name: 'Super Admin' });

  try {
    const res = { locals: {}, clearCookie() {} };
    await authImpersonationService.resolveImpersonationLocals(
      { cookies: { auth_impersonator_token: 'tok' }, user: superAdmin() },
      res
    );
    assert.equal(res.locals.isImpersonating, true);
    assert.equal(res.locals.canImpersonateUsers, false);
    assert.equal(res.locals.impersonationActorLabel, 'Super Admin');

    const res2 = { locals: {}, clearCookie() {} };
    await authImpersonationService.resolveImpersonationLocals(
      { cookies: {}, user: superAdmin() },
      res2
    );
    assert.equal(res2.locals.isImpersonating, false);
    assert.equal(res2.locals.canImpersonateUsers, true);

    const res3 = { locals: {}, clearCookie() {} };
    await authImpersonationService.resolveImpersonationLocals(
      { cookies: {}, user: regularUser() },
      res3
    );
    assert.equal(res3.locals.canImpersonateUsers, false);
  } finally {
    authService.getUserFromToken = originalGetUser;
  }
});

test('auth routes and controller wire impersonation and logout restore', () => {
  const routeSource = fs.readFileSync(path.join(root, 'MVC/routes/authRoutes.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(root, 'MVC/controllers/authController.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(routeSource, /router\.post\('\/impersonate', loginLimiter, requireAuth/);
  assert.match(routeSource, /authValidators\.impersonateUserSchema/);
  assert.match(routeSource, /ctrl\.postImpersonateUser/);
  assert.match(controllerSource, /authImpersonationService\.beginImpersonation/);
  assert.match(controllerSource, /authImpersonationService\.endImpersonationIfActive\(req, res\)/);
  assert.doesNotMatch(controllerSource, /finally\s*\{[\s\S]*clearCookie\('auth_token'\)/);
  assert.match(controllerSource, /impersonatedByUserId/);
  assert.match(appSource, /authImpersonationService\.resolveImpersonationLocals/);
  assert.equal(authImpersonationService.IMPERSONATOR_COOKIE, 'auth_impersonator_token');
});

test('header and layout include impersonation UI hooks', () => {
  const headerSource = fs.readFileSync(path.join(root, 'MVC/views/partials/header.ejs'), 'utf8');
  const layoutSource = fs.readFileSync(path.join(root, 'MVC/views/layouts/layout.ejs'), 'utf8');
  const bannerSource = fs.readFileSync(path.join(root, 'MVC/views/partials/impersonationBanner.ejs'), 'utf8');
  const cssSource = fs.readFileSync(path.join(root, 'public/styles/main.css'), 'utf8');

  assert.match(headerSource, /btn_headerLoginAsUser/);
  assert.match(headerSource, /Login as user/);
  assert.match(headerSource, /Return to admin account/);
  assert.match(headerSource, /fetch\('\/impersonate'/);
  assert.match(headerSource, /window\.location\.reload\(\)/);
  assert.match(headerSource, /text: 'Continue'/);
  assert.doesNotMatch(headerSource, /label: 'Continue'/);
  assert.match(layoutSource, /impersonationBanner/);
  assert.match(bannerSource, /Viewing as/);
  assert.match(bannerSource, /impersonationActorLabel/);
  assert.match(bannerSource, /impersonationLogoutHref/);
  assert.match(headerSource, /impersonationLogoutHref/);
  assert.match(cssSource, /\.impersonation-banner/);
});

test('postImpersonateUser requires super admin via isSuperAdmin', () => {
  const controllerSource = fs.readFileSync(path.join(root, 'MVC/controllers/authController.js'), 'utf8');
  assert.match(controllerSource, /postImpersonateUser[\s\S]*?adminAuthorityService\.isSuperAdmin\(req\.user\)/);
  assert.equal(adminAuthorityService.isSuperAdmin(regularUser()), false);
  assert.equal(adminAuthorityService.isSuperAdmin(superAdmin()), true);
});
