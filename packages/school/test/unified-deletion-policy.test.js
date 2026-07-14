const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { POLICIES, getDeletionPolicy } = require('../MVC/services/school/schoolDeletionPolicyRegistry');
const { buildVoidPatch, isVoidRecord } = require('../MVC/models/school/voidRecordMetadata');

test('business and structural School records use void policy', () => {
  for (const entityType of [
    'studentProgramRegistrations', 'studentTermRegistrations', 'classEnrollmentPeriods',
    'subjects', 'departments', 'terms', 'programs', 'classes', 'activities'
  ]) {
    assert.equal(getDeletionPolicy(entityType), 'void', entityType);
  }
});

test('runtime School records use physical policy', () => {
  for (const entityType of [
    'classSessions', 'activityWorkSessions', 'reportInstances', 'reportAssignments',
    'examAllocations', 'examAssignments', 'examAttempts', 'examAnswers'
  ]) {
    assert.equal(POLICIES[entityType], 'physical', entityType);
  }
});

test('void patch preserves identity and records audit metadata idempotently', () => {
  const original = { id: 'ROW-1', orgId: 'ORG-1', status: 'active', name: 'Example' };
  const first = buildVoidPatch(original, { id: 'USR-1' }, 'Removed in error');
  assert.equal(first.id, original.id);
  assert.equal(first.status, 'void');
  assert.equal(first.statusBeforeVoid, 'active');
  assert.equal(first.voidedBy, 'USR-1');
  assert.equal(first.voidReason, 'Removed in error');
  assert.ok(first.voidedAt);
  assert.equal(isVoidRecord(first), true);
  const replay = buildVoidPatch(first, { id: 'USR-2' }, 'Replay');
  assert.equal(replay.voidedAt, first.voidedAt);
  assert.equal(replay.voidedBy, first.voidedBy);
});

test('normal data deletion dispatches void records to update and maintenance requires void before purge', () => {
  const dataServiceSource = fs.readFileSync(path.join(__dirname, '../MVC/services/school/schoolDataService.js'), 'utf8');
  const maintenanceSource = fs.readFileSync(path.join(__dirname, '../MVC/services/school/schoolDataMaintenanceService.js'), 'utf8');
  assert.match(dataServiceSource, /isVoidPolicy\(normalizedType\)/);
  assert.match(dataServiceSource, /buildVoidPatch/);
  assert.match(maintenanceSource, /Only void records can be permanently purged/);
});

test('runtime routes expose physical class-session and work-session deletion', () => {
  const classRoutes = fs.readFileSync(path.join(__dirname, '../MVC/routes/classRoutes.js'), 'utf8');
  const activityRoutes = fs.readFileSync(path.join(__dirname, '../MVC/routes/activityRoutes.js'), 'utf8');
  assert.match(classRoutes, /router\.delete\('\/:id\/sessions\/:sessionId'/);
  assert.match(activityRoutes, /router\.delete\('\/:activityId\/work-sessions\/:entryId'/);
});
