const test = require('node:test');
const assert = require('node:assert/strict');

const reportTemplateIdService = require('../MVC/services/school/reportTemplateIdService');

test('formatOrgKindTemplateId builds org-scoped template ids', () => {
  assert.equal(
    reportTemplateIdService.formatOrgKindTemplateId('900000', 'rpt', 1),
    '900000-rpt-1'
  );
  assert.equal(
    reportTemplateIdService.formatOrgKindTemplateId('900000', 'ovr', 12),
    '900000-ovr-12'
  );
});

test('maxSeqFromIdSet honors scoped and legacy numeric ids per org', () => {
  const max = reportTemplateIdService.maxSeqFromIdSet(
    ['829385', '900000-rpt-3', '900000-rpt-10', '900000-ovr-2'],
    '900000',
    'rpt'
  );
  assert.equal(max, 829385);
});

test('allocateNextReportTemplateId starts at org-rpt-1', async () => {
  const id = await reportTemplateIdService.allocateNextReportTemplateId('900000', { existingIds: [] });
  assert.equal(id, '900000-rpt-1');
});

test('allocateNextOverallReportTemplateId increments within org', async () => {
  const id = await reportTemplateIdService.allocateNextOverallReportTemplateId('900000', {
    existingIds: ['900000-ovr-1', '900000-ovr-5']
  });
  assert.equal(id, '900000-ovr-6');
});
