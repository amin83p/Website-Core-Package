const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);

function functionSource(name, nextName) {
  const start = viewSource.indexOf(`function ${name}`);
  const end = viewSource.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return viewSource.slice(start, end);
}

test('New Enrollment Period validates dates only after the date field loses focus', () => {
  assert.match(viewSource, /qs\('inp_startDate'\)\?\.addEventListener\('blur', handleEnrollmentDateBlur\)/);
  assert.match(viewSource, /qs\('inp_endDate'\)\?\.addEventListener\('blur', handleEnrollmentDateBlur\)/);
  assert.doesNotMatch(viewSource, /qs\('inp_startDate'\)\?\.addEventListener\('change'/);
  assert.doesNotMatch(viewSource, /qs\('inp_endDate'\)\?\.addEventListener\('change'/);
});

test('date blur validation returns focus to the invalid date and avoids follow-up requests', () => {
  const handler = functionSource('handleEnrollmentDateBlur', 'validateCycleRegistrationDate');
  const validation = functionSource('validateEnrollmentDatesAfterLeavingField', 'handleEnrollmentDateBlur');
  const focus = functionSource('focusInvalidEnrollmentDateInput', 'validateEnrollmentDatesAfterLeavingField');

  assert.match(handler, /await showMsg\('Invalid enrollment date', 'warning', validation\.message\)/);
  assert.match(handler, /setEnrollmentDateValidationState\(validation\.input\)/);
  assert.match(handler, /focusInvalidEnrollmentDateInput\(validation\.input\)/);
  assert.match(handler, /setEnrollmentDateValidationState\(null\)/);
  assert.match(focus, /input\.isConnected && !input\.disabled/);
  assert.match(focus, /input\.focus\(\)/);
  assert.match(handler, /refreshRollingEligibility\(\)/);
  assert.match(handler, /scheduleAlignmentRefresh\(\)/);
  assert.match(validation, /endDate < startDate/);
  assert.match(validation, /Enrollment end date cannot be before the enrollment start date/);
});
