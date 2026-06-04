const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'test/ielts-package-ownership-registry.json'), 'utf8'));
const PACKAGE_SERVICES_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/services/ielts');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('IELTS package pass7 mirrors IELTS service surface', () => {
  REGISTRY.services.forEach((relativePath) => {
    const packagePath = path.join(PACKAGE_SERVICES_DIR, ...relativePath.split('/'));
    assert.equal(fs.existsSync(packagePath), true, `${relativePath} should exist in package services`);
  });

  assert.equal(fs.existsSync(path.join(PACKAGE_SERVICES_DIR, 'ieltsCoreModuleResolver.js')), true);
});

test('IELTS package pass7 package services bridge shared core dependencies through resolver', () => {
  const dataServiceSource = read('packages/ielts/MVC/services/ielts/ieltsDataService.js');
  const aiServiceSource = read('packages/ielts/MVC/services/ielts/aiService.js');

  assert.match(dataServiceSource, /ieltsCoreModuleResolver/);
  assert.match(dataServiceSource, /requireCoreModule\('MVC\/repositories\/ielts'\)/);
  assert.match(dataServiceSource, /requireCoreModule\('MVC\/utils\/queryOptionsAdapter'\)/);

  assert.match(aiServiceSource, /ieltsCoreModuleResolver/);
  assert.match(aiServiceSource, /require\("\.\.\/\.\.\/models\/ielts\/apiProviderModel"\)/);
  assert.match(aiServiceSource, /requireCoreModule\("MVC\/utils\/idAdapter"\)/);
  assert.doesNotMatch(aiServiceSource, /require\("\.\.\/\.\.\/utils\//);
});

test('IELTS package pass7 package controllers use package-local IELTS services', () => {
  const controllerSources = [
    read('packages/ielts/MVC/controllers/ielts/ieltsController.js'),
    read('packages/ielts/MVC/controllers/ielts/promptController.js'),
    read('packages/ielts/MVC/controllers/ielts/apiProviderController.js'),
    read('packages/ielts/MVC/controllers/ielts/aiTokenUsageController.js')
  ];

  controllerSources.forEach((source) => {
    assert.doesNotMatch(source, /requireCoreModule\('MVC\/services\/ielts\//);
  });
  assert.match(controllerSources[0], /require\('\.\.\/\.\.\/services\/ielts\/ieltsDataService'\)/);
  assert.match(controllerSources[0], /require\('\.\.\/\.\.\/services\/ielts\/aiService'\)/);
});

test('IELTS package pass7 service files do not carry runtime data payload paths', () => {
  REGISTRY.services.forEach((relativePath) => {
    const packagePath = path.join(PACKAGE_SERVICES_DIR, ...relativePath.split('/'));
    const source = fs.readFileSync(packagePath, 'utf8');
    assert.doesNotMatch(source, /packages\/ielts\/data/);
    assert.doesNotMatch(source, /path\.join\(__dirname,\s*['"][^'"]*data\/ielts/);
  });
});
