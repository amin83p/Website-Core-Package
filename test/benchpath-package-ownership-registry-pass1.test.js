const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/benchpath-package-ownership-registry.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function assertRegistryPathsAbsent(rows = [], rootRelativePath = '', label = '') {
  rows.forEach((row) => {
    const normalized = String(row || '').replace(/\\/g, '/');
    assert.ok(normalized, `${label} registry row should not be empty`);
    assert.equal(
      fs.existsSync(repoPath(rootRelativePath, ...normalized.split('/'))),
      false,
      `${label} registry path should be retired from root MVC: ${rootRelativePath}/${normalized}`
    );
  });
}

function filterBenchpathRows(filePath) {
  const rows = readJson(filePath);
  return (Array.isArray(rows) ? rows : []).filter((row) => /benchpath/i.test(JSON.stringify(row)));
}

test('BenchPath package registry captures package-owned domain surface after root MVC retirement', () => {
  const registry = readJson(REGISTRY_PATH);

  assertRegistryFilesExist(registry.controllers, 'packages/benchpath/MVC/controllers/benchpath', 'package controller');
  assertRegistryFilesExist(registry.routes, 'packages/benchpath/MVC/routes/benchpath', 'package route');
  assertRegistryFilesExist(registry.models, 'packages/benchpath/MVC/models/benchpath', 'package model');
  assertRegistryFilesExist(registry.repositories, 'packages/benchpath/MVC/repositories/benchpath', 'package repository');
  assertRegistryFilesExist(registry.services, 'packages/benchpath/MVC/services/benchpath', 'package service');
  assertRegistryFilesExist(registry.views, 'packages/benchpath/MVC/views/benchpath', 'package view');
  assertRegistryPathsAbsent(registry.controllers, 'MVC/controllers/benchpath', 'controller');
  assertRegistryPathsAbsent(registry.routes, 'MVC/routes/benchpath', 'route');
  assertRegistryPathsAbsent(registry.models, 'MVC/models/benchpath', 'model');
  assertRegistryPathsAbsent(registry.repositories, 'MVC/repositories/benchpath', 'repository');
  assertRegistryPathsAbsent(registry.services, 'MVC/services/benchpath', 'service');
  assertRegistryPathsAbsent(registry.views, 'MVC/views/benchpath', 'view');
  assertRegistryFilesExist(registry.scripts, '', 'script');
  assertRegistryFilesExist(registry.tests, 'test', 'test');

  assert.equal(registry.controllers.length, 9);
  assert.equal(registry.routes.length, 17);
  assert.equal(registry.models.length, 7);
  assert.equal(registry.repositories.length, 1);
  assert.equal(registry.services.length, 21);
  assert.equal(registry.views.length, 26);
  assert.equal(registry.scripts.length, 11);
  assert.equal(registry.tests.length, 2);
  assert.equal(registry.dataEntities.length, 13);
});

test('BenchPath package pass1 keeps runtime data app-level and out of package source', () => {
  const appDataRoot = repoPath('data/benchpath');
  const referenceDataRoot = repoPath('data/benchpath/reference');
  const runtimeDataRoot = repoPath('data/benchpath/runtime');
  const packageDataRoot = repoPath('packages/benchpath/data');

  assert.equal(fs.existsSync(appDataRoot), true, 'data/benchpath should remain app-level runtime data');
  assert.equal(fs.existsSync(referenceDataRoot), true, 'BenchPath reference data should remain app-level runtime data');
  assert.equal(fs.existsSync(runtimeDataRoot), true, 'BenchPath runtime data should remain app-level runtime data');
  assert.equal(fs.existsSync(packageDataRoot), false, 'packages/benchpath/data should not carry runtime payload');
});

test('BenchPath package pass1 captures current declaration and registry state', () => {
  const sections = filterBenchpathRows(repoPath('data/sections.json'));
  const symbols = filterBenchpathRows(repoPath('data/symbols.json'));
  const packageRegistry = readJson(repoPath('data/packageRegistry.json'));
  const benchpathRegistryRows = (Array.isArray(packageRegistry) ? packageRegistry : [])
    .filter((row) => String(row?.packageId || row?.id || '').toLowerCase() === 'benchpath');

  assert.equal(sections.length, 15, 'BenchPath should have 15 section declarations before package extraction');
  assert.equal(symbols.length, 15, 'BenchPath should have 15 symbol declarations before package extraction');
  assert.equal(benchpathRegistryRows.length <= 1, true, 'BenchPath package registry should have at most one row');
  if (benchpathRegistryRows.length) {
    assert.equal(benchpathRegistryRows[0].enabled, true, 'BenchPath registry row should be enabled after cutover');
    assert.equal(benchpathRegistryRows[0].metadata?.manifestPath, 'packages/benchpath/package.manifest.json');
  }

  const globalImageSymbol = symbols.find((row) => String(row?.value || '').includes('/uploads/GLOBAL/symbols/'));
  assert.ok(globalImageSymbol, 'BenchPath should keep image-backed symbols in GLOBAL symbol storage');
});
