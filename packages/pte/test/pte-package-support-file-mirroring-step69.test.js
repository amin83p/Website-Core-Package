const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('PTE package docs and tests have package-local mirrors', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const mirroredRows = [
    ...(supportMap.docs || []),
    ...(supportMap.tests || [])
  ];

  assert.ok(mirroredRows.length > 0);

  mirroredRows.forEach((row) => {
    assert.equal(row.status, 'root-active', `${row.source} should remain root-active during compatibility`);
    assert.equal(row.targetStatus, 'package-mirrored', `${row.target} should be marked as a package mirror`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
  });
});

test('PTE support-file notes describe the Pass 4 mirror contract', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const notes = (supportMap.notes || []).join('\n');

  assert.match(notes, /docs and tests/i);
  assert.match(notes, /package-local mirrors/i);
  assert.match(notes, /root-active/i);
});
