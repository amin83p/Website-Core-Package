const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'MVC'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Unable to resolve project root.');
}

const ROOT_DIR = findProjectRoot(__dirname);
const CURRENT_MODEL_ROOT = path.join(ROOT_DIR, 'MVC/models/pte');
const PACKAGE_MODEL_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/models/pte');
const CURRENT_REPOSITORY_ROOT = path.join(ROOT_DIR, 'MVC/repositories');
const PACKAGE_REPOSITORY_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/repositories');

function listJsFiles(rootDir) {
  const found = [];

  function visit(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        found.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
      }
    });
  }

  visit(rootDir);
  return found.sort();
}

function listPteRepositoryFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^pte.*\.js$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedShimRequirePath({ shimRoot, targetRoot, relativeFile }) {
  const shimPath = path.join(shimRoot, relativeFile);
  const targetPath = path.join(targetRoot, relativeFile).replace(/\.js$/, '');
  let relativeRequirePath = path.relative(path.dirname(shimPath), targetPath).replace(/\\/g, '/');
  if (!relativeRequirePath.startsWith('.')) {
    relativeRequirePath = `./${relativeRequirePath}`;
  }
  return relativeRequirePath;
}

const packageOnlyRepositoryAdapters = new Set([
  'pteAiRepositoryDependencies.js'
]);

test('PTE package model implementations mirror the root compatibility model tree', () => {
  const currentFiles = listJsFiles(CURRENT_MODEL_ROOT);
  const packageFiles = listJsFiles(PACKAGE_MODEL_ROOT);

  assert.deepEqual(packageFiles, currentFiles);
});

test('PTE package repository implementations mirror the root compatibility repository modules', () => {
  const currentFiles = listPteRepositoryFiles(CURRENT_REPOSITORY_ROOT);
  const packageFiles = listPteRepositoryFiles(PACKAGE_REPOSITORY_ROOT)
    .filter((relativeFile) => !packageOnlyRepositoryAdapters.has(relativeFile));

  assert.deepEqual(packageFiles, currentFiles);
});

test('root PTE model compatibility shims delegate to package-owned models', () => {
  listJsFiles(CURRENT_MODEL_ROOT).forEach((relativeFile) => {
    const rootShimPath = path.join(CURRENT_MODEL_ROOT, relativeFile);
    const source = readText(rootShimPath).trim();
    const expectedRequire = expectedShimRequirePath({
      shimRoot: CURRENT_MODEL_ROOT,
      targetRoot: PACKAGE_MODEL_ROOT,
      relativeFile
    });

    assert.equal(
      source,
      `module.exports = require('${expectedRequire}');`,
      `${relativeFile} should delegate to package model ${expectedRequire}`
    );
  });
});

test('root PTE repository compatibility shims delegate to package-owned repositories', () => {
  listPteRepositoryFiles(CURRENT_REPOSITORY_ROOT).forEach((relativeFile) => {
    const rootShimPath = path.join(CURRENT_REPOSITORY_ROOT, relativeFile);
    const source = readText(rootShimPath).trim();
    const expectedRequire = expectedShimRequirePath({
      shimRoot: CURRENT_REPOSITORY_ROOT,
      targetRoot: PACKAGE_REPOSITORY_ROOT,
      relativeFile
    });

    assert.equal(
      source,
      `module.exports = require('${expectedRequire}');`,
      `${relativeFile} should delegate to package repository ${expectedRequire}`
    );
  });
});

test('PTE package models and repositories are active implementations, not root shims', () => {
  listJsFiles(PACKAGE_MODEL_ROOT).forEach((relativeFile) => {
    const source = readText(path.join(PACKAGE_MODEL_ROOT, relativeFile)).trim();
    assert.doesNotMatch(source, /MVC\/models\/pte/);
    assert.doesNotMatch(source, /MVC\\models\\pte/);
    assert.doesNotMatch(source, /^module\.exports\s*=\s*require\(/);
  });

  listPteRepositoryFiles(PACKAGE_REPOSITORY_ROOT)
    .filter((relativeFile) => !packageOnlyRepositoryAdapters.has(relativeFile))
    .forEach((relativeFile) => {
      const source = readText(path.join(PACKAGE_REPOSITORY_ROOT, relativeFile)).trim();
      assert.doesNotMatch(source, /MVC\/repositories\/pte/);
      assert.doesNotMatch(source, /MVC\\repositories\\pte/);
      assert.doesNotMatch(source, /^module\.exports\s*=\s*require\(/);
    });
});

test('representative PTE root shims export package-owned model and repository modules', () => {
  [
    {
      rootPath: path.join(CURRENT_MODEL_ROOT, 'pteAttemptModelUtils.js'),
      packagePath: path.join(PACKAGE_MODEL_ROOT, 'pteAttemptModelUtils.js')
    },
    {
      rootPath: path.join(CURRENT_REPOSITORY_ROOT, 'pteApplicantRepository.js'),
      packagePath: path.join(PACKAGE_REPOSITORY_ROOT, 'pteApplicantRepository.js')
    }
  ].forEach(({ rootPath, packagePath }) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootModule = require(rootPath);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageModule = require(packagePath);
    assert.equal(rootModule, packageModule, `${rootPath} should export ${packagePath}`);
  });
});
