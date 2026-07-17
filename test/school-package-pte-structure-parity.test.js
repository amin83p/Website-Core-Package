const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/school/package.support-files.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRepoPath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function assertPteStyleRows(rows = [], kind = '') {
  rows.forEach((row) => {
    assert.equal(typeof row, 'object', `${kind} support row should be an object`);
    assert.equal(typeof row.source, 'string', `${kind} support row should declare source`);
    assert.equal(typeof row.target, 'string', `${kind} support row should declare target`);
    assert.equal(typeof row.category, 'string', `${kind} support row should declare category`);
    const isPackageOnly = row.status === 'package-only';
    assert.equal(
      row.status,
      isPackageOnly ? 'package-only' : 'root-active',
      `${row.source} should declare a supported source status`
    );
    assert.equal(
      row.targetStatus,
      isPackageOnly ? 'package-active' : 'package-mirrored',
      `${row.source} should declare the matching package status`
    );
    if (!isPackageOnly) {
      assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    }
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
    assert.equal(normalizeRepoPath(row.target).startsWith(`packages/school/${kind}/`), true);
  });
}

test('school support files use PTE-style mirrored docs and tests rows', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  assert.equal(supportMap.packageId, 'school');
  assertPteStyleRows(supportMap.docs || [], 'docs');
  assertPteStyleRows(supportMap.tests || [], 'test');
});

test('school package should not carry package-local runtime data payload', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/school/data')), false);
});
