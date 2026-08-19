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

test('cap enrollment review step exposes summary card and optional session tools', () => {
  assert.match(viewSource, /id="enrollCapReviewSummary"/);
  assert.match(viewSource, /id="enrollCapReviewSummaryBody"/);
  assert.match(viewSource, /id="enrollCapReviewContext"/);
  assert.match(viewSource, /id="enrollCapOptionalSessionsPanel"/);
  assert.match(viewSource, /id="enrollCapOptionalSessionsCollapse"/);
  assert.match(viewSource, /Manage sessions \(optional\)/);
});

test('cap form step hides calendar controls and uses neutral alignment hint', () => {
  const hint = functionSource('updateSessionCountHint', 'getEnrollmentWizardStepMeta');
  const viewBtn = functionSource('updateViewSessionsButton', 'buildEnrollmentPickerBundleFromWorkspace');

  assert.match(hint, /capSet && enrollWizardStep === 'form'/);
  assert.match(hint, /Use Next to review and optionally manage sessions/);
  assert.doesNotMatch(hint, /insufficient_sessions[\s\S]*enrollWizardStep === 'form'/);
  assert.match(viewBtn, /hasEnrollmentCap\(\) && enrollWizardStep === 'form'/);
  assert.match(viewBtn, /classList\.add\('d-none'\)/);
});

test('cap wizard step rail labels review instead of sessions', () => {
  const meta = functionSource('getEnrollmentWizardStepMeta', 'renderEnrollmentWizardStepIndicator');
  assert.match(meta, /id: 'addSessions', label: 'Review'/);
  assert.doesNotMatch(meta, /id: 'addSessions', label: 'Sessions'/);
});

test('addPeriod advances cap enrollments to review step instead of saving immediately', () => {
  const addPeriod = functionSource('addPeriod', 'openCloseModal');
  const formBranch = addPeriod.match(/if \(enrollWizardStep === 'form'\) \{[\s\S]*?\n    \}/);
  assert.ok(formBranch, 'form branch should exist');
  assert.match(formBranch[0], /alignmentGate[\s\S]*prepareEnrollmentReviewStep\(alignmentGate\.alignment\)/);
  assert.match(formBranch[0], /enrollWizardStep = 'addSessions'/);
});

test('review step primary action finalizes without session-pick gating', () => {
  const syncBtn = functionSource('syncEnrollmentWizardPrimaryButton', 'isRollingClass');
  const canContinue = functionSource('canContinueFromAddSessionsStep', 'validateEnrollmentPickForContinue');
  const validate = functionSource('validateEnrollmentPickForContinue', 'updateEnrollmentPickCounter');

  assert.match(syncBtn, /enrollWizardStep === 'addSessions'[\s\S]*Add Enrollment Period/);
  assert.match(syncBtn, /enrollWizardStep === 'addSessions'[\s\S]*btn\.disabled = false/);
  assert.match(canContinue, /if \(hasEnrollmentCap\(\)\) return true/);
  assert.match(validate, /if \(hasEnrollmentCap\(\)\) return true/);
});

test('prepareEnrollmentReviewStep renders summary without auto-including sessions', () => {
  const prepare = functionSource('prepareEnrollmentReviewStep', 'prepareAddSessionsStep');
  assert.match(prepare, /renderEnrollCapReviewSummary\(\)/);
  assert.match(prepare, /renderEnrollCapReviewContext\(alignment\)/);
  assert.match(prepare, /pendingIncludedSessionIds = \[\]/);
  assert.doesNotMatch(prepare, /buildDefaultIncludedSessionIds/);
  assert.match(prepare, /setGapStepNotice\(summaryNotice, \{ title: '', detail: '', visible: false/);
});
