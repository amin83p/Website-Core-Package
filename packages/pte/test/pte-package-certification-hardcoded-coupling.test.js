const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PTE_RUNTIME_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC');
const PTE_CONFIG_ACCESS_CONSTANTS_PATH = path.resolve(ROOT_DIR, 'packages/pte/config/accessConstants.js');
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

function collectConfigAccessConstantsRequires(source = '') {
  const matches = [];
  const requireRegex = /require\(\s*['"]([^'"]*config\/accessConstants(?:\.js)?)['"]\s*\)/g;
  let match = requireRegex.exec(source);
  while (match) {
    matches.push(String(match[1] || ''));
    match = requireRegex.exec(source);
  }
  return matches;
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

test('PTE runtime should not import package section constants from core paths', () => {
  const jsFiles = walkFiles(PTE_RUNTIME_ROOT, (filePath) => filePath.endsWith('.js'));
  const offenders = [];

  jsFiles.forEach((filePath) => {
    const source = read(filePath);
    const relative = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');

    if (/requireCoreModule\(\s*['"]config\/accessConstants['"]\s*\)/.test(source)) {
      offenders.push(`${relative} uses requireCoreModule('config/accessConstants')`);
    }

    const requireTargets = collectConfigAccessConstantsRequires(source);
    requireTargets.forEach((target) => {
      if (!target.startsWith('.')) {
        offenders.push(`${relative} uses non-relative accessConstants import: ${target}`);
        return;
      }
      const resolvedTarget = path.resolve(path.dirname(filePath), target);
      const resolvedWithExt = resolvedTarget.endsWith('.js') ? resolvedTarget : `${resolvedTarget}.js`;
      if (path.resolve(resolvedWithExt) !== PTE_CONFIG_ACCESS_CONSTANTS_PATH) {
        offenders.push(`${relative} resolves accessConstants to non-package path: ${target}`);
      }
    });
  });

  assert.deepEqual(offenders, []);
});

test('PTE manifest section names should align with package-owned PTE section constants', () => {
  const manifest = JSON.parse(read(path.join(ROOT_DIR, 'packages/pte/package.manifest.json')));
  const { PTE_SECTIONS } = require(path.join(ROOT_DIR, 'packages/pte/config/accessConstants.js'));
  const manifestSectionNames = new Set((manifest.sections || []).map((section) => String(section?.name || '').trim()).filter(Boolean));
  const constantSectionNames = Object.values(PTE_SECTIONS || {}).map((value) => String(value || '').trim()).filter(Boolean);

  const missingInManifest = constantSectionNames.filter((name) => !manifestSectionNames.has(name));
  const extraInManifest = Array.from(manifestSectionNames).filter((name) => name.startsWith('PTE_') && !constantSectionNames.includes(name));

  assert.deepEqual(missingInManifest, [], 'All package-owned PTE section constants must be represented in manifest.sections[].name');
  assert.deepEqual(extraInManifest, [], 'Manifest PTE section names should be declared in package-owned PTE_SECTIONS');
});
