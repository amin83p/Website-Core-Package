const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTROLLERS_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/controllers/ielts');

const EXPECTED_CONTROLLERS = [
  'aiTokenUsageController.js',
  'apiProviderController.js',
  'ieltsController.js',
  'promptController.js'
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('IELTS package pass5 owns package controller files', () => {
  EXPECTED_CONTROLLERS.forEach((name) => {
    const packagePath = path.join(CONTROLLERS_DIR, name);
    assert.equal(fs.existsSync(packagePath), true, `${name} should exist in package controllers`);
    const source = fs.readFileSync(packagePath, 'utf8');
    assert.match(source, /ieltsCoreModuleResolver/, `${name} should bridge shared dependencies through resolver`);
  });
});

test('IELTS package pass5 route layer uses package controllers', () => {
  const routeSource = read('packages/ielts/MVC/routes/ieltsRoutes.js');

  assert.match(routeSource, /require\('\.\.\/controllers\/ielts\/ieltsController'\)/);
  assert.match(routeSource, /require\('\.\.\/controllers\/ielts\/promptController'\)/);
  assert.match(routeSource, /require\('\.\.\/controllers\/ielts\/apiProviderController'\)/);
  assert.match(routeSource, /require\('\.\.\/controllers\/ielts\/aiTokenUsageController'\)/);
  assert.doesNotMatch(routeSource, /requireCoreModule\('MVC\/controllers\/ielts\//);
});

test('IELTS package pass5 package controllers can be required', () => {
  EXPECTED_CONTROLLERS.forEach((name) => {
    const controller = require(path.join(CONTROLLERS_DIR, name));
    assert.equal(typeof controller, 'object', `${name} should export controller handlers`);
  });
});

test('IELTS package pass5 controller commit-helper paths resolve from core root', () => {
  const source = read('packages/ielts/MVC/controllers/ielts/ieltsController.js');
  assert.match(source, /const IELTS_PROJECT_ROOT = resolveCoreRoot\(\);/);
  assert.doesNotMatch(source, /path\.join\(__dirname,\s*['"]\.\.\/\.\.\/\.\.\/['"]\)/);
});
