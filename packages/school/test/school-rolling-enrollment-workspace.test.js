const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');
const workspaceService = require('../MVC/services/school/rollingEnrollmentWorkspaceService');

const STATUS_MAP = {
  scheduled: {
    code: 'scheduled',
    label: 'Scheduled',
    excludeFromAttendance: false,
    makeUpRequired: false,
    active: true
  },
  cancelled: {
    code: 'cancelled',
    label: 'Cancelled',
    excludeFromAttendance: true,
    makeUpRequired: false,
    active: true
  }
};

function scheduledSession(id, date, startTime = '09:00', endTime = '12:00', extra = {}) {
  return {
    sessionId: id,
    date,
    startTime,
    endTime,
    status: 'scheduled',
    durationHours: 3,
    ...extra
  };
}

function loadAlignmentClient() {
  const scriptPath = path.join(__dirname, '../public/scripts/rollingEnrollmentAlignmentClient.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {}, globalThis: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.RollingEnrollmentAlignmentClient;
}

test('workspace evaluateWorkspaceAlignment matches server alignment for session targets', () => {
  const sessions = [
    scheduledSession('SES_001', '2026-01-05'),
    scheduledSession('SES_002', '2026-01-12'),
    scheduledSession('SES_003', '2026-01-19')
  ];
  const workspace = workspaceService.buildRollingEnrollmentWorkspacePayload({
    classData: { id: 'CLS_WORK_001', orgId: 'ORG_900000' },
    sessions,
    statusMap: STATUS_MAP,
    scheduleDefaults: { startTime: '09:00', endTime: '12:00' }
  });

  const local = workspaceService.evaluateWorkspaceAlignment({
    workspace,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetSessionCount: 2,
    pendingStagedSessions: []
  });
  const server = alignmentService.evaluateAlignment({
    sessions,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetSessionCount: 2,
    statusMap: STATUS_MAP
  });

  assert.equal(local.alignmentStatus, server.alignmentStatus);
  assert.equal(local.availableCount, server.availableCount);
  assert.equal(local.requiredNaCount, server.requiredNaCount);
  assert.equal(local.enforceSessionCount, true);
});

test('client alignment client mirrors server evaluateAlignment', () => {
  const client = loadAlignmentClient();
  assert.ok(client);

  const sessions = [
    scheduledSession('SES_A', '2026-02-01', '10:00', '11:00', { durationHours: 1 }),
    scheduledSession('SES_B', '2026-02-08', '10:00', '12:00', { durationHours: 2 })
  ];
  const workspace = {
    sessions,
    statusMap: STATUS_MAP,
    scheduleDefaults: {}
  };

  const clientResult = client.buildAlignmentPayload({
    workspace,
    startDate: '2026-02-01',
    endDate: '2026-02-28',
    targetHours: 2,
    pendingStagedSessions: [{
      sessionId: 'STAGED_001',
      date: '2026-02-15',
      startTime: '10:00',
      endTime: '11:00',
      status: 'scheduled',
      durationHours: 1
    }]
  });

  const serverResult = alignmentService.evaluateAlignment({
    sessions: [...sessions, {
      sessionId: 'STAGED_001',
      date: '2026-02-15',
      startTime: '10:00',
      endTime: '11:00',
      status: 'scheduled',
      durationHours: 1
    }],
    startDate: '2026-02-01',
    endDate: '2026-02-28',
    targetHours: 2,
    statusMap: STATUS_MAP
  });

  assert.equal(clientResult.alignmentStatus, serverResult.alignmentStatus);
  assert.equal(clientResult.availableHours, serverResult.availableHours);
  assert.equal(clientResult.requiredNaHours, serverResult.requiredNaHours);
  assert.equal(clientResult.pendingStagedCount, 1);
});

test('buildEnrollmentSessionPickerPayloadSync uses persisted sessions without refetch', () => {
  const pickerService = require('../MVC/services/school/sessionEnrollmentPickerService');
  const sessions = [
    scheduledSession('SES_PICK_1', '2026-01-05'),
    scheduledSession('SES_PICK_2', '2026-01-12')
  ];
  const payload = pickerService.buildEnrollmentSessionPickerPayloadSync({
    classData: {
      id: 'CLS_PICKER_LOCAL',
      orgId: 'ORG_900000',
      instructors: [{ personId: 'TCH_001', name: 'Coach A', status: 'active' }]
    },
    persistedSessions: sessions,
    statusMap: STATUS_MAP,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetSessionCount: 1,
    selectedSessionIds: ['SES_PICK_1'],
    viewPreset: 'week',
    anchorDate: '2026-01-15'
  });
  assert.equal(payload.allEvents.length, 2);
  assert.equal(payload.summary.selectedCount, 1);
  assert.equal(payload.enrollmentAlignment.alignmentStatus, 'overage_requires_na');
});

test('filterSessionsInEnrollmentWindow scopes sessions to enrollment dates', () => {
  const sessions = [
    scheduledSession('SES_EARLY', '2025-12-15'),
    scheduledSession('SES_OK', '2026-02-01')
  ];
  const filtered = workspaceService.filterSessionsInEnrollmentWindow(sessions, '2026-01-01', '2026-03-31');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sessionId, 'SES_OK');
});

test('slimSessionRow preserves rosterCount from roster array', () => {
  const row = workspaceService.slimSessionRow({
    sessionId: 'SES_ROSTER',
    date: '2026-02-01',
    startTime: '09:00',
    endTime: '10:00',
    roster: [{ personId: 'PERSON_1' }]
  });
  assert.equal(row.rosterCount, 1);
});

test('slimSessionRow reports zero rosterCount when roster is empty', () => {
  const row = workspaceService.slimSessionRow({
    sessionId: 'SES_EMPTY',
    date: '2026-02-01',
    startTime: '09:00',
    endTime: '10:00',
    roster: []
  });
  assert.equal(row.rosterCount, 0);
});

test('resolveSessionOccupiedStudentCount uses enrollment applicability without roster attendance', () => {
  const sessions = [{ sessionId: 'SES_OCC', date: '2026-02-01', startTime: '09:00', endTime: '10:00', roster: [] }];
  const students = [
    { id: 'STU_A', personId: 'PERSON_A', orgId: 'ORG_900000' },
    { id: 'STU_B', personId: 'PERSON_B', orgId: 'ORG_900000' }
  ];
  const periodRows = [{
    id: 'EP_A',
    orgId: 'ORG_900000',
    studentId: 'STU_A',
    personId: 'PERSON_A',
    status: 'active',
    startDate: '2026-02-01',
    endDate: '2026-03-31',
    sessionCapacityType: 'one_on_one',
    plannedNotApplicableSessionIds: []
  }];
  const count = workspaceService.resolveSessionOccupiedStudentCount({
    session: sessions[0],
    periodRows,
    studentToPersonMap: workspaceService.buildStudentToPersonMap(students, 'ORG_900000'),
    statusMap: STATUS_MAP,
    excludeStudentId: 'STU_B',
    activeOrgId: 'ORG_900000'
  });
  assert.equal(count, 1);
});

test('enrichSessionsWithEnrollmentOccupancy writes occupancy onto slim sessions', () => {
  const sessions = [{ sessionId: 'SES_OCC', date: '2026-02-01', startTime: '09:00', endTime: '10:00', roster: [] }];
  const students = [
    { id: 'STU_A', personId: 'PERSON_A', orgId: 'ORG_900000' },
    { id: 'STU_B', personId: 'PERSON_B', orgId: 'ORG_900000' }
  ];
  const periodRows = [{
    id: 'EP_A',
    orgId: 'ORG_900000',
    studentId: 'STU_A',
    personId: 'PERSON_A',
    status: 'active',
    startDate: '2026-02-01',
    endDate: '2026-03-31',
    sessionCapacityType: 'one_on_one',
    plannedNotApplicableSessionIds: []
  }];
  const enriched = workspaceService.enrichSessionsWithEnrollmentOccupancy({
    sessions,
    periodRows,
    statusMap: STATUS_MAP,
    students,
    excludeStudentId: 'STU_B',
    activeOrgId: 'ORG_900000'
  });
  const payload = workspaceService.buildRollingEnrollmentWorkspacePayload({
    classData: { id: 'CLS_OCC', orgId: 'ORG_900000' },
    sessions: enriched,
    statusMap: STATUS_MAP,
    scheduleDefaults: {}
  });
  assert.equal(payload.sessions[0].rosterCount, 1);
});
