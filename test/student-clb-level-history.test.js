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


test('sanitizeStudentInput accepts an optional trimmed Custom Student ID', () => {
  const populated = studentModel.sanitizeStudentInput(baseStudentInput({ customStudentId: '  SCHOOL-42  ' }));
  const blank = studentModel.sanitizeStudentInput(baseStudentInput({ customStudentId: '   ' }));

  assert.equal(populated.customStudentId, 'SCHOOL-42');
  assert.equal(blank.customStudentId, '');
});

test('Custom Student ID remains separate from the immutable student record id', () => {
  const modelSource = read('packages/school/MVC/models/school/studentModel.js');
  const controllerSource = read('packages/school/MVC/controllers/school/studentController.js');
  const formSource = read('packages/school/MVC/views/school/student/studentForm.ejs');
  const listSource = read('packages/school/MVC/views/school/student/studentList.ejs');

  assert.match(modelSource, /customStudentId: cleanId\(input\.customStudentId, \{ max: 40, allowEmpty: true \}\)/);
  assert.match(modelSource, /Custom Student ID is already assigned within this organization/);
  assert.doesNotMatch(controllerSource, /payload\.id = req\.body\.studentId/);
  assert.match(controllerSource, /customStudentId: String\(req\.body\.customStudentId \|\| ''\)\.trim\(\)/);
  assert.match(formSource, /Object\.prototype\.hasOwnProperty\.call\(s, 'customStudentId'\)/);
  assert.match(formSource, /hasCustomStudentId \? \(s\.customStudentId \|\| ''\) : \(isEdit \? s\.id : ''\)/);
  assert.match(formSource, /name="customStudentId"[^>]*value="<%= customStudentIdValue %>"/);
  assert.match(formSource, /System Record ID/);
  assert.match(listSource, /item\.customStudentId \|\| item\.id/);
});

test('sanitizeStudentInput accepts valid CLB history and sorts newest first', () => {
  const out = studentModel.sanitizeStudentInput(baseStudentInput({
    clbLevelHistory: [
      {
        id: 'clb_old',
        recordedAt: '2026-01-01',
        goal: { listening: '5', speaking: '5', reading: '4', writing: '4' },
        current: { listening: '4+', speaking: '4+', reading: '3+', writing: '3+' },
        result: { listening: ' 4 ', speaking: '4', reading: '3', writing: '3' }
      },
      {
        id: 'clb_new',
        recordedAt: '2026-07-08',
        goal: { listening: '7-8', speaking: '7-8', reading: '6', writing: '6' },
        current: { listening: '7+', speaking: '7+', reading: '6-', writing: '5+' },
        result: { listening: '7', speaking: '7', reading: '6', writing: '5' }
      }
    ]
  }));

  assert.equal(out.clbLevelHistory.length, 2);
  assert.equal(out.clbLevelHistory[0].id, 'clb_new');
  assert.equal(out.clbLevelHistory[0].goal.listening, '7-8');
  assert.equal(out.clbLevelHistory[0].current.writing, '5+');
  assert.equal(out.clbLevelHistory[0].result.reading, '6');
  assert.equal(out.clbLevelHistory[1].result.listening, '4');
});

test('sanitizeStudentInput keeps legacy CLB entries without results backward compatible', () => {
  const out = studentModel.sanitizeStudentInput(baseStudentInput({
    clbLevelHistory: [{
      id: 'legacy',
      recordedAt: '2025-12-01',
      goal: { listening: '5' },
      current: { listening: '4' }
    }]
  }));

  assert.deepEqual(out.clbLevelHistory[0].result, {
    listening: '',
    speaking: '',
    reading: '',
    writing: ''
  });
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
      { id: 'a', recordedAt: '2026-01-01', goal: { listening: '5' }, current: { listening: '4+' }, result: { listening: '4' } },
      { id: 'b', recordedAt: '2026-07-08', goal: { listening: '7-8' }, current: { listening: '7+' }, result: { listening: '7' } }
    ]
  });
  assert.equal(latest.id, 'b');
  assert.equal(latest.goal.listening, '7-8');
  assert.equal(latest.result.listening, '7');
});

test('buildPrefillSnapshot exposes latest CLB goal, current, result, and date keys', async () => {
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
            current: { listening: '4+', speaking: '4+', reading: '4+', writing: '4+' },
            result: { listening: '4', speaking: '4', reading: '4', writing: '4' }
          },
          {
            id: 'new',
            recordedAt: '2026-07-08',
            goal: { listening: '7-8', speaking: '7-8', reading: '6', writing: '6' },
            current: { listening: '7+', speaking: '7+', reading: '6-', writing: '5+' },
            result: { listening: '7', speaking: '7', reading: '6', writing: '5' }
          },
          {
            id: 'legacy',
            recordedAt: '2025-09-01',
            goal: { listening: '4' },
            current: { listening: '3+' }
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
    assert.equal(snapshot.CLB_latest_recorded_at, '2026-07-08');
    assert.equal(snapshot.CLB_result_listening, '7');
    assert.equal(snapshot.CLB_result_speaking, '7');
    assert.equal(snapshot.CLB_result_reading, '6');
    assert.equal(snapshot.CLB_result_writing, '5');

    const collections = await reportService.buildReportDocxCollections({
      instance: {
        classId: 'CLASS-CLB',
        sessionId: 'SES-CLB',
        sessionDate: '2026-07-08',
        studentId: 'STUDENT-CLB'
      },
      assignment: { ...assignment, reportScope: 'each_student' },
      reqUser: { id: 'USER-1', activeOrgId: '900000' }
    });
    assert.equal(collections.student_clb_entries.length, 3);
    assert.equal(collections.student_clb_entries[0].student_full_name, 'Sam Student');
    assert.equal(collections.student_clb_entries[0].clb_entry_id, 'new');
    assert.equal(collections.student_clb_entries[0].clb_entry_no, 1);
    assert.equal(collections.student_clb_entries[0].clb_is_latest, true);
    assert.deepEqual({
      goalListening: collections.student_clb_entries[0].clb_goal_listening,
      goalSpeaking: collections.student_clb_entries[0].clb_goal_speaking,
      goalReading: collections.student_clb_entries[0].clb_goal_reading,
      goalWriting: collections.student_clb_entries[0].clb_goal_writing,
      currentListening: collections.student_clb_entries[0].clb_current_listening,
      currentSpeaking: collections.student_clb_entries[0].clb_current_speaking,
      currentReading: collections.student_clb_entries[0].clb_current_reading,
      currentWriting: collections.student_clb_entries[0].clb_current_writing,
      resultListening: collections.student_clb_entries[0].clb_result_listening,
      resultSpeaking: collections.student_clb_entries[0].clb_result_speaking,
      resultReading: collections.student_clb_entries[0].clb_result_reading,
      resultWriting: collections.student_clb_entries[0].clb_result_writing
    }, {
      goalListening: '7-8',
      goalSpeaking: '7-8',
      goalReading: '6',
      goalWriting: '6',
      currentListening: '7+',
      currentSpeaking: '7+',
      currentReading: '6-',
      currentWriting: '5+',
      resultListening: '7',
      resultSpeaking: '7',
      resultReading: '6',
      resultWriting: '5'
    });
    assert.equal(collections.student_clb_entries[1].clb_entry_id, 'old');
    assert.equal(collections.student_clb_entries[1].clb_entry_no, 2);
    assert.equal(collections.student_clb_entries[1].clb_is_latest, false);
    assert.equal(collections.student_clb_entries[2].clb_entry_id, 'legacy');
    assert.equal(collections.student_clb_entries[2].clb_result_listening, '');
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
  const reportTemplateSource = read('packages/school/MVC/views/school/report/templateForm.ejs');
  assert.match(source, /hid_clbLevelHistory/);
  assert.match(source, /__INIT_CLB_LEVEL_HISTORY__/);
  assert.match(source, /btnAddClbEntry/);
  assert.match(source, /renderClbHistoryTable/);
  assert.match(source, /syncClbHiddenField/);
  assert.match(source, /Current CLB Level/);
  assert.match(source, /CLB Result/);
  assert.match(source, /inp_clb_result_listening/);
  assert.match(source, /btn-edit-clb-entry/);
  assert.match(source, /showClbEditorForEdit/);
  assert.match(source, /editingClbEntryId/);
  assert.match(source, /choice === true .*=== 'delete'/);
  assert.doesNotMatch(source, /text: 'Delete'.*onClick/);
  assert.match(reportTemplateSource, /student_clb_entries/);
});

test('student form create defaults cover DOB, email, admission, country, fee, and CLB dash', () => {
  const source = read('packages/school/MVC/views/school/student/studentForm.ejs');
  assert.match(source, /inp_newPersonDateOfBirth[^>]*value="2000-01-01"/);
  assert.match(source, /defaultAdmissionDate\s*=\s*`\$\{admissionYear\}-01-01`/);
  assert.match(source, /s\.enrollmentDate\s*\|\|\s*defaultAdmissionDate/);
  assert.match(source, /defaultCountryOfOrigin\s*=\s*'Canada'/);
  assert.match(source, /s\.countryOfOrigin\s*\|\|\s*defaultCountryOfOrigin/);
  assert.match(source, /defaultFeeCategory\s*=\s*'Domestic'/);
  assert.match(source, /s\.feeCategory\s*\|\|\s*defaultFeeCategory/);
  assert.match(source, /createRandomEquilibriumEmail/);
  assert.match(source, /ensurePrimaryNewPersonEmailIfEmpty/);
  assert.match(source, /@equilibrium\.ab\.ca/);
  assert.match(source, /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*14;/);
  assert.match(source, /selectedMode === 'new'[\s\S]*?ensurePrimaryNewPersonEmailIfEmpty\(\)/);
  assert.match(source, /firstSkillInput\.value\s*=\s*'-'/);
  assert.match(source, /getClbEditorInput\(group,\s*CLB_SKILLS\[0\]\)/);
});
