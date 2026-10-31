const test = require('node:test');
const assert = require('node:assert/strict');

const reportInstanceIdService = require('../MVC/services/school/reportInstanceIdService');

test('formatReportInstanceId matches RPTINS prefix', () => {
  const id = reportInstanceIdService.formatReportInstanceId(new Date('2026-03-01T12:00:00Z'), 0);
  assert.match(id, /^RPTINS-2026-[A-Z0-9]+$/);
});

test('allocateUniqueReportInstanceId skips taken ids', async () => {
  const taken = reportInstanceIdService.formatReportInstanceId(new Date('2026-01-01T12:00:00Z'), 0);
  const id = await reportInstanceIdService.allocateUniqueReportInstanceId({
    now: '2026-01-01T12:00:00Z',
    existingIds: [taken]
  });
  assert.notEqual(id, taken);
  assert.match(id, /^RPTINS-2026-[A-Z0-9]+$/);
});

test('allocateUniqueOverallReportInstanceId uses OVRINS prefix', async () => {
  const id = await reportInstanceIdService.allocateUniqueOverallReportInstanceId({
    existingIds: ['OVRINS-2026-TAKEN']
  });
  assert.match(id, /^OVRINS-2026-[A-Z0-9]+$/);
  assert.notEqual(id, 'OVRINS-2026-TAKEN');
});

test('allocateUniqueOverallReportManagementSessionId uses OVRMSG prefix', async () => {
  const id = await reportInstanceIdService.allocateUniqueOverallReportManagementSessionId({
    existingIds: ['OVRMSG-2026-TAKEN']
  });
  assert.match(id, /^OVRMSG-2026-[A-Z0-9]+$/);
});
