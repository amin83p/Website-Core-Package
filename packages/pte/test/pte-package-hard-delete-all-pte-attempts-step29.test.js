const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');
const TARGET = 'packages/pte/scripts/maintenance/hard-delete-all-pte-attempts.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedDelegateFor(row = {}) {
  const sourcePath = path.join(ROOT_DIR, row.source).replace(/\.js$/, '');
  let relativePath = path.relative(path.dirname(path.join(ROOT_DIR, row.target)), sourcePath).replace(/\\/g, '/');
  if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
  return relativePath;
}

test('PTE hard-delete attempts package entrypoint is package-safe', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const row = (supportMap.scripts || []).find((entry) => entry.target === TARGET);

  assert.ok(row, `${TARGET} should be in package support map`);
  assert.equal(row.entrypointMode, 'package-safe');

  const source = readText(path.join(ROOT_DIR, TARGET));
  const expectedDelegate = expectedDelegateFor(row);
  assert.doesNotMatch(
    source,
    new RegExp(expectedDelegate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${TARGET} should not delegate to root script ${expectedDelegate}`
  );
  assert.match(source, /hard-delete-all-pte-attempts\.report\.json/);
  assert.match(source, /connectMongo/);
  assert.match(source, /disconnectMongo/);
  assert.match(source, /pteAttemptSessions/);
});
