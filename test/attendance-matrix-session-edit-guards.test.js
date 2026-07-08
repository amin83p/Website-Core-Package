const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const attendanceController = require('../packages/school/MVC/controllers/school/attendanceController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const attendanceMatrixPolicyModel = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');
const classEnrollmentSessionApplicabilityService = require('../packages/school/MVC/services/school/classEnrollmentSessionApplicabilityService');
const adminChekersService = require('../MVC/services/adminChekersService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function createReq(overrides = {}) {
  return {
    body: {},
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      name: 'Test User'
    },
    ...overrides
  };
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

const sampleClass = { id: 'CLS-1', orgId: 'ORG-1', title: 'Test Class' };

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

test('attendance controller uses shared session edit guard with makeup policy check', () => {
  const source = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(source, /async function assertAttendanceMatrixSessionEditable\(req, classData, session\)/);
  assert.match(source, /shouldForceNotApplicableAttendanceByMap\(statusMap/);
  assert.match(source, /await assertAttendanceMatrixSessionEditable\(req, classData, session\);/);
  assert.equal((source.match(/await assertAttendanceMatrixSessionEditable\(req, classData, session\);/g) || []).length, 2);
});

test('attendance matrix view blocks makeup-required sessions in allowEdit and comment controls', () => {
  const source = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(source, /const makeupRequired = record\.applicability === 'makeup_required'/);
  assert.match(source, /const allowEdit = canEdit && !makeupRequired && \(!locked \|\| canOverride\)/);
  assert.match(source, /cell_modal_makeup_notice/);
  assert.match(source, /\['inp_newComment', 'inp_newCommentFile', 'btn_saveComment', 'btn_mentionUser'\]/);
  assert.match(source, /if \(el\) el\.disabled = !allowEdit/);
  assert.match(source, /make-up session required/);
});

test('updateAttendanceRosterCell rejects makeup-required session', async () => {
  await withPatched(schoolDataService, {
    getDataById: async () => sampleClass,
    getClassSessions: async () => ([
      { sessionId: 'SES-1', date: '2026-06-01', status: 'missed_informed24', roster: [] }
    ])
  }, async () => withPatched(sessionStatusPolicyService, {
    getStatusMap: async () => new Map(),
    shouldForceNotApplicableAttendanceByMap: () => true
  }, async () => withPatched(adminChekersService, {
    isAdminForRequestAsync: async () => true
  }, async () => {
    const req = createReq({
      body: {
        classId: 'CLS-1',
        sessionId: 'SES-1',
        studentPersonId: 'PER-1',
        attendance: 'present'
      }
    });
    const res = createRes();
    await attendanceController.updateAttendanceRosterCell(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /make-up session/i);
  })));
});

test('updateAttendanceRosterCell rejects locked session without admin override', async () => {
  await withPatched(schoolDataService, {
    getDataById: async () => sampleClass,
    getClassSessions: async () => ([
      { sessionId: 'SES-1', date: '2026-06-01', status: 'completed', locked: true, roster: [] }
    ])
  }, async () => withPatched(sessionStatusPolicyService, {
    getStatusMap: async () => new Map(),
    shouldForceNotApplicableAttendanceByMap: () => false
  }, async () => withPatched(adminChekersService, {
    isAdminForRequestAsync: async () => false
  }, async () => {
    const req = createReq({
      body: {
        classId: 'CLS-1',
        sessionId: 'SES-1',
        studentPersonId: 'PER-1',
        attendance: 'present'
      }
    });
    const res = createRes();
    await attendanceController.updateAttendanceRosterCell(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /locked/i);
  })));
});

test('updateAttendanceRosterCell allows locked session with admin override', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    saveClassSessions: schoolDataService.saveClassSessions,
    getStatusMap: sessionStatusPolicyService.getStatusMap,
    shouldForceNotApplicableAttendanceByMap: sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap,
    isAdminForRequestAsync: adminChekersService.isAdminForRequestAsync,
    getPolicyForOrg: attendanceMatrixPolicyModel.getPolicyForOrg,
    recompute: classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass
  };

  schoolDataService.getDataById = async () => sampleClass;
  schoolDataService.getClassSessions = async () => ([
    { sessionId: 'SES-1', date: '2026-06-01', status: 'completed', locked: true, roster: [] }
  ]);
  schoolDataService.saveClassSessions = async () => {};
  sessionStatusPolicyService.getStatusMap = async () => new Map();
  sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap = () => false;
  adminChekersService.isAdminForRequestAsync = async () => true;
  attendanceMatrixPolicyModel.getPolicyForOrg = async () => ({});
  classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = async () => {};

  try {
    const req = createReq({
      body: {
        classId: 'CLS-1',
        sessionId: 'SES-1',
        studentPersonId: 'PER-1',
        attendance: 'present'
      }
    });
    const res = createRes();
    await attendanceController.updateAttendanceRosterCell(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'success');
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.saveClassSessions = originals.saveClassSessions;
    sessionStatusPolicyService.getStatusMap = originals.getStatusMap;
    sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap = originals.shouldForceNotApplicableAttendanceByMap;
    adminChekersService.isAdminForRequestAsync = originals.isAdminForRequestAsync;
    attendanceMatrixPolicyModel.getPolicyForOrg = originals.getPolicyForOrg;
    classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass = originals.recompute;
  }
});

test('addAttendanceComment rejects makeup-required session', async () => {
  await withPatched(schoolDataService, {
    getDataById: async () => sampleClass,
    getClassSessions: async () => ([
      { sessionId: 'SES-1', date: '2026-06-01', status: 'missed_informed24', roster: [] }
    ])
  }, async () => withPatched(sessionStatusPolicyService, {
    getStatusMap: async () => new Map(),
    shouldForceNotApplicableAttendanceByMap: () => true
  }, async () => withPatched(adminChekersService, {
    isAdminForRequestAsync: async () => true
  }, async () => {
    const req = createReq({
      body: {
        classId: 'CLS-1',
        sessionId: 'SES-1',
        studentPersonId: 'PER-1',
        text: 'Should not save'
      }
    });
    const res = createRes();
    await attendanceController.addAttendanceComment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /make-up session/i);
  })));
});

test('addAttendanceComment rejects locked session without admin override', async () => {
  await withPatched(schoolDataService, {
    getDataById: async () => sampleClass,
    getClassSessions: async () => ([
      { sessionId: 'SES-1', date: '2026-06-01', status: 'completed', locked: true, roster: [] }
    ])
  }, async () => withPatched(sessionStatusPolicyService, {
    getStatusMap: async () => new Map(),
    shouldForceNotApplicableAttendanceByMap: () => false
  }, async () => withPatched(adminChekersService, {
    isAdminForRequestAsync: async () => false
  }, async () => {
    const req = createReq({
      body: {
        classId: 'CLS-1',
        sessionId: 'SES-1',
        studentPersonId: 'PER-1',
        text: 'Should not save'
      }
    });
    const res = createRes();
    await attendanceController.addAttendanceComment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /locked/i);
  })));
});
