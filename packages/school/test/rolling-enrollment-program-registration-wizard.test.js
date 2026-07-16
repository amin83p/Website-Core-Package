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

test('rolling program-registration shortcut presents a four-step wizard', () => {
  assert.match(viewSource, /id="shortcut_stepNumber">Step 1 of 4/);
  assert.match(viewSource, /id="shortcut_stepDetails"/);
  assert.match(viewSource, /id="shortcut_stepPreview" class="d-none"/);
  assert.match(viewSource, /id="shortcut_stepDraft" class="d-none"/);
  assert.match(viewSource, /id="shortcut_stepFinalized" class="d-none"/);
  assert.match(viewSource, /id="btn_shortcutPreview"[^>]*>[^<]*<i[^>]*><\/i>Preview Registration/);
  assert.match(viewSource, /class="btn btn-primary btn-sm d-none" id="btn_shortcutSaveDraft"/);
  assert.match(viewSource, /class="btn btn-success btn-sm d-none" id="btn_shortcutApprove"/);
  assert.match(viewSource, /class="btn btn-outline-success btn-sm d-none" id="btn_shortcutRetry"/);
});

test('wizard advances only through preview, draft, finalization, then explicit eligibility retry', () => {
  const preview = functionSource('previewProgramRegistrationShortcut', 'saveProgramRegistrationShortcutDraft');
  const saveDraft = functionSource('saveProgramRegistrationShortcutDraft', 'approveProgramRegistrationShortcutDraft');
  const approve = functionSource('approveProgramRegistrationShortcutDraft', 'returnToProgramRegistrationShortcutDetails');
  const retry = functionSource('retryProgramRegistrationShortcutEligibility', 'refreshRollingEligibility');

  assert.match(preview, /Array\.isArray\(result\.preview\)/);
  assert.match(preview, /programShortcutPreview = \{ payload, rows \}/);
  assert.match(preview, /setProgramRegistrationShortcutStep\('preview'\)/);
  assert.match(saveDraft, /programShortcutStep !== 'preview'/);
  assert.match(saveDraft, /setProgramRegistrationShortcutStep\('draft'\)/);
  assert.match(approve, /programShortcutStep !== 'draft'/);
  assert.match(approve, /setProgramRegistrationShortcutStep\('finalized'\)/);
  assert.doesNotMatch(approve, /refreshRollingEligibility\(\)/);
  assert.match(retry, /programShortcutStep !== 'finalized'/);
  assert.match(retry, /await refreshRollingEligibility\(\)/);
});

test('wizard invalidates a preview before returning to editable details', () => {
  const back = functionSource('returnToProgramRegistrationShortcutDetails', 'retryProgramRegistrationShortcutEligibility');
  const stepControl = functionSource('setProgramRegistrationShortcutStep', 'renderProgramRegistrationShortcutReview');

  assert.match(back, /resetProgramRegistrationShortcutPreview\(\)/);
  assert.match(back, /setProgramRegistrationShortcutStep\('details'\)/);
  assert.match(stepControl, /btn_shortcutBack/);
  assert.match(stepControl, /btn_shortcutSaveDraft/);
  assert.match(stepControl, /btn_shortcutApprove/);
  assert.match(stepControl, /btn_shortcutRetry/);
});

test('wizard allows no-fee warning previews to continue to draft creation', () => {
  const view = functionSource('isProgramRegistrationShortcutPreviewReady', 'setProgramRegistrationShortcutStep');
  const preview = functionSource('previewProgramRegistrationShortcut', 'saveProgramRegistrationShortcutDraft');

  assert.match(view, /\['ready', 'warning'\]\.includes\(status\)/);
  assert.match(preview, /const previewHasWarning/);
  assert.match(preview, /The academic registration will still be recorded/);
});
