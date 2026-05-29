const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tar = require('tar');

const localPackageSyncService = require('../MVC/services/localPackageSyncService');
const fileGatewayClientService = require('../MVC/services/fileGatewayClientService');

async function withTempWorkspace(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-pkg-sync-'));
  const runtimeRoot = path.join(root, 'runtime-packages');
  const targetRoot = path.join(root, 'local-packages');
  const registryFilePath = path.join(root, 'localPackageRegistry.json');
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });
  try {
    await callback({ root, runtimeRoot, targetRoot, registryFilePath });
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeManifestPackage(runtimeRoot, packageId, version = '1.0.0') {
  const dir = path.join(runtimeRoot, packageId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.manifest.json'), JSON.stringify({
    id: packageId,
    name: packageId.toUpperCase(),
    version,
    mountPath: `/${packageId}`
  }, null, 2), 'utf8');
  return dir;
}

async function makeArchiveBuffer(sourceRoot, packageFolderName) {
  const archivePath = path.join(sourceRoot, `.tmp-${packageFolderName}-${Date.now()}.tar.gz`);
  await tar.c({
    gzip: true,
    file: archivePath,
    cwd: sourceRoot,
    portable: true,
    strict: true
  }, [packageFolderName]);
  const buffer = await fs.readFile(archivePath);
  await fs.rm(archivePath, { force: true });
  return buffer;
}

test('scanMountedPackageSource uses gateway runtime rows', async () => {
  const originalList = fileGatewayClientService.gatewayListRuntimePackages;
  try {
    fileGatewayClientService.gatewayListRuntimePackages = async () => ({
      status: 'success',
      runtime: { packageRootDir: '/app/uploads/packages', source: 'railway-default', warnings: [] },
      packages: [
        { packageId: 'pte', name: 'PTE', version: '1.0.1', mountPath: '/pte', valid: true, reason: '' },
        { folderName: 'broken', packageId: '', valid: false, reason: 'Invalid package manifest.' }
      ]
    });

    const report = await localPackageSyncService.scanMountedPackageSource({
      targetRoot: path.join(os.tmpdir(), 'local-sync-target')
    });

    assert.equal(report.runtimeSource, 'gateway');
    assert.equal(report.packageCount, 2);
    assert.equal(report.validCount, 1);
    assert.equal(report.invalidCount, 1);
    const pteRow = report.packages.find((row) => row.packageId === 'pte');
    const brokenRow = report.packages.find((row) => row.folderName === 'broken');
    assert.equal(Boolean(pteRow?.valid), true);
    assert.equal(Boolean(brokenRow?.valid), false);
  } finally {
    fileGatewayClientService.gatewayListRuntimePackages = originalList;
  }
});

test('syncMountedPackages downloads selected package and refreshes local cache JSON', async () => {
  const originalList = fileGatewayClientService.gatewayListRuntimePackages;
  const originalDownload = fileGatewayClientService.gatewayDownloadRuntimePackage;
  await withTempWorkspace(async ({ runtimeRoot, targetRoot, registryFilePath }) => {
    try {
      const pteDir = await writeManifestPackage(runtimeRoot, 'pte', '1.0.2');
      await fs.writeFile(path.join(pteDir, 'runtime-file.txt'), 'pte-data', 'utf8');
      const ieltsDir = await writeManifestPackage(runtimeRoot, 'ielts', '1.0.3');
      await fs.writeFile(path.join(ieltsDir, 'runtime-file.txt'), 'ielts-data', 'utf8');
      const pteBuffer = await makeArchiveBuffer(runtimeRoot, 'pte');
      const ieltsBuffer = await makeArchiveBuffer(runtimeRoot, 'ielts');

      fileGatewayClientService.gatewayListRuntimePackages = async () => ({
        status: 'success',
        runtime: { packageRootDir: '/app/uploads/packages', source: 'railway-default', warnings: [] },
        packages: [
          { folderName: 'pte', packageDir: '/app/uploads/packages/pte', packageId: 'pte', name: 'PTE', version: '1.0.2', mountPath: '/pte', manifestPath: '/app/uploads/packages/pte/package.manifest.json', valid: true, reason: '' },
          { folderName: 'ielts', packageDir: '/app/uploads/packages/ielts', packageId: 'ielts', name: 'IELTS', version: '1.0.3', mountPath: '/ielts', manifestPath: '/app/uploads/packages/ielts/package.manifest.json', valid: true, reason: '' }
        ]
      });
      fileGatewayClientService.gatewayDownloadRuntimePackage = async (packageId) => ({
        fileName: `${packageId}.tar.gz`,
        buffer: packageId === 'pte' ? pteBuffer : ieltsBuffer
      });

      const pteTarget = path.join(targetRoot, 'pte');
      await fs.mkdir(pteTarget, { recursive: true });
      await fs.writeFile(path.join(pteTarget, 'stale.txt'), 'stale', 'utf8');

      const report = await localPackageSyncService.syncMountedPackages({
        targetRoot,
        registryFilePath,
        selectedPackageIds: ['pte'],
        syncAll: false
      });

      assert.equal(report.status, 'success');
      assert.equal(report.syncedCount, 1);
      assert.equal(report.failedCount, 0);
      assert.equal(report.syncedPackages[0].packageId, 'pte');

      await assert.rejects(fs.access(path.join(targetRoot, 'pte', 'stale.txt')), /ENOENT/);
      await fs.access(path.join(targetRoot, 'pte', 'package.manifest.json'));
      await fs.access(path.join(targetRoot, 'pte', 'runtime-file.txt'));
      await assert.rejects(fs.access(path.join(targetRoot, 'ielts', 'package.manifest.json')), /ENOENT/);

      const cacheRaw = await fs.readFile(registryFilePath, 'utf8');
      const cache = JSON.parse(cacheRaw);
      assert.equal(Array.isArray(cache.packages), true);
      assert.equal(cache.packages.length, 1);
      assert.equal(cache.packages[0].packageId, 'pte');
      assert.match(String(cache.sourceRoot || ''), /\/app\/uploads\/packages/i);
    } finally {
      fileGatewayClientService.gatewayListRuntimePackages = originalList;
      fileGatewayClientService.gatewayDownloadRuntimePackage = originalDownload;
    }
  });
});

test('syncMountedPackages with syncAll=true honors selected package ids', async () => {
  const originalList = fileGatewayClientService.gatewayListRuntimePackages;
  const originalDownload = fileGatewayClientService.gatewayDownloadRuntimePackage;
  await withTempWorkspace(async ({ runtimeRoot, targetRoot, registryFilePath }) => {
    try {
      await writeManifestPackage(runtimeRoot, 'pte', '1.0.0');
      await writeManifestPackage(runtimeRoot, 'ielts', '1.0.0');
      const pteBuffer = await makeArchiveBuffer(runtimeRoot, 'pte');
      const ieltsBuffer = await makeArchiveBuffer(runtimeRoot, 'ielts');

      fileGatewayClientService.gatewayListRuntimePackages = async () => ({
        status: 'success',
        runtime: { packageRootDir: '/app/uploads/packages', source: 'railway-default', warnings: [] },
        packages: [
          { folderName: 'pte', packageDir: '/app/uploads/packages/pte', packageId: 'pte', name: 'PTE', version: '1.0.0', mountPath: '/pte', manifestPath: '/app/uploads/packages/pte/package.manifest.json', valid: true, reason: '' },
          { folderName: 'ielts', packageDir: '/app/uploads/packages/ielts', packageId: 'ielts', name: 'IELTS', version: '1.0.0', mountPath: '/ielts', manifestPath: '/app/uploads/packages/ielts/package.manifest.json', valid: true, reason: '' }
        ]
      });
      fileGatewayClientService.gatewayDownloadRuntimePackage = async (packageId) => ({
        fileName: `${packageId}.tar.gz`,
        buffer: packageId === 'pte' ? pteBuffer : ieltsBuffer
      });

      const report = await localPackageSyncService.syncMountedPackages({
        targetRoot,
        registryFilePath,
        selectedPackageIds: ['ielts'],
        syncAll: true
      });

      assert.equal(report.syncedCount, 1);
      assert.equal(report.syncedPackages[0].packageId, 'ielts');
      await fs.access(path.join(targetRoot, 'ielts', 'package.manifest.json'));
      await assert.rejects(fs.access(path.join(targetRoot, 'pte', 'package.manifest.json')), /ENOENT/);
    } finally {
      fileGatewayClientService.gatewayListRuntimePackages = originalList;
      fileGatewayClientService.gatewayDownloadRuntimePackage = originalDownload;
    }
  });
});

test('syncMountedPackages blocks archive payload outside selected package root', async () => {
  const originalList = fileGatewayClientService.gatewayListRuntimePackages;
  const originalDownload = fileGatewayClientService.gatewayDownloadRuntimePackage;
  await withTempWorkspace(async ({ runtimeRoot, targetRoot, registryFilePath }) => {
    try {
      await writeManifestPackage(runtimeRoot, 'pte', '1.0.0');
      await writeManifestPackage(runtimeRoot, 'otherpkg', '1.0.0');
      const wrongBuffer = await makeArchiveBuffer(runtimeRoot, 'otherpkg');

      fileGatewayClientService.gatewayListRuntimePackages = async () => ({
        status: 'success',
        runtime: { packageRootDir: '/app/uploads/packages', source: 'railway-default', warnings: [] },
        packages: [
          { folderName: 'pte', packageDir: '/app/uploads/packages/pte', packageId: 'pte', name: 'PTE', version: '1.0.0', mountPath: '/pte', manifestPath: '/app/uploads/packages/pte/package.manifest.json', valid: true, reason: '' }
        ]
      });
      fileGatewayClientService.gatewayDownloadRuntimePackage = async () => ({
        fileName: 'pte.tar.gz',
        buffer: wrongBuffer
      });

      await assert.rejects(
        localPackageSyncService.syncMountedPackages({
          targetRoot,
          registryFilePath,
          selectedPackageIds: ['pte'],
          syncAll: false
        }),
        /No packages were synced/i
      );
    } finally {
      fileGatewayClientService.gatewayListRuntimePackages = originalList;
      fileGatewayClientService.gatewayDownloadRuntimePackage = originalDownload;
    }
  });
});
