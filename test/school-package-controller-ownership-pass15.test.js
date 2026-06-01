const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass15 owns sessionController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/sessionController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/sessionController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns termController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/termController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/termController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/paginationHelper'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns subjectController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/subjectController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/subjectController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns holidayController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/holidayController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/holidayController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/services\/adminChekersService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

