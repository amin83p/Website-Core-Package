const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
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

const packageOwnedRepositories = new Set([
  'pteAiProviderRepository.js',
  'pteAiScoringSettingRepository.js',
  'pteAiTokenUsageRepository.js'
]);

function expectedShimRequirePath({ packageRoot, currentRoot, relativeFile }) {
  const packageShimPath = path.join(packageRoot, relativeFile);
  const currentPath = path.join(currentRoot, relativeFile).replace(/\.js$/, '');
  let relativeRequirePath = path.relative(path.dirname(packageShimPath), currentPath).replace(/\\/g, '/');
  if (!relativeRequirePath.startsWith('.')) {
    relativeRequirePath = `./${relativeRequirePath}`;
  }
  return relativeRequirePath;
}

test('PTE package model shims mirror the current PTE model tree', () => {
  const currentFiles = listJsFiles(CURRENT_MODEL_ROOT);
  const packageFiles = listJsFiles(PACKAGE_MODEL_ROOT);

  assert.deepEqual(packageFiles, currentFiles);
});

test('PTE package repository shims mirror the current flat PTE repository modules', () => {
  const currentFiles = listPteRepositoryFiles(CURRENT_REPOSITORY_ROOT);
  const packageFiles = listPteRepositoryFiles(PACKAGE_REPOSITORY_ROOT);

  assert.deepEqual(packageFiles, currentFiles);
});

test('PTE package model shims delegate to current MVC model modules', () => {
  listJsFiles(CURRENT_MODEL_ROOT).forEach((relativeFile) => {
    const packageShimPath = path.join(PACKAGE_MODEL_ROOT, relativeFile);
    const source = readText(packageShimPath);
    const expectedRequire = expectedShimRequirePath({
      packageRoot: PACKAGE_MODEL_ROOT,
      currentRoot: CURRENT_MODEL_ROOT,
      relativeFile
    });

    assert.ok(
      source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should delegate to ${expectedRequire}`
    );
  });
});

test('PTE package repository shims delegate to current MVC repository modules', () => {
  listPteRepositoryFiles(CURRENT_REPOSITORY_ROOT).forEach((relativeFile) => {
    if (packageOwnedRepositories.has(relativeFile)) {
      return;
    }

    const packageShimPath = path.join(PACKAGE_REPOSITORY_ROOT, relativeFile);
    const source = readText(packageShimPath);
    const expectedRequire = expectedShimRequirePath({
      packageRoot: PACKAGE_REPOSITORY_ROOT,
      currentRoot: CURRENT_REPOSITORY_ROOT,
      relativeFile
    });

    assert.ok(
      source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should delegate to ${expectedRequire}`
    );
  });
});

test('PTE package-owned AI Assist repositories are not simple shims', () => {
  packageOwnedRepositories.forEach((relativeFile) => {
    const packageRepositoryPath = path.join(PACKAGE_REPOSITORY_ROOT, relativeFile);
    const source = readText(packageRepositoryPath);
    const expectedRequire = expectedShimRequirePath({
      packageRoot: PACKAGE_REPOSITORY_ROOT,
      currentRoot: CURRENT_REPOSITORY_ROOT,
      relativeFile
    });

    assert.ok(
      !source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should not delegate to ${expectedRequire}`
    );
  });
});

test('representative PTE package model and repository shims export current modules', () => {
  [
    {
      packageRoot: PACKAGE_MODEL_ROOT,
      currentRoot: CURRENT_MODEL_ROOT,
      relativeFile: 'pteAttemptModelUtils.js'
    },
    {
      packageRoot: PACKAGE_REPOSITORY_ROOT,
      currentRoot: CURRENT_REPOSITORY_ROOT,
      relativeFile: 'pteApplicantRepository.js'
    }
  ].forEach(({ packageRoot, currentRoot, relativeFile }) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageModule = require(path.join(packageRoot, relativeFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentModule = require(path.join(currentRoot, relativeFile));
    assert.equal(packageModule, currentModule, `${relativeFile} should export the current module`);
  });
});
