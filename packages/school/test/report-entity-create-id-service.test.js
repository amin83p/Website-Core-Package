const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveReportCreateId } = require('../MVC/services/school/reportEntityCreateIdService');

test('resolveReportCreateId returns free requested id', async () => {
  const id = await resolveReportCreateId({
    requestedId: '900000-rpt-9',
    reservedIds: ['900000-rpt-1'],
    allocateNext: () => Promise.resolve('900000-rpt-99')
  });
  assert.equal(id, '900000-rpt-9');
});

test('resolveReportCreateId allocates when requested id is taken', async () => {
  let allocated = false;
  const id = await resolveReportCreateId({
    requestedId: '900000-rpt-1',
    reservedIds: ['900000-rpt-1'],
    allocateNext: () => {
      allocated = true;
      return Promise.resolve('900000-rpt-2');
    }
  });
  assert.equal(allocated, true);
  assert.equal(id, '900000-rpt-2');
});

test('resolveReportCreateId allocates when no requested id', async () => {
  const id = await resolveReportCreateId({
    allocateNext: () => Promise.resolve('RPTINS-2026-ABC')
  });
  assert.equal(id, 'RPTINS-2026-ABC');
});
