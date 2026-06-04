const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

test('BenchPath package pass6 support map mirrors root docs scripts and tests', () => {
  const supportMap = readJson('packages/benchpath/package.support-files.json');
  const rows = [
    ...(supportMap.scripts || []),
    ...(supportMap.docs || []),
    ...(supportMap.tests || [])
  ];

  assert.equal(supportMap.packageId, 'benchpath');
  assert.equal(supportMap.step, 6);
  assert.equal(supportMap.status, 'support-mirrored');
  assert.equal((supportMap.scripts || []).length, 12);
  assert.equal((supportMap.docs || []).length, 2);
  assert.equal((supportMap.tests || []).length, 2);

  rows.forEach((row) => {
    assert.equal(typeof row.source, 'string');
    assert.equal(typeof row.target, 'string');
    assert.equal(typeof row.category, 'string');
    assert.equal(row.status, 'root-active');
    assert.ok(row.target.startsWith('packages/benchpath/'));
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
  });
});

test('BenchPath package pass6 keeps package-local support tests as mirrors', () => {
  const supportMap = readJson('packages/benchpath/package.support-files.json');
  const testRows = supportMap.tests || [];

  assert.equal(testRows.every((row) => row.targetStatus === 'package-mirrored'), true);
  assert.equal(testRows.some((row) => row.source === 'test/benchpath.payload-contract.step0.test.js'), true);
  assert.equal(testRows.some((row) => row.source === 'test/benchpath.cross-entity-integrity.step7b.test.js'), true);
});
