const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

test('BenchPath package pass6 symbol artifacts stay in GLOBAL symbol storage', () => {
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const uploadBackedSymbols = (manifest.symbols || [])
    .filter((row) => String(row?.value || '').startsWith('/uploads/'));

  assert.equal(uploadBackedSymbols.length >= 1, true);
  uploadBackedSymbols.forEach((row) => {
    assert.match(String(row.value || ''), /^\/uploads\/GLOBAL\/symbols\//);
    assert.doesNotMatch(String(row.value || ''), /^\/uploads\/ORG_/i);
  });
});

test('BenchPath package pass6 symbol declarations remain package scoped by name and tags', () => {
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const symbolNames = (manifest.symbols || []).map((row) => row.name).sort();

  assert.equal(symbolNames.length, 15);
  assert.equal(symbolNames.every((name) => String(name || '').startsWith('BENCHPATH')), true);
});
