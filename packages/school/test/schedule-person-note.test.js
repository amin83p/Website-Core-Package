const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schedulePersonNoteService = require('../MVC/services/school/schedulePersonNoteService');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('schedulePersonNoteService normalizes and validates notes', () => {
  assert.equal(schedulePersonNoteService.normalizeNoteText('  hello  '), 'hello');
  assert.equal(schedulePersonNoteService.normalizeNoteText(''), '');
  assert.throws(
    () => schedulePersonNoteService.normalizeNoteText('x'.repeat(schedulePersonNoteService.MAX_NOTE_LENGTH + 1)),
    /cannot exceed/
  );
  const stored = schedulePersonNoteService.buildStoredNote('Note text', 'USR_1');
  assert.equal(stored.note, 'Note text');
  assert.equal(stored.updatedBy, 'USR_1');
  assert.ok(stored.updatedAt);
  assert.equal(schedulePersonNoteService.buildStoredNote('   ', 'USR_1'), null);
});

test('schedule person note API and viewer wiring are present', () => {
  const routes = read('MVC/routes/scheduleRoutes.js');
  const controller = read('MVC/controllers/school/scheduleController.js');
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const noteScript = read('public/scripts/masterSchedulePersonNote.js');

  assert.match(routes, /\/api\/person-schedule-note/);
  assert.match(controller, /getPersonScheduleNote/);
  assert.match(controller, /savePersonScheduleNote/);
  assert.match(controller, /schedulePersonNoteModel/);
  assert.match(view, /data-schedule-admin-action="person-schedule-note"/);
  assert.match(view, /schedulePersonNoteModal/);
  assert.match(view, /masterSchedulePersonNote\.js/);
  assert.match(viewer, /bindPersonScheduleNoteRail/);
  assert.match(viewer, /notifyActiveSchedulePersonChanged/);
  assert.match(viewer, /person-schedule-note/);
  assert.match(noteScript, /person-schedule-note/);
  assert.match(noteScript, /bindActiveSchedulePersonChangeListener/);
});
