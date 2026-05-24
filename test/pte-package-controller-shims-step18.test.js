const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function controllerFileNames() {
  return [
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
}

const packageOwnedControllers = new Set([
  'attemptController.js',
  'aiProviderController.js',
  'aiScoringSettingsController.js',
  'aiTokenUsageController.js'
]);

test('PTE package controller shims mirror current PTE controller module names', () => {
  controllerFileNames().forEach((fileName) => {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'MVC/controllers/pte', fileName)), true);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/pte/MVC/controllers', fileName)), true);
  });
});

test('PTE package controller shims delegate to current MVC controller modules', () => {
  controllerFileNames().forEach((fileName) => {
    if (packageOwnedControllers.has(fileName)) {
      return;
    }

    const source = readText(`packages/pte/MVC/controllers/${fileName}`);
    assert.ok(
      source.includes(`../../../../MVC/controllers/pte/${fileName.replace(/\.js$/, '')}`),
      `${fileName} should delegate to the current MVC controller module`
    );

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageController = require(`../packages/pte/MVC/controllers/${fileName}`);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentController = require(`../MVC/controllers/pte/${fileName}`);
    assert.equal(packageController, currentController, `${fileName} should export the current controller`);
  });
});

test('Package-owned AI Assist controllers are not simple shims', () => {
  packageOwnedControllers.forEach((fileName) => {
    const source = readText(`packages/pte/MVC/controllers/${fileName}`);
    assert.ok(
      !source.includes(`module.exports = require('../../../../MVC/controllers/pte/${fileName.replace(/\\.js$/, '')}`),
      `${fileName} should not delegate to MVC controller`
    );
  });
});

test('PTE package main route uses package-local top-level controller shims', () => {
  const source = readText('packages/pte/MVC/routes/pteMainRoute.js');

  [
    'infoController',
    'userDashboardController',
    'publicPageSettingsController',
    'publicJoinController'
  ].forEach((controllerName) => {
    assert.ok(
      source.includes(`require('../controllers/${controllerName}')`),
      `Expected package main route to use package-local ${controllerName}`
    );
    assert.doesNotMatch(
      source,
      new RegExp(`\\.\\.\\/\\.\\.\\/\\.\\.\\/\\.\\.\\/MVC\\/controllers\\/pte\\/${controllerName}`)
    );
  });
});
