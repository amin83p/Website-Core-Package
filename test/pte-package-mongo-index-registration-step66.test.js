const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const manifest = require('../packages/pte/package.manifest.json');
const pteIndexDefinitions = require('../packages/pte/MVC/infrastructure/mongo/pteMongoIndexDefinitions');
const packageMongoIndexRegistry = require('../MVC/infrastructure/mongo/packageMongoIndexRegistry');
const mongoIndexManager = require('../MVC/infrastructure/mongo/mongoIndexManager');

const PTE_COLLECTIONS = [
  'pteApplicants',
  'pteTeachers',
  'pteCourses',
  'pteAiProviders',
  'pteAiScoringSettings',
  'ptePublicPageSettings',
  'pteAiTokenUsages',
  'pteApplicantPackageAssignments',
  'pteQuestionVersions',
  'pteTestVersions',
  'pteAttemptSessions',
  'pteAttemptItems',
  'pteAttemptLedgerEvents',
  'pteAttemptArtifacts'
];

test.afterEach(() => {
  packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
});

test('PTE manifest declares package-owned Mongo index definitions', () => {
  assert.deepEqual(manifest.mongoIndexes, [
    {
      path: 'MVC/infrastructure/mongo/pteMongoIndexDefinitions.js',
      active: true
    }
  ]);

  PTE_COLLECTIONS.forEach((collectionName) => {
    assert.equal(Array.isArray(pteIndexDefinitions[collectionName]), true, `${collectionName} should be package-owned.`);
    assert.ok(pteIndexDefinitions[collectionName].length > 0, `${collectionName} should define indexes.`);
  });
});

test('core default index definitions no longer inline PTE collection definitions', () => {
  PTE_COLLECTIONS.forEach((collectionName) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(mongoIndexManager.INDEX_DEFINITIONS, collectionName),
      false,
      `${collectionName} should not be in core INDEX_DEFINITIONS.`
    );
  });
});

test('Mongo index manager discovers PTE indexes from package manifests', () => {
  packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
  const definitions = mongoIndexManager.getIndexDefinitions({ projectRoot: ROOT_DIR });

  PTE_COLLECTIONS.forEach((collectionName) => {
    assert.equal(Array.isArray(definitions[collectionName]), true, `${collectionName} should be merged from package indexes.`);
    assert.deepEqual(definitions[collectionName], pteIndexDefinitions[collectionName]);
  });
});

test('ensureMongoIndexes uses package-discovered PTE indexes by default', async () => {
  packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
  const calls = [];
  const fakeDb = {
    collection(collectionName) {
      return {
        async createIndexes(indexes) {
          calls.push({ collectionName, indexes });
          return indexes.map((index) => index.name);
        }
      };
    }
  };

  await mongoIndexManager.ensureMongoIndexes(fakeDb, {
    projectRoot: ROOT_DIR,
    verbose: false
  });

  const pteApplicantCall = calls.find((row) => row.collectionName === 'pteApplicants');
  assert.ok(pteApplicantCall, 'pteApplicants indexes should be created from package definitions.');
  assert.ok(
    pteApplicantCall.indexes.some((index) => index.name === 'idx_pte_applicants_id'),
    'pteApplicants package index names should be preserved.'
  );
});
