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

test('buildEnrollmentGapConflictReview filters staged sessions by student windows', () => {
  const staged = [
    { sessionId: 'S1', date: '2026-01-05', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'S2', date: '2026-01-12', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'S3', date: '2026-02-02', startTime: '09:00', endTime: '10:00' }
  ];
  const review = conflictService.buildEnrollmentGapConflictReview({
    stagedSessions: staged,
    conflictResult: {
      teacherConflicts: [{
        date: '2026-01-12',
        teacherName: 'Jane Doe',
        conflictClass: 'Other Class',
        existTime: '09:00 - 10:00',
        conflictType: 'teacher_schedule'
      }],
      rosterStudentConflicts: [{
        sessionIndex: 1,
        date: '2026-01-12',
        teacherName: 'Student A',
        conflictClass: 'Math Lab',
        existTime: '09:00 - 10:00',
        conflictType: 'student_schedule',
        studentId: 'STU_A'
      }],
      enrollingStudentConflicts: []
    },
    studentWindows: [
      {
        studentId: 'STU_A',
        displayName: 'Student A',
        role: 'enrolled',
        windowStart: '2026-01-01',
        windowEnd: '2026-01-31'
      },
      {
        studentId: 'STU_B',
        displayName: 'Student B',
        role: 'enrolling',
        windowStart: '2026-01-01',
        windowEnd: '2026-02-28'
      }
    ]
  });

  assert.equal(review.hasConflicts, true);
  assert.equal(review.teacherConflicts.length, 1);
  assert.equal(review.students.length, 2);

  const enrolled = review.students.find((row) => row.studentId === 'STU_A');
  assert.ok(enrolled);
  assert.equal(enrolled.sessions.length, 2);
  assert.equal(enrolled.sessions.some((row) => row.date === '2026-02-02'), false);
  const conflicted = enrolled.sessions.find((row) => row.date === '2026-01-12');
  assert.equal(conflicted.hasConflict, true);
  assert.match(conflicted.conflictDetail, /Math Lab/);
  assert.match(conflicted.conflictDetail, /Student A/);
  assert.equal(conflicted.studentDisplayName, 'Student A');

  const enrolling = review.students.find((row) => row.role === 'enrolling');
  assert.ok(enrolling);
  assert.equal(enrolling.sessions.length, 3);
  assert.equal(enrolling.hasConflicts, false);
});

test('buildEnrollmentGapConflictReview reports clear when no conflicts', () => {
  const review = conflictService.buildEnrollmentGapConflictReview({
    stagedSessions: [{ sessionId: 'S1', date: '2026-01-05', startTime: '09:00', endTime: '10:00' }],
    conflictResult: {
      teacherConflicts: [],
      rosterStudentConflicts: [],
      enrollingStudentConflicts: []
    },
    studentWindows: [{
      studentId: 'STU_NEW',
      displayName: 'New Student',
      role: 'enrolling',
      windowStart: '2026-01-01',
      windowEnd: '2026-01-31'
    }]
  });
  assert.equal(review.hasConflicts, false);
  assert.equal(review.students[0].sessions.length, 1);
  assert.equal(review.students[0].sessions[0].hasConflict, false);
});

test('rolling enrollment controller exposes enrollment-gap conflict review endpoint', () => {
  const controllerSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  const routeSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/routes/classRoutes.js'),
    'utf8'
  );
  assert.match(controllerSource, /postEnrollmentGapConflictReview/);
  assert.match(controllerSource, /buildEnrollmentGapConflictReview/);
  assert.match(routeSource, /enrollment-gap-conflict-review/);
});

test('rolling enrollment UI uses multi-step enrollment wizard', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
    'utf8'
  );
  assert.match(source, /enrollWizardStepForm/);
  assert.match(source, /enrollWizardStepAddSessions/);
  assert.match(source, /enrollWizardStepMarkNa/);
  assert.match(source, /enrollWizardStepConflicts/);
  assert.match(source, /btn_enrollWizardBack/);
  assert.match(source, /Add Enrollment Period/);
  assert.match(source, /enrollment-gap-conflict-review/);
  assert.match(source, /goEnrollmentWizardBack/);
  assert.match(source, /wizard-step-rail/);
  assert.match(source, /wizard-step-pill/);
  assert.match(source, /wizardStepRail\.js/);
  assert.match(source, /conflictReviewReadyPanel/);
  assert.match(source, /conflictReviewConflictPanel/);
  assert.match(source, /renderConflictReview/);
  assert.doesNotMatch(source, /enrollmentSessionGapModal/);
  assert.doesNotMatch(source, /enrollmentSessionNaModal/);
  assert.doesNotMatch(source, /openSessionGapModal/);
  assert.doesNotMatch(source, /openSessionNaModal/);
});

test('buildStudentWindowsForGapConflictReview uses person-based student display names', () => {
  const controllerSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  assert.match(controllerSource, /buildStudentWindowsForGapConflictReview/);
  assert.match(controllerSource, /buildPersonByIdMap/);
  assert.match(controllerSource, /formatPersonName/);
});

test('session conflict service enriches enrollment gap conflict details with display names', () => {
  const serviceSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/services/school/sessionConflictDetectionService.js'),
    'utf8'
  );
  assert.match(serviceSource, /buildStudentDisplayNameMap/);
  assert.match(serviceSource, /enrichConflictRowsWithDisplayNames/);
  assert.match(serviceSource, /studentDisplayName/);
});
