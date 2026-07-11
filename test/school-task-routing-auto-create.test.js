const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const routingRuleModel = require('../packages/school/MVC/models/school/taskRoutingRuleModel');
const taskModel = require('../packages/school/MVC/models/school/taskModel');
const taskService = require('../packages/school/MVC/services/school/taskService');
const taskRoutingRuleService = require('../packages/school/MVC/services/school/taskRoutingRuleService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('TASK_ROUTING_SOURCE_TYPES excludes manual', () => {
  assert.deepEqual(routingRuleModel.TASK_ROUTING_SOURCE_TYPES, [
    'leave_request',
    'student_session_case',
    'timesheet'
  ]);
  assert.ok(taskModel.TASK_SOURCE_TYPES.includes('manual'));
});

test('formatTaskSourceTypeLabel capitalizes the first letter only', () => {
  assert.equal(taskModel.formatTaskSourceTypeLabel('leave_request'), 'Leave request');
  assert.equal(taskModel.formatTaskSourceTypeLabel('student_session_case'), 'Student session case');
  assert.equal(taskModel.formatTaskSourceTypeLabel('timesheet'), 'Timesheet');
});

test('upsertSourceTask skips create when no active routing rule exists', async () => {
  const originals = {
    getActiveRuleForSource: taskRoutingRuleService.getActiveRuleForSource,
    list: schoolRepositories.tasks.list,
    create: schoolRepositories.tasks.create,
    update: schoolRepositories.tasks.update
  };
  let createCalled = false;
  try {
    taskRoutingRuleService.getActiveRuleForSource = async () => null;
    schoolRepositories.tasks.list = async () => [];
    schoolRepositories.tasks.create = async (payload) => {
      createCalled = true;
      return payload;
    };
    schoolRepositories.tasks.update = async (_id, payload) => payload;

    const result = await taskService.upsertSourceTask({
      orgId: '900000',
      sourceType: 'student_session_case',
      sourceId: 'SSC-1',
      title: 'Student case',
      message: 'Needs review'
    }, { id: 'USR-1', activeOrgId: '900000' });

    assert.equal(result, null);
    assert.equal(createCalled, false);
  } finally {
    taskRoutingRuleService.getActiveRuleForSource = originals.getActiveRuleForSource;
    schoolRepositories.tasks.list = originals.list;
    schoolRepositories.tasks.create = originals.create;
    schoolRepositories.tasks.update = originals.update;
  }
});

test('upsertSourceTask creates task when active routing rule exists', async () => {
  const originals = {
    getActiveRuleForSource: taskRoutingRuleService.getActiveRuleForSource,
    list: schoolRepositories.tasks.list,
    create: schoolRepositories.tasks.create,
    update: schoolRepositories.tasks.update
  };
  let createdPayload = null;
  try {
    taskRoutingRuleService.getActiveRuleForSource = async () => ({
      assigneePersonId: 'STAFF-1',
      assigneePersonName: 'Staff One',
      label: 'Student Case Reviewer'
    });
    schoolRepositories.tasks.list = async () => [];
    schoolRepositories.tasks.create = async (payload) => {
      createdPayload = payload;
      return { id: 'TSK-1', ...payload };
    };
    schoolRepositories.tasks.update = async (_id, payload) => payload;

    const result = await taskService.upsertSourceTask({
      orgId: '900000',
      sourceType: 'student_session_case',
      sourceId: 'SSC-1',
      title: 'Student case',
      message: 'Needs review'
    }, { id: 'USR-1', activeOrgId: '900000' });

    assert.ok(result);
    assert.equal(createdPayload.assignedPersonId, 'STAFF-1');
    assert.equal(createdPayload.sourceType, 'student_session_case');
  } finally {
    taskRoutingRuleService.getActiveRuleForSource = originals.getActiveRuleForSource;
    schoolRepositories.tasks.list = originals.list;
    schoolRepositories.tasks.create = originals.create;
    schoolRepositories.tasks.update = originals.update;
  }
});

test('applyRoutingRule assigns active rule for timesheet source type', async () => {
  const original = taskRoutingRuleService.getActiveRuleForSource;
  try {
    taskRoutingRuleService.getActiveRuleForSource = async () => ({
      assigneePersonId: 'STAFF-2',
      assigneePersonName: 'Staff Two',
      label: 'Timesheet Reviewer'
    });
    const routed = await taskService._private.applyRoutingRule({
      orgId: '900000',
      sourceType: 'timesheet',
      sourceId: 'TS-1'
    }, { id: 'USR-1', activeOrgId: '900000' });
    assert.equal(routed.assignedPersonId, 'STAFF-2');
    assert.equal(routed.assignedRole, 'Timesheet Reviewer');
  } finally {
    taskRoutingRuleService.getActiveRuleForSource = original;
  }
});

test('leave request service wires task sync on create and resolve flows', () => {
  const source = read('packages/school/MVC/services/school/leaveRequestService.js');
  assert.match(source, /await syncLeaveRequestTask\('upsert', created, reqUser\)/);
  assert.match(source, /await syncLeaveRequestTask\('resolve', updated, reqUser/);
  assert.match(source, /syncLeaveRequestTask,/);
  assert.match(source, /requireActiveRoutingRule: false/);
});

test('routing and task views use formatSourceTypeLabel', () => {
  const routingSource = read('packages/school/MVC/views/school/task/routing.ejs');
  const listSource = read('packages/school/MVC/views/school/task/list.ejs');
  const detailSource = read('packages/school/MVC/views/school/task/detail.ejs');
  const controllerSource = read('packages/school/MVC/controllers/school/taskController.js');

  assert.match(routingSource, /formatSourceTypeLabel/);
  assert.match(listSource, /formatSourceTypeLabel/);
  assert.match(detailSource, /formatSourceTypeLabel/);
  assert.match(controllerSource, /formatSourceTypeLabel:\s*taskModel\.formatTaskSourceTypeLabel/);
});

test('timesheet controller syncs school tasks on submit and resolve', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(source, /upsertTimesheetTask/);
  assert.match(source, /resolveTimesheetTask/);
});
