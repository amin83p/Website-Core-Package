const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('master academia hub keeps holidays workspace wiring without a section button', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const holidayButtonIndex = viewSource.indexOf('data-hub-workspace-section="holidays"');

  assert.equal(holidayButtonIndex, -1, 'Holidays button should remain removed from the section strip.');
  assert.match(viewSource, /function renderHolidayWorkspace\(payload\)/);
  assert.match(viewSource, /function renderHolidayRows\(rows\)/);
  assert.match(viewSource, /id="hubHolidayYear"/);
  assert.match(viewSource, /data-hub-holiday-edit/);
  assert.match(viewSource, /data-hub-holiday-delete/);
  assert.match(viewSource, /function saveHubHoliday\(\)/);
  assert.match(viewSource, /function deleteHubHoliday\(id,\s*title\)/);
  assert.match(viewSource, /requestQuery\.set\('year',\s*workspaceState\.holidaysYear/);
  assert.match(viewSource, /endpoint:\s*'\/school\/master-hub\/api\/workspace\/holidays'/);
  assert.match(viewSource, /renderHolidayWorkspace\(payload\)/);
});

test('master academia hub holidays workspace is access scoped and data backed', () => {
  const routeSource = read('packages/school/MVC/routes/schoolMasterAcademiaHubRoutes.js');
  const serviceSource = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(routeSource, /SECTIONS\.SCHOOL_HOLIDAYS/);
  assert.match(serviceSource, /key === 'holidays'/);
  assert.match(serviceSource, /sectionId:\s*SECTIONS\.SCHOOL_HOLIDAYS/);
  assert.match(serviceSource, /dataService\.fetchData\('holidays'/);
  assert.match(serviceSource, /resolveHolidayYear/);
  assert.match(serviceSource, /row\.date[\s\S]*startsWith\(targetYear\)/);
  assert.match(serviceSource, /normalizeHolidayRows\(rows\)/);
});
