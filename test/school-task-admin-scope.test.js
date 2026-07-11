const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const adminChekersService = require('../MVC/services/adminChekersService');
const personDisplayNameService = require('../packages/school/MVC/services/school/personDisplayNameService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const taskService = require('../packages/school/MVC/services/school/taskService');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('listVisibleTasks filters admin rows to assignment=mine', async () => {
  const originals = {
    list: schoolRepositories.tasks.list,
    isAdminForRequest: adminChekersService.isAdminForRequest,
    getUserPersonId: personDisplayNameService.getUserPersonId
  };

  const rows = [
    { id: 'TASK-1', assignedPersonId: 'P-ADMIN', status: 'open', audit: {} },
    { id: 'TASK-2', assignedPersonId: 'P-OTHER', status: 'open', audit: {} },
    { id: 'TASK-3', assignedPersonId: '', status: 'open', audit: {} }
  ];

  try {
    schoolRepositories.tasks.list = async () => rows;
    adminChekersService.isAdminForRequest = () => true;
    personDisplayNameService.getUserPersonId = () => 'P-ADMIN';

    const adminUser = {
      id: 'U-ADMIN',
      personId: 'P-ADMIN',
      activeOrgId: '900000',
      activeProfile: { active: true, orgId: '900000', sections: [] }
    };

    const allVisible = await taskService.listVisibleTasks(adminUser, {});
    assert.equal(allVisible.length, 3);

    const mineVisible = await taskService.listVisibleTasks(adminUser, { assignment: 'mine' });
    assert.deepEqual(mineVisible.map((row) => row.id), ['TASK-1']);
  } finally {
    schoolRepositories.tasks.list = originals.list;
    adminChekersService.isAdminForRequest = originals.isAdminForRequest;
    personDisplayNameService.getUserPersonId = originals.getUserPersonId;
  }
});

test('getTaskSummary forwards req.query to getActiveUserTasks', () => {
  const source = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');
  assert.match(source, /async function getTaskSummary\(req\)/);
  assert.match(source, /getActiveUserTasks\(req,\s*req\.query\s*\|\|\s*\{\}\)/);
});

test('task list and master hub expose admin show-all scope toggle', () => {
  const listView = read('packages/school/MVC/views/school/task/list.ejs');
  const hubView = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(listView, /taskAdminShowAllSwitch/);
  assert.match(listView, /school_tasks_admin_show_all/);
  assert.match(hubView, /hubTaskAdminShowAllSwitch/);
  assert.match(hubView, /school_tasks_admin_show_all/);
  assert.match(hubView, /data-can-manage-all-tasks/);
});
