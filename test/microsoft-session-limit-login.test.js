const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';

const pendingLoginService = require('../MVC/services/microsoftPendingLoginService');
const dataService = require('../MVC/services/dataService');

test('Microsoft pending login survives through a signed short-lived cookie', () => {
  const pending = {
    userId: 'USR_MICROSOFT_1',
    providerAccount: {
      email: 'Person@Example.com',
      tenantId: 'tenant-1',
      objectId: 'object-1',
      name: 'Example Person'
    }
  };
  const cookies = [];
  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    }
  };

  pendingLoginService.setCookie(res, pending, { ttlMs: 60_000, secure: true });

  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, pendingLoginService.COOKIE_NAME);
  assert.equal(cookies[0].options.httpOnly, true);
  assert.equal(cookies[0].options.secure, true);
  assert.equal(cookies[0].options.sameSite, 'lax');

  const restored = pendingLoginService.readCookie({
    cookies: { [pendingLoginService.COOKIE_NAME]: cookies[0].value }
  });
  assert.equal(restored.userId, pending.userId);
  assert.equal(restored.providerAccount.email, 'person@example.com');
  assert.equal(restored.providerAccount.objectId, 'object-1');
  assert.ok(restored.expiresAt > Date.now());
});

test('Microsoft pending login rejects a modified cookie', () => {
  const token = pendingLoginService.sign({
    userId: 'USR_MICROSOFT_2',
    providerAccount: { email: 'person@example.com' }
  });
  const parts = token.split('.');
  const firstSignatureCharacter = parts[2].startsWith('a') ? 'b' : 'a';
  parts[2] = firstSignatureCharacter + parts[2].slice(1);
  const modified = parts.join('.');
  assert.equal(pendingLoginService.verify(modified), null);
});

test('Microsoft force-login re-resolves a stale or mismatched local user ID by verified provider email', async () => {
  const originalGetDataById = dataService.getDataById;
  const originalFetchData = dataService.fetchData;
  dataService.getDataById = async () => ({
    id: 'old-user-id',
    email: 'old@example.com',
    active: true,
    status: 'active'
  });
  dataService.fetchData = async (entityName) => entityName === 'users'
    ? [{ id: 'current-user-id', email: 'apaknejad@equilibrium.ab.ca', active: true, status: 'active' }]
    : [];

  try {
    const user = await require('../MVC/controllers/authController').resolvePendingMicrosoftUser({
      userId: 'old-user-id',
      providerAccount: { email: 'Apaknejad@Equilibrium.AB.CA' }
    });
    assert.equal(user.id, 'current-user-id');
  } finally {
    dataService.getDataById = originalGetDataById;
    dataService.fetchData = originalFetchData;
  }
});

test('Microsoft session-limit routes keep OAuth traffic outside the credential limiter', () => {
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../MVC/routes/authRoutes.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.resolve(__dirname, '../MVC/controllers/authController.js'), 'utf8');

  assert.match(routeSource, /router\.get\('\/auth\/microsoft', microsoftLoginLimiter/);
  assert.match(routeSource, /router\.get\('\/auth\/microsoft\/callback', microsoftLoginLimiter/);
  assert.match(routeSource, /router\.post\('\/force-login', loginLimiter/);
  assert.match(controllerSource, /microsoftPendingLoginService\.readCookie\(req\)/);
  assert.match(controllerSource, /storePendingMicrosoftLogin\(req, res, user, microsoftAccount/);
});

test('Microsoft disconnect errors are shown in the message modal instead of alert', () => {
  const loginViewSource = fs.readFileSync(path.resolve(__dirname, '../MVC/views/login/login.ejs'), 'utf8');
  assert.match(loginViewSource, /await showLoginFlowMessage\(json\.message/);
  assert.match(loginViewSource, /window\.showMessageModal\(\{/);
  assert.doesNotMatch(loginViewSource, /alert\(/);
});
