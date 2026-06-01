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
  assert.equal(Array.isArray(out.mongoIndexes), true);
  assert.equal(out.mongoIndexes[0].path, 'MVC/infrastructure/mongo/exampleMongoIndexes.js');
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

test('manifest accepts valid migration and seeder declarations', () => {
  const out = manifestService.validatePackageManifest({
    id: 'addon',
    name: 'Addon',
    version: '1.2.0',
    mountPath: '/addon',
    migrations: [
      {
        id: 'm001_init',
        version: '1.0.0',
        description: 'init',
        up: 'migrations/001-init-up.js',
        down: 'migrations/001-init-down.js',
        dependsOn: [],
        backendModes: ['json', 'mongo'],
        safeToRollback: true
      }
    ],
    seeders: [
      {
        id: 's001_seed',
        version: '1.0.0',
        description: 'seed',
        run: 'seeders/001-seed-run.js',
        revert: 'seeders/001-seed-revert.js',
        mode: 'upsert',
        backendModes: ['json'],
        idempotencyKey: 'addon.seed.001'
      }
    ]
  });

  assert.equal(out.migrations.length, 1);
  assert.equal(out.seeders.length, 1);
  assert.equal(out.migrations[0].up, 'migrations/001-init-up.js');
  assert.equal(out.seeders[0].mode, 'upsert');
});

test('manifest rejects invalid lifecycle script paths and duplicate lifecycle ids', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '1.0.0',
      mountPath: '/addon',
      migrations: [
        {
          id: 'step-1',
          version: '1.0.0',
          up: '../outside.js',
          down: 'migrations/down.js'
        }
      ]
    });
  }, /inside package folder/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '1.0.0',
      mountPath: '/addon',
      migrations: [
        {
          id: 'dup-step',
          version: '1.0.0',
          up: 'migrations/up.js',
          down: 'migrations/down.js'
        }
      ],
      seeders: [
        {
          id: 'dup-step',
          version: '1.0.0',
          run: 'seeders/run.js',
          revert: 'seeders/revert.js',
          idempotencyKey: 'dup-step'
        }
      ]
    });
  }, /must be unique/i);
});

test('manifest rejects invalid lifecycle ordering and backend/seed mode values', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '1.0.0',
      mountPath: '/addon',
      migrations: [
        {
          id: 'm2',
          version: '1.1.0',
          up: 'migrations/up-2.js',
          down: 'migrations/down-2.js',
          backendModes: ['json']
        },
        {
          id: 'm1',
          version: '1.0.0',
          up: 'migrations/up-1.js',
          down: 'migrations/down-1.js',
          backendModes: ['json']
        }
      ]
    });
  }, /ordered by non-decreasing semantic version/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '1.0.0',
      mountPath: '/addon',
      seeders: [
        {
          id: 'seed-1',
          version: '1.0.0',
          run: 'seeders/run.js',
          revert: 'seeders/revert.js',
          mode: 'truncate',
          backendModes: ['sqlite'],
          idempotencyKey: 'seed-1'
        }
      ]
    });
  }, /unsupported backend mode|mode is invalid/i);
});

test('manifest accepts valid data schema and upgrade guard declarations', () => {
  const out = manifestService.validatePackageManifest({
    id: 'addon',
    name: 'Addon',
    version: '2.0.0',
    mountPath: '/addon',
    dataSchemas: [
      {
        entityType: 'addonItems',
        fields: ['id', 'name', 'updatedAt']
      }
    ],
    upgradeGuards: [
      {
        id: 'guard-001',
        version: '2.0.0',
        script: 'upgradeGuards/guard-001.js',
        severity: 'warning',
        backendModes: ['json']
      }
    ]
  });

  assert.equal(out.dataSchemas.length, 1);
  assert.equal(out.dataSchemas[0].entityType, 'addonItems');
  assert.match(String(out.dataSchemas[0].signature || ''), /^fields:/i);
  assert.equal(out.upgradeGuards.length, 1);
  assert.equal(out.upgradeGuards[0].id, 'guard-001');
  assert.equal(out.upgradeGuards[0].severity, 'warning');
});

test('manifest rejects invalid data schema and upgrade guard declarations', () => {
  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '2.0.0',
      mountPath: '/addon',
      dataSchemas: [
        { entityType: 'addonItems' },
        { entityType: 'addonItems', signature: 'x' }
      ]
    });
  }, /requires either signature|Duplicate data schema entityType/i);

  assert.throws(() => {
    manifestService.validatePackageManifest({
      id: 'addon',
      name: 'Addon',
      version: '2.0.0',
      mountPath: '/addon',
      upgradeGuards: [
        {
          id: 'guard-002',
          version: '2.0.0',
          script: '../escape.js',
          severity: 'critical'
        }
      ]
    });
  }, /inside package folder|severity is invalid/i);
});
