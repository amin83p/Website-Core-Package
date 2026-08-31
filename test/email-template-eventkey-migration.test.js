const test = require('node:test');
const assert = require('node:assert/strict');

const { migrateTemplates, resolveEventKey } = require('../scripts/email/migrate-templates-to-eventkey');

test('resolveEventKey maps legacy section/operation to catalog eventKey', () => {
  assert.equal(
    resolveEventKey({ sectionId: 'USERS', operationId: 'UPDATE', packageName: 'CORE' }),
    'AUTH_PASSWORD_RESET_CODE'
  );
});

test('migrateTemplates assigns eventKey and preserves uniqueness', () => {
  const { rows, migratedCount } = migrateTemplates([
    {
      id: 'EMTPL1',
      orgId: 'ORG_1',
      sectionId: 'USERS',
      operationId: 'UPDATE',
      packageName: 'CORE'
    }
  ]);
  assert.equal(migratedCount, 1);
  assert.equal(rows[0].eventKey, 'AUTH_PASSWORD_RESET_CODE');
});

test('migrateTemplates fails on orphan section/operation mapping', () => {
  assert.throws(() => {
    migrateTemplates([
      {
        id: 'EMTPL_ORPHAN',
        orgId: 'ORG_1',
        sectionId: 'UNKNOWN_SECTION',
        operationId: 'UNKNOWN_OP',
        packageName: 'CORE'
      }
    ]);
  }, /Unable to map template/i);
});
