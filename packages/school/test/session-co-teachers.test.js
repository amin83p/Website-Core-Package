const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sessionDeliveryTeamService = require('../MVC/services/school/sessionDeliveryTeamService');

const ROOT = path.resolve(__dirname, '../../..');

function readPackage(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'packages/school', relativePath), 'utf8');
}

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
  const session = {
    delivery: {
      deliveredBy: 'MAIN',
      deliveredByName: 'Main Teacher',
      coTeachers: [
        { personId: 'CO_VIEW', name: 'Viewer', canEdit: false },
        { personId: 'CO_EDIT', name: 'Editor', canEdit: true }
      ]
    }
  };

  assert.equal(sessionDeliveryTeamService.isPersonSessionMainTeacher(session, 'MAIN'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionViewer(session, 'CO_VIEW'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(session, 'CO_VIEW'), false);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(session, 'CO_EDIT'), true);
  assert.equal(sessionDeliveryTeamService.isPersonSessionEditor(session, 'MAIN'), true);
  assert.deepEqual(
    sessionDeliveryTeamService.getSessionDeliveryPersonIds(session),
    ['MAIN', 'CO_VIEW', 'CO_EDIT']
  );
});

test('session builder and manager UI wire co-teacher controls', () => {
  const classForm = readPackage('MVC/views/school/class/classForm.ejs');
  const sessionManager = readPackage('MVC/views/school/class/sessionManager.ejs');
  const access = readPackage('MVC/services/school/schoolRecordAccessService.js');
  const timesheetEditor = readPackage('MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(classForm, /bulk_applyCoTeachersBtn/);
  assert.match(classForm, /sessionsSelectAll/);
  assert.match(classForm, /coTeachers/);
  assert.match(sessionManager, /sessionCanManageCoTeachers/);
  assert.match(sessionManager, /session-co-can-edit/);
  assert.match(sessionManager, /payload\.coTeachers/);
  assert.match(access, /isPersonSessionEditor/);
  assert.match(access, /viewSession/);
  assert.match(timesheetEditor, /isCoTeacherSession|Co-Teacher/i);
});

test('class save and session metadata accept coTeachers', () => {
  const controller = readPackage('MVC/controllers/school/classController.js');
  assert.match(controller, /normalizeSessionCoTeachers/);
  assert.match(controller, /canManageCoTeachers/);
  assert.match(controller, /body\.coTeachers/);
  assert.match(controller, /sessionCoTeachers/);
});
