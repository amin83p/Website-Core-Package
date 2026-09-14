const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');
const conflictService = require('../MVC/services/school/sessionConflictDetectionService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

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
    classData: { id: 'CLASS_01', registrationMode: 'rolling' },
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

test('evaluateEnrollmentGapBatchConflicts is available after scheduleController load order', () => {
  const scheduleControllerPath = path.resolve(__dirname, '../MVC/controllers/school/scheduleController.js');
  const conflictServicePath = path.resolve(__dirname, '../MVC/services/school/sessionConflictDetectionService.js');
  const sessionMergePath = path.resolve(__dirname, '../MVC/services/school/sessionMergeService.js');

  delete require.cache[scheduleControllerPath];
  delete require.cache[conflictServicePath];
  delete require.cache[sessionMergePath];

  const scheduleController = require(scheduleControllerPath);
  const reloadedConflictService = require(conflictServicePath);

  assert.equal(typeof reloadedConflictService.evaluateEnrollmentGapBatchConflicts, 'function');
  assert.equal(typeof reloadedConflictService.buildConflictBlockingMessage, 'function');
  assert.equal(typeof scheduleController.postCommitStagedSessions, 'function');
});

test('postCommitStagedSessions uses lightweight master schedule conflict path', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/scheduleController.js'),
    'utf8'
  );
  assert.match(controllerSource, /evaluateMasterScheduleStagedSessionConflicts/);
  const commitBlock = controllerSource.slice(
    controllerSource.indexOf('async function postCommitStagedSessions'),
    controllerSource.indexOf('function parseBulkDeleteSessionsFromBody')
  );
  assert.doesNotMatch(commitBlock, /evaluateEnrollmentGapBatchConflicts/);
});

test('postCommitStagedSessions returns viewer events for created sessions', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/scheduleController.js'),
    'utf8'
  );
  assert.match(controllerSource, /buildPersonScheduleEventsForSessions/);
  const commitBlock = controllerSource.slice(
    controllerSource.indexOf('async function postCommitStagedSessions'),
    controllerSource.indexOf('function parseBulkDeleteSessionsFromBody')
  );
  assert.match(commitBlock, /events:\s*commitEvents/);
  assert.match(commitBlock, /fingerprint/);
});

test('evaluateMasterScheduleStagedSessionConflicts scopes teacher conflicts only', () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/sessionConflictDetectionService.js'),
    'utf8'
  );
  const fnBlock = serviceSource.slice(
    serviceSource.indexOf('async function evaluateMasterScheduleStagedSessionConflicts'),
    serviceSource.indexOf('function buildConflictBlockingMessage')
  );
  assert.match(fnBlock, /instructorPersonId:\s*fallbackTeacherId/);
  assert.match(fnBlock, /startDate/);
  assert.match(fnBlock, /endDate/);
  assert.doesNotMatch(fnBlock, /detectStudentScheduleConflicts/);
  assert.doesNotMatch(fnBlock, /listActiveStudentIdsForClass/);
});

test('sessionDateInWindow and isPersonInstructorOnClass filter conflict scope', () => {
  assert.equal(conflictService.sessionDateInWindow('2026-01-10', '2026-01-01', '2026-01-31'), true);
  assert.equal(conflictService.sessionDateInWindow('2026-02-01', '2026-01-01', '2026-01-31'), false);
  assert.equal(conflictService.sessionDateInWindow('2026-01-15', '', '2026-01-31'), true);
  assert.equal(conflictService.sessionDateInWindow('2026-02-01', '2026-01-10', ''), true);
  assert.equal(conflictService.sessionDateInWindow('', '2026-01-01', '2026-01-31'), false);

  const classRow = {
    instructors: [
      { personId: 'PERSON_A', status: 'active' },
      { personId: 'PERSON_B', status: 'inactive' }
    ]
  };
  assert.equal(conflictService.isPersonInstructorOnClass(classRow, 'PERSON_A'), true);
  assert.equal(conflictService.isPersonInstructorOnClass(classRow, 'PERSON_B'), false);
  assert.equal(conflictService.isPersonInstructorOnClass(classRow, 'PERSON_C'), false);

  const filtered = conflictService.filterSessionsForConflictWindow([
    { date: '2026-01-05' },
    { date: '2026-02-01' }
  ], '2026-01-01', '2026-01-31');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].date, '2026-01-05');
});

test('findDuplicateClassSessionConflicts detects ISO date sessions already on class schedule', async (t) => {
  const originalGetSessions = schoolDataService.getClassSessions;
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES_EXISTING',
    date: '2026-09-08T00:00:00.000Z',
    startTime: '09:00',
    endTime: '10:00',
    delivery: { deliveredByName: 'Taylor Reimer' }
  }]);
  t.after(() => {
    schoolDataService.getClassSessions = originalGetSessions;
  });

  const conflicts = await alignmentService.findDuplicateClassSessionConflicts({
    classData: { id: 'CLASS_01' },
    sessionsToAdd: [{ date: '2026-09-08', startTime: '09:00', endTime: '10:00' }],
    reqUser: { activeOrgId: 'ORG_01' }
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].date, '2026-09-08');
  assert.equal(conflicts[0].sessionId, 'SES_EXISTING');
  assert.equal(conflicts[0].rawDateField, '2026-09-08T00:00:00.000Z');
  const duplicates = await alignmentService.findDuplicateClassSessionDates({
    classData: { id: 'CLASS_01' },
    sessionsToAdd: [{ date: '2026-09-08', startTime: '09:00', endTime: '10:00' }],
    reqUser: { activeOrgId: 'ORG_01' }
  });
  assert.deepEqual(duplicates, ['2026-09-08']);
  assert.match(
    alignmentService.buildDuplicateClassDateMessage(conflicts),
    /already has an overlapping session: 2026-09-08 09:00-10:00, taught by Taylor Reimer \(SES_EXISTING\)/
  );
});

test('findDuplicateClassSessionConflicts allows same-day staged sessions when times do not overlap', async (t) => {
  const originalGetSessions = schoolDataService.getClassSessions;
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES_EXISTING',
    date: '2026-09-08',
    startTime: '10:00',
    endTime: '12:00',
    delivery: { deliveredByName: 'Taylor Reimer' }
  }]);
  t.after(() => {
    schoolDataService.getClassSessions = originalGetSessions;
  });

  const conflicts = await alignmentService.findDuplicateClassSessionConflicts({
    classData: { id: 'CLASS_01' },
    sessionsToAdd: [{ date: '2026-09-08', startTime: '09:00', endTime: '10:00' }],
    reqUser: { activeOrgId: 'ORG_01' }
  });
  assert.deepEqual(conflicts, []);
});

test('commitStagedSessions creates same-day session when times do not overlap', async (t) => {
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalSaveSessions = schoolDataService.saveClassSessions;
  let savedSessions = null;

  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES_EXISTING',
    date: '2026-09-08',
    startTime: '10:00',
    endTime: '12:00',
    status: 'scheduled',
    delivery: { deliveredBy: 'PERSON_01' }
  }]);
  schoolDataService.saveClassSessions = async (_classId, sessions) => {
    savedSessions = sessions;
    return sessions;
  };

  t.after(() => {
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.saveClassSessions = originalSaveSessions;
  });

  const result = await alignmentService.commitStagedSessions({
    classData: {
      id: 'CLASS_01',
      orgId: 'ORG_01',
      registrationMode: 'rolling',
      cycleStartDate: '2026-01-01',
      cycleEndDate: '2026-12-31'
    },
    sessionsToAdd: [{
      sessionId: 'STAGED_001',
      date: '2026-09-08',
      startTime: '09:00',
      endTime: '10:00',
      delivery: { deliveredBy: 'PERSON_01' }
    }],
    reqUser: { activeOrgId: 'ORG_01' }
  });

  assert.equal(result.createdCount, 1);
  assert.equal(savedSessions?.length, 2);
  assert.equal(savedSessions?.[1]?.startTime, '09:00');
});

test('postCommitStagedSessions blocks duplicate class dates before commit', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/scheduleController.js'),
    'utf8'
  );
  const commitBlock = controllerSource.slice(
    controllerSource.indexOf('async function postCommitStagedSessions'),
    controllerSource.indexOf('function parseBulkDeleteSessionsFromBody')
  );
  assert.match(commitBlock, /findDuplicateClassSessionConflicts/);
  assert.match(commitBlock, /buildDuplicateClassDateMessage/);
});

test('class edit form normalizes session dates for session builder display', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/classController.js'),
    'utf8'
  );
  assert.match(controllerSource, /function normalizeClassSessionsForForm/);
  assert.match(controllerSource, /normalizeClassSessionsForForm\(\s*\n?\s*await schoolDataService\.getClassSessions/);
});

test('commitStagedSessions returns createdCount 0 when dates already exist', async (t) => {
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalSaveSessions = schoolDataService.saveClassSessions;

  let saveCalled = false;
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES_EXISTING',
    date: '2026-02-03',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled'
  }]);
  schoolDataService.saveClassSessions = async () => {
    saveCalled = true;
    return [];
  };

  t.after(() => {
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.saveClassSessions = originalSaveSessions;
  });

  const result = await alignmentService.commitStagedSessions({
    classData: { id: 'CLASS_01', orgId: 'ORG_01', registrationMode: 'rolling', cycleEndDate: '2026-12-31' },
    sessionsToAdd: [{
      sessionId: 'STAGED_001',
      date: '2026-02-03',
      startTime: '09:00',
      endTime: '10:00',
      delivery: { deliveredBy: 'PERSON_01' }
    }],
    reqUser: { activeOrgId: 'ORG_01' }
  });

  assert.equal(result.createdCount, 0);
  assert.equal(saveCalled, false);
  assert.deepEqual(result.createdSessions, []);
});

test('master schedule UI keeps drafts on zero-created save and uses commit timeout', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/schedule/personSchedule.ejs'),
    'utf8'
  );
  assert.match(source, /fetchWithScheduleTimeout/);
  assert.match(source, /SCHEDULE_COMMIT_TIMEOUT_MS/);
  assert.match(source, /if \(createdCount > 0\)/);
  assert.match(source, /Nothing Saved|No new sessions were saved/);
  assert.match(source, /bindScheduleDraftUnloadGuard/);
  const unloadGuardBlock = source.slice(
    source.indexOf('function bindScheduleDraftUnloadGuard'),
    source.indexOf('function getScheduleEventsForPerson')
  );
  assert.doesNotMatch(unloadGuardBlock, /addEventListener\('beforeunload'/);
  assert.match(source, /restoreScheduleDraftBackup/);
  assert.match(source, /schedulePersistDraftBackup/);
  assert.match(source, /SCHEDULE_DRAFT_BACKUP_KEY/);
});
