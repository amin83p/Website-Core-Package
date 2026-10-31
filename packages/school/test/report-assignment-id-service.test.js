const test = require('node:test');
const assert = require('node:assert/strict');

const reportAssignmentIdService = require('../MVC/services/school/reportAssignmentIdService');

test('formatReportAssignmentId builds class-scoped ids', () => {
  assert.equal(reportAssignmentIdService.formatReportAssignmentId('646148', 1), '646148-1');
  assert.equal(reportAssignmentIdService.formatReportAssignmentId('646148', 42), '646148-42');
});

test('maxSeqFromIdSet honors class-scoped and legacy numeric ids', () => {
  const max = reportAssignmentIdService.maxSeqFromIdSet(
    ['581970', '646148-3', '646148-12', '999999-1'],
    '646148'
  );
  assert.equal(max, 581970);
});

test('allocateNextReportAssignmentId returns first id for class', async () => {
  const id = await reportAssignmentIdService.allocateNextReportAssignmentId('CLS_9', {
    existingIds: []
  });
  assert.equal(id, 'CLS_9-1');
});

test('allocateNextReportAssignmentId increments from max scoped seq', async () => {
  const id = await reportAssignmentIdService.allocateNextReportAssignmentId('646148', {
    existingIds: ['646148-2', '646148-5']
  });
  assert.equal(id, '646148-6');
});

test('allocateNextReportAssignmentId skips reserved ids', async () => {
  const id = await reportAssignmentIdService.allocateNextReportAssignmentId('646148', {
    existingIds: ['646148-1'],
    reservedIds: new Set(['646148-2'])
  });
  assert.equal(id, '646148-3');
});

test('allocateNextReportAssignmentId skips ids found in mongo', async () => {
  const taken = new Set(['646148-1']);
  const collection = {
    find: () => ({ toArray: async () => [] }),
    findOne: async (query) => (taken.has(String(query?.id || '')) ? { _id: 'x' } : null)
  };
  const id = await reportAssignmentIdService.allocateNextReportAssignmentId('646148', { collection });
  assert.equal(id, '646148-2');
});
