const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageNavigationService = require('../MVC/services/packageNavigationService');

async function withTempPackageWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-nav-'));
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

test('package navigation loads enabled manifest declarations for menu + dashboard', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'alpha', {
      id: 'alpha',
      name: 'Alpha',
      version: '1.0.0',
      mountPath: '/alpha',
      menuEntries: [
        {
          id: 'alpha-docs',
          label: 'Alpha Docs',
          href: '/alpha/docs',
          icon: 'bi-journal-text',
          visibility: 'all'
        }
      ],
      dashboardEntries: [
        {
          id: 'alpha-home',
          label: 'Alpha Dashboard',
          href: '/alpha',
          icon: 'bi-box',
          visibility: 'authenticated'
        }
      ]
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'alpha',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const snapshot = await packageNavigationService.refreshNavigationRegistry({
      backendMode: 'json',
      packageRootDir
    });

    assert.equal(snapshot.enabledPackageIds.includes('alpha'), true);
    const publicEntries = packageNavigationService.getPublicMenuEntries(null);
    const hasAlphaMenu = publicEntries.some((entry) => entry.href === '/alpha/docs' && entry.label === 'Alpha Docs');
    assert.equal(hasAlphaMenu, true);

    const guestDashboardEntries = packageNavigationService.getDashboardEntries(null);
    assert.equal(guestDashboardEntries.some((entry) => entry.href === '/alpha'), false);

    const authDashboardEntries = packageNavigationService.getDashboardEntries({ id: 'U1' });
    assert.equal(authDashboardEntries.some((entry) => entry.href === '/alpha'), true);
  });
});

test('disabled packages contribute mount-path filtering for menu entries', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: false,
      installStatus: 'disabled'
    }, { backendMode: 'json' });

    const snapshot = await packageNavigationService.refreshNavigationRegistry({
      backendMode: 'json',
      packageRootDir
    });
    assert.equal(snapshot.disabledPackageIds.includes('pte'), true);
    assert.equal(snapshot.disabledMountPaths.includes('/pte'), true);

    const filtered = packageNavigationService.filterMenuItemsAgainstDisabledPackages([
      { id: 'home', label: 'Home', href: '/' },
      { id: 'pte', label: 'PTE', href: '/pte' },
      { id: 'pte-sub', label: 'PTE Packages', href: '/pte/packages' },
      { id: 'about', label: 'About', href: '/about' }
    ]);

    assert.equal(filtered.some((entry) => entry.href === '/pte'), false);
    assert.equal(filtered.some((entry) => entry.href === '/pte/packages'), false);
    assert.equal(filtered.some((entry) => entry.href === '/about'), true);
  });
});

test('PTE navigation comes from manifest declarations instead of compat fallback', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      menuEntries: [
        {
          id: 'pte-join',
          label: 'Join PTE Practice',
          href: '/pte/join',
          icon: 'bi-person-plus',
          visibility: 'all'
        }
      ],
      dashboardEntries: [
        {
          id: 'pte-dashboard',
          label: 'PTE Dashboard',
          href: '/pte/dashboard',
          icon: 'bi-mortarboard',
          visibility: 'authenticated'
        }
      ]
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const snapshot = await packageNavigationService.refreshNavigationRegistry({
      backendMode: 'json',
      packageRootDir
    });

    assert.equal(snapshot.enabledPackageIds.includes('pte'), true);
    assert.equal(snapshot.dashboardEntries.some((entry) => entry.href === '/pte/dashboard'), true);
    assert.equal(snapshot.dashboardEntries.some((entry) => entry.href === '/pte'), false);
    assert.equal(packageNavigationService.getPublicMenuEntries(null).some((entry) => entry.href === '/pte/join'), true);
  });
});

test('primary dashboard href resolves from enabled package dashboard entries', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'gamma', {
      id: 'gamma',
      name: 'Gamma',
      version: '1.0.0',
      mountPath: '/gamma',
      dashboardEntries: [
        {
          id: 'gamma-dashboard',
          label: 'Gamma Dashboard',
          href: '/gamma/dashboard',
          icon: 'bi-box',
          visibility: 'authenticated'
        }
      ]
    });

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'gamma',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    await packageNavigationService.refreshNavigationRegistry({
      backendMode: 'json',
      packageRootDir
    });

    assert.equal(packageNavigationService.getPrimaryDashboardHref({ id: 'U1' }, { fallback: '/dashboard' }), '/gamma/dashboard');
    assert.equal(packageNavigationService.getPrimaryDashboardHref(null, { fallback: '/dashboard' }), '/dashboard');
  });
});

test('core dashboard redirects are package-navigation driven instead of PTE literals', async () => {
  const [authSource, dashboardRouteSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../MVC/controllers/authController.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../MVC/routes/dashboardRoutes.js'), 'utf8')
  ]);

  assert.doesNotMatch(authSource, /\/pte\/dashboard/);
  assert.doesNotMatch(dashboardRouteSource, /\/pte\/dashboard/);
  assert.match(authSource, /packageNavigationService\.getPrimaryDashboardHref/);
  assert.match(dashboardRouteSource, /packageNavigationService\.getPrimaryDashboardHref/);
});
