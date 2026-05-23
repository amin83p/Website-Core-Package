const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');
const TARGET = 'packages/pte/scripts/maintenance/ensure-pte-list-indexes.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedRequireFor(row = {}) {
  const targetPath = path.join(ROOT_DIR, row.target);
  const sourcePath = path.join(ROOT_DIR, row.source).replace(/\.js$/, '');
  let relativePath = path.relative(path.dirname(targetPath), sourcePath).replace(/\\/g, '/');
  if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
  return relativePath;
}

test('PTE ensure list indexes package entrypoint is package-safe', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const row = (supportMap.scripts || []).find((entry) => entry.target === TARGET);

  assert.ok(row, `${TARGET} row should exist in package support map`);
  assert.equal(row.entrypointMode, 'package-safe');

  const source = readText(path.join(ROOT_DIR, TARGET));
  const expectedRequire = expectedRequireFor(row);

  assert.doesNotMatch(
    source,
    new RegExp(expectedRequire.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${TARGET} should not delegate to root script ${expectedRequire}`
  );
  assert.match(source, /ensureMongoIndexes/);
  assert.match(source, /SCRIPT_ID/);
});
