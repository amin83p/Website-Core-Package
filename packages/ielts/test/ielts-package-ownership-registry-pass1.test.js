const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'test/ielts-package-ownership-registry.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error(`Unable to locate project root from ${startDir}`);
}

const ROOT_DIR = findProjectRoot(__dirname);
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/ielts-package-ownership-registry.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function repoPath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

function assertRegistryFilesExist(rows = [], baseRelativePath = '', label = '') {
  rows.forEach((row) => {
    const normalized = String(row || '').replace(/\\/g, '/');
    assert.ok(normalized, `${label} registry row should not be empty`);
    assert.equal(
      fs.existsSync(repoPath(baseRelativePath, ...normalized.split('/'))),
      true,
      `${label} registry path should exist: ${baseRelativePath}/${normalized}`
    );
  });
}

test('IELTS package pass1 registry captures package-owned domain surface', () => {
  const registry = readJson(REGISTRY_PATH);

  assertRegistryFilesExist(registry.controllers, 'packages/ielts/MVC/controllers/ielts', 'controller');
  assertRegistryFilesExist(registry.routes, 'packages/ielts/MVC/routes/ielts', 'route');
  assertRegistryFilesExist(registry.models, 'packages/ielts/MVC/models/ielts', 'model');
  assertRegistryFilesExist(registry.services, 'packages/ielts/MVC/services/ielts', 'service');
  assertRegistryFilesExist(registry.views, 'packages/ielts/MVC/views/ielts', 'view');
  assertRegistryFilesExist(registry.scripts, 'scripts/ielts', 'script');
  assertRegistryFilesExist(registry.tests, 'test', 'test');

  assert.equal(registry.controllers.length, 4);
  assert.equal(registry.routes.length, 2);
  assert.equal(registry.models.length, 7);
  assert.equal(registry.services.length, 28);
  assert.equal(registry.views.length, 30);
  assert.equal(registry.scripts.length, 8);
  assert.equal(registry.tests.length, 25);
});

test('IELTS package pass1 keeps legacy root MVC runtime surface retired', () => {
  const retiredRoots = [
    'MVC/controllers/ielts',
    'MVC/routes/ielts',
    'MVC/models/ielts',
    'MVC/services/ielts',
    'MVC/repositories/ielts',
    'MVC/views/ielts'
  ];

  retiredRoots.forEach((rootRelativePath) => {
    assert.equal(fs.existsSync(repoPath(rootRelativePath)), false, `${rootRelativePath} should be removed after package migration`);
  });
});

test('IELTS package pass1 keeps runtime data app-level and out of package source', () => {
  const appDataRoot = repoPath('data/ielts');
  const packageDataRoot = repoPath('packages/ielts/data');
  const scoringSessionsRoot = repoPath('data/ielts/scoring/sessions');

  assert.equal(fs.existsSync(appDataRoot), true, 'data/ielts should remain app-level runtime data');
  assert.equal(fs.existsSync(scoringSessionsRoot), true, 'IELTS scoring sessions should remain app-level runtime data');
  assert.equal(fs.existsSync(packageDataRoot), false, 'packages/ielts/data should not carry runtime payload');

  const scoringSessionFiles = fs.readdirSync(scoringSessionsRoot).filter((name) => name.endsWith('.json'));
  assert.equal(scoringSessionFiles.length >= 100, true, 'large scoring history should not be treated as package source');
});
