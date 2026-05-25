const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const packageToCoreDependencyMap = [
  {
    packageFile: 'packages/pte/MVC/controllers/attemptControllerCoreDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/attemptControllerCoreDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/feedbackControllerCoreDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/feedbackControllerCoreDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/infoControllerDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/infoControllerDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/mockExamControllerDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/mockExamControllerDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/practiceControllerDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/practiceControllerDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/publicJoinControllerCoreDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/publicJoinControllerCoreDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/publicPageSettingsControllerDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/publicPageSettingsControllerDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/questionBankControllerDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/questionBankControllerDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/studentControllerCoreDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/studentControllerCoreDependencies'
  },
  {
    packageFile: 'packages/pte/MVC/controllers/userDashboardControllerCoreDependencies.js',
    expectedCoreTarget: '../../../../MVC/controllers/pte/userDashboardControllerCoreDependencies'
  }
];

test('Package controller dependency shims should delegate to MVC core adapters', () => {
  packageToCoreDependencyMap.forEach(({ packageFile, expectedCoreTarget }) => {
    const fullPath = path.join(ROOT_DIR, packageFile);
    const source = fs.readFileSync(fullPath, 'utf8');
    const expectedSources = [
      `module.exports = require('${expectedCoreTarget}');`,
      `module.exports = require("${expectedCoreTarget}");`
    ];
    assert.equal(
      expectedSources.includes(source.trim()),
      true,
      `${packageFile} should delegate to ${expectedCoreTarget}.`
    );
  });
});

test('Package controller dependency shims should remain loadable through core adapters', () => {
  packageToCoreDependencyMap.forEach(({ packageFile }) => {
    const modulePath = path.join(ROOT_DIR, packageFile);
    const exported = require(modulePath);
    assert.equal(typeof exported, 'object', `Expected ${packageFile} to export an object.`);
  });
});

test('Core controller dependency adapters should exist on disk', () => {
  packageToCoreDependencyMap.forEach(({ expectedCoreTarget }) => {
    const coreRelativePath = expectedCoreTarget.replace(/^\.\.\/\.\.\/\.\.\/\.\.\//, '');
    const absoluteCorePath = path.join(
      ROOT_DIR,
      coreRelativePath
    );
    assert.equal(
      fs.existsSync(absoluteCorePath + '.js'),
      true,
      `Core adapter file should exist at ${absoluteCorePath}.js.`
    );
  });
});
