const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timezoneUtils = require('../MVC/utils/timezoneUtils');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('normalizeTimezoneToken accepts valid IANA zones and falls back for invalid values', () => {
  assert.equal(timezoneUtils.normalizeTimezoneToken('America/Edmonton', 'UTC'), 'America/Edmonton');
  assert.equal(timezoneUtils.normalizeTimezoneToken('Asia/Tehran', 'UTC'), 'Asia/Tehran');
  assert.equal(timezoneUtils.normalizeTimezoneToken('Not/A_Real_Zone', 'UTC'), 'UTC');
  assert.equal(timezoneUtils.isValidTimezoneToken('America/Edmonton'), true);
  assert.equal(timezoneUtils.isValidTimezoneToken('Not/A_Real_Zone'), false);
});

test('parseOrganizationTimezoneInput resolves default, curated, and custom values', () => {
  const fallback = 'UTC';
  assert.deepEqual(timezoneUtils.parseOrganizationTimezoneInput({ timeZone: '__default__' }, fallback), {
    timeZone: 'UTC',
    error: ''
  });
  assert.deepEqual(timezoneUtils.parseOrganizationTimezoneInput({ timeZone: 'America/Edmonton' }, fallback), {
    timeZone: 'America/Edmonton',
    error: ''
  });
  assert.deepEqual(timezoneUtils.parseOrganizationTimezoneInput({
    timeZone: '__custom__',
    timeZoneCustom: 'Asia/Tehran'
  }, fallback), {
    timeZone: 'Asia/Tehran',
    error: ''
  });
  assert.match(
    timezoneUtils.parseOrganizationTimezoneInput({
      timeZone: '__custom__',
      timeZoneCustom: 'Invalid/Zone'
    }, fallback).error,
    /valid IANA timezone/i
  );
});

test('listCuratedTimezoneOptions returns grouped timezone choices', () => {
  const options = timezoneUtils.listCuratedTimezoneOptions();
  assert.ok(options.length >= 20);
  assert.ok(options.some((row) => row.value === 'America/Edmonton'));
  assert.ok(options.some((row) => row.value === 'Asia/Tehran'));
  assert.ok(options.every((row) => row.group && row.label && row.value));
});

test('formatNowInTimezone returns readable text for valid zones', () => {
  const formatted = timezoneUtils.formatNowInTimezone('UTC');
  assert.match(formatted, /20\d{2}/);
});

test('organization controller persists settings.timeZone from timezone input', () => {
  const controller = read('MVC/controllers/organizationController.js');
  assert.match(controller, /parseOrganizationTimezoneInput/);
  assert.match(controller, /timeZone:\s*timezoneResult\.timeZone/);
  assert.match(controller, /buildOrganizationFormViewModel/);
  assert.match(controller, /listCuratedTimezoneOptions/);
  assert.match(controller, /resolveDefaultTimezone/);
});

test('organization form exposes timezone select, custom input, and preview', () => {
  const form = read('MVC/views/organization/organizationForm.ejs');
  assert.match(form, /name="timeZone"/);
  assert.match(form, /name="timeZoneCustom"/);
  assert.match(form, /orgTimeZoneSelect/);
  assert.match(form, /orgTimeZoneCustom/);
  assert.match(form, /orgTimeZonePreview/);
  assert.match(form, /formatTimezonePreview/);
  assert.match(form, /Locale \/ Time/);
  assert.match(form, /__custom__/);
});

test('organization model validates settings.timeZone as IANA token', () => {
  const model = read('MVC/models/organizationModel.js');
  assert.match(model, /isValidTimezoneToken/);
  assert.match(model, /settings\.timeZone must be a valid IANA timezone/);
});
