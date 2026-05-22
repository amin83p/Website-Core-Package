const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const packageRegistryService = require('../MVC/services/packageRegistryService');

async function withTempRegistryFile(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-registry-'));
  const registryPath = path.join(tempDir, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;
  try {
    await callback({ registryPath, tempDir });
  } finally {
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

test('package registry upsert creates and lists records in json mode', async () => {
  await withTempRegistryFile(async () => {
    const created = await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      version: '1.0.0',
      enabled: true,
      installStatus: 'installed'
    }, { backendMode: 'json', actor: { id: 'USR_A' } });

    assert.equal(created.packageId, 'pte');
    assert.equal(created.id, 'pte');
    assert.equal(created.version, '1.0.0');
    assert.equal(created.enabled, true);
    assert.equal(created.installStatus, 'installed');
    assert.ok(created.installedAt);
    assert.ok(created.updatedAt);

    const rows = await packageRegistryService.listPackageRegistry({ backendMode: 'json' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].packageId, 'pte');
  });
});

test('package registry upsert is idempotent and preserves installedAt on update', async () => {
  await withTempRegistryFile(async () => {
    const first = await packageRegistryService.upsertPackageRegistry({
      packageId: 'school',
      version: '1.0.0',
      enabled: false,
      installStatus: 'pending'
    }, { backendMode: 'json', actor: 'USR_A' });

    const second = await packageRegistryService.upsertPackageRegistry({
      packageId: 'school',
      version: '1.2.0',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json', actor: 'USR_B' });

    assert.equal(first.packageId, second.packageId);
    assert.equal(second.version, '1.2.0');
    assert.equal(second.enabled, true);
    assert.equal(second.installStatus, 'enabled');
    assert.equal(second.installedAt, first.installedAt);
    assert.notEqual(second.audit.lastUpdateUser, first.audit.lastUpdateUser);

    const rows = await packageRegistryService.listPackageRegistry({ backendMode: 'json' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].packageId, 'school');
    assert.equal(rows[0].version, '1.2.0');
  });
});

test('package registry upsert preserves existing status when status is omitted', async () => {
  await withTempRegistryFile(async () => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      version: '1.0.0',
      enabled: false,
      installStatus: 'failed',
      lastError: 'bootstrap error'
    }, { backendMode: 'json' });

    const updated = await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      version: '1.1.0'
    }, { backendMode: 'json' });

    assert.equal(updated.installStatus, 'failed');
    assert.equal(updated.lastError, 'bootstrap error');
    assert.equal(updated.version, '1.1.0');
  });
});

test('setPackageEnabled updates enablement state and installStatus', async () => {
  await withTempRegistryFile(async () => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'credit',
      version: '0.9.0',
      enabled: false,
      installStatus: 'installed'
    }, { backendMode: 'json' });

    const enabled = await packageRegistryService.setPackageEnabled('credit', true, {
      backendMode: 'json'
    });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.installStatus, 'enabled');

    const disabled = await packageRegistryService.setPackageEnabled('credit', false, {
      backendMode: 'json'
    });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.installStatus, 'disabled');
  });
});

test('markPackageInstallFailure records failed status and error message', async () => {
  await withTempRegistryFile(async () => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'ielts',
      version: '1.0.0',
      enabled: true,
      installStatus: 'installed'
    }, { backendMode: 'json' });

    const failed = await packageRegistryService.markPackageInstallFailure(
      'ielts',
      'Dependency migration failed',
      { backendMode: 'json', actor: 'USR_SYS' }
    );
    assert.equal(failed.enabled, false);
    assert.equal(failed.installStatus, 'failed');
    assert.match(String(failed.lastError || ''), /Dependency migration failed/i);
  });
});

test('removePackageRegistry deletes registry row by package id', async () => {
  await withTempRegistryFile(async () => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'benchpath',
      version: '1.0.0',
      enabled: true
    }, { backendMode: 'json' });
    const removed = await packageRegistryService.removePackageRegistry('benchpath', {
      backendMode: 'json'
    });
    assert.equal(removed, true);
    const after = await packageRegistryService.getPackageRegistryById('benchpath', {
      backendMode: 'json'
    });
    assert.equal(after, null);
  });
});
