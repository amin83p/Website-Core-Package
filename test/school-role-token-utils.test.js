const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterSchoolPackageOrgRoles,
  normalizeOrgRoleTokens
} = require('../packages/school/MVC/utils/schoolRoleTokenUtils');

test('filterSchoolPackageOrgRoles keeps only school package role tokens', () => {
  const roles = filterSchoolPackageOrgRoles({
    orgId: 'ORG-1',
    roles: ['member', 'school_teacher', 'credit_customer', 'school_staff', 'admin']
  });
  assert.deepEqual(roles, ['school_teacher', 'school_staff']);
});

test('filterSchoolPackageOrgRoles canonicalizes school role aliases', () => {
  const roles = filterSchoolPackageOrgRoles({
    orgId: 'ORG-1',
    role: 'member school_student'
  });
  assert.deepEqual(roles, ['school_student']);
});

test('filterSchoolPackageOrgRoles returns empty when only non-school roles exist', () => {
  const roles = filterSchoolPackageOrgRoles({
    orgId: 'ORG-1',
    roles: ['member', 'credit_customer', 'website_editor']
  });
  assert.deepEqual(roles, []);
});

test('normalizeOrgRoleTokens still includes member for non-display workflows', () => {
  const roles = normalizeOrgRoleTokens({
    orgId: 'ORG-1',
    roles: ['member', 'school_teacher']
  });
  assert.ok(roles.includes('member'));
  assert.ok(roles.includes('school_teacher'));
});
