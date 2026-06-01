const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCHOOL_RUNTIME_ROOT = path.join(ROOT_DIR, 'packages/school/MVC');
const SCHOOL_CONFIG_ACCESS_CONSTANTS_PATH = path.resolve(ROOT_DIR, 'packages/school/config/accessConstants.js');
const DEEP_CORE_REQUIRE_PATTERN = /require\(\s*['"](?:\.\.\/){5}(?:MVC|config)\//g;

function walkFiles(directory, predicate = () => true) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, predicate));
      return;
    }
    if (entry.isFile() && predicate(fullPath)) out.push(fullPath);
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

test('school package manifest should validate and use package-local module paths', () => {
  const packageManifestService = require(path.join(ROOT_DIR, 'MVC/services/packageManifestService.js'));
  const manifestPath = path.join(ROOT_DIR, 'packages/school/package.manifest.json');
  const manifest = JSON.parse(read(manifestPath));
  const validated = packageManifestService.validatePackageManifest(manifest, { knownIds: [] });

  assert.equal(validated.id, 'school');
  assert.equal(validated.mountPath, '/school');
  assert.equal(validated.routes[0]?.router, 'MVC/routes/schoolMainRoute.js');
  assert.equal(manifest.routes.some((row) => String(row?.router || '').includes('MVC/routes/school/')), false);
  assert.equal(manifest.routes.some((row) => String(row?.controller || '').includes('MVC/controllers/school/')), false);
});

test('school package constants should expose package-owned School section map', () => {
  const constants = require(path.join(ROOT_DIR, 'packages/school/config/accessConstants.js'));
  assert.equal(typeof constants, 'object');
  assert.equal(typeof constants.SCHOOL_SECTIONS, 'object');
  assert.equal(constants.SCHOOL_SECTIONS.SCHOOL, 'SCHOOL');
  assert.equal(constants.SCHOOL_SECTIONS.SCHOOL_STUDENTS, 'SCHOOL_STUDENTS');
});

test('School runtime files should not use deep core relative imports', () => {
  const jsFiles = walkFiles(SCHOOL_RUNTIME_ROOT, (filePath) => filePath.endsWith('.js'));
  const offenders = [];

  jsFiles.forEach((filePath) => {
    const source = read(filePath);
    const relative = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
    const hasDeepCoreImport = DEEP_CORE_REQUIRE_PATTERN.test(source);
    DEEP_CORE_REQUIRE_PATTERN.lastIndex = 0;
    if (!hasDeepCoreImport) return;
    offenders.push(relative);
  });

  assert.deepEqual(offenders, []);
});

test('School runtime should not import package section constants from core paths', () => {
  const jsFiles = walkFiles(SCHOOL_RUNTIME_ROOT, (filePath) => filePath.endsWith('.js'));
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
      if (path.resolve(resolvedWithExt) !== SCHOOL_CONFIG_ACCESS_CONSTANTS_PATH) {
        offenders.push(`${relative} resolves accessConstants to non-package path: ${target}`);
      }
    });
  });

  assert.deepEqual(offenders, []);
});
