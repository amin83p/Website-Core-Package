const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sessionDeliveryTeamService = require('../MVC/services/school/sessionDeliveryTeamService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
const { SCOPE_MODES } = require('../MVC/services/school/schoolDataScopeBuilder');
const rollingEnrollmentSessionAlignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');

const ROOT = path.resolve(__dirname, '../../..');

function readPackage(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'packages/school', relativePath), 'utf8');
}

const sampleSession = {
  delivery: {
    deliveredBy: 'MAIN',
    deliveredByName: 'Main Teacher',
    coTeachers: [
      { personId: 'CO_VIEW', name: 'Viewer', canEdit: false },
      { personId: 'CO_EDIT', name: 'Editor', canEdit: true }
    ]
  }
};

test('normalizeSessionCoTeachers drops main teacher, duplicates, and enforces max', () => {
  const rows = sessionDeliveryTeamService.normalizeSessionCoTeachers([
    { personId: 'T1', name: 'Main', roleLabel: 'Co-Teacher' },
    { personId: 'C1', name: 'Helper', canEdit: true },
    { personId: 'C1', name: 'Helper Dup' },
    { personId: 'C2', name: 'TA', roleLabel: 'Teaching Assistant' },
    ...Array.from({ length: 12 }, (_, i) => ({ personId: `X${i}`, name: `Extra ${i}` }))
  ], { mainTeacherId: 'T1' });

  assert.equal(rows.length, 10);
  assert.equal(rows[0].personId, 'C1');
  assert.equal(rows[0].canEdit, true);
  assert.equal(rows[0].roleLabel, 'Co-Teacher');
  assert.equal(rows[1].roleLabel, 'Teaching Assistant');
  assert.ok(!rows.some((row) => row.personId === 'T1'));
});

test('delivery-team matchers distinguish viewer vs editor', () => {
  assert.equal(sessionDeliveryTeamService.isPersonSessionMainTeacher(sampleSession, 'MAIN'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionViewer(sampleSession, 'CO_VIEW'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(sampleSession, 'CO_VIEW'), false);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(sampleSession, 'CO_EDIT'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(sampleSession, 'MAIN'), true);
  assert.deepEqual(
    sessionDeliveryTeamService.getSessionDeliveryPersonIds(sampleSession),
    ['MAIN', 'CO_VIEW', 'CO_EDIT']
  );
});

test('schoolRecordAccessService grants view to co-teachers and edit only with canEdit', () => {
  const assignmentAccess = { scopeMode: SCOPE_MODES.ASSIGNMENT, personId: 'CO_VIEW' };
  const editorAccess = { scopeMode: SCOPE_MODES.ASSIGNMENT, personId: 'CO_EDIT' };
  const outsiderAccess = { scopeMode: SCOPE_MODES.ASSIGNMENT, personId: 'OTHER' };
  const classRow = { instructors: [] };

  assert.equal(schoolRecordAccessService.isSessionAccessible({
    classRow,
    session: sampleSession,
    access: assignmentAccess,
    context: 'viewSession'
  }), true);
  assert.equal(schoolRecordAccessService.isSessionAccessible({
    classRow,
    session: sampleSession,
    access: assignmentAccess,
    context: 'manageSession'
  }), false);
  assert.equal(schoolRecordAccessService.isSessionAccessible({
    classRow,
    session: sampleSession,
    access: editorAccess,
    context: 'manageSession'
  }), true);
  assert.equal(schoolRecordAccessService.isSessionAccessible({
    classRow,
    session: sampleSession,
    access: outsiderAccess,
    context: 'list'
  }), false);
});

test('rolling staged sessions preserve coTeachers', () => {
  const staged = rollingEnrollmentSessionAlignmentService.sanitizeStagedSessionRow({
    date: '2026-07-21',
    startTime: '09:00',
    endTime: '10:00',
    delivery: {
      deliveredBy: 'MAIN',
      deliveredByName: 'Main',
      coTeachers: [{ personId: 'CO1', name: 'Helper', canEdit: true }]
    }
  }, 0);
  assert.ok(staged);
  assert.equal(staged.delivery.coTeachers.length, 1);
  assert.equal(staged.delivery.coTeachers[0].personId, 'CO1');
  assert.equal(staged.delivery.coTeachers[0].canEdit, true);
});

test('timesheet and schedule paths include co-teacher delivery matching', () => {
  const timesheetController = readPackage('MVC/controllers/school/timesheetController.js');
  const scheduleController = readPackage('MVC/controllers/school/scheduleController.js');
  const indexService = readPackage('MVC/services/school/schoolIndexService.js');
  const timesheetEditor = readPackage('MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(timesheetController, /isCoTeacherSession/);
  assert.match(timesheetController, /isPersonOnSessionDelivery/);
  assert.match(scheduleController, /isPersonOnSessionDelivery/);
  assert.match(indexService, /getSessionDeliveryPersonIds/);
  assert.match(timesheetEditor, /isCoTeacherSession/);
});

test('session builder and manager UI wire co-teacher controls', () => {
  const classForm = readPackage('MVC/views/school/class/classForm.ejs');
  const sessionManager = readPackage('MVC/views/school/class/sessionManager.ejs');
  const access = readPackage('MVC/services/school/schoolRecordAccessService.js');
  const explorer = readPackage('MVC/services/school/sessionExplorerService.js');

  assert.match(classForm, /bulk_applyCoTeachersBtn/);
  assert.match(classForm, /bulk-tab-co/);
  assert.match(classForm, /bulk-tab-main/);
  assert.match(classForm, /getSelectedSessionsForCoTeachers/);
  assert.match(classForm, /session-select-cb/);
  assert.match(classForm, /Apply Co-Teachers to Selected Sessions/);
  assert.match(classForm, /sessionsSelectAll/);
  assert.match(classForm, /_bulkSelected/);
  assert.match(classForm, /coTeachers/);
  assert.match(sessionManager, /sessionCanManageCoTeachers/);
  assert.match(sessionManager, /session-co-can-edit/);
  assert.match(sessionManager, /payload\.coTeachers/);
  assert.match(access, /isPersonSessionEditor/);
  assert.match(access, /viewSession/);
  assert.match(explorer, /getSessionCoTeachers/);
  assert.match(explorer, /matchedAsCoTeacher/);
});

test('class save and session metadata accept coTeachers', () => {
  const controller = readPackage('MVC/controllers/school/classController.js');
  assert.match(controller, /normalizeSessionCoTeachers/);
  assert.match(controller, /canManageCoTeachers/);
  assert.match(controller, /canToggleCoTeacherEdit/);
  assert.match(controller, /body\.coTeachers/);
  assert.match(controller, /sessionCoTeachers/);
  assert.match(controller, /coTeacherMembershipSessions/);
  assert.match(controller, /const canManageCoTeachers = Boolean\(canOverride\)/);
  assert.match(controller, /isPersonSessionMainTeacher/);
});

test('session manager splits co-teacher manage vs canEdit toggle', () => {
  const sessionManager = readPackage('MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /sessionCanToggleCoTeacherEdit/);
  assert.match(sessionManager, /sessionCanManageCoTeachers/);
  assert.match(sessionManager, /session-co-can-edit/);
  assert.match(sessionManager, /session-co-remove/);
  assert.match(sessionManager, /if \(!sessionCanManageCoTeachers\) return;/);
});

test('conflict detection resolves delivery person ids for main and co-teachers', () => {
  const conflictService = require('../MVC/services/school/sessionConflictDetectionService');
  const session = {
    delivery: {
      deliveredBy: 'MAIN',
      deliveredByName: 'Main Teacher',
      coTeachers: [
        { personId: 'CO1', name: 'Helper One', roleLabel: 'Co-Teacher' },
        { personId: 'CO2', name: 'Helper Two', roleLabel: 'Teaching Assistant' }
      ]
    }
  };
  const ids = conflictService.resolveSessionDeliveryPersonIds(session, '', {});
  assert.deepEqual(ids, ['MAIN', 'CO1', 'CO2']);
  assert.match(
    conflictService.resolveDeliveryPersonDisplayName(session, 'CO1'),
    /Helper One \(Co-Teacher\)/
  );
  assert.match(
    conflictService.resolveDeliveryPersonDisplayName(session, 'MAIN'),
    /Main Teacher/
  );

  const conflictSource = readPackage('MVC/services/school/sessionConflictDetectionService.js');
  assert.match(conflictSource, /resolvedDeliveryPersonIds/);
  assert.match(conflictSource, /getSessionDeliveryPersonIds/);
});
