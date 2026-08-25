const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('generic picker exposes recent picks UI hooks', () => {
  const picker = read('MVC/views/partials/modal_GenericPicker.ejs');

  assert.match(picker, /id="gp-recent-section"/);
  assert.match(picker, /id="gp-recent-chips"/);
  assert.match(picker, /function recentPicksStorageKey/);
  assert.match(picker, /genericPicker\.recent:\$\{userId\}:\$\{orgId\}:\$\{key\}/);
  assert.match(picker, /RECENT_PICKS_LIMIT\s*=\s*5/);
  assert.match(picker, /function rememberRecentPick/);
  assert.match(picker, /function renderRecentChips/);
  assert.match(picker, /function selectRecentPick/);
  assert.match(picker, /renderRecentChips\(\)/);
  assert.match(picker, /rememberRecentPick\(currentRecentResourceKey,\s*item\)/);
});

test('generic picker presets export inferName for recent resource keys', () => {
  const presets = read('public/scripts/genericPickerPresets.js');

  assert.match(presets, /function inferName\(/);
  assert.match(presets, /inferName,/);
});

test('generic picker recent label resolves teacher first and last name', () => {
  const picker = read('MVC/views/partials/modal_GenericPicker.ejs');

  assert.match(picker, /function resolveRecentPickDisplayName/);
  assert.match(picker, /item\?\.name\?\.first \|\| item\?\.firstName/);
  assert.match(picker, /item\?\.name\?\.last \|\| item\?\.lastName/);
  assert.match(picker, /resolveRecentPickDisplayName\(item\) \|\| String\(item\?\.id/);
  assert.match(picker, /snapshot\.displayName = displayName/);
});
