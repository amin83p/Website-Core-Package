const test = require('node:test');
const assert = require('node:assert/strict');

const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');
const conflictService = require('../MVC/services/school/sessionConflictDetectionService');

test('parseGapBatchSpec returns null when required fields are missing', () => {
  assert.equal(alignmentService.parseGapBatchSpec({}), null);
  assert.equal(alignmentService.parseGapBatchSpec({ startDate: '2026-01-01' }), null);
});

test('parseGapBatchSpec normalizes pending gap batch payload', () => {
  const spec = alignmentService.parseGapBatchSpec({
    pendingGapBatch: {
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      startTime: '09:00',
      endTime: '10:00',
      daysOfWeek: [1],
      teacherId: 'PERSON_01',
      teacherName: 'Jane Doe',
      extendCycleEndDate: true
    }
  });
  assert.ok(spec);
  assert.equal(spec.startDate, '2026-01-05');
  assert.equal(spec.teacherId, 'PERSON_01');
  assert.equal(spec.extendCycleEndDate, true);
  assert.deepEqual(spec.daysOfWeek, [1]);
});

test('evaluateAlignment counts staged proposed sessions in enrollment window', () => {
  const existing = [{ sessionId: 'SES_1', date: '2026-01-05', startTime: '09:00', endTime: '10:00', status: 'scheduled' }];
  const proposed = alignmentService.generateBatchSessionRows({
    classData: { registrationMode: 'rolling' },
    existingSessions: existing,
    batchSpec: {
      startDate: '2026-01-12',
      endDate: '2026-01-12',
      daysOfWeek: [1],
      startTime: '09:00',
      endTime: '10:00',
      skipExistingDates: false
    }
  });
  const merged = [...existing, ...proposed];
  const alignment = alignmentService.evaluateAlignment({
    sessions: merged,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    targetSessionCount: 2,
    statusMap: new Map([['scheduled', { code: 'scheduled', countable: true }]])
  });
  assert.equal(alignment.availableCount, 2);
  assert.equal(alignment.alignmentStatus, 'ok');
});

test('buildConflictBlockingMessage summarizes conflicts', () => {
  const message = conflictService.buildConflictBlockingMessage([
    {
      date: '2026-01-05',
      teacherName: 'Jane Doe',
      conflictClass: 'Math 101',
      existTime: '09:00 - 10:00'
    }
  ]);
  assert.match(message, /Scheduling conflicts detected/);
  assert.match(message, /Jane Doe overlaps Math 101/);
});

test('dedupeSessionConflictRows removes duplicate conflict rows', () => {
  const row = {
    sessionIndex: 0,
    date: '2026-01-05',
    teacherName: 'Student A',
    conflictClass: 'Other Class',
    existTime: '09:00 - 10:00',
    conflictType: 'student_schedule'
  };
  const deduped = conflictService.dedupeSessionConflictRows([row, { ...row }]);
  assert.equal(deduped.length, 1);
});

test('commitGapBatchSessions delegates to appendBatchSessions', async () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/services/school/rollingEnrollmentSessionAlignmentService.js'),
    'utf8'
  );
  assert.match(source, /async function commitGapBatchSessions/);
  assert.match(source, /return appendBatchSessions\(/);
});

test('rolling enrollment controller commits pending batch after enrollment create', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  assert.match(source, /commitPendingGapBatchIfPresent/);
  assert.match(source, /postPreviewBatchSessions/);
  assert.match(source, /pendingGapBatch/);
});

test('parsePendingStagedSessions normalizes explicit staged session rows', () => {
  const rows = alignmentService.parsePendingStagedSessions({
    pendingStagedSessions: [{
      sessionId: 'STAGED_001',
      date: '2026-02-03',
      startTime: '09:00',
      endTime: '10:00',
      status: 'scheduled',
      delivery: { deliveredBy: 'PERSON_01', deliveredByName: 'Jane Doe' }
    }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'STAGED_001');
  assert.equal(rows[0].delivery.deliveredBy, 'PERSON_01');
});

test('commitStagedSessions is exported for explicit staged commit path', () => {
  assert.equal(typeof alignmentService.commitStagedSessions, 'function');
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/services/school/rollingEnrollmentSessionAlignmentService.js'),
    'utf8'
  );
  assert.match(source, /async function commitStagedSessions/);
});

test('rolling enrollment controller parses pendingStagedSessions for alignment and commit', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  assert.match(source, /parsePendingStagedSessionsFromBody/);
  assert.match(source, /commitStagedSessions/);
  assert.match(source, /pendingStagedSessions/);
});

test('rolling enrollment UI highlights staged sessions and persists gap form draft', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
    'utf8'
  );
  assert.match(source, /pendingStagedSessions/);
  assert.match(source, /gapFormDraft/);
  assert.match(source, /gap-session-row-staged/);
  assert.match(source, /btn-remove-staged/);
  assert.match(source, /captureGapFormDraft/);
  assert.match(source, /applyGapFormDraft/);
});

test('rolling enrollment UI uses preview-batch instead of immediate append-batch save', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
    'utf8'
  );
  assert.match(source, /sessions\/preview-batch/);
  assert.match(source, /pendingGapBatch/);
  assert.match(source, /Stage Sessions/);
  assert.doesNotMatch(source, /sessions\/append-batch/);
});
