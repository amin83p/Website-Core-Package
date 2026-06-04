const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROOT_VIEWS_DIR = path.join(ROOT_DIR, 'MVC/views/ielts');
const PACKAGE_VIEWS_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/views/ielts');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('IELTS package pass4 mirrors root IELTS views exactly', () => {
  const rootViews = listFiles(ROOT_VIEWS_DIR);
  const packageViews = listFiles(PACKAGE_VIEWS_DIR);

  assert.equal(rootViews.length, 30);
  assert.deepEqual(packageViews, rootViews);

  rootViews.forEach((name) => {
    assert.equal(
      read(path.join(PACKAGE_VIEWS_DIR, name)),
      read(path.join(ROOT_VIEWS_DIR, name)),
      `${name} should match the root-active IELTS view`
    );
  });
});

test('IELTS package pass4 manifest declares package view namespace', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/ielts/package.manifest.json'), 'utf8'));

  assert.equal(manifest.views.path, 'packages/ielts/MVC/views');
  assert.equal(manifest.views.namespace, 'ielts');
  assert.equal(manifest.views.active, true);
});
