const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('School leave request manifest declares section, symbol, menus, data entity, and access grants', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445575');
  assert.ok(section, 'section 445575 should be declared');
  assert.equal(section.name, 'SCHOOL_LEAVE_REQUESTS');
  assert.equal(section.homeURL, '/school/leave-requests');
  assert.equal(section.trackState, true);

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok((academia.subsections || []).some((row) => row.id === '445575'), 'section should be under SCHOOL_ACADEMIA');

  const symbol = (manifest.symbols || []).find((row) => row.id === 'SYM_SYSTEM_059');
  assert.ok(symbol, 'symbol SYM_SYSTEM_059 should be declared');
  assert.equal(symbol.name, 'SCHOOL_LEAVE_REQUESTS');
  assert.equal(symbol.orgId, 'SYSTEM');
  assert.deepEqual(symbol.tags, ['SCHOOL_LEAVE_REQUESTS', '445575']);

  assert.ok((manifest.menuEntries || []).some((row) => row.id === 'school-menu-leave-requests' && row.href === '/school/leave-requests'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.id === 'school-dashboard-leave-requests' && row.href === '/school/leave-requests'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'leaveRequests' && row.collectionName === 'schoolLeaveRequests'));

  ['SCHOOL_STAFF', 'SCHOOL_STUDENT', 'SCHOOL_TEACHER'].forEach((profileName) => {
    const profile = (manifest.accesses || []).find((row) => row.name === profileName);
    assert.ok(profile, `${profileName} should exist`);
    const grant = (profile.sections || []).find((row) => row.sectionId === '445575');
    assert.ok(grant, `${profileName} should include leave request section`);
    assert.equal(grant.adminAccess, false);
    assert.deepEqual((grant.operations || []).map((row) => `${row.operationId}:${row.scopeId}`), [
      'OP1001:SCP_OWNER',
      'OP1002:SCP_OWNER',
      'OP1003:SCP_OWNER',
      'OP1005:SCP_OWNER'
    ]);
  });
});

test('School leave request files are package-owned and wired through package route/data layers', () => {
  const schoolRoute = readText('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(schoolRoute, /router\.use\('\/leave-requests', require\('\.\/leaveRequestRoutes'\)\)/);

  const leaveRoute = readText('packages/school/MVC/routes/leaveRequestRoutes.js');
  assert.match(leaveRoute, /SECTIONS\.SCHOOL_LEAVE_REQUESTS/);
  assert.match(leaveRoute, /trackActionState\(SECTION, OPERATIONS\.CREATE, \{ requireToken: true \}\)/);

  const controller = readText('packages/school/MVC/controllers/school/leaveRequestController.js');
  assert.match(controller, /requesterRecordId: body\.requesterRecordId/);

  const dataService = readText('packages/school/MVC/services/school/schoolDataService.js');
  assert.match(dataService, /leaveRequests: \{ repository: schoolRepositories\.leaveRequests \}/);

  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /collectionName: 'schoolLeaveRequests'/);
  assert.match(repo, /assertQueryableCrudRepository\('schoolRepositories\.leaveRequests'/);
});

test('School leave request lifecycle helpers preserve approved snapshots and detect overlaps', () => {
  const service = require('../packages/school/MVC/services/school/leaveRequestService');
  const snapshot = service.getActiveApprovedSnapshot({
    status: 'pending_reapproval',
    lastApprovedSnapshot: {
      requestId: 'LR-1',
      orgId: '900000',
      requesterPersonId: 'P-1',
      requesterRole: 'teacher',
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      allDay: false,
      startTime: '09:00',
      endTime: '12:00',
      active: true
    }
  });
  assert.equal(snapshot.requestId, 'LR-1');
  assert.equal(snapshot.active, true);

  assert.equal(service._private.snapshotOverlapsWindow(snapshot, {
    personId: 'P-1',
    date: '2026-06-10',
    startTime: '10:00',
    endTime: '11:00'
  }), true);
  assert.equal(service._private.snapshotOverlapsWindow(snapshot, {
    personId: 'P-1',
    date: '2026-06-10',
    startTime: '12:30',
    endTime: '13:00'
  }), false);
});

test('School leave request schedule and conflict integrations are present', () => {
  const leaveRequestService = readText('packages/school/MVC/services/school/leaveRequestService.js');
  assert.match(leaveRequestService, /approved_request_modified/);
  assert.match(leaveRequestService, /request_modified/);

  const scheduleController = readText('packages/school/MVC/controllers/school/scheduleController.js');
  assert.match(scheduleController, /leaveRequestService\.getApprovedLeaveEventsForPerson/);

  const classController = readText('packages/school/MVC/controllers/school/classController.js');
  assert.match(classController, /leaveRequestService\.findApprovedLeaveConflicts/);
  assert.match(classController, /Approved leave request/);
  assert.match(classController, /Student approved leave request/);

  const registrationService = readText('packages/school/MVC/services/school/registrationIntegrityService.js');
  assert.match(registrationService, /assertStudentLeaveDoesNotOverlapClass/);
  assert.match(registrationService, /leaveRequestService\.findApprovedLeaveConflicts/);
});

test('School leave request form uses role-aware requester picker and hourly leave mode', () => {
  const form = readText('packages/school/MVC/views/school/leaveRequest/form.ejs');
  const list = readText('packages/school/MVC/views/school/leaveRequest/list.ejs');
  const detail = readText('packages/school/MVC/views/school/leaveRequest/detail.ejs');
  assert.match(form, /requesterRoleOptions/);
  assert.match(form, /selfRequester/);
  assert.match(form, /id="requesterPickerLabel"/);
  assert.match(form, /id="btnPickRequester"/);
  assert.match(form, /modal_GenericPicker/);
  assert.match(form, /GenericPickerPresets\.student/);
  assert.match(form, /GenericPickerPresets\.teacher/);
  assert.match(form, /GenericPickerPresets\.staff/);
  assert.match(form, /name="requesterPersonId"/);
  assert.match(form, /name="requesterRecordId"/);
  assert.match(form, /id="leaveDurationHours"/);
  assert.match(form, /id="allDay" name="allDay"/);
  assert.match(form, /showMessageModal/);
  assert.doesNotMatch(form, /window\.alert|window\.confirm|window\.prompt/);
  assert.match(list, /showMessageModal/);
  assert.match(detail, /showMessageModal/);
  assert.doesNotMatch(list, /window\.alert|window\.confirm|window\.prompt/);
  assert.doesNotMatch(detail, /window\.alert|window\.confirm|window\.prompt/);
});

test('School leave request requester role helpers scope normal users to their own roles', () => {
  const service = require('../packages/school/MVC/services/school/leaveRequestService');
  const requester = {
    id: 'U-1',
    personId: 'P-1',
    displayName: 'Alex Requester',
    role: 'member',
    roles: ['school_teacher'],
    activeOrgId: '900000',
    allowedOrgs: [
      { orgId: '900000', roles: ['school_staff'] },
      { orgId: 'OTHER', roles: ['school_student'] }
    ]
  };

  assert.deepEqual(service.getRequesterRoleOptions(requester), ['teacher', 'staff']);
  assert.deepEqual(service.getSelfRequesterContext(requester), {
    requesterPersonId: 'P-1',
    requesterName: 'Alex Requester',
    requesterRole: 'teacher',
    requesterRoles: ['teacher', 'staff']
  });
});

test('School leave request Mongo seed is mirrored in package support metadata', () => {
  const support = readJson('packages/school/package.support-files.json');
  assert.ok((support.scripts || []).some((row) => (
    row.source === 'scripts/mongo-railway/insert-school-leave-request-section.mongosh.js' &&
    row.target === 'packages/school/scripts/maintenance/insert-school-leave-request-section.mongosh.js'
  )));

  const seed = readText('scripts/mongo-railway/insert-school-leave-request-section.mongosh.js');
  assert.match(seed, /const SECTION_ID = '445575'/);
  assert.match(seed, /const SYMBOL_ID = 'SYM_SYSTEM_059'/);
  assert.match(seed, /SCHOOL_STAFF/);
});
