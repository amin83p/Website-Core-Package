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
  assert.match(viewSource, /enrollment-info-trigger-has-note/);
  assert.match(viewSource, /bi-info-circle-fill/);
});

test('session manager updates enrollment info button style after note save', () => {
  assert.match(viewSource, /syncEnrollmentInfoTriggerStyle\(activeEnrollmentInfoTrigger, savedNotes\)/);
  assert.match(viewSource, /querySelectorAll\('\.js-enrollment-info-trigger'\)/);
});

test('session manager supports enrollment finish alert button styling', () => {
  assert.match(viewSource, /enrollment-info-trigger-alert/);
  assert.match(viewSource, /data-enrollment-alert-active/);
  assert.match(viewSource, /attendanceEnrollmentInfoAlert/);
  assert.match(viewSource, /btn-danger text-white enrollment-info-trigger-alert/);
});

test('session manager highlights enrollment info button for continuation with green broadcast', () => {
  assert.match(viewSource, /enrollment-info-trigger-continuing/);
  assert.match(viewSource, /enrollment-info-trigger--broadcast/);
  assert.match(viewSource, /enrollment-info-trigger-rings/);
});

test('session manager uses dual red-green styling when finishing and continuation overlap', () => {
  assert.match(viewSource, /enrollment-info-trigger-dual/);
  assert.match(viewSource, /enrollmentFinishAlertActive && hasUpcomingEnrollmentPeriods/);
});

test('session manager wires upcoming enrollment in info modal', () => {
  assert.match(viewSource, /data-enrollment-upcoming-periods/);
  assert.match(viewSource, /id="attendanceEnrollmentInfoUpcomingSection"/);
  assert.match(viewSource, /function renderEnrollmentUpcomingPeriods/);
  assert.match(viewSource, /Continuing in this class/);
});

test('enrollment info modal shows current CLB only', () => {
  const block = viewSource.slice(
    viewSource.indexOf('function renderEnrollmentClbGrid'),
    viewSource.indexOf('function formatEnrollmentFinishDate')
  );
  assert.doesNotMatch(block, /Goal/);
  assert.doesNotMatch(block, /goalSkills/);
  assert.match(block, /currentSkills/);
});
