const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('calendar view uses fixed activity layers and saved layer preferences', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /value="school_public_activities"/);
  assert.match(view, /value="my_assigned_activities"/);
  assert.match(view, /data-layer-kind="activity-fixed"/);
  assert.match(view, /function defaultLayers\(\)/);
  assert.match(view, /DEFAULT_BASE_LAYERS = \['school_days_off', 'timesheet_deadlines', 'school_public_activities', 'my_assigned_activities'\]/);
  assert.match(view, /window\.localStorage\.getItem\(layerStorageKey\)/);
  assert.match(view, /window\.localStorage\.setItem\(layerStorageKey,\s*JSON\.stringify\(selectedLayers\(\)\)\)/);
  assert.match(view, /function updateRoleLayerVisibility\(roleKeys = \[\]\)/);
  assert.match(view, /function syncAssignedActivitiesLayerState\(\)/);
});

test('calendar controller passes storage key without category layers', () => {
  const controller = read('packages/school/MVC/controllers/school/calendarController.js');

  assert.doesNotMatch(controller, /calendarActivityCategories:/);
  assert.match(controller, /calendarLayerStorageKey:\s*`schoolCalendar:selectedLayers:/);
});

test('calendar service exposes public and assigned activity fetchers', () => {
  const service = read('packages/school/MVC/services/school/schoolCalendarService.js');

  assert.match(service, /SCHOOL_PUBLIC_ACTIVITIES:\s*'school_public_activities'/);
  assert.match(service, /MY_ASSIGNED_ACTIVITIES:\s*'my_assigned_activities'/);
  assert.match(service, /function getPublicSchoolActivityEvents/);
  assert.match(service, /function getAssignedActivityEventsForPerson/);
  assert.match(service, /function buildAssignedActivityTitle/);
  assert.match(service, /selectedLayers\.has\(LAYER_KEYS\.SCHOOL_PUBLIC_ACTIVITIES\)/);
  assert.match(service, /selectedLayers\.has\(LAYER_KEYS\.MY_ASSIGNED_ACTIVITIES\)/);
  assert.doesNotMatch(service, /selectedActivityCategoryIds = parseSelectedActivityCategoryIds/);
});
