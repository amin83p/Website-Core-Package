const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateUniqueLibraryCopyId,
  allocateUniqueLibraryPatronId
} = require('../MVC/services/school/libraryCatalogEntityIdService');

test('library catalog allocators use year-random prefix format', async () => {
  const copyId = await allocateUniqueLibraryCopyId({ existingIds: ['LC-2026-TAKEN'] });
  assert.match(copyId, /^LC-\d{4}-[A-Z0-9]+$/);
  assert.notEqual(copyId, 'LC-2026-TAKEN');

  const patronId = await allocateUniqueLibraryPatronId({ existingIds: [copyId] });
  assert.match(patronId, /^LP-\d{4}-[A-Z0-9]+$/);
});
