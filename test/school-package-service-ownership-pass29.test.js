const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readOwnershipRegistry() {
  return JSON.parse(read('test/school-package-ownership-registry.json'));
}

function findMissingRelativeRequire(filePath, source) {
  const fileDir = path.dirname(filePath);
  const requirePattern = /require\(\s*(['"])(.*?)\1\s*\)/g;
  let match;

  while ((match = requirePattern.exec(source)) !== null) {
    const importPath = match[2];
    if (!importPath.startsWith('.')) continue;
    if (!importPath.startsWith('../') && !importPath.startsWith('..\\')) continue;

    const candidate = path.resolve(fileDir, importPath);
    const hasModule =
      fs.existsSync(candidate) ||
      fs.existsSync(`${candidate}.js`) ||
      fs.existsSync(path.join(candidate, 'index.js'));
    if (!hasModule) return importPath;
  }

  return '';
}

test('school package pass29 owns first batch of services and is free of core service wrappers', () => {
  const registry = readOwnershipRegistry();
  const serviceFiles = (registry.services || []).map(String).sort();
  const offenders = [];
  assert.ok(serviceFiles.length > 0, 'pass29 should register at least one service');

  serviceFiles.forEach((fileName) => {
    const sourcePath = path.join(ROOT_DIR, 'packages/school/MVC/services/school', fileName);
    if (!fs.existsSync(sourcePath)) {
      offenders.push(`${fileName}: missing service file`);
      return;
    }

    const source = read(`packages/school/MVC/services/school/${fileName}`);

    if (source.includes(`requireCoreModule('MVC/services/school/${fileName}')`)) {
      offenders.push(`${fileName}: still delegates to core service wrapper`);
    }
    if (source.includes('module.exports = requireCoreModule')) {
      offenders.push(`${fileName}: still exports through core module resolver`);
    }
    if (source.includes("requireCoreModule('')")) {
      offenders.push(`${fileName}: unresolved converted require`);
    }

    const missingRelativeRequire = findMissingRelativeRequire(sourcePath, source);
    if (missingRelativeRequire) {
      offenders.push(`${fileName}: missing local module ${missingRelativeRequire}`);
    }
  });

  assert.deepEqual(offenders, []);
});
