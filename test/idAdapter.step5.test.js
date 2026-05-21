const test = require('node:test');
const assert = require('node:assert/strict');

const { toPublicId, toStorageId, idsEqual, toIdArray } = require('../MVC/utils/idAdapter');

test('toPublicId normalizes primitive and object ids', () => {
  assert.equal(toPublicId(10), '10');
  assert.equal(toPublicId('  ABC  '), 'ABC');
  assert.equal(toPublicId({ id: 55 }), '55');
  assert.equal(toPublicId({ _id: 'X1' }), 'X1');
});

test('toStorageId returns nullable normalized value', () => {
  assert.equal(toStorageId(''), null);
  assert.equal(toStorageId(' 100 '), '100');
  assert.equal(toStorageId('100', { preferNumber: true }), 100);
});

test('idsEqual compares cross-type ids safely', () => {
  assert.equal(idsEqual('7', 7), true);
  assert.equal(idsEqual({ id: 'A1' }, { _id: 'A1' }), true);
  assert.equal(idsEqual('A1', 'a1'), false);
  assert.equal(idsEqual('A1', 'a1', { caseInsensitive: true }), true);
});

test('toIdArray returns cleaned id list', () => {
  assert.deepEqual(toIdArray([1, ' 2 ', null, '', 'x']), ['1', '2', 'x']);
});
