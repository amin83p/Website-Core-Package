const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPOSITORY_PATH = path.join(ROOT_DIR, 'packages/ielts/MVC/repositories/ielts/index.js');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('IELTS package pass8 owns package repository module', () => {
  assert.equal(fs.existsSync(REPOSITORY_PATH), true);
  const source = fs.readFileSync(REPOSITORY_PATH, 'utf8');

  assert.match(source, /ieltsCoreModuleResolver/);
  assert.match(source, /require\('\.\.\/\.\.\/models\/ielts\/task2SampleModel'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/queryEngine'\)/);
  assert.match(source, /requireCoreModule\('MVC\/repositories\/backend\/repositoryBackendSelector'\)/);
  assert.doesNotMatch(source, /require\('\.\.\/backend\//);
  assert.doesNotMatch(source, /require\('\.\.\/contracts\//);
});

test('IELTS package pass8 data service uses package repository module', () => {
  const source = read('packages/ielts/MVC/services/ielts/ieltsDataService.js');
  assert.match(source, /const ieltsRepositories = require\('\.\.\/\.\.\/repositories\/ielts'\);/);
  assert.doesNotMatch(source, /requireCoreModule\('MVC\/repositories\/ielts'\)/);
});

test('IELTS package pass8 manifest declares query executors through package repository', () => {
  const manifest = JSON.parse(read('packages/ielts/package.manifest.json'));
  const executors = manifest.queryExecutors || [];
  const expectedEntities = [
    'ielts.task2samples',
    'ielts.microassessments',
    'ielts.prompts',
    'ielts.apiproviders',
    'ielts.aitokenusages',
    'ielts.scoringhistory'
  ];

  assert.deepEqual(executors.map((row) => row.entity).sort(), expectedEntities.sort());
  executors.forEach((row) => {
    assert.equal(row.source, 'ielts');
    assert.equal(row.modulePath, 'packages/ielts/MVC/repositories/ielts/index.js');
  });
});

test('IELTS package pass8 package repository can be required', () => {
  const repository = require(REPOSITORY_PATH);
  assert.equal(typeof repository, 'object');
  ['task2Samples', 'microAssessments', 'prompts', 'apiProviders', 'aiTokenUsages', 'scoringHistory'].forEach((key) => {
    assert.equal(typeof repository[key]?.list, 'function', `${key} repository should expose list()`);
  });
});
