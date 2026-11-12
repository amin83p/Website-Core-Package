const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../MVC/services/school/enrollmentCloseReasonPolicyService');

const rollingSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);

test('DEFAULT_REASONS are enrollment close / finish items, not attendance excuses', () => {
  assert.equal(service.DEFAULT_REASONS.length, 12);
  assert.ok(service.DEFAULT_REASONS.includes('Completed program requirements.'));
  assert.ok(service.DEFAULT_REASONS.includes('Funding or claim period ended.'));
  assert.doesNotMatch(
    service.DEFAULT_REASONS.join('\n'),
  /sick|doctor|appointment/i
  );
});

test('normalizeReasons trims, dedupes case-insensitively, and caps length', () => {
  const rows = service.normalizeReasons([' Completed. ', 'completed.', '  ', 'B'.repeat(250)]);
  assert.deepEqual(rows, ['Completed.', 'B'.repeat(200)]);
});

test('resolvePolicy falls back to defaults when org has no custom list', () => {
  const resolved = service.resolvePolicy(null);
  assert.equal(resolved.usesCustomList, false);
  assert.equal(resolved.reasons.length, 12);
  assert.deepEqual(resolved.reasons, service.sortReasonsForDisplay([...service.DEFAULT_REASONS]));
});

test('Rolling enrollment uses enrollment close reason picker, not attendance excuses', () => {
  assert.match(rollingSource, /enrollmentCloseReasonPickerClient\.js/);
  assert.match(rollingSource, /installEnrollmentCloseReasonPicker/);
  assert.match(rollingSource, /enrollmentCloseReasonPickerModal/);
  assert.doesNotMatch(rollingSource, /attendanceExcuseReasonPickerClient\.js/);
  assert.doesNotMatch(rollingSource, /installAttendanceExcuseReasonPicker/);
  assert.match(rollingSource, /Pick a frequent enrollment close reason/);
});
