const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');

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

test('PTE package support-file script targets exist as package entrypoints', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  (supportMap.scripts || []).forEach((row) => {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
    assert.match(row.target, /^packages\/pte\/scripts\/(seed|migration|maintenance)\//);
  });
});

test('PTE package script entrypoints delegate to root-active scripts', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  (supportMap.scripts || []).forEach((row) => {
    if (row.entrypointMode === 'package-safe') return;
    const targetPath = path.join(ROOT_DIR, row.target);
    const source = readText(targetPath);
    const expectedRequire = expectedRequireFor(row);

    assert.ok(
      source.includes(`require('${expectedRequire}')`),
      `${row.target} should delegate to ${expectedRequire}`
    );
  });
});

test('PTE package script entrypoints keep root scripts active as source of truth', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  assert.ok((supportMap.notes || []).some((note) => /root-active scripts/i.test(note)));
  (supportMap.scripts || []).forEach((row) => {
    assert.equal(row.status, 'root-active');
  });
});

test('package-safe PTE script entrypoints do not delegate to root scripts', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  const packageSafeRows = (supportMap.scripts || []).filter((row) => row.entrypointMode === 'package-safe');

  assert.ok(packageSafeRows.some((row) => row.target === 'packages/pte/scripts/maintenance/enable-pte-package.js'));
  packageSafeRows.forEach((row) => {
    const source = readText(path.join(ROOT_DIR, row.target));
    const expectedRequire = expectedRequireFor(row);

    assert.doesNotMatch(source, new RegExp(expectedRequire.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

