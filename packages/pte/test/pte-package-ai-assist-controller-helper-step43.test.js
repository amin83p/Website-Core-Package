const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const coreHelpersDepsPath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js');
const coreHelpersPath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers/pte/coreHelpers.js');

test('PTE core helper dependencies should use package dependency shim', () => {
  const source = fs.readFileSync(coreHelpersDepsPath, 'utf8');

  assert.ok(
    source.includes("require('../../services/pte/pteCoreDependencies')"),
    'pteCoreHelpersDependencies should import package core dependency adapter.'
  );
  assert.ok(
    !source.includes('../../../../MVC/utils/paginationHelper'),
    'pteCoreHelpersDependencies should not import paginationHelper directly from core.'
  );
  assert.ok(
    !source.includes('../../../../MVC/utils/generalTools'),
    'pteCoreHelpersDependencies should not import generalTools directly from core.'
  );
  assert.ok(
    !source.includes('../../../../MVC/services/adminChekersService'),
    'pteCoreHelpersDependencies should not import adminChekersService directly from core.'
  );
  assert.ok(
    !source.includes('../../../../MVC/utils/idAdapter'),
    'pteCoreHelpersDependencies should not import idAdapter directly from core.'
  );
});

test('PTE core helper dependency shim should expose required helpers', () => {
  const deps = require(coreHelpersDepsPath);

  assert.equal(typeof deps.paginate, 'function', 'paginate should be available.');
  assert.equal(typeof deps.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be available.');
  assert.equal(typeof deps.inferSearchableFields, 'function', 'inferSearchableFields should be available.');
  assert.equal(typeof deps.isAjax, 'function', 'isAjax should be available.');
  assert.equal(typeof deps.adminChekersService, 'object', 'adminChekersService should be available.');
  assert.equal(typeof deps.toPublicId, 'function', 'toPublicId should be available.');
});

test('PTE controllers using core helpers still load all expected APIs', () => {
  const coreHelpers = require(coreHelpersPath);
  assert.equal(typeof coreHelpers.paginate, 'function', 'paginate should be available.');
  assert.equal(typeof coreHelpers.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be available.');
  assert.equal(typeof coreHelpers.inferSearchableFields, 'function', 'inferSearchableFields should be available.');
  assert.equal(typeof coreHelpers.isAjax, 'function', 'isAjax should be available.');
  assert.equal(typeof coreHelpers.adminChekersService, 'object', 'adminChekersService should be available.');
});
