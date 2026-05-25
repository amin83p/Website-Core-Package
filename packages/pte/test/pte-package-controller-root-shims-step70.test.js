const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const controllerFileNames = [
  'aiProviderController.js',
  'aiScoringSettingsController.js',
  'aiTokenUsageController.js',
  'attemptController.js',
  'courseController.js',
  'feedbackController.js',
  'infoController.js',
  'mockExamController.js',
  'practiceController.js',
  'publicJoinController.js',
  'publicPageSettingsController.js',
  'questionBankController.js',
  'scoringController.js',
  'studentController.js',
  'teacherController.js',
  'testController.js',
  'userDashboardController.js'
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8').trim();
}

test('root PTE controllers are pure compatibility shims to package-owned controllers', () => {
  controllerFileNames.forEach((fileName) => {
    const moduleName = fileName.replace(/\.js$/, '');
    const expectedShim = `module.exports = require('../../../packages/pte/MVC/controllers/${moduleName}');`;
    const currentSource = readText(`MVC/controllers/pte/${fileName}`);

    assert.equal(currentSource, expectedShim, `${fileName} should delegate to the package-owned controller`);
  });
});

test('root PTE controller shims export the package-owned controller modules', () => {
  controllerFileNames.forEach((fileName) => {
    const rootControllerPath = path.join(ROOT_DIR, 'MVC/controllers/pte', fileName);
    const packageControllerPath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers', fileName);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootController = require(rootControllerPath);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageController = require(packageControllerPath);

    assert.equal(rootController, packageController, `${fileName} should export the package controller`);
  });
});
