const test = require('node:test');
const assert = require('node:assert/strict');

const schoolPersonAccessService = require('../MVC/services/school/schoolPersonAccessService');

test('formatPersonName returns fallback when person is null', () => {
  assert.equal(schoolPersonAccessService.formatPersonName(null, 'STU_001'), 'STU_001');
});

test('formatPersonName returns fallback when person is undefined', () => {
  assert.equal(schoolPersonAccessService.formatPersonName(undefined, 'STU_002'), 'STU_002');
});

test('formatPersonName prefers person name parts over fallback', () => {
  assert.equal(
    schoolPersonAccessService.formatPersonName({ name: { first: 'Jane', last: 'Doe' } }, 'STU_003'),
    'Jane Doe'
  );
});
