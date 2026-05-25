const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const roleRegistryService = require('../MVC/services/person/roleRegistryService');
const personModelSource = fs.readFileSync(
  path.join(ROOT_DIR, 'MVC/models/personModel.js'),
  'utf8'
);
const roleRegistrySource = fs.readFileSync(
  path.join(ROOT_DIR, 'MVC/services/person/roleRegistryService.js'),
  'utf8'
);

test('PTE system role seeds come from the PTE package manifest', () => {
  const packageRoles = roleRegistryService.buildPackageRoleSeedRows({
    packageRoot: path.join(ROOT_DIR, 'packages')
  });

  const pteStudentRole = packageRoles.find((row) => row.key === 'pte_student');
  assert.ok(pteStudentRole, 'PTE student role should be discovered from package roles.');
  assert.equal(pteStudentRole.packageName, 'PTE');
  assert.equal(pteStudentRole.system, true);
  assert.ok(pteStudentRole.aliases.includes('ptestudent'));

  const registry = roleRegistryService.buildRoleRegistry([]);
  assert.ok(registry.systemRoleKeys.includes('pte_student'));
  assert.ok(registry.systemRoleKeys.includes('pte_student_public'));
  assert.equal(registry.systemRoleAlias.ptestudent, 'pte_student');
  assert.equal(registry.audienceAliasToCanonical.pte_students, 'pte_student');
});

test('core role fallback constants no longer hardcode PTE package roles', () => {
  const registryLegacyBlock = roleRegistrySource.slice(
    roleRegistrySource.indexOf('const LEGACY_SYSTEM_ROLE_KEYS'),
    roleRegistrySource.indexOf('const DEPRECATED_ROLE_KEYS')
  );
  assert.equal(/pte_student|ptestudent|pte-teacher|pte_instructor|pte_trainer/.test(registryLegacyBlock), false);

  const personFallbackBlock = personModelSource.slice(
    personModelSource.indexOf('const PERSON_SYSTEM_TAG_KEYS'),
    personModelSource.indexOf('async function readAllPersonsRaw')
  );
  assert.equal(/pte_student|ptestudent|pte-teacher|pte_instructor|pte_trainer/.test(personFallbackBlock), false);
});
