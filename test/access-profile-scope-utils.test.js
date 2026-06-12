const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveAccessProfileOrgId,
  normalizeAccessProfileScope,
  choosePreferredAccessProfile,
  dedupeAccessProfilesById,
  buildOrgValueVariants,
  buildMongoAccessOrgFilter
} = require('../MVC/utils/accessProfileScopeUtils');

test('resolveAccessProfileOrgId reads canonical and legacy scoped org fields', () => {
  assert.equal(resolveAccessProfileOrgId({ orgId: 900000 }), '900000');
  assert.equal(resolveAccessProfileOrgId({ scope: { type: 'org', orgId: 900000 } }), '900000');
  assert.equal(resolveAccessProfileOrgId({ scope: 'org 900000' }), '900000');
  assert.equal(resolveAccessProfileOrgId({ scopeType: 'org', scopeId: 900000 }), '900000');
});

test('normalizeAccessProfileScope exposes legacy scoped org as canonical orgId', () => {
  const row = normalizeAccessProfileScope({
    id: 'ACC-1',
    name: 'SCHOOL_ADMIN',
    scope: { type: 'org', orgId: 900000 }
  });

  assert.equal(row.orgId, '900000');
});

test('dedupeAccessProfilesById keeps one preferred row per public profile id', () => {
  const rows = dedupeAccessProfilesById([
    {
      id: '191019',
      name: 'PTE_APPLICANT',
      orgId: 900000,
      validity: {},
      audit: { lastUpdateDateTime: '2026-01-01T00:00:00.000Z' }
    },
    {
      id: '191019',
      name: 'PTE_APPLICANT',
      orgId: 900000,
      validity: { startDate: '2026-06-01', endDate: '2026-12-31' },
      audit: { lastUpdateDateTime: '2026-06-10T00:00:00.000Z' }
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '191019');
  assert.equal(rows[0].validity.startDate, '2026-06-01');
});

test('choosePreferredAccessProfile selects the same row update should overwrite', () => {
  const oldRow = {
    id: '191019',
    validity: {},
    audit: { lastUpdateDateTime: '2026-01-01T00:00:00.000Z' }
  };
  const currentRow = {
    id: '191019',
    validity: { startDate: '2026-06-01' },
    audit: { lastUpdateDateTime: '2026-06-10T00:00:00.000Z' }
  };

  const preferred = choosePreferredAccessProfile(oldRow, currentRow);
  assert.equal(preferred, currentRow);
});

test('buildMongoAccessOrgFilter accepts string and numeric org id storage', () => {
  const variants = buildOrgValueVariants('900000');
  assert.deepEqual(variants, ['900000', 900000]);

  const filter = buildMongoAccessOrgFilter('900000');
  const serialized = JSON.stringify(filter);
  assert.match(serialized, /"orgId":\{"\$in":\["900000",900000\]\}/);
  assert.match(serialized, /"scope\.orgId":\{"\$in":\["900000",900000\]\}/);
});
