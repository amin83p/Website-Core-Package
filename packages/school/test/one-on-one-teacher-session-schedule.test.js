const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
const sessionConflictDetectionService = require('../MVC/services/school/sessionConflictDetectionService');
const oneOnOneSessionScheduleService = require('../MVC/services/school/oneOnOneSessionScheduleService');

const CLASS_ID = 'CLASS/OO1';
const SESSION_ID = 'SESSION/OO1';
const ORG_ID = 'ORG-1';
const PERSON_TEACHER = 'PERSON/T1';
const PERSON_STUDENT = 'PERSON/S1';
const STUDENT_ID = 'STUDENT/S1';

function buildTeacherReq() {
  return {
    user: { id: 'USER/1', activeOrgId: ORG_ID, personId: PERSON_TEACHER },
    headers: {}
  };
}

function buildRollingOneOnOneClass() {
  return {
    id: CLASS_ID,
    orgId: ORG_ID,
    title: '1-on-1 Test',
    registrationMode: 'rolling',
    enrollment: { maxCapacity: 1 }
  };
}

function buildSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    date: '2026-03-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    durationHours: 1,
    delivery: { deliveredBy: PERSON_TEACHER, deliveredByName: 'Teacher' },
    roster: [{ personId: PERSON_STUDENT }],
    ...overrides
  };
}

test('applyTeacherOneOnOneScheduleFields updates date and duration', () => {
  const session = buildSession();
  const { changed } = oneOnOneSessionScheduleService.applyTeacherOneOnOneScheduleFields(session, {
    date: '2026-03-08',
    startTime: '10:00',
    endTime: '12:00'
  });
  assert.equal(changed, true);
  assert.equal(session.date, '2026-03-08');
  assert.equal(session.durationHours, 2);
});

test('resolveTeacherOneOnOneScheduleEditAccess allows main teacher on one-on-one rolling class', async () => {
  const originals = {
    fetchAll: schoolDataService.fetchAllData,
    periods: schoolDataService.getClassEnrollmentPeriodsByClassId,
    accessible: schoolRecordAccessService.isSessionAccessible
  };
  const classData = buildRollingOneOnOneClass();
  const session = buildSession();
  schoolDataService.fetchAllData = async (entity) => (
    entity === 'students' ? [{ id: STUDENT_ID, personId: PERSON_STUDENT, orgId: ORG_ID }] : []
  );
  schoolDataService.getClassEnrollmentPeriodsByClassId = async () => ([{
    id: 'PER/1',
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    personId: PERSON_STUDENT,
    status: 'active',
    startDate: '2026-03-01',
    targetSessionCount: 3,
    sessionCapacityType: 'one_on_one'
  }]);
  schoolRecordAccessService.isSessionAccessible = () => true;
  try {
    const access = await oneOnOneSessionScheduleService.resolveTeacherOneOnOneScheduleEditAccess(
      buildTeacherReq(),
      classData,
      session
    );
    assert.equal(access.allowed, true);
  } finally {
    schoolDataService.fetchAllData = originals.fetchAll;
    schoolDataService.getClassEnrollmentPeriodsByClassId = originals.periods;
    schoolRecordAccessService.isSessionAccessible = originals.accessible;
  }
});

test('assertEnrollmentCapAllowsScheduleChange rejects session date before enrollment window', async () => {
  const originals = {
    fetchAll: schoolDataService.fetchAllData,
    periods: schoolDataService.getClassEnrollmentPeriodsByClassId
  };
  const classData = buildRollingOneOnOneClass();
  const sessions = [
    buildSession({ date: '2026-02-01' }),
    buildSession({ sessionId: 'SESSION/2', date: '2026-03-08' })
  ];
  schoolDataService.fetchAllData = async (entity) => (
    entity === 'students' ? [{ id: STUDENT_ID, personId: PERSON_STUDENT, orgId: ORG_ID }] : []
  );
  schoolDataService.getClassEnrollmentPeriodsByClassId = async () => ([{
    id: 'PER/1',
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    personId: PERSON_STUDENT,
    status: 'active',
    startDate: '2026-03-01',
    targetSessionCount: 3,
    sessionCapacityType: 'one_on_one'
  }]);
  try {
    await assert.rejects(
      () => oneOnOneSessionScheduleService.assertEnrollmentCapAllowsScheduleChange({
        classData,
        sessions,
        sessionId: SESSION_ID,
        workingSession: sessions[0],
        reqUser: buildTeacherReq().user
      }),
      (error) => error.code === oneOnOneSessionScheduleService.ERROR_CODES.ENROLLMENT_CAP
    );
  } finally {
    schoolDataService.fetchAllData = originals.fetchAll;
    schoolDataService.getClassEnrollmentPeriodsByClassId = originals.periods;
  }
});

test('validateTeacherOneOnOneScheduleChange surfaces schedule conflicts without override path', async () => {
  const originals = {
    fetchAll: schoolDataService.fetchAllData,
    periods: schoolDataService.getClassEnrollmentPeriodsByClassId,
    detect: sessionConflictDetectionService.detectSessionConflicts,
    studentDetect: sessionConflictDetectionService.detectStudentScheduleConflicts
  };
  const classData = buildRollingOneOnOneClass();
  const workingSession = buildSession({ date: '2026-03-08', startTime: '09:00', endTime: '10:00' });
  schoolDataService.fetchAllData = async (entity) => (
    entity === 'students' ? [{ id: STUDENT_ID, personId: PERSON_STUDENT, orgId: ORG_ID }] : []
  );
  schoolDataService.getClassEnrollmentPeriodsByClassId = async () => ([{
    id: 'PER/1',
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    personId: PERSON_STUDENT,
    status: 'active',
    startDate: '2026-03-01',
    targetSessionCount: 3,
    sessionCapacityType: 'one_on_one'
  }]);
  sessionConflictDetectionService.detectSessionConflicts = async () => ([{
    date: '2026-03-08',
    teacherName: 'Teacher',
    conflictClass: 'Other class',
    existTime: '09:00 - 10:00',
    conflictType: 'teacher_schedule'
  }]);
  sessionConflictDetectionService.detectStudentScheduleConflicts = async () => [];
  try {
    await assert.rejects(
      () => oneOnOneSessionScheduleService.validateTeacherOneOnOneScheduleChange({
        classData,
        sessions: [workingSession],
        sessionId: SESSION_ID,
        workingSession,
        reqUser: buildTeacherReq().user
      }),
      (error) => error.code === oneOnOneSessionScheduleService.ERROR_CODES.METADATA_CONFLICTS
    );
  } finally {
    schoolDataService.fetchAllData = originals.fetchAll;
    schoolDataService.getClassEnrollmentPeriodsByClassId = originals.periods;
    sessionConflictDetectionService.detectSessionConflicts = originals.detect;
    sessionConflictDetectionService.detectStudentScheduleConflicts = originals.studentDetect;
  }
});

test('applyTeacherOneOnOneScheduleFields leaves session unchanged when body has no schedule fields', () => {
  const session = buildSession();
  const { changed } = oneOnOneSessionScheduleService.applyTeacherOneOnOneScheduleFields(session, { room: 'A1' });
  assert.equal(changed, false);
  assert.equal(session.date, '2026-03-01');
});
