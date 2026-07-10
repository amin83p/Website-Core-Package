/**
 * Admin Google Authenticator (TOTP) — self-serve enroll, verify, disable.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { authenticator } = require('otplib');

const adminAuthorityService = require('../MVC/services/adminAuthorityService');
const adminTotpService = require('../MVC/services/adminTotpService');
const securityController = require('../MVC/controllers/securityController');

const STORE_PATH = path.join(__dirname, '../data/adminTotpSecrets.json');

async function withTempStore(callback) {
  const backupExists = fs.existsSync(STORE_PATH);
  const backup = backupExists ? fs.readFileSync(STORE_PATH, 'utf8') : null;
  try {
    if (backupExists) fs.unlinkSync(STORE_PATH);
    await callback();
  } finally {
    if (backupExists) fs.writeFileSync(STORE_PATH, backup, 'utf8');
    else if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  }
}

function mockReq(user, session = {}) {
  return {
    user,
    session,
    requestId: 'test-req',
    body: {}
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

function sectionAdminUser(id = 'SEC-ADMIN-1') {
  return {
    id,
    email: `${id}@example.com`,
    accessLevel: 1,
    activeProfile: {
      active: true,
      fullAdmin: false,
      adminCategories: [],
      sections: [{ id: 'USERS', adminAccess: true, operations: [] }]
    }
  };
}

function categoryAdminUser(id = 'CAT-ADMIN-1') {
  return {
    id,
    email: `${id}@example.com`,
    accessLevel: 1,
    activeProfile: {
      active: true,
      fullAdmin: false,
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
}

function operationAdminUser(id = 'OP-ADMIN-1') {
  return {
    id,
    email: `${id}@example.com`,
    accessLevel: 1,
    activeProfile: {
      active: true,
      fullAdmin: false,
      adminCategories: [],
      sections: [{
        id: 'USERS',
        adminAccess: false,
        operations: [{ id: 'UPDATE', adminAccess: true }]
      }]
    }
  };
}

test('hasAnyAdminPrivilege and TOTP eligibility for admin levels', () => {
  const root = { id: 'ROOT_001', isVirtualSuperAdmin: true, email: 'root@example.com' };
  const normal = { id: 'U-3', accessLevel: 1, email: 'user@example.com' };
  const sectionAdmin = sectionAdminUser();
  const categoryAdmin = categoryAdminUser();
  const operationAdmin = operationAdminUser();
  const systemProfileOnly = { id: 'U-4', systemAccessProfileId: 'PROF-1', email: 'sys@example.com', accessLevel: 1 };

  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(root), true);
  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(sectionAdmin), true);
  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(categoryAdmin), true);
  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(operationAdmin), true);
  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(normal), false);
  assert.equal(adminAuthorityService.hasAnyAdminPrivilege(systemProfileOnly), false);

  assert.equal(adminTotpService.isTotpEligibleUser(root), true);
  assert.equal(adminTotpService.isTotpEligibleUser(sectionAdmin), true);
  assert.equal(adminTotpService.isTotpEligibleUser(normal), false);

  assert.equal(adminTotpService.canManageOwnTotp(root), true);
  assert.equal(adminTotpService.canManageOwnTotp(sectionAdmin), true);
  assert.equal(adminTotpService.canManageOwnTotp(normal), false);

  // Self-only management — no admin-to-admin via user id.
  assert.equal(adminTotpService.canManageTotp(root, sectionAdmin), false);
  assert.equal(adminTotpService.canManageTotp(root, root), true);
  assert.equal(adminTotpService.canManageTotp(normal, root), false);
});

test('section admin can enroll confirm verify and disable', async () => {
  await withTempStore(async () => {
    const user = sectionAdminUser('TOTP-SEC-1');
    const req = mockReq(user, {});

    const setup = await adminTotpService.beginEnrollment({ req, targetUser: user });
    assert.ok(setup.qrDataUrl.startsWith('data:image'));
    assert.ok(setup.secret);
    assert.ok(setup.otpauthUrl.startsWith('otpauth://totp/'));
    assert.match(setup.secretGrouped, / /);

    const token = authenticator.generate(setup.secret);
    const confirmed = await adminTotpService.confirmEnrollment({ req, targetUser: user, code: token });
    assert.equal(confirmed.enabled, true);
    assert.ok(confirmed.enrolledAt);

    const status = await adminTotpService.getStatus(user.id);
    assert.equal(status.enabled, true);

    await assert.rejects(
      () => adminTotpService.verifyUserCode(user.id, '1'),
      (err) => err && (err.code === 'INVALID_CODE' || err.code === 'INVALID_CODE_FORMAT')
    );

    let verifyToken = authenticator.generate(setup.secret);
    try {
      await adminTotpService.verifyUserCode(user.id, verifyToken);
    } catch (err) {
      if (err.code !== 'CODE_REUSED') throw err;
    }

    await adminTotpService.disableEnrollment({ targetUser: user, requireCode: false });
    const after = await adminTotpService.getStatus(user.id);
    assert.equal(after.enabled, false);
  });
});

test('verifyAdminCode rejects hardcoded 1 and requires enrollment', async () => {
  await withTempStore(async () => {
    const user = { id: 'TOTP-USER-2', email: 'totp2@example.com', accessLevel: 10, isVirtualSuperAdmin: true };
    const req = mockReq(user, { save(cb) { cb(null); } });
    req.body = { code: '1' };
    const res = mockRes();
    await securityController.verifyAdminCode(req, res);
    assert.equal(res.statusCode, 403);
    assert.ok(
      res.body?.code === 'ADMIN_TOTP_NOT_ENROLLED' ||
      /Set up Google Authenticator|not enrolled|Authenticator/i.test(String(res.body?.message || ''))
    );
  });
});

test('verifyAdminCode accepts valid TOTP for section admin and sets adminKey', async () => {
  await withTempStore(async () => {
    const user = sectionAdminUser('TOTP-USER-3');
    const req = mockReq(user, { save(cb) { cb(null); } });
    const setup = await adminTotpService.beginEnrollment({ req, targetUser: user });
    const enrollCode = authenticator.generate(setup.secret);
    await adminTotpService.confirmEnrollment({ req, targetUser: user, code: enrollCode });

    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (store['TOTP-USER-3']) delete store['TOTP-USER-3'].lastUsedStep;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');

    const req2 = mockReq(user, { save(cb) { cb(null); } });
    req2.body = { code: authenticator.generate(setup.secret) };
    const res2 = mockRes();
    await securityController.verifyAdminCode(req2, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body?.status, 'success');
    assert.ok(req2.session.adminKey);

    const badReq = mockReq(user, { save(cb) { cb(null); } });
    badReq.body = { code: '1' };
    const badRes = mockRes();
    await securityController.verifyAdminCode(badReq, badRes);
    assert.equal(badRes.statusCode, 403);
    assert.notEqual(badRes.body?.status, 'success');
  });
});

test('non-admin cannot verify', async () => {
  const user = { id: 'TOTP-USER-4', email: 'plain@example.com', accessLevel: 1 };
  const req = mockReq(user, { save(cb) { cb(null); } });
  req.body = { code: '123456' };
  const res = mockRes();
  await securityController.verifyAdminCode(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body?.message || ''), /admin access/i);
});

test('virtual root remains eligible for self TOTP', () => {
  const root = { id: 'ROOT_001', isVirtualSuperAdmin: true, email: 'apaknejad@equilibrium.ab.ca' };
  assert.equal(adminTotpService.isTotpEligibleUser(root), true);
  assert.equal(adminTotpService.canManageOwnTotp(root), true);
});
