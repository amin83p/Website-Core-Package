const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('../MVC/services/school/sessionStatusPolicyService');
const sessionMergeService = require('../MVC/services/school/sessionMergeService');
const sessionDeliveryTeamService = require('../MVC/services/school/sessionDeliveryTeamService');
const { DEFAULT_SESSION_STATUS_TEMPLATES } = require('../MVC/models/school/sessionStatusModel');

const ROOT = path.resolve(__dirname, '../../..');

function readPackage(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'packages/school', relativePath), 'utf8');
}

function buildStatusMap(definition) {
  return new Map([[policy.normalizeStatusCode(definition.code), definition]]);
}

test('DEFAULT_SESSION_STATUS_TEMPLATES includes merged_session with mergedSessionRequired', () => {
  const merged = DEFAULT_SESSION_STATUS_TEMPLATES.find((row) => row.code === 'merged_session');
  assert.ok(merged);
  assert.equal(merged.mergedSessionRequired, true);
  assert.equal(merged.makeUpRequired, false);
  assert.equal(merged.timesheetFormula, 'duration');
});

test('isMergedSessionRequiredByMap detects merged session policy flag', () => {
  const statusMap = buildStatusMap({
    code: 'merged_session',
    mergedSessionRequired: true,
    makeUpRequired: false,
    isFinal: true
  });
  assert.equal(policy.isMergedSessionRequiredByMap(statusMap, { status: 'merged_session' }), true);
  assert.equal(policy.isMergedSessionRequiredByMap(statusMap, { status: 'scheduled' }), false);
});

test('buildClientStatusMeta exposes mergedSessionRequired', () => {
  const meta = policy.buildClientStatusMeta([{
    code: 'merged_session',
    label: 'Merged Session',
    mergedSessionRequired: true,
    makeUpRequired: false,
    makeupDurationPercent: 100,
    timesheetFormula: 'duration',
    isFinal: true,
    excludeFromAttendance: false,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 50,
    colorBg: '#e8eaf6',
    colorText: '#3f51b5',
    colorBorder: '#c5cae9'
  }]);
  assert.equal(meta[0].mergedSessionRequired, true);
});

test('isSessionCompletionStatusByMap excludes mergedSessionRequired statuses', () => {
  const statusMap = buildStatusMap({
    code: 'merged_session',
    mergedSessionRequired: true,
    makeUpRequired: false,
    isFinal: true,
    excludeFromAttendance: false
  });
  assert.equal(policy.isSessionCompletionStatusByMap(statusMap, { status: 'merged_session' }), false);
});

test('areMergeLinkedSessions links source merged metadata to partner session', () => {
  const source = {
    sessionId: 'SRC-1',
    merged: {
      isMergedSession: true,
      partnerClassId: 'CLASS-B',
      partnerSessionId: 'PART-1'
    }
  };
  const partner = {
    sessionId: 'PART-1',
    mergedPartner: {
      linkedClassId: 'CLASS-A',
      linkedSessionId: 'SRC-1',
      ignoreScheduleConflict: true
    }
  };
  assert.equal(sessionMergeService.areMergeLinkedSessions(source, 'CLASS-A', partner, 'CLASS-B'), true);
  assert.equal(sessionMergeService.areMergeLinkedSessions(source, 'CLASS-A', { sessionId: 'OTHER' }, 'CLASS-B'), false);
});

test('normalizeClock normalizes HH:MM for exact-time matching', () => {
  assert.equal(sessionMergeService.normalizeClock('9:05'), '09:05');
  assert.equal(sessionMergeService.normalizeClock('09:05'), '09:05');
  assert.equal(sessionMergeService.normalizeClock('12:30:00'), '12:30');
  assert.equal(sessionMergeService.normalizeClock('invalid'), '');
});

test('explainPartnerSessionMergeFailure is available for merge preview diagnostics', () => {
  assert.equal(typeof sessionMergeService.explainPartnerSessionMergeFailure, 'function');
});

test('unpaid previous teacher co-teacher row yields zero timesheet hours', () => {
  const session = {
    delivery: {
      deliveredBy: 'NEW-TEACHER',
      coTeachers: [{
        personId: 'OLD-TEACHER',
        name: 'Previous Teacher',
        paid: false,
        paidHours: 0
      }]
    }
  };
  assert.equal(sessionDeliveryTeamService.resolveCoTeacherTimesheetHours({
    session,
    personId: 'OLD-TEACHER',
    formulaHours: 2
  }), 0);
  assert.equal(sessionDeliveryTeamService.resolveCoTeacherTimesheetHours({
    session,
    personId: 'NEW-TEACHER',
    formulaHours: 2
  }), 2);
});

test('session status form exposes mergedSessionRequired control', () => {
  const form = readPackage('MVC/views/school/sessionStatus/sessionStatusForm.ejs');
  assert.match(form, /mergedSessionRequired/);
  assert.match(form, /Merged Session Required/);
});

test('session manager includes merge modal and status hook markers', () => {
  const sessionManager = readPackage('MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /ensureMergedSessionModal/);
  assert.match(sessionManager, /isSessionStatusMergedRequired/);
  assert.match(sessionManager, /mergedSessionModal/);
  assert.match(sessionManager, /merge\/preview/);
  assert.match(sessionManager, /openMergedSessionModal/);
});

test('class routes register merge preview and execute endpoints', () => {
  const routes = readPackage('MVC/routes/classRoutes.js');
  assert.match(routes, /merge\/preview/);
  assert.match(routes, /previewSessionMerge/);
  assert.match(routes, /executeSessionMerge/);
  assert.match(routes, /merge\/unmerge/);
  assert.match(routes, /unmergeSession/);
});

test('removeMergeAddedCoTeachers strips merge-added previous teacher row', () => {
  const coTeachers = [
    { personId: 'CO-1', name: 'Co One', roleLabel: 'Co-Teacher', paid: true },
    { personId: 'OLD-TEACHER', name: 'Previous Teacher', roleLabel: 'Previous Teacher', paid: false, paidHours: 0 },
    { personId: 'NEW-TEACHER', name: 'Merging Teacher', roleLabel: 'Co-Teacher', paid: true }
  ];
  const next = sessionMergeService.removeMergeAddedCoTeachers(coTeachers, 'OLD-TEACHER', 'NEW-TEACHER');
  assert.equal(next.length, 1);
  assert.equal(next[0].personId, 'CO-1');
  assert.equal(sessionMergeService.isMergeAddedPreviousTeacherCoTeacher({
    personId: 'OLD-TEACHER',
    roleLabel: 'Previous Teacher'
  }, 'OLD-TEACHER'), true);
  assert.equal(sessionMergeService.isMergeAddedPreviousTeacherCoTeacher({
    personId: 'OLD-TEACHER',
    roleLabel: 'Co-Teacher'
  }, 'OLD-TEACHER'), false);
});

test('executeSessionUnmerge is exported for undo merge workflow', () => {
  assert.equal(typeof sessionMergeService.executeSessionUnmerge, 'function');
});

test('session manager includes undo merge UI and handler', () => {
  const sessionManager = readPackage('MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /btnUndoSessionMerge/);
  assert.match(sessionManager, /unmergeSessionFromManager/);
  assert.match(sessionManager, /merge\/unmerge/);
  assert.match(sessionManager, /Undo merge required/);
});

test('class controller exports unmergeSession and save guard for UNMERGE_REQUIRED', () => {
  const controller = readPackage('MVC/controllers/school/classController.js');
  assert.match(controller, /unmergeSession/);
  assert.match(controller, /UNMERGE_REQUIRED/);
  assert.match(controller, /executeSessionUnmerge/);
});

test('ensureOrgDefaultSessionStatuses backfills missing default templates', () => {
  const policySource = readPackage('MVC/services/school/sessionStatusPolicyService.js');
  assert.match(policySource, /templatesToCreate/);
  assert.match(policySource, /!existingCodes\.has\(code\)/);
});
