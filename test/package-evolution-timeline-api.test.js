const test = require('node:test');
const assert = require('node:assert/strict');

const access = require('../MVC/services/packageEvolutionAccessService');

test('category admin sees mapped package in accessible list', () => {
  const user = {
    activeProfile: {
      active: true,
      adminCategories: ['SCHOOL']
    }
  };
  const packages = access.resolveAccessiblePackagesSync(user);
  assert.ok(packages.includes('SCHOOL'));
});

test('assertPackageAccess denies other packages for category admin', () => {
  const user = {
    activeProfile: {
      active: true,
      adminCategories: ['SCHOOL']
    }
  };
  assert.equal(access.assertPackageAccess(user, 'SCHOOL'), true);
  assert.equal(access.assertPackageAccess(user, 'PTE'), false);
});