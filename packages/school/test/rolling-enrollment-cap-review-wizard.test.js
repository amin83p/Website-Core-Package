const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);

function functionSource(name, nextName) {
  const startPatterns = [`function ${name}(`, `async function ${name}(`];
  let start = -1;
  for (const pattern of startPatterns) {
    const idx = viewSource.indexOf(pattern);
    if (idx !== -1) {
      start = idx;
      break;
    }
  }
  assert.notEqual(start, -1, `${name} should exist`);
  if (!nextName) return viewSource.slice(start);
  const endPatterns = [`function ${nextName}(`, `async function ${nextName}(`];
  let end = -1;
  for (const pattern of endPatterns) {
    const idx = viewSource.indexOf(pattern, start + 1);
    if (idx !== -1 && (end === -1 || idx < end)) end = idx;
  }
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return viewSource.slice(start, end);
}

test('group enrollment finishes on form step without cap review wizard', () => {
  const addPeriod = functionSource('addPeriod', 'openCloseModal');
  const formBranch = addPeriod.match(/if \(enrollWizardStep === 'form'\) \{[\s\S]*?\n    \}/);
  assert.ok(formBranch, 'form branch should exist');
  assert.match(formBranch[0], /isGroupSessionCapacityEnrollment\(\)/);
  assert.match(formBranch[0], /proceedWithEnrollmentAfterAlignment\(\)/);
  assert.doesNotMatch(formBranch[0], /enrollWizardStep = 'addSessions'/);
});

test('one-on-one enrollment advances to unmark sessions step', () => {
  const addPeriod = functionSource('addPeriod', 'openCloseModal');
  assert.match(addPeriod, /prepareUnmarkSessionsStep\(lastAlignmentResult\)/);
  assert.match(addPeriod, /enrollWizardStep = 'unmarkSessions'/);
  assert.match(addPeriod, /enrollWizardPath = 'oneOnOne'/);
});

test('wizard step meta exposes unmark step for one-on-one path', () => {
  const meta = functionSource('getEnrollmentWizardStepMeta', 'renderEnrollmentWizardStepIndicator');
  assert.match(meta, /enrollWizardPath === 'oneOnOne'/);
  assert.match(meta, /id: 'unmarkSessions', label: 'Unmark Sessions'/);
});

test('form step shows Next only for one-on-one session capacity', () => {
  const syncBtn = functionSource('syncEnrollmentWizardPrimaryButton', 'isRollingClass');
  assert.match(syncBtn, /isOneOnOneSessionCapacityEnrollment\(\)/);
  assert.doesNotMatch(syncBtn, /hasEnrollmentCap\(\)/);
});

test('unmark step primary action requires at least one selected session', () => {
  const syncBtn = functionSource('syncEnrollmentWizardPrimaryButton', 'isRollingClass');
  assert.match(syncBtn, /enrollWizardStep === 'unmarkSessions'/);
  assert.match(syncBtn, /readSelectedUnmarkSessionIds\(\)/);
  assert.match(syncBtn, /btn\.disabled = selectedCount < 1/);
});

test('group cap hint does not route through cap review Next copy', () => {
  const hint = functionSource('updateSessionCountHint', 'getEnrollmentWizardStepMeta');
  assert.match(hint, /isOneOnOneSessionCapacityEnrollment\(\)/);
  assert.match(hint, /Use Next to pick sessions to unmark/);
  assert.doesNotMatch(hint, /Use Next to review and optionally manage sessions/);
});

test('syncEnrollmentWizardPathFromCap routes one-on-one only', () => {
  const syncPath = functionSource('syncEnrollmentWizardPathFromCap', 'updateSessionCountHint');
  assert.match(syncPath, /enrollWizardPath = 'oneOnOne'/);
  assert.doesNotMatch(syncPath, /enrollWizardPath = 'planA'/);
});
