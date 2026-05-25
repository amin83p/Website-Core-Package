const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const RETIRED_SHIM_BASELINE_COUNT = 117;

const ROOT_SHIM_LOCATIONS = [
  'MVC/controllers/pte',
  'MVC/services/pte',
  'MVC/models/pte',
  'MVC/routes/pte',
  'MVC/repositories',
  'MVC/middleware/pteUploadContextMiddleware.js',
  'MVC/utils/pteUploadPathUtils.js'
];

function listRepositoryPteShims() {
  const repositoryDir = path.join(ROOT_DIR, 'MVC/repositories');
  if (!fs.existsSync(repositoryDir)) return [];
  return fs.readdirSync(repositoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^pte.*\.js$/i.test(entry.name))
    .map((entry) => path.join(repositoryDir, entry.name));
}

function countLegacyShimFiles() {
  const candidates = [];
  const controllerDir = path.join(ROOT_DIR, 'MVC/controllers/pte');
  const serviceDir = path.join(ROOT_DIR, 'MVC/services/pte');
  const modelDir = path.join(ROOT_DIR, 'MVC/models/pte');
  const routeDir = path.join(ROOT_DIR, 'MVC/routes/pte');
  [controllerDir, serviceDir, modelDir, routeDir].forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          return;
        }
        if (entry.isFile() && entry.name.endsWith('.js')) candidates.push(fullPath);
      });
    };
    walk(dirPath);
  });
  candidates.push(...listRepositoryPteShims());
  ['MVC/middleware/pteUploadContextMiddleware.js', 'MVC/utils/pteUploadPathUtils.js'].forEach((relativePath) => {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    if (fs.existsSync(absolutePath)) candidates.push(absolutePath);
  });

  return candidates.filter((absolutePath) => {
    const source = fs.readFileSync(absolutePath, 'utf8').trim();
    return /^module\.exports\s*=\s*require\(['"].*packages\/pte\/.*['"]\);?$/.test(source.replace(/\\/g, '/'));
  }).length;
}

test('retirement baseline metadata remains explicit', () => {
  assert.equal(RETIRED_SHIM_BASELINE_COUNT, 117);
});

test('root pte compatibility shim locations are retired', () => {
  ROOT_SHIM_LOCATIONS.forEach((relativePath) => {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    if (relativePath === 'MVC/repositories') {
      const pteRepoShims = listRepositoryPteShims();
      assert.equal(pteRepoShims.length, 0, 'PTE root repository shim files should be removed.');
      return;
    }
    assert.equal(fs.existsSync(absolutePath), false, `${relativePath} should be retired from root MVC.`);
  });
});

test('no remaining one-line root exports delegate into packages/pte', () => {
  assert.equal(countLegacyShimFiles(), 0);
});
