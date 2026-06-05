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

function repoPath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

test('IELTS package pass14 removed root MVC IELTS shim folders after package migration', () => {
  const retiredFolders = [
    'MVC/controllers/ielts',
    'MVC/models/ielts',
    'MVC/services/ielts',
    'MVC/repositories/ielts',
    'MVC/views/ielts',
    'MVC/routes/ielts'
  ];

  retiredFolders.forEach((folder) => {
    assert.equal(fs.existsSync(repoPath(folder)), false, `${folder} should be removed`);
  });
});

test('IELTS package pass14 package folders remain complete', () => {
  const packageFolders = [
    'packages/ielts/MVC/controllers/ielts',
    'packages/ielts/MVC/models/ielts',
    'packages/ielts/MVC/services/ielts',
    'packages/ielts/MVC/repositories/ielts',
    'packages/ielts/MVC/views/ielts',
    'packages/ielts/MVC/routes/ielts'
  ];

  packageFolders.forEach((folder) => {
    assert.equal(fs.existsSync(repoPath(folder)), true, `${folder} should exist`);
  });
});

test('IELTS package pass14 keeps runtime data app-level during root shim retirement', () => {
  assert.equal(fs.existsSync(repoPath('data/ielts')), true);
  assert.equal(fs.existsSync(repoPath('packages/ielts/data')), false);
});
