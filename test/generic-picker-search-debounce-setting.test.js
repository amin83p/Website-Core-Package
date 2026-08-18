const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('system settings define generic picker search debounce default', () => {
  const model = require('../MVC/models/systemSettingsModel');

  assert.equal(model.DEFAULTS.app.genericPickerSearchDebounceMs, 400);
});

test('app settings renders generic picker search delay control', () => {
  const view = read('MVC/views/systemSettings/appSettings.ejs');

  assert.match(view, /Generic Picker Search Delay/);
  assert.match(view, /name="genericPickerSearchDebounceMs"/);
  assert.match(view, /min="0"/);
  assert.match(view, /max="2000"/);
});

test('layout exposes sanitized app UI settings for browser scripts', () => {
  const layout = read('MVC/views/layouts/layout.ejs');

  assert.match(layout, /window\.__APP_UI_SETTINGS__/);
  assert.match(layout, /genericPickerSearchDebounceMs:\s*400/);
});

test('generic picker uses configurable debounce instead of hard-coded 300ms search delay', () => {
  const picker = read('MVC/views/partials/modal_GenericPicker.ejs');

  assert.match(picker, /DEFAULT_SEARCH_DEBOUNCE_MS\s*=\s*400/);
  assert.match(picker, /function getSearchDebounceMs\(\)/);
  assert.match(picker, /currentConfig\.searchDebounceMs/);
  assert.match(picker, /window\.__APP_UI_SETTINGS__/);
  assert.match(picker, /genericPickerSearchDebounceMs/);
  assert.match(picker, /function clearSearchDebounce\(\)/);
  assert.match(picker, /hidden\.bs\.modal/);
  assert.doesNotMatch(picker, /setTimeout\(\(\) => \{ fetchData\(term\); \}, 300\)/);
});

test('generic picker supports initialSearchTerm prefill and search', () => {
  const picker = read('MVC/views/partials/modal_GenericPicker.ejs');

  assert.match(picker, /initialSearchTerm/);
  assert.match(picker, /scheduleSearch\(initialTerm\)/);
});
