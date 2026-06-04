const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/benchpath-package-ownership-registry.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function repoPath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

function assertRegistryFilesExist(rows = [], rootRelativePath = '', label = '') {
  rows.forEach((row) => {
    const normalized = String(row || '').replace(/\\/g, '/');
    assert.ok(normalized, `${label} registry row should not be empty`);
    assert.equal(
      fs.existsSync(repoPath(rootRelativePath, ...normalized.split('/'))),
      true,
      `${label} registry path should exist: ${rootRelativePath}/${normalized}`
    );
  });
}

test('BenchPath package pass4 owns copied controller model service and repository files', () => {
  const registry = readJson(REGISTRY_PATH);

  assertRegistryFilesExist(registry.controllers, 'packages/benchpath/MVC/controllers/benchpath', 'package controller');
  assertRegistryFilesExist(registry.models, 'packages/benchpath/MVC/models/benchpath', 'package model');
  assertRegistryFilesExist(registry.repositories, 'packages/benchpath/MVC/repositories/benchpath', 'package repository');
  assertRegistryFilesExist(registry.services, 'packages/benchpath/MVC/services/benchpath', 'package service');
});

test('BenchPath package pass4 keeps runtime data rooted at app-level data/benchpath', () => {
  const registry = readJson(REGISTRY_PATH);
  const modelSources = registry.models
    .map((name) => read(repoPath('packages/benchpath/MVC/models/benchpath', ...name.split('/'))))
    .join('\n');
  const migrationSource = read(repoPath('packages/benchpath/MVC/services/benchpath/data/migrationDryRunService.js'));

  assert.match(modelSources, /resolveCoreRoot\(\), 'data\/benchpath\//);
  assert.match(migrationSource, /resolveCoreRoot\(\), 'data\/benchpath\/reference'/);
  assert.doesNotMatch(modelSources, /\.\.\/\.\.\/\.\.\/data\/benchpath/);
  assert.doesNotMatch(migrationSource, /\.\.\/\.\.\/\.\.\/\.\.\/data\/benchpath/);
  assert.equal(fs.existsSync(repoPath('packages/benchpath/data')), false);
});

test('BenchPath package pass4 routes and repositories can load from package-owned surface', () => {
  const router = require('../packages/benchpath/MVC/routes/benchpath/benchpathMainRoute');
  const repositories = require('../packages/benchpath/MVC/repositories/benchpath');
  const entityRegistry = require('../packages/benchpath/MVC/services/benchpath/data/entityRegistry');

  assert.equal(typeof router, 'function');
  assert.equal(Object.keys(repositories).length, 13);
  assert.equal(Object.keys(entityRegistry.BENCHPATH_ENTITY_REGISTRY).length, 13);
});

test('BenchPath package pass4 bridges shared core dependencies through resolver', () => {
  const registry = readJson(REGISTRY_PATH);
  const packageSources = [
    ...registry.controllers.map((name) => repoPath('packages/benchpath/MVC/controllers/benchpath', ...name.split('/'))),
    ...registry.models.map((name) => repoPath('packages/benchpath/MVC/models/benchpath', ...name.split('/'))),
    ...registry.services.map((name) => repoPath('packages/benchpath/MVC/services/benchpath', ...name.split('/'))),
    ...registry.repositories.map((name) => repoPath('packages/benchpath/MVC/repositories/benchpath', ...name.split('/')))
  ]
    .filter((filePath) => filePath.endsWith('.js'))
    .map((filePath) => read(filePath))
    .join('\n');

  assert.match(packageSources, /benchpathCoreModuleResolver/);
  assert.match(packageSources, /requireCoreModule\('MVC\/models\/fileQueue'\)/);
  assert.match(packageSources, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(packageSources, /requireCoreModule\('MVC\/repositories\/backend\/repositoryBackendSelector'\)/);
  assert.doesNotMatch(packageSources, /require\('\.\.\/fileQueue'\)/);
  assert.doesNotMatch(packageSources, /require\('\.\.\/\.\.\/utils\//);
  assert.doesNotMatch(packageSources, /require\('\.\.\/\.\.\/middleware\//);
});
