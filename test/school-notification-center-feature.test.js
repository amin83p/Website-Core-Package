const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('School notification manifest declares section, symbol, menus, data entity, and access grants', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445576');
  assert.ok(section, 'section 445576 should be declared');
  assert.equal(section.name, 'SCHOOL_NOTIFICATIONS');
  assert.equal(section.homeURL, '/school/notifications');
  assert.equal(section.trackState, true);

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok((academia.subsections || []).some((row) => row.id === '445576'), 'section should be under SCHOOL_ACADEMIA');

  const symbol = (manifest.symbols || []).find((row) => row.id === 'SYM_SYSTEM_060');
  assert.ok(symbol, 'symbol SYM_SYSTEM_060 should be declared');
  assert.equal(symbol.name, 'SCHOOL_NOTIFICATIONS');
  assert.equal(symbol.orgId, 'SYSTEM');
  assert.deepEqual(symbol.tags, ['SCHOOL_NOTIFICATIONS', '445576']);

  assert.ok((manifest.menuEntries || []).some((row) => row.id === 'school-menu-notifications' && row.href === '/school/notifications'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.id === 'school-dashboard-notifications' && row.href === '/school/notifications'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'notifications' && row.collectionName === 'schoolNotifications'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'notificationRoutingRules' && row.collectionName === 'schoolNotificationRoutingRules'));

  ['SCHOOL_STAFF', 'SCHOOL_STUDENT', 'SCHOOL_TEACHER'].forEach((profileName) => {
    const profile = (manifest.accesses || []).find((row) => row.name === profileName);
    assert.ok(profile, `${profileName} should exist`);
    const grants = (profile.sections || []).filter((row) => row.sectionId === '445576');
    assert.equal(grants.length, 1, `${profileName} should include one notification section grant`);
    assert.equal(grants[0].adminAccess, false);
    assert.deepEqual((grants[0].operations || []).map((row) => `${row.operationId}:${row.scopeId}`), [
      'OP1001:SCP_ORG',
      'OP1002:SCP_ORG',
      'OP1003:SCP_ORG',
      'OP1005:SCP_ORG'
    ]);
  });
});

test('School notification package route, repository, data service, and views are wired', () => {
  const schoolRoute = readText('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(schoolRoute, /router\.use\('\/notifications', require\('\.\/notificationRoutes'\)\)/);

  const notificationRoute = readText('packages/school/MVC/routes/notificationRoutes.js');
  const notificationController = readText('packages/school/MVC/controllers/school/notificationController.js');
  assert.match(notificationRoute, /SECTIONS\.SCHOOL_NOTIFICATIONS/);
  assert.match(notificationRoute, /requireAccess\(SECTION, OPERATIONS\.READ/);
  assert.match(notificationRoute, /requireAccess\(SECTION, OPERATIONS\.UPDATE/);
  assert.match(notificationRoute, /router\.get\('\/api\/eligible-persons'/);
  assert.match(notificationController, /listEligiblePersons/);
  assert.match(notificationRoute, /router\.get\('\/routing'/);
  assert.match(notificationRoute, /router\.post\('\/api\/routing'/);
  assert.match(notificationRoute, /router\.post\('\/api\/:id\/assign'/);

  const dataService = readText('packages/school/MVC/services/school/schoolDataService.js');
  assert.match(dataService, /notifications: \{ repository: schoolRepositories\.notifications \}/);
  assert.match(dataService, /notificationRoutingRules: \{ repository: schoolRepositories\.notificationRoutingRules \}/);

  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /collectionName: 'schoolNotifications'/);
  assert.match(repo, /collectionName: 'schoolNotificationRoutingRules'/);
  assert.match(repo, /assertQueryableCrudRepository\('schoolRepositories\.notifications'/);
  assert.match(repo, /assertQueryableCrudRepository\('schoolRepositories\.notificationRoutingRules'/);

  const listView = readText('packages/school/MVC/views/school/notification/list.ejs');
  const detailView = readText('packages/school/MVC/views/school/notification/detail.ejs');
  const routingView = readText('packages/school/MVC/views/school/notification/routing.ejs');
  assert.match(listView, /btn-row-actions-toggle/);
  assert.match(listView, /bi-three-dots-vertical/);
  assert.match(listView, /Assigned to me/);
  assert.match(listView, /Unassigned/);
  assert.match(listView, /Routing Rules/);
  assert.match(listView, /showMessageModal/);
  assert.match(detailView, /notification-lifecycle-timeline/);
  assert.match(detailView, /notificationTaskForm/);
  assert.match(detailView, /btnReassignNotification/);
  assert.match(detailView, /taskAssignedPersonId/);
  assert.match(detailView, /GenericPickerPresets\.person/);
  assert.match(detailView, /\/school\/notifications\/api\/eligible-persons/);
  assert.match(detailView, /showMessageModal/);
  assert.match(routingView, /notificationRoutingForm/);
  assert.match(routingView, /GenericPickerPresets\.person/);
  assert.match(routingView, /\/school\/notifications\/api\/eligible-persons/);
  assert.match(routingView, /showMessageModal/);
  assert.doesNotMatch(listView, /window\.alert|window\.confirm|window\.prompt/);
  assert.doesNotMatch(detailView, /window\.alert|window\.confirm|window\.prompt/);
  assert.doesNotMatch(routingView, /window\.alert|window\.confirm|window\.prompt/);
});

test('School notification ownership limits non-admin users to their assigned notifications and tasks', async (t) => {
  const notificationDataPath = path.join(ROOT, 'data/school/notifications.json');
  const originalNotifications = fs.existsSync(notificationDataPath) ? fs.readFileSync(notificationDataPath, 'utf8') : '[]';
  t.after(() => fs.writeFileSync(notificationDataPath, originalNotifications));
  fs.writeFileSync(notificationDataPath, '[]');

  const service = require('../packages/school/MVC/services/school/notificationService');

  const admin = {
    id: 'NOTIFICATION-ADMIN',
    personId: 'PERSON-ADMIN',
    activeOrgId: 'ORG-NOTIFICATION-OWNERSHIP',
    isSuperAdmin: true
  };
  const user = {
    id: 'NOTIFICATION-USER',
    personId: 'PERSON-USER',
    activeOrgId: 'ORG-NOTIFICATION-OWNERSHIP'
  };
  const outsider = {
    id: 'NOTIFICATION-OUTSIDER',
    personId: 'PERSON-OUTSIDER',
    activeOrgId: 'ORG-NOTIFICATION-OWNERSHIP'
  };

  const assignedRow = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-OWNERSHIP',
    sourceType: 'manual',
    sourceId: 'NR-ASSIGNED',
    title: 'Assigned notification',
    message: 'Only the assigned user may change this.',
    severity: 'warning',
    assignedPersonId: 'PERSON-USER',
    assignedPersonName: 'Person User'
  }, admin);
  const otherRow = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-OWNERSHIP',
    sourceType: 'manual',
    sourceId: 'NR-OTHER',
    title: 'Notification for another user',
    message: 'This should be blocked from other users.',
    severity: 'warning',
    assignedPersonId: 'PERSON-OUTSIDER',
    assignedPersonName: 'Person Outsider'
  }, admin);

  const updated = await service.updateNotificationStatus(user, assignedRow.id, { status: 'in_progress' });
  assert.equal(updated.status, 'in_progress');

  await assert.rejects(
    async () => service.updateNotificationStatus(user, otherRow.id, { status: 'resolved' }),
    /not authorized/i
  );

  const withTask = await service.addNotificationTask(admin, assignedRow.id, {
    title: 'Assigned task',
    description: 'Task should auto-start once assigned',
    assignedPersonId: 'PERSON-USER',
    assignedPersonName: 'Person User',
    dueDate: '2026-06-12'
  });
  const assignedTask = withTask.tasks.find((task) => task.title === 'Assigned task');
  assert.ok(assignedTask);
  assert.equal(assignedTask.status, 'in_progress');
  assert.ok(assignedTask.assignedAt);
  assert.ok(assignedTask.startedAt);

  await assert.rejects(
    async () => service.updateNotificationTask(outsider, assignedRow.id, assignedTask.id, { status: 'done' }),
    /not authorized/i
  );

  const completed = await service.updateNotificationTask(user, assignedRow.id, assignedTask.id, { status: 'done' });
  const completedTask = completed.tasks.find((task) => task.id === assignedTask.id);
  assert.equal(completedTask.status, 'done');
  assert.ok(completedTask.completedAt);
});

test('School notification service routes leave requests, falls back to unassigned, and tracks embedded tasks', async (t) => {
  const notificationDataPath = path.join(ROOT, 'data/school/notifications.json');
  const routingDataPath = path.join(ROOT, 'data/school/notificationRoutingRules.json');
  const originalNotifications = fs.existsSync(notificationDataPath) ? fs.readFileSync(notificationDataPath, 'utf8') : '[]';
  const originalRouting = fs.existsSync(routingDataPath) ? fs.readFileSync(routingDataPath, 'utf8') : '[]';
  t.after(() => {
    fs.writeFileSync(notificationDataPath, originalNotifications);
    fs.writeFileSync(routingDataPath, originalRouting);
  });
  fs.writeFileSync(notificationDataPath, '[]');
  fs.writeFileSync(routingDataPath, '[]');

  const service = require('../packages/school/MVC/services/school/notificationService');
  const routingService = require('../packages/school/MVC/services/school/notificationRoutingRuleService');
  const personDisplayNameService = require('../packages/school/MVC/services/school/personDisplayNameService');
  const expectedAssigneeName = await personDisplayNameService.resolvePersonDisplayName('144922', { fallback: '144922' });
  const actor = {
    id: 'TEST-NOTIFICATION-USER',
    personId: '144922',
    displayName: 'Notification Tester',
    activeOrgId: 'ORG-NOTIFICATION-TEST',
    isSuperAdmin: true
  };

  const rule = await routingService.saveRoutingRule(actor, {
    sourceType: 'leave_request',
    assigneePersonId: '144922',
    assigneePersonName: 'old username value',
    label: 'Leave Request Reviewer'
  });
  assert.equal(rule.sourceType, 'leave_request');
  assert.equal(rule.assigneePersonId, '144922');
  assert.equal(rule.assigneePersonName, expectedAssigneeName);

  const opened = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'leave_request',
    sourceId: 'LR-NOTIFICATION-TEST',
    sourceUrl: '/school/leave-requests/detail/LR-NOTIFICATION-TEST',
    title: 'Leave request needs review',
    message: 'A leave request was submitted.',
    severity: 'warning',
    taskTitle: 'Review leave request'
  }, actor);
  assert.equal(opened.status, 'open');
  assert.equal(opened.sourceType, 'leave_request');
  assert.equal(opened.sourceId, 'LR-NOTIFICATION-TEST');
  assert.equal(opened.assignedPersonId, '144922');
  assert.equal(opened.assignedPersonName, expectedAssigneeName);
  assert.equal(opened.tasks.length, 1);
  assert.equal(opened.tasks[0].status, 'in_progress');
  assert.equal(opened.tasks[0].assignedPersonId, '144922');
  assert.equal(opened.tasks[0].assignedPersonName, expectedAssigneeName);
  assert.equal(opened.lifecycle.at(-1).action, 'source_notification_created');

  const withTask = await service.addNotificationTask(actor, opened.id, {
    title: 'Check schedule conflicts',
    assignedPersonId: '144922',
    assignedPersonName: 'old username value',
    dueDate: '2026-06-12'
  });
  assert.equal(withTask.status, 'in_progress');
  assert.equal(withTask.tasks.length, 2);
  const addedTask = withTask.tasks.find((task) => task.title === 'Check schedule conflicts');
  assert.ok(addedTask, 'added task should be present');
  assert.equal(addedTask.assignedPersonId, '144922');
  assert.equal(addedTask.assignedPersonName, expectedAssigneeName);

  const updatedTask = await service.updateNotificationTask(actor, opened.id, addedTask.id, {
    status: 'done',
    note: 'Reviewed.'
  });
  assert.equal(updatedTask.tasks.find((task) => task.id === addedTask.id).status, 'done');
  assert.equal(updatedTask.lifecycle.at(-1).action, 'task_updated');

  const resolved = await service.resolveSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'leave_request',
    sourceId: 'LR-NOTIFICATION-TEST',
    action: 'leave_request_approved',
    note: 'Leave request approved.'
  }, actor);
  assert.equal(resolved.status, 'resolved');
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.tasks.every((task) => ['done', 'cancelled'].includes(task.status)), true);
  assert.equal(resolved.lifecycle.at(-1).action, 'leave_request_approved');

  const reopened = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'leave_request',
    sourceId: 'LR-NOTIFICATION-TEST',
    title: 'Leave request needs reapproval',
    message: 'The approved request was modified.',
    severity: 'warning'
  }, actor);
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.resolvedAt, '');
  assert.equal(reopened.assignedPersonId, '144922');
  assert.equal(reopened.tasks.at(-1).assignedPersonId, '144922');
  assert.equal(reopened.lifecycle.at(-1).action, 'source_notification_reopened');

  const fromLeave = await service.upsertLeaveRequestNotification({
    id: 'LR-NOTIFICATION-PERSON-NAME',
    orgId: 'ORG-NOTIFICATION-TEST',
    requesterPersonId: '144922',
    requesterName: '900000_student_1772254486524_1@sample.school.local',
    requesterRole: 'student',
    status: 'submitted',
    startDate: '2026-06-12',
    endDate: '2026-06-12'
  }, actor);
  assert.match(fromLeave.title, /Hossein Norouzi/);
  assert.match(fromLeave.message, /Hossein Norouzi/);
  assert.doesNotMatch(fromLeave.title, /@sample\.school\.local/);

  const assignedFirst = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'manual',
    sourceId: 'MANUAL-ASSIGNED-FIRST',
    title: 'Assigned first',
    message: 'Assigned to current user.',
    severity: 'info',
    assignedPersonId: '144922'
  }, actor);
  await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'manual',
    sourceId: 'MANUAL-UNASSIGNED-SECOND',
    title: 'Unassigned second',
    message: 'Unassigned row.',
    severity: 'info'
  }, actor);
  const visibleRows = await service.listVisibleNotifications(actor, {});
  assert.equal(visibleRows[0].id, assignedFirst.id, 'assigned open notifications for current user should sort first');

  await routingService.saveRoutingRule(actor, {
    id: rule.id,
    sourceType: 'leave_request',
    active: false,
    assigneePersonId: '',
    assigneePersonName: '',
    label: 'Leave Request Reviewer'
  });
  const unassignedLeave = await service.upsertSourceNotification({
    orgId: 'ORG-NOTIFICATION-TEST',
    sourceType: 'leave_request',
    sourceId: 'LR-NOTIFICATION-NO-ROUTE',
    title: 'Leave request without route',
    message: 'No routing rule should leave this unassigned.',
    severity: 'warning'
  }, actor);
  assert.equal(unassignedLeave.assignedPersonId, '');
  assert.equal(unassignedLeave.assignedPersonName, '');
  assert.notEqual(unassignedLeave.assignedRole, 'manager');

  const reassigned = await service.reassignNotification(actor, unassignedLeave.id, {
    assignedPersonId: '144922',
    assignedPersonName: 'old username value'
  });
  assert.equal(reassigned.assignedPersonId, '144922');
  assert.equal(reassigned.assignedPersonName, expectedAssigneeName);
  assert.equal(reassigned.lifecycle.at(-1).action, 'notification_reassigned');
});

test('School leave requests synchronize notification lifecycle events', () => {
  const leaveRequestService = readText('packages/school/MVC/services/school/leaveRequestService.js');
  assert.match(leaveRequestService, /notificationService\.upsertLeaveRequestNotification/);
  assert.match(leaveRequestService, /notificationService\.resolveLeaveRequestNotification/);
  assert.match(leaveRequestService, /leave_request_approved/);
  assert.match(leaveRequestService, /leave_request_rejected/);
  assert.match(leaveRequestService, /leave_request_cancelled/);
});

test('School notification Mongo seed is mirrored in package support metadata', () => {
  const support = readJson('packages/school/package.support-files.json');
  assert.ok((support.scripts || []).some((row) => (
    row.source === 'scripts/mongo-railway/insert-school-notification-section.mongosh.js' &&
    row.target === 'packages/school/scripts/maintenance/insert-school-notification-section.mongosh.js' &&
    row.targetStatus === 'package-mirrored'
  )));

  const seed = readText('scripts/mongo-railway/insert-school-notification-section.mongosh.js');
  assert.match(seed, /const SECTION_ID = '445576'/);
  assert.match(seed, /const SYMBOL_ID = 'SYM_SYSTEM_060'/);
  assert.match(seed, /scopeId: 'SCP_ORG'/);
  assert.match(seed, /SCHOOL_STAFF/);
  assert.doesNotMatch(seed, /orgSymbols|organizationSymbols/);
});
