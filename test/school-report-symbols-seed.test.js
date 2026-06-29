const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

test('school report symbols exist in root symbols registry', () => {
  const symbols = readJson('data/symbols.json');
  const expected = [
    { name: 'SCHOOL_REPORTS', id: 'SYM_SYSTEM_124', sectionId: '445571' },
    { name: 'SCHOOL_REPORTS_TEMPLATE', id: 'SYM_SYSTEM_125', sectionId: '446101' },
    { name: 'SCHOOL_REPORTS_ASSIGNMENT', id: 'SYM_SYSTEM_126', sectionId: '446102' },
    { name: 'SCHOOL_REPORTS_INSTANCES', id: 'SYM_SYSTEM_127', sectionId: '446103' }
  ];

  expected.forEach((row) => {
    const found = symbols.find((symbol) => String(symbol?.name || '') === row.name);
    assert.ok(found, `Missing symbol ${row.name}`);
    assert.equal(String(found.id || ''), row.id);
    const tags = Array.isArray(found.tags) ? found.tags.map((tag) => String(tag)) : [];
    assert.ok(tags.includes(row.sectionId), `${row.name} must include section id tag ${row.sectionId}`);
  });
});

test('school package manifest declares report symbols', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const symbols = Array.isArray(manifest.symbols) ? manifest.symbols : [];
  const expectedNames = [
    'SCHOOL_REPORTS',
    'SCHOOL_REPORTS_TEMPLATE',
    'SCHOOL_REPORTS_ASSIGNMENT',
    'SCHOOL_REPORTS_INSTANCES'
  ];

  expectedNames.forEach((name) => {
    const found = symbols.find((row) => String(row?.name || '') === name);
    assert.ok(found, `Manifest missing symbol ${name}`);
    assert.equal(Boolean(found.adoptExisting), true, `${name} should be adoptExisting`);
  });
});
