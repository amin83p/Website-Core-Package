const test = require('node:test');
const assert = require('node:assert/strict');

const feeCategoryCatalog = require('../MVC/models/school/feeCategoryCatalog');

test('Self Funded is a valid fee category', () => {
  assert.ok(feeCategoryCatalog.FEE_CATEGORIES.includes('Self Funded'));
  assert.equal(feeCategoryCatalog.isValidFeeCategory('Self Funded'), true);
  assert.equal(feeCategoryCatalog.isValidFeeCategory('Self Funded-extra'), false);
});

test('getStudentFeeCategoryControlAccountCode maps Self Funded to 1229', () => {
  assert.equal(feeCategoryCatalog.getStudentFeeCategoryControlAccountCode('Self Funded'), '1229');
  assert.equal(feeCategoryCatalog.getStudentFeeCategoryControlAccountCode('self'), '1229');
  assert.equal(feeCategoryCatalog.getStudentFeeCategoryControlAccountCode('Domestic'), '1221');
  assert.equal(feeCategoryCatalog.getStudentFeeCategoryControlAccountCode('Unknown Category'), null);
});

test('normalizeFeeCategoryKey strips punctuation consistently', () => {
  assert.equal(feeCategoryCatalog.normalizeFeeCategoryKey('Government Funded'), 'government_funded');
  assert.equal(feeCategoryCatalog.normalizeFeeCategoryKey('LINC Alberta'), 'linc_alberta');
  assert.equal(feeCategoryCatalog.normalizeFeeCategoryKey('Self Funded'), 'self_funded');
});