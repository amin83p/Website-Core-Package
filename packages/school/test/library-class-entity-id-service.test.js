const test = require('node:test');
const assert = require('node:assert/strict');

const libraryClassEntityIdService = require('../MVC/services/school/libraryClassEntityIdService');
const reportAssignmentIdService = require('../MVC/services/school/reportAssignmentIdService');

test('formatClassKindId builds class-scoped bka and bkc ids', () => {
  assert.equal(
    libraryClassEntityIdService.formatClassKindId('646148', 'bka', 1),
    '646148-bka-1'
  );
  assert.equal(
    libraryClassEntityIdService.formatClassKindId('646148', 'bkc', 3),
    '646148-bkc-3'
  );
});

test('maxSeqFromIdSet increments within class and kind only', () => {
  const max = libraryClassEntityIdService.maxSeqFromIdSet(
    ['646148-bka-1', '646148-bka-4', '646148-bkc-2', '646148-1'],
    '646148',
    'bka'
  );
  assert.equal(max, 4);
});

test('allocateNextClassKindId starts at class-bka-1', async () => {
  const id = await libraryClassEntityIdService.allocateNextClassKindId(
    '646148',
    'bka',
    { existingIds: [] }
  );
  assert.equal(id, '646148-bka-1');
});

test('library bka ids do not share report assignment seq namespace', async () => {
  const reportId = await reportAssignmentIdService.allocateNextReportAssignmentId('646148', {
    existingIds: ['646148-1']
  });
  const bkaId = await libraryClassEntityIdService.allocateNextClassKindId('646148', 'bka', {
    existingIds: ['646148-bka-1']
  });
  assert.equal(reportId, '646148-2');
  assert.equal(bkaId, '646148-bka-2');
});

test('normalizeEntriesBookAssignmentId overwrites stale ids', () => {
  const bookCoveringReportService = require('../MVC/services/school/bookCoveringReportService');
  const out = bookCoveringReportService.normalizeEntriesBookAssignmentId([
    { bookId: 'BK-1', bookAssignmentId: 'STALE' }
  ], '646148-bka-1');
  assert.equal(out[0].bookAssignmentId, '646148-bka-1');
});
