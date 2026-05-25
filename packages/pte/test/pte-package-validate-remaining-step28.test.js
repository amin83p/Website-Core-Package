const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');
const TARGET = 'packages/pte/scripts/maintenance/validate-remaining.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedDelegateRequire(row = {}) {
  const sourcePath = path.join(ROOT_DIR, row.source).replace(/\.js$/, '');
  let relativePath = path.relative(path.dirname(path.join(ROOT_DIR, row.target)), sourcePath).replace(/\\/g, '/');
  if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
  return new RegExp(`require\\(['\`]${relativePath.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}['\`]`, 'i');
}

test('PTE validate-remaining script is package-safe', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const row = (supportMap.scripts || []).find((entry) => entry.target === TARGET);
  assert.ok(row, `${TARGET} should be in package support map`);
  assert.equal(row.entrypointMode, 'package-safe');

  const source = readText(path.join(ROOT_DIR, TARGET));
  assert.match(source, /repoRoot = path\.resolve/);
  assert.ok(
    source.includes("repoRoot, 'data', 'systemSettings.json'"),
    'validate-remaining should resolve system settings from the core repo root.'
  );
  assert.doesNotMatch(source, expectedDelegateRequire(row));
});
