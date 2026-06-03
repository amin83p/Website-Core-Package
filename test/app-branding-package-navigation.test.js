const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageNavigationService = require('../MVC/services/packageNavigationService');
const appBrandingService = require('../MVC/services/appBrandingService');

async function withTempPackageWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'app-brand-nav-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const previousRegistryPath = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;

  try {
    await fs.mkdir(packageRootDir, { recursive: true });
    await callback({ tempRoot, packageRootDir });
  } finally {
    packageNavigationService.resetCache();
    if (previousRegistryPath === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = previousRegistryPath;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeManifest(packageRootDir, packageId, payload) {
  const dir = path.join(packageRootDir, packageId);
  await fs.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'package.manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
  return manifestPath;
}

test('app branding public menu stays curated while settings options include enabled package entries', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'beta', {
      id: 'beta',
      name: 'Beta',
      version: '1.0.0',
      mountPath: '/beta',
      menuEntries: [
        { id: 'beta-home', label: 'Beta Home', href: '/beta', icon: 'bi-grid', visibility: 'all' }
      ]
    });
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'beta',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: false,
      installStatus: 'disabled'
    }, { backendMode: 'json' });

    await packageNavigationService.refreshNavigationRegistry({
      backendMode: 'json',
      packageRootDir
    });

    const publicMenu = appBrandingService.getPublicMenu(null);
    assert.equal(publicMenu.some((entry) => entry.href === '/pte'), false);
    assert.equal(publicMenu.some((entry) => entry.href === '/beta' && entry.label === 'Beta Home'), false);

    const endpointOptions = appBrandingService.getPublicMenuEndpointOptions();
    assert.equal(endpointOptions.some((entry) => entry.href === '/pte'), false);
    assert.equal(endpointOptions.some((entry) => entry.href === '/beta' && entry.label === 'Beta Home'), true);
  });
});
