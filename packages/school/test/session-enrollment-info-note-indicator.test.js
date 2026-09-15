const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

test('session manager defines enrollment info note style sync helper', () => {
  assert.match(viewSource, /function syncEnrollmentInfoTriggerNoteStyle/);
  assert.match(viewSource, /enrollment-info-trigger-has-note/);
});

test('session manager highlights enrollment info button when note exists on render', () => {
  assert.match(viewSource, /hasEnrollmentNote/);
  assert.match(viewSource, /hasEnrollmentNote \? 'btn-warning text-dark enrollment-info-trigger-has-note'/);
  assert.match(viewSource, /bi-info-circle-fill/);
});

test('session manager updates enrollment info button style after note save', () => {
  assert.match(viewSource, /syncEnrollmentInfoTriggerNoteStyle\(activeEnrollmentInfoTrigger, savedNotes\)/);
  assert.match(viewSource, /querySelectorAll\('\.js-enrollment-info-trigger'\)/);
});
