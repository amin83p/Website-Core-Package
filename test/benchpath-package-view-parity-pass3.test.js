const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROOT_VIEWS_DIR = path.join(ROOT_DIR, 'MVC/views/benchpath');
const PACKAGE_VIEWS_DIR = path.join(ROOT_DIR, 'packages/benchpath/MVC/views/benchpath');

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

test('BenchPath package pass3 mirrors root BenchPath views exactly', () => {
  const rootViews = listFilesRecursive(ROOT_VIEWS_DIR);
  const packageViews = listFilesRecursive(PACKAGE_VIEWS_DIR);

  assert.equal(rootViews.length, 26);
  assert.deepEqual(packageViews, rootViews);

  rootViews.forEach((name) => {
    assert.equal(
      read(path.join(PACKAGE_VIEWS_DIR, ...name.split('/'))),
      read(path.join(ROOT_VIEWS_DIR, ...name.split('/'))),
      `${name} should match the root-active BenchPath view`
    );
  });
});

test('BenchPath package pass3 manifest declares package view namespace', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json'), 'utf8'));

  assert.equal(manifest.views.path, 'packages/benchpath/MVC/views');
  assert.equal(manifest.views.namespace, 'benchpath');
  assert.equal(manifest.views.active, true);
});
