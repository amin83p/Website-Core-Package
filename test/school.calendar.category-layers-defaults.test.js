const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('calendar view uses category layers and saved layer preferences', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /data-layer-kind="activity-category"/);
  assert.match(view, /function defaultLayers\(\)/);
  assert.match(view, /DEFAULT_BASE_LAYERS = \['school_days_off', 'timesheet_deadlines'\]/);
  assert.match(view, /window\.localStorage\.getItem\(layerStorageKey\)/);
  assert.match(view, /window\.localStorage\.setItem\(layerStorageKey,\s*JSON\.stringify\(selectedLayers\(\)\)\)/);
  assert.match(view, /function updateRoleLayerVisibility\(roleKeys = \[\]\)/);
});

test('calendar controller passes category layers and storage key', () => {
  const controller = read('packages/school/MVC/controllers/school/calendarController.js');

  assert.match(controller, /calendarActivityCategories:/);
  assert.match(controller, /layerKey:\s*schoolCalendarService\.buildActivityCategoryLayerKey/);
  assert.match(controller, /calendarLayerStorageKey:\s*`schoolCalendar:selectedLayers:/);
});

test('calendar service filters activity events by category layer keys', () => {
  const service = read('packages/school/MVC/services/school/schoolCalendarService.js');

  assert.match(service, /ACTIVITY_CATEGORY_LAYER_PREFIX/);
  assert.match(service, /function buildActivityCategoryLayerKey\(categoryId\)/);
  assert.match(service, /function parseSelectedActivityCategoryIds\(selectedLayers = new Set\(\)\)/);
  assert.match(service, /getActivityEventsByCategoryLayers/);
  assert.match(service, /selectedActivityCategoryIds = parseSelectedActivityCategoryIds\(selectedLayers\)/);
});
