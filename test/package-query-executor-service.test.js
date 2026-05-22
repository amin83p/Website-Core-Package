const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  getEntityQueryExecutor,
  clearEntityQueryExecutors
} = require('../MVC/models/queryExecutionBridge');
const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageQueryExecutorService = require('../MVC/services/packageQueryExecutorService');

async function withTempWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-query-exec-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;

  try {
    await fs.mkdir(packageRootDir, { recursive: true });
    await callback({ tempRoot, packageRootDir, registryPath });
  } finally {
    clearEntityQueryExecutors();
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeRepositoryModule(tempRoot, name) {
  const modulePath = path.join(tempRoot, `${name}.repo.js`);
  const moduleCode = [
    'module.exports = {',
    '  samples: {',
    '    list: async (options = {}) => [{ id: "ROW1", skipExecutor: options.skipExecutor === true }]',
    '  }',
    '};',
    ''
  ].join('\n');
  await fs.writeFile(modulePath, moduleCode, 'utf8');
  return modulePath;
}

async function writeManifest(packageRootDir, packageId, payload) {
  const dir = path.join(packageRootDir, packageId);
  await fs.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'package.manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
  return manifestPath;
}

test('registerManifestQueryExecutors registers declared repository list handlers in json mode', async () => {
  await withTempWorkspace(async ({ tempRoot }) => {
    const modulePath = await writeRepositoryModule(tempRoot, 'custom');
    const summary = await packageQueryExecutorService.registerManifestQueryExecutors({
      packageId: 'custompkg',
      backendMode: 'json',
      manifest: {
        id: 'custompkg',
        queryExecutors: [
          {
            entity: 'custom.items',
            modulePath,
            repository: 'samples'
          }
        ]
      }
    });

    assert.equal(summary.requested, 1);
    assert.equal(summary.registered, 1);
    const executor = getEntityQueryExecutor('custom.items');
    assert.equal(typeof executor, 'function');
    const rows = await executor({ query: {}, scope: {} });
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows[0].skipExecutor, true);
  });
});

test('registerManifestQueryExecutors is a no-op in non-json mode', async () => {
  await withTempWorkspace(async ({ tempRoot }) => {
    const modulePath = await writeRepositoryModule(tempRoot, 'mongo-skip');
    const summary = await packageQueryExecutorService.registerManifestQueryExecutors({
      packageId: 'custompkg',
      backendMode: 'mongo',
      manifest: {
        id: 'custompkg',
        queryExecutors: [
          {
            entity: 'custom.items',
            modulePath,
            repository: 'samples'
          }
        ]
      }
    });

    assert.equal(summary.requested, 0);
    assert.equal(summary.registered, 0);
    assert.equal(getEntityQueryExecutor('custom.items'), null);
  });
});

test('refreshEnabledPackageQueryExecutors reloads enabled package manifests from registry', async () => {
  await withTempWorkspace(async ({ tempRoot, packageRootDir }) => {
    const modulePath = await writeRepositoryModule(tempRoot, 'registry');
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      queryExecutors: [
        {
          entity: 'pte.sampleentity',
          modulePath,
          repository: 'samples'
        }
      ]
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const summary = await packageQueryExecutorService.refreshEnabledPackageQueryExecutors({
      backendMode: 'json',
      packageRootDir
    });

    assert.equal(summary.registered, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.packages.length, 1);
    assert.equal(summary.packages[0].packageId, 'pte');
    assert.equal(typeof getEntityQueryExecutor('pte.sampleentity'), 'function');
  });
});
