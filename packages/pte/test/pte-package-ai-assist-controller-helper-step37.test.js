const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const coreHelpersPath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers/pte/coreHelpers.js');
const coreHelpersDepsPath = path.join(ROOT_DIR, 'packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js');

test('PTE core helpers should use package-local dependency shim', () => {
  assert.equal(fs.existsSync(coreHelpersPath), true, 'coreHelpers.js should exist.');
  const source = fs.readFileSync(coreHelpersPath, 'utf8');

  assert.equal(
    source.includes('require(\'./pteCoreHelpersDependencies\')'),
    true,
    'coreHelpers should import pteCoreHelpersDependencies.'
  );

  assert.equal(
    source.includes('../../../../MVC/utils/paginationHelper'),
    false,
    'coreHelpers should not import paginationHelper directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/utils/generalTools'),
    false,
    'coreHelpers should not import generalTools directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/services/adminChekersService'),
    false,
    'coreHelpers should not import adminChekersService directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/utils/idAdapter'),
    false,
    'coreHelpers should not import idAdapter directly from core.'
  );
});

test('PTE core helper dependency shim should export required utilities', () => {
  const deps = require(coreHelpersDepsPath);
  assert.equal(typeof deps.paginate, 'function', 'paginate should be exported.');
  assert.equal(typeof deps.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be exported.');
  assert.equal(typeof deps.inferSearchableFields, 'function', 'inferSearchableFields should be exported.');
  assert.equal(typeof deps.isAjax, 'function', 'isAjax should be exported.');
  assert.equal(typeof deps.adminChekersService, 'object', 'adminChekersService should be exported.');
  assert.equal(typeof deps.toPublicId, 'function', 'toPublicId should be exported.');
});

test('PTE controllers using core helpers should still load successfully', () => {
  const coreHelpers = require(coreHelpersPath);
  assert.equal(typeof coreHelpers.paginate, 'function', 'paginate should be available.');
  assert.equal(typeof coreHelpers.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be available.');
  assert.equal(typeof coreHelpers.isAjax, 'function', 'isAjax should be available.');
});
