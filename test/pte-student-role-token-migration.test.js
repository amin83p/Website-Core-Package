const test = require('node:test');
const assert = require('node:assert/strict');

const roleRegistryService = require('../MVC/services/person/roleRegistryService');
const roleModel = require('../MVC/models/roleModel');
const pteApplicantModel = require('../packages/pte/MVC/models/pte/pteApplicantModel');
const pteStudentDataService = require('../packages/pte/MVC/services/pte/pteStudentDataService');
const migration = require('../scripts/migrate-pte-student-role-token');

test('role registry exposes canonical PTE student role and not typo role', () => {
  const registry = roleRegistryService.buildRoleRegistry([]);

  assert.ok(registry.systemRoleKeys.includes('pte_student'));
  assert.equal(registry.systemRoleKeys.includes('pte_studnet'), false);
  assert.equal(registry.systemRoleAlias.ptestudent, 'pte_student');
  assert.equal(registry.systemRoleAlias.ptestudnet, undefined);
  assert.equal(registry.audienceAliasToCanonical.pte_students, 'pte_student');

  const registryWithStoredAlias = roleRegistryService.buildRoleRegistry([{
    key: 'pte_student',
    label: 'PTE Student',
    description: '',
    domain: 'pte',
    packageName: 'PTE',
    aliases: ['ptestudent', 'ptestudnet'],
    active: true,
    system: true
  }]);
  assert.equal(registryWithStoredAlias.systemRoleAlias.ptestudent, 'pte_student');
  assert.equal(registryWithStoredAlias.systemRoleAlias.ptestudnet, undefined);
});

test('role validation rejects typo PTE student keys and aliases', () => {
  const keyValidation = roleModel.validateRoleData({
    key: 'pte_studnet',
    label: 'PTE Studnet',
    description: '',
    domain: 'pte',
    packageName: 'PTE',
    aliases: [],
    active: true,
    system: false
  });
  assert.equal(keyValidation.isValid, false);
  assert.match(keyValidation.errors.join('\n'), /deprecated/i);

  const aliasValidation = roleModel.validateRoleData({
    key: 'pte_candidate',
    label: 'PTE Candidate',
    description: '',
    domain: 'pte',
    packageName: 'PTE',
    aliases: ['ptestudnet'],
    active: true,
    system: false
  });
  assert.equal(aliasValidation.isValid, false);
  assert.match(aliasValidation.errors.join('\n'), /deprecated/i);
});

test('migration removes typo role row and maps membership tokens with dedupe', () => {
  const roles = migration.migrateRowsByKind([
    { id: 'ROL1007', key: 'pte_student', aliases: ['ptestudent', 'ptestudnet', 'pte-student'] },
    { id: 'ROL1008', key: 'pte_studnet' },
    { id: 'ROL1009', key: 'pte_student_public' }
  ], 'roles');

  assert.equal(roles.removedCount, 1);
  assert.equal(roles.changedCount, 1);
  assert.equal(roles.aliasRemovedCount, 1);
  assert.deepEqual(roles.value.map((row) => row.key), ['pte_student', 'pte_student_public']);
  assert.deepEqual(roles.value[0].aliases, ['ptestudent', 'pte-student']);

  const persons = migration.migrateRowsByKind([
    {
      id: 'P1',
      tags: ['sample-student'],
      organizations: [
        {
          orgId: 'ORG1',
          roles: ['member', 'pte_studnet', 'pte_student', 'school_student'],
          role: 'pte_studnet'
        }
      ]
    }
  ], 'memberships');

  assert.equal(persons.changedCount, 1);
  assert.equal(persons.mappedCount, 2);
  assert.deepEqual(persons.value[0].organizations[0].roles, [
    'member',
    'pte_student',
    'school_student'
  ]);
  assert.equal(persons.value[0].organizations[0].role, 'pte_student');
  assert.deepEqual(persons.value[0].tags, ['sample-student']);
});

test('migration maps typo PTE applicant personRoleToken', () => {
  const applicants = migration.migrateRowsByKind([
    { id: 'A1', personRoleToken: 'PTE_Studnet' },
    { id: 'A2', personRoleToken: 'PTE_Student_Public' },
    { id: 'A3', personRoleToken: 'PTE_Student' }
  ], 'pteApplicants');

  assert.equal(applicants.changedCount, 1);
  assert.equal(applicants.mappedCount, 1);
  assert.equal(applicants.value[0].personRoleToken, 'PTE_Student');
  assert.equal(applicants.value[1].personRoleToken, 'PTE_Student_Public');
  assert.equal(applicants.value[2].personRoleToken, 'PTE_Student');
});

test('PTE applicant defaults use canonical student tokens', () => {
  assert.equal(pteStudentDataService.PERSON_ROLE_TOKEN, 'PTE_Student');
  assert.equal(pteStudentDataService.PERSON_ORG_ROLE_TOKEN, 'pte_student');

  const applicant = pteApplicantModel.sanitizeApplicant({
    orgId: 'ORG1',
    personId: 'P1'
  });

  assert.equal(applicant.personRoleToken, 'PTE_Student');
});
