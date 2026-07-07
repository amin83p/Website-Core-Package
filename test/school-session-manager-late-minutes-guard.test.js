const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('session manager opens attendance details and focuses late minutes when individual Late is selected without minutes', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.ok(source.includes('function openLateDetailsForRow(row)'));
  assert.ok(source.includes('openDetailsModal(personId, getRosterStudentName(row));'));
  assert.ok(source.includes('function focusLateInputInDetailsModal()'));
  assert.ok(source.includes('lateInput.focus();'));
  assert.ok(source.includes("if (e.target.value === 'late' && isLateMissingMinutes(row))"));
  assert.ok(source.includes('openLateDetailsForRow(row);'));
});

test('session manager blocks Save Session when Late rows have no late or early minutes', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.ok(source.includes('.roster-row.attendance-late-missing-minutes'));
  assert.ok(source.includes('function getLateMissingMinuteRows()'));
  assert.ok(source.includes('const lateMissingRows = getLateMissingMinuteRows();'));
  assert.ok(source.includes('await showLateMinutesRequiredWarning(lateMissingRows, { openFirst: true });'));
  assert.ok(source.includes('return;'));
});

test('session manager bulk All Late shows one guidance warning instead of opening many modals', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.ok(source.includes("btnAllLateGb.addEventListener('click', async () => {"));
  assert.ok(source.includes("applyBulkAttendance('late');"));
  assert.ok(source.includes('showLateMinutesRequiredWarning(getLateMissingMinuteRows(), { openFirst: false })'));
  assert.ok(source.includes('if (options.openFirst !== false) openLateDetailsForRow(issueRows[0]);'));
});
