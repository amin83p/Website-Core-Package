const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestService = require('../MVC/services/packageManifestService');

function loadFixture(name) {
  const fixturePath = path.resolve(__dirname, 'fixtures', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('valid fixture manifest passes and normalizes required fields', () => {
  const fixture = loadFixture('package-manifest.valid.json');
  const out = manifestService.validatePackageManifest(fixture);

  assert.equal(out.id, 'pte');
  assert.equal(out.name, 'PTE');
  assert.equal(out.version, '1.0.0');
  assert.equal(out.mountPath, '/pte');
  assert.equal(Array.isArray(out.routes), true);
  assert.equal(Array.isArray(out.queryExecutors), true);
  assert.equal(Array.isArray(out.roles), true);
});

test('missing required fields are rejected', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      version: '1.0.0',
      mountPath: '/pte'
    });
  }, /name is required/i);
});

test('unsafe package ids are rejected', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'PTE_MAIN',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });
  }, /id is invalid/i);
});

test('invalid mountPath values are rejected', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: 'pte'
    });
  }, /must start with \"\/\"/i);
});

test('invalid semver format is rejected', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: 'v1',
      mountPath: '/pte'
    });
  }, /semver format/i);
});

test('duplicate package ids are rejected against knownIds', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    }, { knownIds: ['core', 'pte'] });
  }, /Duplicate package id \"pte\"/i);
});

test('collection validator rejects duplicate ids inside manifest list', () => {
  assert.throws(() => {
    manifestService.validatePackageManifestCollection([
      { id: 'pte', name: 'PTE', version: '1.0.0', mountPath: '/pte' },
      { id: 'pte', name: 'PTE v2', version: '1.1.0', mountPath: '/pte-v2' }
    ]);
  }, /Duplicate package id \"pte\"/i);
});

test('unsupported keys and invalid declaration types are rejected', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      unknownThing: true
    });
  }, /unsupported keys/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      queryExecutors: 'not-an-array'
    });
  }, /queryExecutors must be an array/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: 'not-an-array'
    });
  }, /routes must be an array/i);
});

test('dependencies must be valid package ids and cannot self-reference', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      dependencies: ['core_pkg']
    });
  }, /Dependency id is invalid/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      dependencies: ['pte']
    });
  }, /cannot depend on itself/i);
});
