const test = require('node:test');
const assert = require('node:assert/strict');

const attendanceController = require('../MVC/controllers/school/attendanceController');
const scheduleController = require('../MVC/controllers/school/scheduleController');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const dataService = require('../MVC/services/dataService');
const schoolRepositories = require('../MVC/repositories/school');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');

function createReq(overrides = {}) {
  return {
    query: {},
    params: {},
    body: {},
    headers: { 'x-ajax-request': true },
    xhr: true,
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1'
    },
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    viewName: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    render(viewName, payload) {
      this.viewName = viewName;
      this.payload = payload;
      return this;
    }
  };
}

const schoolBackup = {
  getDataById: schoolDataService.getDataById,
  getClassSessions: schoolDataService.getClassSessions,
  fetchData: schoolDataService.fetchData,
  getStudentIndex: schoolDataService.getStudentIndex,
  getClassEnrollmentPeriodsByStudentId: schoolDataService.getClassEnrollmentPeriodsByStudentId
};

const dataBackup = {
  getDataById: dataService.getDataById,
  fetchData: dataService.fetchData
};

const reportRepoBackup = {
  assignmentsList: schoolRepositories.reportAssignments.list,
  templatesList: schoolRepositories.reportTemplates.list
};

const statusBackup = {
  getStatusMap: sessionStatusPolicyService.getStatusMap,
  shouldExcludeFromAttendanceByMap: sessionStatusPolicyService.shouldExcludeFromAttendanceByMap,
  getClientStatusMeta: sessionStatusPolicyService.getClientStatusMeta,
  getStatusMetaMap: sessionStatusPolicyService.getStatusMetaMap,
  normalizeStatusCode: sessionStatusPolicyService.normalizeStatusCode,
  normalizeSessionStatus: sessionStatusPolicyService.normalizeSessionStatus,
  shouldExcludeFromTeacherIndexByMap: sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap,
  shouldExcludeFromStudentIndexByMap: sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap
};

const enrollmentReadBackup = {
  listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
};

function restore() {
  schoolDataService.getDataById = schoolBackup.getDataById;
  schoolDataService.getClassSessions = schoolBackup.getClassSessions;
  schoolDataService.fetchData = schoolBackup.fetchData;
  schoolDataService.getStudentIndex = schoolBackup.getStudentIndex;
  schoolDataService.getClassEnrollmentPeriodsByStudentId = schoolBackup.getClassEnrollmentPeriodsByStudentId;

  dataService.getDataById = dataBackup.getDataById;
  dataService.fetchData = dataBackup.fetchData;

  schoolRepositories.reportAssignments.list = reportRepoBackup.assignmentsList;
  schoolRepositories.reportTemplates.list = reportRepoBackup.templatesList;

  sessionStatusPolicyService.getStatusMap = statusBackup.getStatusMap;
  sessionStatusPolicyService.shouldExcludeFromAttendanceByMap = statusBackup.shouldExcludeFromAttendanceByMap;
  sessionStatusPolicyService.getClientStatusMeta = statusBackup.getClientStatusMeta;
  sessionStatusPolicyService.getStatusMetaMap = statusBackup.getStatusMetaMap;
  sessionStatusPolicyService.normalizeStatusCode = statusBackup.normalizeStatusCode;
  sessionStatusPolicyService.normalizeSessionStatus = statusBackup.normalizeSessionStatus;
  sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap = statusBackup.shouldExcludeFromTeacherIndexByMap;
  sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap = statusBackup.shouldExcludeFromStudentIndexByMap;

  classEnrollmentReadService.listActiveStudentIdsForClass = enrollmentReadBackup.listActiveStudentIdsForClass;
}

test.afterEach(() => {
  restore();
});

function applyScheduleStubs(periodRows = []) {
  const personRow = {
    id: 'PER-1',
    name: { first: 'Ali', last: 'Student' },
    organizations: [{ orgId: 'ORG-1', memberStatus: 'active', roles: ['school_student'] }]
  };
  const classRow = {
    id: 'CLS-1',
    orgId: 'ORG-1',
    title: 'Rolling Class',
    registrationMode: 'rolling',
    enrollment: { students: [] },
    sessions: []
  };
  const sessionRow = {
    sessionId: 'SES-1',
    date: '2026-03-15',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    notes: '',
    roster: []
  };

  schoolDataService.getStudentIndex = async () => ({});
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'classes') return [classRow];
    if (entityType === 'teachers') return [];
    if (entityType === 'students') return [{ id: 'STU-1', personId: 'PER-1' }];
    return [];
  };
  schoolDataService.getClassSessions = async () => [sessionRow];
  schoolDataService.getClassEnrollmentPeriodsByStudentId = async () => periodRows;

  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'persons' && String(id) === 'PER-1') return personRow;
    return null;
  };
  dataService.fetchData = async (entityType) => {
    if (entityType === 'persons') return [personRow];
    return [];
  };

  schoolRepositories.reportAssignments.list = async () => [];
  schoolRepositories.reportTemplates.list = async () => [];

  sessionStatusPolicyService.getClientStatusMeta = async () => [];
  sessionStatusPolicyService.getStatusMetaMap = () => new Map();
  sessionStatusPolicyService.normalizeStatusCode = (value) => String(value || '').trim().toLowerCase();
  sessionStatusPolicyService.normalizeSessionStatus = (status) => String(status || '').trim().toLowerCase() || 'scheduled';
  sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap = () => false;
  sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap = () => false;
}

test('schedule hides class session when student is outside enrollment period window', async () => {
  applyScheduleStubs([
    {
      id: 'CEP-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      studentId: 'STU-1',
      status: 'active',
      startDate: '2026-04-01',
      endDate: '2026-12-31'
    }
  ]);

  const req = createReq({
    query: { personId: 'PER-1', startDate: '2026-03-01', endDate: '2026-03-31' }
  });
  const res = createRes();
  await scheduleController.getPersonSchedule(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(Array.isArray(res.payload.events), true);
  assert.equal(res.payload.events.length, 0);
});

test('schedule includes class session when student is active on session date', async () => {
  applyScheduleStubs([
    {
      id: 'CEP-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      studentId: 'STU-1',
      status: 'active',
      startDate: '2026-03-01',
      endDate: '2026-12-31'
    }
  ]);

  const req = createReq({
    query: { personId: 'PER-1', startDate: '2026-03-01', endDate: '2026-03-31' }
  });
  const res = createRes();
  await scheduleController.getPersonSchedule(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(Array.isArray(res.payload.events), true);
  assert.equal(res.payload.events.length, 1);
  assert.equal(res.payload.events[0].classId, 'CLS-1');
});

test('attendance matrix includes only students active in selected period window', async () => {
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && String(id) === 'CLS-1') {
      return {
        id: 'CLS-1',
        title: 'Rolling Class',
        orgId: 'ORG-1',
        enrollment: {
          students: [
            { personId: 'PER-1', studentId: 'STU-1', status: 'enrolled' },
            { personId: 'PER-2', studentId: 'STU-2', status: 'enrolled' }
          ]
        }
      };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-03-15', status: 'scheduled', roster: [] }
  ]);
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'students') {
      return [
        { id: 'STU-1', personId: 'PER-1', studentNumber: 'S-1' },
        { id: 'STU-2', personId: 'PER-2', studentNumber: 'S-2' }
      ];
    }
    return [];
  };

  dataService.fetchData = async (entityType) => {
    if (entityType === 'persons') {
      return [
        { id: 'PER-1', name: { first: 'Ali', last: 'One' } },
        { id: 'PER-2', name: { first: 'Sara', last: 'Two' } }
      ];
    }
    return [];
  };

  sessionStatusPolicyService.getStatusMap = async () => new Map();
  sessionStatusPolicyService.shouldExcludeFromAttendanceByMap = () => false;

  classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
    source: 'canonical',
    usedFallback: false,
    studentIds: new Set(['STU-1'])
  });

  const req = createReq({
    query: {
      classId: 'CLS-1',
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  });
  const res = createRes();
  await attendanceController.getAttendanceData(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(Array.isArray(res.payload.matrix), true);
  assert.equal(res.payload.matrix.length, 1);
  assert.equal(res.payload.matrix[0].personId, 'PER-1');
  assert.equal(res.payload.enrollmentSource, 'canonical');
  assert.ok(res.payload.matrix[0].summary);
  assert.equal(typeof res.payload.matrix[0].summary.performancePercent, 'number');
  // Threshold numbers are omitted for non-managers (default mock user has no manage access).
  assert.equal(res.payload.attendancePolicy, undefined);
});

