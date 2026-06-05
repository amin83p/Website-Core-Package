const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'test/ielts-package-ownership-registry.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error(`Unable to locate project root from ${startDir}`);
}

const ROOT_DIR = findProjectRoot(__dirname);
const OWNERSHIP_REGISTRY_PATH = path.join(ROOT_DIR, 'test/ielts-package-ownership-registry.json');
const ROOT_VIEWS_DIR = path.join(ROOT_DIR, 'MVC/views/ielts');
const PACKAGE_VIEWS_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/views/ielts');
const PACKAGE_MANIFEST_PATH = path.join(ROOT_DIR, 'packages/ielts/package.manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

test('IELTS package pass4 keeps package-owned IELTS views in package folder', () => {
  assert.equal(fs.existsSync(ROOT_VIEWS_DIR), false, 'legacy root views folder should be retired');
  assert.equal(fs.existsSync(PACKAGE_VIEWS_DIR), true, 'package view folder should exist');

  const manifest = readJson(PACKAGE_MANIFEST_PATH);
  const ownership = readJson(OWNERSHIP_REGISTRY_PATH);
  const expectedViews = [...(ownership.views || [])].sort();
  const packageViews = listFiles(PACKAGE_VIEWS_DIR);

  assert.equal(packageViews.length, 30);
  assert.equal(packageViews.length, expectedViews.length, 'package view count should match ownership manifest');
  assert.deepEqual(packageViews, expectedViews);
  assert.equal(manifest.views.path, 'packages/ielts/MVC/views');
  assert.equal(manifest.views.namespace, 'ielts');
  assert.equal(manifest.views.active, true);
});
