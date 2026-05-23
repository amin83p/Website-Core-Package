const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CURRENT_MIDDLEWARE_ROOT = path.join(ROOT_DIR, 'MVC/middleware');
const PACKAGE_MIDDLEWARE_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/middleware');
const CURRENT_UTIL_ROOT = path.join(ROOT_DIR, 'MVC/utils');
const PACKAGE_UTIL_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/utils');

const PTE_MIDDLEWARE_FILES = Object.freeze([
  'pteUploadContextMiddleware.js'
]);

const PTE_UTILITY_FILES = Object.freeze([
  'pteUploadPathUtils.js'
]);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedShimRequirePath({ packageRoot, currentRoot, relativeFile }) {
  const packageShimPath = path.join(packageRoot, relativeFile);
  const currentPath = path.join(currentRoot, relativeFile).replace(/\.js$/, '');
  let relativeRequirePath = path.relative(path.dirname(packageShimPath), currentPath).replace(/\\/g, '/');
  if (!relativeRequirePath.startsWith('.')) {
    relativeRequirePath = `./${relativeRequirePath}`;
  }
  return relativeRequirePath;
}

function assertShimSet({ files, packageRoot, currentRoot }) {
  files.forEach((relativeFile) => {
    assert.equal(fs.existsSync(path.join(currentRoot, relativeFile)), true, `${relativeFile} should exist in current MVC`);
    assert.equal(fs.existsSync(path.join(packageRoot, relativeFile)), true, `${relativeFile} should exist in the package`);
  });
}

function assertDelegates({ files, packageRoot, currentRoot }) {
  files.forEach((relativeFile) => {
    const packageShimPath = path.join(packageRoot, relativeFile);
    const source = readText(packageShimPath);
    const expectedRequire = expectedShimRequirePath({
      packageRoot,
      currentRoot,
      relativeFile
    });

    assert.ok(
      source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should delegate to ${expectedRequire}`
    );
  });
}

test('PTE package middleware and utility shims exist for upload boundaries', () => {
  assertShimSet({
    files: PTE_MIDDLEWARE_FILES,
    packageRoot: PACKAGE_MIDDLEWARE_ROOT,
    currentRoot: CURRENT_MIDDLEWARE_ROOT
  });
  assertShimSet({
    files: PTE_UTILITY_FILES,
    packageRoot: PACKAGE_UTIL_ROOT,
    currentRoot: CURRENT_UTIL_ROOT
  });
});

test('PTE package middleware and utility shims delegate to current MVC modules', () => {
  assertDelegates({
    files: PTE_MIDDLEWARE_FILES,
    packageRoot: PACKAGE_MIDDLEWARE_ROOT,
    currentRoot: CURRENT_MIDDLEWARE_ROOT
  });
  assertDelegates({
    files: PTE_UTILITY_FILES,
    packageRoot: PACKAGE_UTIL_ROOT,
    currentRoot: CURRENT_UTIL_ROOT
  });
});

test('PTE package middleware and utility shims export current modules', () => {
  [
    {
      packageRoot: PACKAGE_MIDDLEWARE_ROOT,
      currentRoot: CURRENT_MIDDLEWARE_ROOT,
      relativeFile: 'pteUploadContextMiddleware.js'
    },
    {
      packageRoot: PACKAGE_UTIL_ROOT,
      currentRoot: CURRENT_UTIL_ROOT,
      relativeFile: 'pteUploadPathUtils.js'
    }
  ].forEach(({ packageRoot, currentRoot, relativeFile }) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageModule = require(path.join(packageRoot, relativeFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentModule = require(path.join(currentRoot, relativeFile));
    assert.equal(packageModule, currentModule, `${relativeFile} should export the current module`);
  });
});

