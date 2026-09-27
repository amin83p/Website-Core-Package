'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const workSessionScheduleConflictService = require('../MVC/services/school/workSessionScheduleConflictService');

test('scheduleFieldsChanged detects date and time updates', () => {
  const prior = { date: '2026-03-10', startTime: '09:00', endTime: '10:00' };
  assert.equal(workSessionScheduleConflictService.scheduleFieldsChanged(prior, prior), false);
  assert.equal(
    workSessionScheduleConflictService.scheduleFieldsChanged(prior, { ...prior, date: '2026-03-11' }),
    true
  );
  assert.equal(
    workSessionScheduleConflictService.scheduleFieldsChanged(prior, { ...prior, startTime: '09:30' }),
    true
  );
});

test('assertNoAssigneeScheduleConflicts skips check when schedule unchanged', async () => {
  const priorEntry = { date: '2026-03-10', startTime: '09:00', endTime: '10:00', status: 'posted' };
  const result = await workSessionScheduleConflictService.assertNoAssigneeScheduleConflicts({
    orgId: 'ORG_1',
    activityId: 'ACT_1',
    entryId: 'ENT_1',
    date: '2026-03-10',
    startTime: '09:00',
    endTime: '10:00',
    assignees: [{ personId: 'P1' }],
    priorEntry,
    status: 'posted',
    reqUser: { id: 'U1', activeOrgId: 'ORG_1' }
  });
  assert.deepEqual(result, { conflicts: [] });
});

test('assertNoAssigneeScheduleConflicts throws SESSION_METADATA_CONFLICTS when overlaps exist', async () => {
  const scheduleControllerPath = require.resolve('../MVC/controllers/school/scheduleController');
  const original = require(scheduleControllerPath);
  const mockBuild = async () => ({
    events: [{
      date: '2026-03-11',
      start: '09:00',
      end: '10:00',
      title: 'Math 101',
      className: 'Math 101'
    }]
  });
  require.cache[scheduleControllerPath].exports = {
    ...original,
    buildEventsForPersonAndRange: mockBuild
  };

  try {
    await assert.rejects(
      () => workSessionScheduleConflictService.assertNoAssigneeScheduleConflicts({
        orgId: 'ORG_1',
        activityId: 'ACT_1',
        entryId: 'ENT_1',
        date: '2026-03-11',
        startTime: '09:00',
        endTime: '10:00',
        assignees: [{ personId: 'P1', startTime: '09:00', endTime: '10:00' }],
        priorEntry: { date: '2026-03-10', startTime: '09:00', endTime: '10:00', status: 'posted' },
        status: 'posted',
        reqUser: { id: 'U1', activeOrgId: 'ORG_1' }
      }),
      (error) => {
        assert.equal(error.code, 'SESSION_METADATA_CONFLICTS');
        assert.ok(Array.isArray(error.data?.conflicts));
        assert.ok(error.data.conflicts.length >= 1);
        return true;
      }
    );
  } finally {
    require.cache[scheduleControllerPath].exports = original;
  }
});
