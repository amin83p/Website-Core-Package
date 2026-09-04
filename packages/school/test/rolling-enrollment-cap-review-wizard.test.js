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

test('capacity-1 rolling class forces one-on-one session flow in UI helpers', () => {
  assert.match(viewSource, /function isRollingCapacityOneClass\(/);
  assert.match(viewSource, /function syncSessionCapacityControlsForClass\(/);
  assert.match(viewSource, /maxCapacity: Number\(c\?\.enrollment\?\.maxCapacity/);

  const isOneOnOne = functionSource('isOneOnOneSessionCapacityEnrollment', 'resolveAnticipatedFinishDateClient');
  assert.match(isOneOnOne, /isRollingCapacityOneClass\(\)/);

  const capacityPanel = functionSource('renderClassCapacityWarningPanel', 'renderProgramRegistrationShortcutPanel');
  assert.match(capacityPanel, /isRollingCapacityOneClass\(\)/);
});

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

test('unmark step calendar picker opens calendar modal and syncs pendingUnmarkSessionIds', () => {
  const unmarkCalendar = functionSource('openUnmarkSessionCalendarModal', 'openEnrollmentSessionListModal');
  assert.match(unmarkCalendar, /SessionEnrollmentCalendarModal\.open/);
  assert.match(unmarkCalendar, /applyUnmarkSelectionFromIds/);
  assert.match(unmarkCalendar, /selectedUnmarkIds/);
  assert.match(unmarkCalendar, /cycleEndDate:\s*String\(cycleWindow\?\.endDate/);

  const applyUnmark = functionSource('applyUnmarkSelectionFromIds', 'readSelectedUnmarkSessionIdsFromScope');
  assert.match(applyUnmark, /pendingUnmarkSessionIds =/);
  assert.match(applyUnmark, /renderUnmarkSessionTable\(buildUnmarkSessionRows/);

  assert.match(viewSource, /btn_openUnmarkCalendarPicker'\)\?\.addEventListener\('click', openUnmarkSessionCalendarModal\)/);
  assert.doesNotMatch(viewSource, /btn_openUnmarkCalendarPicker'\)\?\.addEventListener\('click', openEnrollmentSessionListModal\)/);
  assert.match(unmarkCalendar, /openUnmarkSessionListModal\(\)/);
});

test('unmark step list view opens dedicated session list modal', () => {
  assert.match(viewSource, /id="btn_openUnmarkSessionsList"/);
  assert.match(viewSource, /id="unmarkSessionListModal"/);
  assert.match(viewSource, /id="unmarkSessionListTbody"/);
  assert.match(viewSource, /Sessions to unmark/);

  const openList = functionSource('openUnmarkSessionListModal', 'handleUnmarkSessionToggleClick');
  assert.match(openList, /renderUnmarkSessionListModalTable/);
  assert.match(openList, /unmarkSessionListModal\?\.show/);

  assert.match(viewSource, /btn_openUnmarkSessionsList'\)\?\.addEventListener\('click', openUnmarkSessionListModal\)/);
  assert.match(viewSource, /unmarkSessionListTbody'\)\?\.addEventListener\('click'/);
});

test('enrollment picker calendar modal passes cycle end date', () => {
  const pickerCalendar = functionSource('openEnrollmentSessionCalendarModal', 'applyUnmarkSelectionFromIds');
  assert.match(pickerCalendar, /cycleEndDate:\s*String\(cycleWindow\?\.endDate/);
});

test('unmark step hides inline session table panel', () => {
  assert.match(viewSource, /id="unmarkSessionsTablePanel"[^>]*class="[^"]*\bd-none\b/);
  assert.match(viewSource, /Choose empty sessions for this student/);
});

test('unmark occupancy helpers and occupied row styling exist', () => {
  assert.match(viewSource, /function resolveSessionRosterCount\(/);
  assert.match(viewSource, /function isUnmarkSelectableSessionRow\(/);
  assert.match(viewSource, /function applyUnmarkSelectableRules\(/);
  assert.match(viewSource, /unmark-session-row-occupied/);
  assert.match(viewSource, /Student enrolled/);
  assert.match(viewSource, /filterSelectableUnmarkSessionIds/);

  const unmarkCalendar = functionSource('openUnmarkSessionCalendarModal', 'openEnrollmentSessionListModal');
  assert.match(unmarkCalendar, /applyUnmarkSelectableRules\(prefetchedPickerData\)/);

  const renderTable = functionSource('renderSessionWindowTable', 'getCountableSessionsFromAlignment');
  assert.match(renderTable, /unmarkOccupied/);
  assert.match(renderTable, /Occupied/);
});
