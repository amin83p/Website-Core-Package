const test = require('node:test');
const assert = require('node:assert/strict');

const examController = require('../MVC/controllers/school/examController');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const dataService = require('../MVC/services/dataService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');

const methodNames = [
  'getDataById',
  'fetchData',
  'updateData',
  'createExamAllocation',
  'createExamAssignmentsForAllocation'
];

const originals = Object.fromEntries(methodNames.map((name) => [name, schoolDataService[name]]));
const originalDataServiceGetById = dataService.getDataById;
const originalListActiveStudentIdsForClass = classEnrollmentReadService.listActiveStudentIdsForClass;

function restoreStubs() {
  methodNames.forEach((name) => {
    schoolDataService[name] = originals[name];
  });
  dataService.getDataById = originalDataServiceGetById;
  classEnrollmentReadService.listActiveStudentIdsForClass = originalListActiveStudentIdsForClass;
}

function createReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: { 'x-ajax-request': 'true' },
    xhr: true,
    user: {
      id: 'USR-1',
      personId: 'PER-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: false },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    actionStateId: 'ACT-1',
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    viewName: '',
    redirectUrl: '',
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
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };
}

test.afterEach(() => {
  restoreStubs();
});

test('saveAllocation creates allocation for published revision and normalizes schedule inputs', async () => {
  let capturedInput = null;
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examTemplates' && String(id) === 'TMP-1') {
      return { id: 'TMP-1', orgId: 'ORG-1', title: 'Midterm', settings: { defaultTimezone: 'UTC' } };
    }
    if (entity === 'classes' && String(id) === 'CLS-1') {
      return {
        id: 'CLS-1',
        orgId: 'ORG-1',
        title: 'Class A',
        sessions: [{ sessionId: 'SES-1', date: '2026-04-02', startTime: '09:00', endTime: '10:30', status: 'scheduled' }]
      };
    }
    if (entity === 'examAllocations') return null;
    return null;
  };
  schoolDataService.fetchData = async (entity, query) => {
    if (entity === 'examRevisions' && String(query?.templateId__eq || '') === 'TMP-1') {
      return [{ id: 'REV-1', templateId: 'TMP-1', orgId: 'ORG-1', revisionNo: 2, status: 'published' }];
    }
    if (entity === 'teachers') return [];
    return [];
  };
  schoolDataService.createExamAllocation = async (input) => {
    capturedInput = input;
    return { id: 'ALC-1', ...input };
  };

  const req = createReq({
    user: {
      id: 'USR-1',
      personId: 'PER-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    body: {
      templateId: 'TMP-1',
      sessionId: 'SES-1',
      classId: 'CLS-1',
      allocationName: 'Midterm March',
      timezone: 'UTC',
      windowStartLocalDate: '2026-04-02',
      windowStartLocalTime: '09:00',
      windowEndLocalDate: '2026-04-02',
      windowEndLocalTime: '10:30',
      durationMinutes: '90',
      maxAttemptsPerStudent: '2',
      status: 'scheduled'
    }
  });
  const res = createRes();

  await examController.saveAllocation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.allocationId, 'ALC-1');
  assert.ok(capturedInput);
  assert.equal(capturedInput.templateId, 'TMP-1');
  assert.equal(capturedInput.revisionId, 'REV-1');
  assert.equal(capturedInput.revisionNo, 2);
  assert.match(String(capturedInput.windowStartUtc || ''), /^2026-04-02T09:00:00/);
  assert.match(String(capturedInput.windowEndUtc || ''), /^2026-04-02T10:30:00/);
});

test('saveAllocation rejects draft revision (published-only rule)', async () => {
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examTemplates' && String(id) === 'TMP-1') {
      return { id: 'TMP-1', orgId: 'ORG-1', title: 'Quiz' };
    }
    if (entity === 'classes' && String(id) === 'CLS-1') {
      return {
        id: 'CLS-1',
        orgId: 'ORG-1',
        title: 'Class A',
        sessions: [{ sessionId: 'SES-1', date: '2026-04-02', startTime: '09:00', endTime: '10:00', status: 'scheduled' }]
      };
    }
    return null;
  };
  schoolDataService.fetchData = async (entity, query) => {
    if (entity === 'examRevisions' && String(query?.templateId__eq || '') === 'TMP-1') {
      return [{ id: 'REV-1', templateId: 'TMP-1', orgId: 'ORG-1', revisionNo: 1, status: 'draft' }];
    }
    if (entity === 'teachers') return [];
    return [];
  };

  const req = createReq({
    user: {
      id: 'USR-1',
      personId: 'PER-1',
      activeOrgId: 'ORG-1',
      activeProfile: { fullAdmin: true },
      isSystemAdmin: false,
      isVirtualSuperAdmin: false
    },
    body: {
      templateId: 'TMP-1',
      sessionId: 'SES-1',
      classId: 'CLS-1',
      timezone: 'UTC',
      windowStartLocalDate: '2026-04-02',
      windowStartLocalTime: '09:00',
      windowEndLocalDate: '2026-04-02',
      windowEndLocalTime: '10:00'
    }
  });
  const res = createRes();
  await examController.saveAllocation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.status, 'error');
  assert.match(String(res.payload?.message || ''), /publish/i);
});

test('generateAllocationAssignments creates from active periods and returns created/skipped counts', async () => {
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examAllocations' && String(id) === 'ALC-1') {
      return { id: 'ALC-1', orgId: 'ORG-1', classId: 'CLS-1', revisionId: 'REV-1', templateId: 'TMP-1', revisionNo: 1 };
    }
    if (entity === 'classes' && String(id) === 'CLS-1') {
      return { id: 'CLS-1', orgId: 'ORG-1', title: 'Class A', enrollment: { students: [] } };
    }
    return null;
  };
  schoolDataService.fetchData = async (entity) => {
    if (entity === 'examAssignments') return [];
    return [];
  };
  classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
    studentIds: new Set(['STU-1', 'STU-2']),
    source: 'canonical'
  });
  schoolDataService.createExamAssignmentsForAllocation = async (input) => {
    assert.equal(input.allocationId, 'ALC-1');
    assert.deepEqual(input.studentIds, ['STU-1', 'STU-2']);
    return { created: [{ id: 'ASN-1' }], skippedStudentIds: ['STU-2'] };
  };

  const req = createReq({
    params: { allocationId: 'ALC-1' }
  });
  const res = createRes();
  await examController.generateAllocationAssignments(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.createdCount, 1);
  assert.equal(res.payload?.skippedCount, 1);
});

test('generateAllocationAssignments fails when class roster has no students', async () => {
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examAllocations' && String(id) === 'ALC-2') {
      return { id: 'ALC-2', orgId: 'ORG-1', classId: 'CLS-2', revisionId: 'REV-1', templateId: 'TMP-1', revisionNo: 1 };
    }
    if (entity === 'classes' && String(id) === 'CLS-2') {
      return { id: 'CLS-2', orgId: 'ORG-1', title: 'Class B', enrollment: { students: [] } };
    }
    return null;
  };
  schoolDataService.fetchData = async (entity) => {
    if (entity === 'examAssignments') return [];
    return [];
  };
  classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
    studentIds: new Set(),
    source: 'canonical'
  });

  const req = createReq({
    params: { allocationId: 'ALC-2' }
  });
  const res = createRes();
  await examController.generateAllocationAssignments(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.status, 'error');
  assert.match(String(res.payload?.message || ''), /no students/i);
});

test('saveAllocationEdit updates allocation and pushes max attempts to all non-cancelled assignments', async () => {
  const updateCalls = [];
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examAllocations' && String(id) === 'ALC-EDIT-1') {
      return {
        id: 'ALC-EDIT-1',
        orgId: 'ORG-1',
        classId: 'CLS-1',
        status: 'scheduled',
        timezone: 'UTC',
        windowStartUtc: '2026-04-10T09:00:00.000Z',
        windowEndUtc: '2026-04-10T10:00:00.000Z'
      };
    }
    return null;
  };
  schoolDataService.fetchData = async (entity, query) => {
    if (entity === 'examAssignments' && String(query?.allocationId__eq || '') === 'ALC-EDIT-1') {
      return [
        { id: 'ASN-1', status: 'pending' },
        { id: 'ASN-2', status: 'started' },
        { id: 'ASN-3', status: 'submitted' }
      ];
    }
    return [];
  };
  schoolDataService.updateData = async (entity, id, payload) => {
    updateCalls.push({ entity, id, payload });
    return { id, ...payload };
  };

  const req = createReq({
    params: { allocationId: 'ALC-EDIT-1' },
    body: {
      classId: 'CLS-1',
      allocationName: 'Updated',
      timezone: 'UTC',
      windowStartLocalDate: '2026-04-10',
      windowStartLocalTime: '10:00',
      windowEndLocalDate: '2026-04-10',
      windowEndLocalTime: '11:00',
      durationMinutes: '60',
      maxAttemptsPerStudent: '2',
      status: 'open'
    }
  });
  const res = createRes();

  await examController.saveAllocationEdit(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(updateCalls[0]?.entity, 'examAllocations');
  const assignmentUpdates = updateCalls.filter((c) => c.entity === 'examAssignments');
  assert.equal(assignmentUpdates.length, 3);
  assignmentUpdates.forEach((c) => {
    assert.equal(c.payload?.maxAttemptsAllowed, 2);
  });
  const pendingPatch = assignmentUpdates.find((c) => c.id === 'ASN-1')?.payload;
  assert.equal(Boolean(pendingPatch?.startWindowUtc), true);
  const startedPatch = assignmentUpdates.find((c) => c.id === 'ASN-2')?.payload;
  assert.equal(startedPatch?.startWindowUtc, undefined);
  assert.equal(updateCalls.length, 4);
});

test('cancelAllocation cancels non-final assignments and keeps finalized rows', async () => {
  const updateCalls = [];
  schoolDataService.getDataById = async (entity, id) => {
    if (entity === 'examAllocations' && String(id) === 'ALC-CAN-1') {
      return { id: 'ALC-CAN-1', orgId: 'ORG-1', status: 'open' };
    }
    return null;
  };
  schoolDataService.fetchData = async (entity, query) => {
    if (entity === 'examAssignments' && String(query?.allocationId__eq || '') === 'ALC-CAN-1') {
      return [
        { id: 'ASN-1', status: 'pending' },
        { id: 'ASN-2', status: 'graded' },
        { id: 'ASN-3', status: 'started' }
      ];
    }
    return [];
  };
  schoolDataService.updateData = async (entity, id, payload) => {
    updateCalls.push({ entity, id, payload });
    return { id, ...payload };
  };

  const req = createReq({
    params: { allocationId: 'ALC-CAN-1' }
  });
  const res = createRes();

  await examController.cancelAllocation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  const allocationUpdates = updateCalls.filter((row) => row.entity === 'examAllocations');
  const assignmentUpdates = updateCalls.filter((row) => row.entity === 'examAssignments');
  assert.equal(allocationUpdates.length, 1);
  assert.equal(assignmentUpdates.length, 2);
  assert.deepEqual(assignmentUpdates.map((row) => row.id).sort(), ['ASN-1', 'ASN-3']);
});

test('listTeacherAssignments scopes non-admin user to linked instructor classes', async () => {
  schoolDataService.fetchData = async (entity) => {
    if (entity === 'examAllocations') {
      return [
        { id: 'ALC-1', classId: 'CLS-1', revisionId: 'REV-1', status: 'open', allocationName: 'A1' },
        { id: 'ALC-2', classId: 'CLS-2', revisionId: 'REV-2', status: 'open', allocationName: 'A2' }
      ];
    }
    if (entity === 'examAssignments') {
      return [
        { id: 'ASN-1', allocationId: 'ALC-1', personId: 'PER-STU-1', status: 'pending' },
        { id: 'ASN-2', allocationId: 'ALC-2', personId: 'PER-STU-2', status: 'pending' }
      ];
    }
    if (entity === 'classes') {
      return [
        { id: 'CLS-1', title: 'Class 1', instructors: [{ personId: 'PER-1' }] },
        { id: 'CLS-2', title: 'Class 2', instructors: [{ personId: 'PER-9' }] }
      ];
    }
    if (entity === 'examRevisions') {
      return [
        { id: 'REV-1', revisionNo: 1, title: 'R1' },
        { id: 'REV-2', revisionNo: 2, title: 'R2' }
      ];
    }
    if (entity === 'teachers') {
      return [{ id: 'T-1', personId: 'PER-1' }];
    }
    return [];
  };
  dataService.getDataById = async () => ({ id: 'PER-1', name: { first: 'Test', last: 'Teacher' } });

  const req = createReq({
    headers: {},
    xhr: false
  });
  const res = createRes();

  await examController.listTeacherAssignments(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.viewName, 'school/exam/teacherAssignmentList');
  assert.equal(Array.isArray(res.payload?.data), true);
  assert.equal(res.payload.data.length, 1);
  assert.equal(res.payload.data[0].id, 'ALC-1');
});
