const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const coreDependencyFileNames = [
  'attemptControllerCoreDependencies.js',
  'feedbackControllerCoreDependencies.js',
  'infoControllerDependencies.js',
  'mockExamControllerDependencies.js',
  'practiceControllerDependencies.js',
  'publicJoinControllerCoreDependencies.js',
  'publicPageSettingsControllerDependencies.js',
  'questionBankControllerDependencies.js',
  'studentControllerCoreDependencies.js',
  'userDashboardControllerCoreDependencies.js'
];

test('PTE controller dependency shims in MVC should delegate to package-owned controllers', () => {
  coreDependencyFileNames.forEach((fileName) => {
    const corePath = path.join(ROOT_DIR, 'MVC/controllers/pte', fileName);
    const packagePath = path.join(
      ROOT_DIR,
      'packages/pte/MVC/controllers',
      fileName
    );
    const expectedShims = [
      `module.exports = require('../../../packages/pte/MVC/controllers/${fileName}');`,
      `module.exports = require('../../../packages/pte/MVC/controllers/${fileName.replace(/\.js$/, '')}');`,
      `module.exports = require(\"../../../packages/pte/MVC/controllers/${fileName}\");`,
      `module.exports = require(\"../../../packages/pte/MVC/controllers/${fileName.replace(/\.js$/, '')}\");`
    ];

    const source = fs.readFileSync(corePath, 'utf8').trim();
    assert.equal(expectedShims.includes(source), true, `${fileName} should be a compatibility shim to packages/pte.`);

    const coreModule = require(corePath);
    const packageModule = require(packagePath);
    assert.equal(coreModule, packageModule, `${fileName} should export the package-owned module.`);
    assert.equal(typeof coreModule, 'object', `${fileName} should export an object.`);
  });
});

test('Package-owned PTE controller dependencies should still exist on disk', () => {
  coreDependencyFileNames.forEach((fileName) => {
    const packagePath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers', fileName);
    assert.equal(
      fs.existsSync(packagePath),
      true,
      `Expected package ownership file ${packagePath} to exist.`
    );
  });
});
