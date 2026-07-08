const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studentModel = require('../packages/school/MVC/models/school/studentModel');
const reportService = require('../packages/school/MVC/services/school/reportService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolIdentityLookupService = require('../packages/school/MVC/services/school/schoolIdentityLookupService');
const dataServiceGlobal = require('../MVC/services/dataService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const attendanceMatrixPolicyModel = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function baseStudentInput(overrides = {}) {
  return {
    orgId: 'ORG-1',
    personId: 'PER-1',
    enrollmentDate: '2026-07-08',
    feeCategory: 'Domestic',
    ...overrides
  };
}


test('sanitizeStudentInput accepts valid CLB history and sorts newest first', () => {
  const out = studentModel.sanitizeStudentInput(baseStudentInput({
    clbLevelHistory: [
      {
        id: 'clb_old',
        recordedAt: '2026-01-01',
        goal: { listening: '5', speaking: '5', reading: '4', writing: '4' },
        current: { listening: '4+', speaking: '4+', reading: '3+', writing: '3+' }
      },
      {
        id: 'clb_new',
        recordedAt: '2026-07-08',
        goal: { listening: '7-8', speaking: '7-8', reading: '6', writing: '6' },
        current: { listening: '7+', speaking: '7+', reading: '6-', writing: '5+' }
      }
    ]
  }));

  assert.equal(out.clbLevelHistory.length, 2);
  assert.equal(out.clbLevelHistory[0].id, 'clb_new');
  assert.equal(out.clbLevelHistory[0].goal.listening, '7-8');
  assert.equal(out.clbLevelHistory[0].current.writing, '5+');
});

test('sanitizeStudentInput rejects invalid CLB recordedAt', () => {
  assert.throws(() => studentModel.sanitizeStudentInput(baseStudentInput({
    clbLevelHistory: [{ recordedAt: 'not-a-date', goal: {}, current: {} }]
  })), /Invalid enrollmentDate|recordedAt/i);
});

test('sanitizeStudentInput defaults missing CLB history to empty array', () => {
  const out = studentModel.sanitizeStudentInput(baseStudentInput());
  assert.deepEqual(out.clbLevelHistory, []);
});

test('getLatestClbLevelEntry returns newest dated entry', () => {
  const latest = reportService.getLatestClbLevelEntry({
    clbLevelHistory: [
      { id: 'a', recordedAt: '2026-01-01', goal: { listening: '5' }, current: { listening: '4+' } },
      { id: 'b', recordedAt: '2026-07-08', goal: { listening: '7-8' }, current: { listening: '7+' } }
    ]
  });
  assert.equal(latest.id, 'b');
  assert.equal(latest.goal.listening, '7-8');
});

test('buildPrefillSnapshot exposes latest CLB goal and current keys', async () => {
  const assignment = {
    id: 'ASN-CLB',
    orgId: '900000',
    classId: 'CLASS-CLB',
    sessionId: 'SES-CLB',
    sessionDate: '2026-07-08',
    reportStartDate: '2026-07-01',
    reportDueDate: '2026-07-31',
    teacherIds: ['TEACHER-CLB']
  };

  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchDataSchool: schoolDataService.fetchData,
    listSchoolPersonRecords: schoolIdentityLookupService.listSchoolPersonRecords,
    fetchDataGlobal: dataServiceGlobal.fetchData,
    getStatusMap: sessionStatusPolicyService.getStatusMap,
    getPolicyForOrg: attendanceMatrixPolicyModel.getPolicyForOrg
  };

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === 'CLASS-CLB') {
      return { id: 'CLASS-CLB', orgId: '900000', title: 'CLB Class' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES-CLB',
    date: '2026-07-08',
    status: 'completed',
    roster: [{ personId: 'STUDENT-CLB', attendance: 'present' }]
  }]);
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'students') {
      return [{
        id: 'STU-CLB',
        orgId: '900000',
        personId: 'STUDENT-CLB',
        clbLevelHistory: [
          {
            id: 'old',
            recordedAt: '2026-01-01',
            goal: { listening: '5', speaking: '5', reading: '5', writing: '5' },
            current: { listening: '4+', speaking: '4+', reading: '4+', writing: '4+' }
          },
          {
            id: 'new',
            recordedAt: '2026-07-08',
            goal: { listening: '7-8', speaking: '7-8', reading: '6', writing: '6' },
            current: { listening: '7+', speaking: '7+', reading: '6-', writing: '5+' }
          }
        ]
      }];
    }
    if (entityType === 'examAssignments') return [];
    return [];
  };
  schoolIdentityLookupService.listSchoolPersonRecords = async () => ({
    allRows: [
      { id: 'TEACHER-CLB', firstName: 'T', lastName: 'Eacher' },
      { id: 'STUDENT-CLB', firstName: 'Sam', lastName: 'Student' }
    ]
  });
  dataServiceGlobal.fetchData = async (entityType) => (entityType === 'organizations' ? [{ id: '900000', name: 'Org' }] : []);
  sessionStatusPolicyService.getStatusMap = async () => new Map();
  attendanceMatrixPolicyModel.getPolicyForOrg = async () => ({});

  try {
    const snapshot = await reportService.buildPrefillSnapshot({
      assignment,
      teacherId: 'TEACHER-CLB',
      studentId: 'STUDENT-CLB',
      reqUser: { id: 'USER-1', activeOrgId: '900000' }
    });

    assert.equal(snapshot.CLB_goal_listening, '7-8');
    assert.equal(snapshot.CLB_goal_speaking, '7-8');
    assert.equal(snapshot.CLB_goal_reading, '6');
    assert.equal(snapshot.CLB_goal_writing, '6');
    assert.equal(snapshot.CLB_current_listening, '7+');
    assert.equal(snapshot.CLB_current_speaking, '7+');
    assert.equal(snapshot.CLB_current_reading, '6-');
    assert.equal(snapshot.CLB_current_writing, '5+');
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchData = originals.fetchDataSchool;
    schoolIdentityLookupService.listSchoolPersonRecords = originals.listSchoolPersonRecords;
    dataServiceGlobal.fetchData = originals.fetchDataGlobal;
    sessionStatusPolicyService.getStatusMap = originals.getStatusMap;
    attendanceMatrixPolicyModel.getPolicyForOrg = originals.getPolicyForOrg;
  }
});

test('student controller parses clbLevelHistory on save', () => {
  const source = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(source, /parsedClbLevelHistory/);
  assert.match(source, /clbLevelHistory:\s*parsedClbLevelHistory/);
});

test('student form includes CLB history UI and hidden JSON field', () => {
  const source = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.match(source, /hid_clbLevelHistory/);
  assert.match(source, /__INIT_CLB_LEVEL_HISTORY__/);
  assert.match(source, /btnAddClbEntry/);
  assert.match(source, /renderClbHistoryTable/);
  assert.match(source, /syncClbHiddenField/);
  assert.match(source, /Current CLB Level/);
});
