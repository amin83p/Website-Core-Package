const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolStudentProfileLinkService = require('../packages/school/MVC/services/school/schoolStudentProfileLinkService');
const attendanceController = require('../packages/school/MVC/controllers/school/attendanceController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolIdentityLookupService = require('../packages/school/MVC/services/school/schoolIdentityLookupService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const attendanceMatrixPolicyModel = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const accessService = require('../MVC/services/security');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('schoolStudentProfileLinkService builds edit URL and person map', () => {
  assert.equal(
    schoolStudentProfileLinkService.buildStudentEditUrl('STU-42'),
    '/school/students/edit/STU-42'
  );
  assert.equal(schoolStudentProfileLinkService.buildStudentEditUrl(''), '');

  const map = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap([
    { id: 'STU-1', personId: 'PER-1', orgId: 'ORG-1' },
    { id: 'STU-2', personId: 'PER-2', orgId: 'ORG-2' }
  ], 'ORG-1');
  assert.equal(map.get('PER-1'), 'STU-1');
  assert.equal(map.has('PER-2'), false);

  assert.equal(schoolStudentProfileLinkService.resolveStudentRecordId({
    personId: 'PER-1',
    personToStudentMap: map
  }), 'STU-1');
  assert.equal(schoolStudentProfileLinkService.resolveStudentRecordId({
    studentRecordId: 'STU-EXPLICIT'
  }), 'STU-EXPLICIT');
  assert.equal(schoolStudentProfileLinkService.escapeHtml('<a&>'), '&lt;a&amp;&gt;');
});

test('evaluateCanOpenStudentProfile follows Students UPDATE access', async () => {
  const original = accessService.evaluateAccess;
  accessService.evaluateAccess = async ({ sectionId, operationId }) => ({
    allowed: sectionId === 'SCHOOL_STUDENTS' && operationId === 'UPDATE'
  });
  try {
    assert.equal(await schoolStudentProfileLinkService.evaluateCanOpenStudentProfile({ id: 'USR' }, '127.0.0.1'), true);
    accessService.evaluateAccess = async () => ({ allowed: false });
    assert.equal(await schoolStudentProfileLinkService.evaluateCanOpenStudentProfile({ id: 'USR' }, '127.0.0.1'), false);
  } finally {
    accessService.evaluateAccess = original;
  }
});

test('school main route middleware sets canOpenStudentProfile', () => {
  const source = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(source, /res\.locals\.canOpenStudentProfile/);
  assert.match(source, /schoolStudentProfileLinkService\.evaluateCanOpenStudentProfile/);
});

test('matrix APIs and views expose student profile links', () => {
  const attendanceControllerSource = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(attendanceControllerSource, /studentRecordId:\s*schoolStudentProfileLinkService\.resolveStudentRecordId/);

  const gradesMatrixSource = read('packages/school/MVC/controllers/school/gradesMatrixController.js');
  assert.match(gradesMatrixSource, /studentRecordId:\s*schoolStudentProfileLinkService\.resolveStudentRecordId/);

  const attendanceView = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(attendanceView, /schoolRenderStudentNameHtml/);

  const gradesView = read('packages/school/MVC/views/school/grades/gradesMatrix.ejs');
  assert.match(gradesView, /schoolRenderStudentNameHtml/);

  const sessionManagerView = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManagerView, /partials\/studentNameLink/);
  assert.match(sessionManagerView, /studentProfileLinkBootstrap/);

  const studentNamePartial = read('packages/school/MVC/views/school/partials/studentNameLink.ejs');
  assert.match(studentNamePartial, /target="_blank"/);
  assert.match(studentNamePartial, /\/school\/students\/edit\//);
});

test('getAttendanceData returns studentRecordId when person is mapped', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchData: schoolDataService.fetchData,
    listSchoolPersonRecords: schoolIdentityLookupService.listSchoolPersonRecords,
    getStatusMap: sessionStatusPolicyService.getStatusMap,
    getPolicyForOrg: attendanceMatrixPolicyModel.getPolicyForOrg,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === 'CLS-LINK') {
      return { id: 'CLS-LINK', orgId: 'ORG-1', title: 'Link Class', registrationMode: 'term' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([{
    sessionId: 'SES-1',
    date: '2026-07-01',
    status: 'completed',
    roster: [{ personId: 'PER-STU', attendance: 'present' }]
  }]);
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'students') {
      return [{ id: 'STU-REC', orgId: 'ORG-1', personId: 'PER-STU' }];
    }
    return [];
  };
  schoolIdentityLookupService.listSchoolPersonRecords = async () => ({
    allRows: [{ id: 'PER-STU', name: { first: 'Ada', last: 'Student' } }]
  });
  sessionStatusPolicyService.getStatusMap = async () => ({});
  attendanceMatrixPolicyModel.getPolicyForOrg = async () => ({});
  classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
    studentIds: new Set(['STU-REC'])
  });

  const req = {
    query: { classId: 'CLS-LINK', startDate: '', endDate: '' },
    user: { id: 'USR-1', activeOrgId: 'ORG-1' }
  };
  const res = createRes();

  try {
    await attendanceController.getAttendanceData(req, res);
    assert.equal(res.statusCode, 200);
    const student = (res.payload?.matrix || []).find((row) => row.personId === 'PER-STU');
    assert.ok(student);
    assert.equal(student.studentRecordId, 'STU-REC');
  } finally {
    Object.assign(schoolDataService, {
      getDataById: originals.getDataById,
      getClassSessions: originals.getClassSessions,
      fetchData: originals.fetchData
    });
    schoolIdentityLookupService.listSchoolPersonRecords = originals.listSchoolPersonRecords;
    sessionStatusPolicyService.getStatusMap = originals.getStatusMap;
    attendanceMatrixPolicyModel.getPolicyForOrg = originals.getPolicyForOrg;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});
