const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_VIEWS_DIR = path.join(ROOT_DIR, 'packages/benchpath/MVC/views/benchpath');
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/benchpath-package-ownership-registry.json');

function listFilesRecursive(dir, baseDir = dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(absPath, baseDir);
      if (!entry.isFile()) return [];
      return [path.relative(baseDir, absPath).replace(/\\/g, '/')];
    })
    .sort();
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('BenchPath package owns view inventory after root view retirement', () => {
  const registry = readJson(REGISTRY_PATH);
  const packageViews = listFilesRecursive(PACKAGE_VIEWS_DIR);

  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'MVC/views/benchpath')), false);
  assert.equal(packageViews.length, 26);
  assert.deepEqual(packageViews, [...registry.views].sort());
});

test('BenchPath package pass3 manifest declares package view namespace', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json'), 'utf8'));

  assert.equal(manifest.views.path, 'packages/benchpath/MVC/views');
  assert.equal(manifest.views.namespace, 'benchpath');
  assert.equal(manifest.views.active, true);
});
