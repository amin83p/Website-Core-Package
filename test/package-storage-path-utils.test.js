const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  DEFAULT_PACKAGE_ROOT,
  getPackageStorageRootAbsolute
} = require('../MVC/utils/packageStoragePathUtils');

test('package storage root defaults to project packages directory when env is not set', () => {
  const previous = process.env.PACKAGE_STORAGE_ROOT;
  delete process.env.PACKAGE_STORAGE_ROOT;
  try {
    const resolved = getPackageStorageRootAbsolute();
    assert.equal(path.resolve(resolved), path.resolve(DEFAULT_PACKAGE_ROOT));
  } finally {
    if (previous === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
    else process.env.PACKAGE_STORAGE_ROOT = previous;
  }
});

test('package storage root uses PACKAGE_STORAGE_ROOT when configured', async () => {
  const previous = process.env.PACKAGE_STORAGE_ROOT;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-root-'));
  const customRoot = path.join(tmpRoot, 'addon-packages');
  process.env.PACKAGE_STORAGE_ROOT = customRoot;
  try {
    const resolved = getPackageStorageRootAbsolute({ ensureExists: true });
    assert.equal(path.resolve(resolved), path.resolve(customRoot));
  } finally {
    if (previous === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
    else process.env.PACKAGE_STORAGE_ROOT = previous;
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('explicit packageRootDir option overrides env config', async () => {
  const previous = process.env.PACKAGE_STORAGE_ROOT;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-root-explicit-'));
  process.env.PACKAGE_STORAGE_ROOT = path.join(tmpRoot, 'env-root');
  const explicitRoot = path.join(tmpRoot, 'explicit-root');
  try {
    const resolved = getPackageStorageRootAbsolute({ packageRootDir: explicitRoot });
    assert.equal(path.resolve(resolved), path.resolve(explicitRoot));
  } finally {
    if (previous === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
    else process.env.PACKAGE_STORAGE_ROOT = previous;
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

