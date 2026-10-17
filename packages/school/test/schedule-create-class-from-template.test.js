const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoPublicRoot = path.resolve(__dirname, '../../../public');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('create class from template rail is wired on master schedule', () => {
  const view = read('MVC/views/school/schedule/partials/personScheduleCalendarShell.ejs');
  const controller = read('MVC/controllers/school/scheduleController.js');
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const script = read('public/scripts/masterScheduleCreateClassFromTemplate.js');
  const modalScript = fs.readFileSync(path.join(repoPublicRoot, 'scripts/classCreateFromTemplateModal.js'), 'utf8');

  const toggleAt = view.indexOf('data-schedule-admin-action="toggle-on-screen-manage"');
  const createAt = view.indexOf('data-schedule-admin-action="create-class-from-template"');
  const enrollAt = view.indexOf('data-schedule-admin-action="enroll-students"');
  const addCoAt = view.indexOf('data-schedule-admin-action="add-co-teacher"');
  const claimAt = view.indexOf('data-schedule-admin-action="claim-numbers"');
  assert.ok(toggleAt >= 0);
  assert.ok(createAt > toggleAt);
  assert.ok(enrollAt > createAt);
  assert.ok(addCoAt > enrollAt);
  assert.ok(claimAt > addCoAt);

  const adminBundle = [
    read('MVC/views/school/schedule/personScheduleAdmin.ejs'),
    read('MVC/views/school/schedule/partials/personScheduleScriptsAdmin.ejs')
  ].join('\n');
  assert.match(adminBundle, /showCreateClassFromTemplateModal/);
  assert.match(adminBundle, /classCreateFromTemplateModal/);
  assert.match(adminBundle, /masterScheduleCreateClassFromTemplate\.js/);

  assert.match(controller, /includeClassCreateFromTemplateModal:\s*canCreateClasses/);
  assert.match(controller, /canCreateOrgScopedItem/);

  assert.match(viewer, /create-class-from-template/);
  assert.match(viewer, /toggle-on-screen-manage/);
  assert.match(viewer, /isScheduleOnScreenManageEnabled/);
  assert.match(viewer, /installMasterScheduleCreateClassFromTemplate/);
  assert.match(viewer, /bindCreateClassFromTemplateRail/);

  assert.match(script, /selectedScheduleRole/);
  assert.match(script, /activeSchedulePerson/);
  assert.match(script, /teacherPersonId/);
  assert.match(script, /redirectOnSuccess:\s*false/);

  assert.match(modalScript, /openOptions\.teacherPersonId/);
});
