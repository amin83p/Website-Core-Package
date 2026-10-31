const test = require('node:test');
const assert = require('node:assert/strict');

const bookCatalogIdService = require('../MVC/services/school/bookCatalogIdService');
const { isIdAvailable, allocateWithRetry } = require('../MVC/services/school/schoolEntityIdAllocationService');

test('formatBookCatalogId matches BK-RANDOM-HHMM pattern', () => {
  const id = bookCatalogIdService.formatBookCatalogId(new Date('2026-03-15T09:37:00'));
  assert.match(id, /^BK-[A-Z0-9]+-\d{4}$/);
  assert.ok(id.endsWith('0937'));
});

test('allocateUniqueBookCatalogId retries when id is taken', async () => {
  const taken = bookCatalogIdService.formatBookCatalogId(new Date('2026-01-01T12:00:00'));
  let calls = 0;
  const id = await allocateWithRetry({
    existingIds: [taken],
    generateCandidate: () => {
      calls += 1;
      return calls === 1 ? taken : 'BK-FREEID-1200';
    }
  });
  assert.equal(id, 'BK-FREEID-1200');
  assert.ok(calls >= 2);
});

test('allocateUniqueBookCatalogId returns unused candidate', async () => {
  const id = await bookCatalogIdService.allocateUniqueBookCatalogId({
    existingIds: ['BK-TAKEN-0000']
  });
  assert.match(id, /^BK-[A-Z0-9]+-\d{4}$/);
  assert.notEqual(id, 'BK-TAKEN-0000');
});

test('isIdAvailable respects existingIds set', async () => {
  assert.equal(await isIdAvailable('BK-X', { existingIds: ['BK-X'] }), false);
  assert.equal(await isIdAvailable('BK-Y', { existingIds: ['BK-X'] }), true);
});
