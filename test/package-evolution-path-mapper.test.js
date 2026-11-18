const test = require('node:test');
const assert = require('node:assert/strict');

const mapper = require('../MVC/services/packageEvolutionPathMapperService');

test('mapPathToPackage maps packages folder and core roots', () => {
  assert.equal(mapper.mapPathToPackage('packages/school/MVC/foo.js'), 'SCHOOL');
  assert.equal(mapper.mapPathToPackage('MVC/controllers/foo.js'), 'CORE');
  assert.equal(mapper.mapPathToPackage('data/school/students.json'), 'SCHOOL');
  assert.equal(mapper.mapPathToPackage('data/users.json'), 'CORE');
});

test('splitCommitFilesIntoPackageBuckets groups multi-package commits', () => {
  const buckets = mapper.splitCommitFilesIntoPackageBuckets([
    'packages/school/a.js',
    'MVC/b.js'
  ]);
  assert.equal(buckets.length, 2);
  const pkgs = buckets.map((row) => row.packageName).sort();
  assert.deepEqual(pkgs, ['CORE', 'SCHOOL']);
});