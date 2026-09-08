'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetImportLifecycleService = require('../MVC/services/school/timesheetImportLifecycleService');

const samplePeriod = { id: 'PER_1', name: 'March 2026', status: 'open' };
const sampleReqUser = { id: 'USER_1', displayName: 'Import Admin' };
const sampleEntries = [{
  sessionId: 'legacyimp-PER_1-PERSON_1-1',
  date: '2026-03-01',
  hours: 2,
  isLegacyImport: true,
  isManual: false
}];

test('prepareImportTargetPayload keeps draft lifecycle fields', () => {
  const result = timesheetImportLifecycleService.prepareImportTargetPayload({
    basePayload: {
      id: 'TS_1',
      status: 'not_started',
      entries: sampleEntries,
      totalHours: 2
    },
    period: samplePeriod,
    targetStatus: 'draft',
    reqUser: sampleReqUser,
    priorTimesheet: { status: 'draft', reviewVersion: 0 }
  });
  assert.equal(result.appliedStatus, 'draft');
  assert.equal(result.requiresPostSaveFinalization, false);
  assert.equal(result.payload.status, 'draft');
  assert.equal(result.payload.submissionSnapshot, null);
});

test('prepareImportTargetPayload builds submitted snapshot and history', () => {
  const result = timesheetImportLifecycleService.prepareImportTargetPayload({
    basePayload: {
      id: 'TS_1',
      status: 'draft',
      entries: sampleEntries,
      totalHours: 2
    },
    period: samplePeriod,
    targetStatus: 'submitted',
    reqUser: sampleReqUser,
    priorTimesheet: { status: 'draft', reviewVersion: 0, reviewHistory: [] }
  });
  assert.equal(result.appliedStatus, 'submitted');
  assert.equal(result.requiresPostSaveFinalization, true);
  assert.equal(result.payload.status, 'submitted');
  assert.ok(result.payload.submissionSnapshot?.submittedAt);
  assert.equal(result.payload.reviewVersion, 1);
  assert.equal(result.payload.managerReview?.status, 'pending');
  assert.match(result.payload.reviewHistory?.[0]?.event, /submitted/);
});

test('prepareImportTargetPayload builds manager approved review state', () => {
  const result = timesheetImportLifecycleService.prepareImportTargetPayload({
    basePayload: {
      id: 'TS_1',
      status: 'draft',
      entries: sampleEntries,
      totalHours: 2
    },
    period: samplePeriod,
    targetStatus: 'manager_approved',
    reqUser: sampleReqUser,
    priorTimesheet: { status: 'draft', reviewVersion: 0, reviewHistory: [] }
  });
  assert.equal(result.appliedStatus, 'manager_approved');
  assert.equal(result.payload.status, 'submitted');
  assert.equal(result.payload.managerReview?.status, 'approved');
  assert.equal(result.payload.managerReview?.reviewVersion, result.payload.reviewVersion);
  assert.ok(result.payload.reviewHistory.some((row) => row.event === 'manager_approved'));
});

test('prepareImportTargetPayload rejects processed target on processed period', () => {
  assert.throws(
    () => timesheetImportLifecycleService.prepareImportTargetPayload({
      basePayload: { entries: sampleEntries, totalHours: 2 },
      period: { id: 'PER_2', status: 'processed' },
      targetStatus: 'processed',
      reqUser: sampleReqUser,
      priorTimesheet: { status: 'draft', reviewVersion: 0 }
    }),
    /already been processed/i
  );
});
