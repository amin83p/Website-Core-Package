const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_PATH = path.join(__dirname, '../app.js');

test('app runtime reconcile loop loads newly enabled package registry rows', async () => {
  const source = await fs.readFile(APP_PATH, 'utf8');

  assert.match(source, /packageRegistryService\s*=\s*require\('\.\/MVC\/services\/packageRegistryService'\)/);
  assert.match(source, /function collectEnabledRegistryPackageIds/);
  assert.match(source, /function collectFailedPackageIds/);
  assert.match(source, /packageRegistryService\.listPackageRegistry\(\{\s*backendMode\s*\}\)/);
  assert.match(source, /function startPackageRuntimeReconcileLoop/);
  assert.match(source, /const missingPackageIds = enabledPackageIds\.filter/);
  assert.match(source, /!failedPackageIds\.has\(packageId\)/);
  assert.match(source, /packageIds: missingPackageIds/);
  assert.match(source, /packageRuntimeRouter/);
  assert.match(source, /startPackageRuntimeReconcileLoop\(\{/);
  assert.match(source, /PACKAGE_RUNTIME_RECONCILE_ENABLED/);
  assert.match(source, /PACKAGE_RUNTIME_RECONCILE_INTERVAL_MS/);
});
