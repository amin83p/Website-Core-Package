const test = require('node:test');
const assert = require('node:assert/strict');

const roleRegistryService = require('../MVC/services/person/roleRegistryService');
const roleModel = require('../MVC/models/roleModel');
const migration = require('../scripts/migrate-school-role-tokens');

test('role registry exposes only canonical school role keys', () => {
  const registry = roleRegistryService.buildRoleRegistry([]);

  assert.ok(registry.systemRoleKeys.includes('school_student'));
  assert.ok(registry.systemRoleKeys.includes('school_teacher'));
  assert.ok(registry.systemRoleKeys.includes('school_staff'));

  assert.equal(registry.systemRoleKeys.includes('student'), false);
  assert.equal(registry.systemRoleKeys.includes('teacher'), false);
  assert.equal(registry.systemRoleKeys.includes('staff'), false);

  assert.equal(registry.systemRoleAlias.student, undefined);
  assert.equal(registry.systemRoleAlias.teacher, undefined);
  assert.equal(registry.systemRoleAlias.staff, undefined);
  assert.equal(registry.audienceAliasToCanonical.schoolstudents, 'school_student');
  assert.equal(registry.audienceAliasToCanonical.schoolteachers, 'school_teacher');
  assert.equal(registry.audienceAliasToCanonical.schoolstaffs, 'school_staff');
});

test('role validation rejects deprecated generic school keys and aliases', () => {
  const keyValidation = roleModel.validateRoleData({
    key: 'student',
    label: 'Student',
    description: '',
    domain: 'school',
    packageName: 'SCHOOL',
    aliases: [],
    active: true,
    system: false
  });
  assert.equal(keyValidation.isValid, false);
  assert.match(keyValidation.errors.join('\n'), /deprecated/i);

  const aliasValidation = roleModel.validateRoleData({
    key: 'school_alumni',
    label: 'School Alumni',
    description: '',
    domain: 'school',
    packageName: 'SCHOOL',
    aliases: ['staff'],
    active: true,
    system: false
  });
  assert.equal(aliasValidation.isValid, false);
  assert.match(aliasValidation.errors.join('\n'), /deprecated/i);
});

test('migration removes old role rows and maps membership tokens with dedupe', () => {
  const roles = migration.migrateRowsByKind([
    { id: 'ROL1', key: 'student' },
    { id: 'ROL2', key: 'school_student' },
    { id: 'ROL3', key: 'Teacher' },
    { id: 'ROL4', key: 'pte_student' }
  ], 'roles');

  assert.equal(roles.removedCount, 2);
  assert.deepEqual(roles.value.map((row) => row.key), ['school_student', 'pte_student']);

  const persons = migration.migrateRowsByKind([
    {
      id: 'P1',
      tags: ['sample-student'],
      organizations: [
        {
          orgId: 'ORG1',
          roles: ['member', 'student', 'school_student', 'Teacher', 'pte_student'],
          role: 'student'
        }
      ]
    }
  ], 'memberships');

  assert.equal(persons.changedCount, 1);
  assert.equal(persons.mappedCount, 3);
  assert.deepEqual(persons.value[0].organizations[0].roles, [
    'member',
    'school_student',
    'school_teacher',
    'pte_student'
  ]);
  assert.equal(persons.value[0].organizations[0].role, 'school_student');
  assert.deepEqual(persons.value[0].tags, ['sample-student']);
});

test('migration maps help audience tokens without changing non-role text', () => {
  const articles = migration.migrateRowsByKind([
    {
      id: 'H1',
      audience: ['staff', 'admins', 'school_staff'],
      contentHtml: '<p>Ask staff for help.</p>'
    }
  ], 'audience');

  assert.equal(articles.changedCount, 1);
  assert.deepEqual(articles.value[0].audience, ['school_staff', 'admins']);
  assert.equal(articles.value[0].contentHtml, '<p>Ask staff for help.</p>');
});
