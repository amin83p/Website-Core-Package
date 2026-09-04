const test = require('node:test');
const assert = require('node:assert/strict');

const engineService = require('../MVC/services/school/rollingEnrollmentEngineService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const enrollmentSessionMarksService = require('../MVC/services/school/enrollmentSessionMarksService');

const classData = {
  id: 'CLS_ROLL_ENG_001',
  orgId: 'ORG_900000',
  registrationMode: 'rolling',
  billingMode: 'no_charge'
};

test('normalizeEnrollmentEngineRequest coerces one_on_one for rolling capacity-1 class', () => {
  const capacityOneClass = {
    registrationMode: 'rolling',
    enrollment: { maxCapacity: 1 }
  };
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    sessionCapacityType: 'group'
  }, capacityOneClass);
  assert.equal(normalized.sessionCapacityType, 'one_on_one');
  assert.equal(normalized.students[0].sessionCapacityType, 'one_on_one');
});

test('normalizeEnrollmentEngineRequest infers session_cap mode from targetSessionCount', () => {
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    targetSessionCount: 5
  });
  assert.equal(normalized.enrollmentMode, engineService.ENROLLMENT_MODES.SESSION_CAP);
  assert.equal(normalized.targetSessionCount, 5);
  assert.equal(normalized.students.length, 1);
  assert.equal(normalized.students[0].studentId, 'STU_001');
});

test('normalizeEnrollmentEngineRequest infers hour_cap mode from targetHours', () => {
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    students: [{ studentId: 'STU_001' }],
    startDate: '2026-01-01',
    targetHours: 20
  });
  assert.equal(normalized.enrollmentMode, engineService.ENROLLMENT_MODES.HOUR_CAP);
  assert.equal(normalized.targetHours, 20);
});

test('normalizeEnrollmentEngineRequest defaults to date_window without caps', () => {
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    endDate: '2026-03-31'
  });
  assert.equal(normalized.enrollmentMode, engineService.ENROLLMENT_MODES.DATE_WINDOW);
  assert.equal(normalized.targetSessionCount, 0);
  assert.equal(normalized.targetHours, 0);
});

test('normalizeEnrollmentEngineRequest rejects mixed session and hour targets', () => {
  assert.throws(() => engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    targetSessionCount: 3,
    targetHours: 9
  }), /not both/i);
});

test('normalizeEnrollmentEngineRequest rejects session_cap without targetSessionCount', () => {
  assert.throws(() => engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    enrollmentMode: 'session_cap'
  }), /targetSessionCount is required/i);
});

test('normalizeEnrollmentEngineRequest parses sessionsToCreate staged rows', () => {
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    enrollmentMode: 'hour_cap',
    targetHours: 10,
    sessionsToCreate: [{
      date: '2026-01-05',
      startTime: '09:00',
      endTime: '10:00'
    }]
  });
  assert.equal(normalized.sessionsToCreate.length, 1);
  assert.equal(normalized.sessionsToCreate[0].date, '2026-01-05');
});

test('execute commits sessions before creating enrollment period', async (t) => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalCreate = schoolDataService.createClassEnrollmentPeriod;
  const originalCommit = alignmentService.commitStagedSessions;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;

  let commitCalled = false;
  let createCalled = false;

  schoolDataService.getDataById = async (collection, id) => {
    if (collection === 'students' && id === 'STU_OK') {
      return { id: 'STU_OK', orgId: classData.orgId, personId: 'PERSON_OK' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => [];
  sessionStatusPolicyService.getStatusMap = async () => new Map([
    ['scheduled', { code: 'scheduled', countable: true }]
  ]);
  alignmentService.commitStagedSessions = async (args) => {
    commitCalled = true;
    assert.equal(createCalled, false);
    return {
      createdCount: 1,
      classData: args.classData,
      cycleEndDateExtended: false
    };
  };
  schoolDataService.createClassEnrollmentPeriod = async () => {
    createCalled = true;
    assert.equal(commitCalled, true);
    return { period: { id: 'EP_001', status: 'active', studentId: 'STU_OK' } };
  };

  t.after(() => {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.createClassEnrollmentPeriod = originalCreate;
    alignmentService.commitStagedSessions = originalCommit;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
  });

  const result = await engineService.execute({
    classData,
    reqUser: { activeOrgId: classData.orgId },
    rawRequest: {
      classId: classData.id,
      studentId: 'STU_OK',
      enrollmentMode: 'date_window',
      startDate: '2026-01-01',
      status: 'active',
      funder: { funderId: 'self', funderType: 'self' },
      sessionsToCreate: [{
        date: '2026-01-05',
        startTime: '09:00',
        endTime: '10:00'
      }]
    },
    hooks: {
      assertPrerequisites: async () => {}
    }
  });

  assert.equal(commitCalled, true);
  assert.equal(createCalled, true);
  assert.equal(result.sessionCommit.createdCount, 1);
  assert.equal(result.summary.succeeded, 1);
});

test('execute returns partial success for batch enrollment', async (t) => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalCreate = schoolDataService.createClassEnrollmentPeriod;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;

  schoolDataService.getDataById = async (collection, id) => {
    if (collection === 'students' && id === 'STU_OK') {
      return { id: 'STU_OK', orgId: classData.orgId, personId: 'PERSON_OK' };
    }
    if (collection === 'students' && id === 'STU_FAIL') {
      return { id: 'STU_FAIL', orgId: classData.orgId, personId: 'PERSON_FAIL' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => [];
  sessionStatusPolicyService.getStatusMap = async () => new Map([
    ['scheduled', { code: 'scheduled', countable: true }]
  ]);
  schoolDataService.createClassEnrollmentPeriod = async (payload) => ({
    period: { id: `EP_${payload.studentId}`, status: 'active', studentId: payload.studentId }
  });

  t.after(() => {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.createClassEnrollmentPeriod = originalCreate;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
  });

  const result = await engineService.execute({
    classData,
    reqUser: { activeOrgId: classData.orgId },
    rawRequest: {
      classId: classData.id,
      students: [{ studentId: 'STU_OK' }, { studentId: 'STU_FAIL' }],
      enrollmentMode: 'date_window',
      startDate: '2026-01-01',
      status: 'active',
      funder: { funderId: 'self', funderType: 'self' }
    },
    hooks: {
      assertPrerequisites: async (student) => {
        if (student.id === 'STU_FAIL') throw new Error('Not eligible for enrollment.');
      }
    }
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.succeeded, 1);
  assert.equal(result.summary.failed, 1);
  const okRow = result.results.find((row) => row.studentId === 'STU_OK');
  const failRow = result.results.find((row) => row.studentId === 'STU_FAIL');
  assert.equal(okRow?.ok, true);
  assert.equal(failRow?.ok, false);
  assert.match(String(failRow?.error || ''), /Not eligible/i);
});

test('rolling enrollment controller exposes execute endpoint and engine service', () => {
  const controllerSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  assert.match(controllerSource, /rollingEnrollmentEngineService/);
  assert.match(controllerSource, /postExecuteRollingEnrollment/);
  assert.match(controllerSource, /rollingEnrollmentEngineService\.execute/);
});

test('normalizeEnrollmentEngineRequest parses unmarkSessionIds', () => {
  const normalized = engineService.normalizeEnrollmentEngineRequest({
    classId: classData.id,
    studentId: 'STU_001',
    startDate: '2026-01-01',
    sessionCapacityType: 'one_on_one',
    unmarkSessionIds: ['SES_001', 'SES_002']
  });
  assert.deepEqual(normalized.unmarkSessionIds, ['SES_001', 'SES_002']);
  assert.deepEqual(normalized.students[0].unmarkSessionIds, ['SES_001', 'SES_002']);
});

test('execute unmarks all class sessions for group enrollment', async (t) => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalCreate = schoolDataService.createClassEnrollmentPeriod;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalClear = enrollmentSessionMarksService.clearRosterNaForSessions;

  let clearedSessionIds = [];
  schoolDataService.getDataById = async (collection, id) => {
    if (collection === 'students' && id === 'STU_OK') {
      return { id: 'STU_OK', orgId: classData.orgId, personId: 'PERSON_OK' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { id: 'SES_001', date: '2026-01-05' },
    { id: 'SES_002', date: '2026-01-12' }
  ]);
  sessionStatusPolicyService.getStatusMap = async () => new Map([
    ['scheduled', { code: 'scheduled', countable: true }]
  ]);
  schoolDataService.createClassEnrollmentPeriod = async () => ({
    period: {
      id: 'EP_001',
      status: 'active',
      studentId: 'STU_OK',
      personId: 'PERSON_OK',
      sessionCapacityType: 'group'
    }
  });
  enrollmentSessionMarksService.clearRosterNaForSessions = async ({ sessionIds }) => {
    clearedSessionIds = sessionIds.slice();
    return { updatedCount: sessionIds.length };
  };

  t.after(() => {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.createClassEnrollmentPeriod = originalCreate;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
    enrollmentSessionMarksService.clearRosterNaForSessions = originalClear;
  });

  const classWithSessions = {
    ...classData,
    sessions: [
      { id: 'SES_001', date: '2026-01-05' },
      { id: 'SES_002', date: '2026-01-12' }
    ]
  };

  await engineService.execute({
    classData: classWithSessions,
    reqUser: { activeOrgId: classData.orgId },
    rawRequest: {
      classId: classData.id,
      studentId: 'STU_OK',
      enrollmentMode: 'date_window',
      startDate: '2026-01-01',
      status: 'active',
      sessionCapacityType: 'group',
      funder: { funderId: 'self', funderType: 'self' }
    },
    hooks: {
      assertPrerequisites: async () => {}
    }
  });

  assert.deepEqual(clearedSessionIds.sort(), ['SES_001', 'SES_002']);
});

test('execute unmarks selected sessions for one-on-one enrollment', async (t) => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalCreate = schoolDataService.createClassEnrollmentPeriod;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalClear = enrollmentSessionMarksService.clearRosterNaForSessions;

  let clearedSessionIds = [];
  schoolDataService.getDataById = async (collection, id) => {
    if (collection === 'students' && id === 'STU_OK') {
      return { id: 'STU_OK', orgId: classData.orgId, personId: 'PERSON_OK' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => [];
  sessionStatusPolicyService.getStatusMap = async () => new Map([
    ['scheduled', { code: 'scheduled', countable: true }]
  ]);
  schoolDataService.createClassEnrollmentPeriod = async () => ({
    period: {
      id: 'EP_002',
      status: 'active',
      studentId: 'STU_OK',
      personId: 'PERSON_OK',
      sessionCapacityType: 'one_on_one'
    }
  });
  enrollmentSessionMarksService.clearRosterNaForSessions = async ({ sessionIds }) => {
    clearedSessionIds = sessionIds.slice();
    return { updatedCount: sessionIds.length };
  };

  t.after(() => {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.createClassEnrollmentPeriod = originalCreate;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
    enrollmentSessionMarksService.clearRosterNaForSessions = originalClear;
  });

  await engineService.execute({
    classData,
    reqUser: { activeOrgId: classData.orgId },
    rawRequest: {
      classId: classData.id,
      studentId: 'STU_OK',
      enrollmentMode: 'date_window',
      startDate: '2026-01-01',
      status: 'active',
      sessionCapacityType: 'one_on_one',
      unmarkSessionIds: ['SES_010'],
      funder: { funderId: 'self', funderType: 'self' }
    },
    hooks: {
      assertPrerequisites: async () => {}
    }
  });

  assert.deepEqual(clearedSessionIds, ['SES_010']);
});

test('rolling enrollment UI builds engine payload and calls execute endpoint', () => {
  const uiSource = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
    'utf8'
  );
  assert.match(uiSource, /buildRollingEnrollmentEnginePayload/);
  assert.match(uiSource, /rolling-enrollment\/execute/);
  assert.match(uiSource, /sessionsToCreate/);
  assert.match(uiSource, /unmarkSessionIds/);
});
