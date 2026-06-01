const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PTE_RUNTIME_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC');
const DEEP_CORE_REQUIRE_PATTERN = /require\(\s*['"](?:\.\.\/){5}(?:MVC|config)\//g;
const ALLOWED_DEEP_CORE_FILES = new Set([
  'packages/pte/MVC/services/pte/pteCoreContracts.js'
]);

function walkFiles(directory, predicate = () => true) {
  const out = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, predicate));
      return;
    }
    if (entry.isFile() && predicate(fullPath)) {
      out.push(fullPath);
    }
  });
  return out;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('runtime resolver should not include PTE-specific legacy aliasing', () => {
  const resolverSource = read(path.join(ROOT_DIR, 'MVC/services/packageModuleResolverService.js'));
  const routeServiceSource = read(path.join(ROOT_DIR, 'MVC/services/packageRouteService.js'));

  assert.equal(resolverSource.includes('applyLegacyPteModuleAliases'), false);
  assert.equal(resolverSource.includes("packageId !== 'pte'"), false);
  assert.equal(routeServiceSource.includes('LEGACY_CORE_IMPORT_PATTERN'), false);
  assert.equal(routeServiceSource.includes('Module._resolveFilename'), false);
});

test('PTE manifest should not reference legacy pte shim controller paths', () => {
  const manifestSource = read(path.join(ROOT_DIR, 'packages/pte/package.manifest.json'));
  assert.equal(manifestSource.includes('MVC/controllers/pte/'), false);
  assert.equal(manifestSource.includes('MVC/routes/pte/'), false);
});

test('PTE runtime files should not use deep core relative imports outside core contract file', () => {
  const jsFiles = walkFiles(PTE_RUNTIME_ROOT, (filePath) => filePath.endsWith('.js'));
  const offenders = [];
  jsFiles.forEach((filePath) => {
    const relative = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
    const source = read(filePath);
    const hasDeepCoreImport = DEEP_CORE_REQUIRE_PATTERN.test(source);
    DEEP_CORE_REQUIRE_PATTERN.lastIndex = 0;
    if (!hasDeepCoreImport) return;
    if (ALLOWED_DEEP_CORE_FILES.has(relative)) return;
    offenders.push(relative);
  });

  assert.deepEqual(offenders, []);
});

test('core should not carry root PTE view duplication or embedded PTE section constants', () => {
  const rootPteViewPath = path.join(ROOT_DIR, 'MVC/views/pte');
  const accessConstantsSource = read(path.join(ROOT_DIR, 'config/accessConstants.js'));
  const actionStateTrackerSource = read(path.join(ROOT_DIR, 'MVC/services/actionStateChangeTrackerService.js'));

  assert.equal(fs.existsSync(rootPteViewPath), false, 'Root MVC/views/pte should be removed.');
  assert.equal(accessConstantsSource.includes('PTE_'), false, 'PTE section constants should be package-owned.');
  assert.equal(actionStateTrackerSource.includes("sourceToken === 'pte'"), false, 'Core action-state tracker should not branch by package id.');
});
