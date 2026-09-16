const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const belowHeadingSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollmentBelowHeading.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);

test('rolling enrollment view includes group enrollment entry and modals', () => {
  assert.match(viewSource, /id="btn_openGroupEnrollmentModal"/);
  assert.match(belowHeadingSource, /id="btn_openRollingClassPicker"/);
  assert.match(viewSource, /async function openRollingClassPicker\(/);
  assert.match(viewSource, /GenericPickerPresets\.class\(/);
  assert.match(viewSource, /itemFilter:/);
  assert.match(viewSource, /registrationMode/);
  assert.match(viewSource, /rolling-enrollment/);
  assert.match(viewSource, /Group Enrollment/);
  assert.match(viewSource, /id="groupEnrollmentModal"/);
  assert.match(viewSource, /id="groupEnrollmentResultsModal"/);
  assert.match(viewSource, /id="grp_autoResolveSubjects"/);
  assert.match(viewSource, /Auto Resolve the Subjects/);
  assert.match(viewSource, /id="btn_completeGroupEnrollment"/);
  assert.match(viewSource, /id="btn_addGroupEnrollmentEntry"/);
  assert.match(viewSource, /id="btn_pickGroupEntryStudent"/);
  assert.match(viewSource, /id="grp_studentId"/);
  assert.match(viewSource, /id="grp_studentLabel"/);
});

test('group enrollment uses add-to-list entry form with per-student enrollment fields', () => {
  assert.match(viewSource, /function addGroupEnrollmentEntry\(/);
  assert.match(viewSource, /function collectGroupEnrollmentEntryFromForm\(/);
  assert.match(viewSource, /function prefillGroupEnrollmentEntryForm\(/);
  assert.match(viewSource, /function pickGroupEntryStudent\(/);
  assert.match(viewSource, /id="grp_startDate"/);
  assert.match(viewSource, /id="grp_endDate"/);
  assert.match(viewSource, /id="grp_targetSessionCount"/);
  assert.match(viewSource, /id="grp_targetHours"/);
  assert.match(viewSource, /id="grp_funder"/);
  assert.match(viewSource, /id="grp_status"/);
  assert.match(viewSource, /id="grp_reasonStart"/);
  assert.doesNotMatch(viewSource, /function pickGroupStudents\(\)/);
  assert.doesNotMatch(viewSource, /id="btn_pickGroupStudents"/);
});

test('group enrollment queue table renders cap, funder, status, and auto-resolve columns', () => {
  assert.match(viewSource, /function formatGroupEnrollmentCapSummary\(/);
  assert.match(viewSource, /<th>Start<\/th>/);
  assert.match(viewSource, /<th>Target<\/th>/);
  assert.match(viewSource, /<th>Funder<\/th>/);
  assert.match(viewSource, /<th>Status<\/th>/);
  assert.match(viewSource, /<th>Auto Resolve<\/th>/);
  assert.match(viewSource, /formatGroupEnrollmentCapSummary\(row\)/);
  assert.match(viewSource, /resolveFunderDisplayLabel\(row\)/);
  assert.match(viewSource, /row\.autoResolveSubjects/);
});

test('group enrollment queue supports inline edit rows with save and cancel', () => {
  assert.match(viewSource, /groupEnrollmentEditingIndex/);
  assert.match(viewSource, /data-group-student-edit/);
  assert.match(viewSource, /data-group-queue-save/);
  assert.match(viewSource, /data-group-queue-cancel/);
  assert.match(viewSource, /group-enrollment-edit-row/);
  assert.match(viewSource, /function collectGroupEnrollmentEntryFromEditRow\(/);
  assert.match(viewSource, /function saveGroupEnrollmentQueueRow\(/);
  assert.match(viewSource, /function cancelGroupEnrollmentQueueEdit\(/);
  assert.match(viewSource, /function buildGroupEnrollmentEditRowHtml\(/);
  assert.match(viewSource, /function applyGroupQueueEditCapMutualExclusion\(/);
});

test('group enrollment records repairable failures for results-modal resolution', () => {
  assert.match(viewSource, /groupEnrollmentLastResults/);
  assert.match(viewSource, /groupEnrollmentResultRepairContext/);
  assert.match(viewSource, /function classifyGroupEnrollmentFailure\(/);
  assert.match(viewSource, /function isGroupPrerequisiteRepairable\(/);
  assert.match(viewSource, /function isAdvisoryPrerequisiteEnforcement\(/);
  assert.match(viewSource, /function getPriorRepairFromEligibility\(/);
  assert.match(viewSource, /function openGroupResultProgramRegistration\(/);
  assert.match(viewSource, /function openGroupResultSubjectRepair\(/);
  assert.match(viewSource, /function retryGroupEnrollmentResult\(/);
  assert.match(viewSource, /function retryAllFailedGroupEnrollments\(/);
  assert.match(viewSource, /function refreshGroupEnrollmentResultPrereq\(/);
  assert.match(viewSource, /btn_groupRetryAllFailed/);
  assert.match(viewSource, /btn-group-result-program-reg/);
  assert.match(viewSource, /btn-group-result-subjects/);
  assert.match(viewSource, /btn-group-result-complete/);
  assert.match(viewSource, /<th>Actions<\/th>/);
  assert.doesNotMatch(viewSource, /waitForGroupPrerequisiteRepair/);
  assert.doesNotMatch(viewSource, /repairable:\s*true/);
});

test('group enrollment pipeline checks prerequisites, optional CLB apply, and executes per student', () => {
  assert.match(viewSource, /function runGroupEnrollment\(\)/);
  assert.match(viewSource, /function runGroupEnrollmentForStudent\(/);
  assert.match(viewSource, /rolling-enrollment-prerequisites/);
  assert.match(viewSource, /rolling-prior-subject-credits\/apply-placement/);
  assert.match(viewSource, /rolling-enrollment\/execute/);
  assert.match(viewSource, /students:\s*\[\{\s*studentId/);
  assert.match(viewSource, /entry\.autoResolveSubjects/);
  assert.match(viewSource, /canApplyPlacement/);
  assert.match(viewSource, /renderGroupEnrollmentResults/);
  assert.match(viewSource, /groupEnrollmentSettingsFromEntry\(entry\)/);
});

test('group enrollment shows waiting modal progress messages during sequential processing', () => {
  assert.match(viewSource, /Checking prerequisites for/);
  assert.match(viewSource, /Applying CLB placement credits for/);
  assert.match(viewSource, /Enrolling /);
});

test('rolling enrollment routes expose prerequisite and execute endpoints used by group enrollment', () => {
  assert.match(routesSource, /rolling-enrollment-prerequisites/);
  assert.match(routesSource, /rolling-enrollment\/execute/);
  assert.match(routesSource, /rolling-prior-subject-credits\/apply-placement/);
});

test('rolling enrollment view includes attendance report menu action and modals', () => {
  assert.match(viewSource, /btn-row-attendance-report/);
  assert.match(viewSource, /Attendance report/);
  assert.match(viewSource, /id="enrollmentAttendanceReportModal"/);
  assert.match(viewSource, /attendance-report-modal/);
  assert.match(viewSource, /attendance-report-metric/);
  assert.match(viewSource, /attendance-report-date-range/);
  assert.match(viewSource, /attendance-report-slot-col1/);
  assert.match(viewSource, /attendance-report-metric-standard/);
  assert.match(viewSource, /attendance-report-metric-excused/);
  assert.match(viewSource, /id="attendanceReport_lateExcused"/);
  assert.match(viewSource, /id="enrollmentAttendanceNaReasonsModal"/);
  assert.match(viewSource, /rolling-period-row-ended/);
  assert.match(viewSource, /function isEndedEnrollmentRow\(/);
  assert.match(viewSource, /function fetchEnrollmentAttendanceReport\(/);
  assert.match(viewSource, /function renderEnrollmentAttendanceReport\(/);
  assert.match(viewSource, /function openEnrollmentAttendanceNaReasonsModal\(/);
  assert.match(viewSource, /function formatAttendanceReportDisplayDate\(/);
});

test('rolling enrollment routes expose attendance report endpoint', () => {
  assert.match(routesSource, /attendance-report/);
  assert.match(routesSource, /getEnrollmentPeriodAttendanceReport/);
});

test('rolling enrollment modals include session capacity type fields and payloads', () => {
  assert.match(viewSource, /id="inp_sessionCapacityType"/);
  assert.match(viewSource, /id="grp_sessionCapacityType"/);
  assert.match(viewSource, /id="edit_sessionCapacityType"/);
  assert.match(viewSource, /sessionCapacityType/);
  assert.match(viewSource, /function formatSessionCapacityTypeLabel\(/);
  assert.match(viewSource, /readSessionCapacityTypeFromSelect\('inp_sessionCapacityType'\)/);
  assert.match(viewSource, /readSessionCapacityTypeFromSelect\('grp_sessionCapacityType'\)/);
  assert.match(viewSource, /readSessionCapacityTypeFromSelect\('edit_sessionCapacityType'\)/);
  assert.match(viewSource, /setSessionCapacitySelectValue\('edit_sessionCapacityType'/);
  assert.match(viewSource, /function submitEditPeriod\(/);
  assert.match(viewSource, /data-column="sessionCapacity"/);
});

test('new enrollment period modal lays out meta fields evenly with full-width reason start', () => {
  assert.match(viewSource, /enroll-meta-inputs-row/);
  assert.match(viewSource, /col-12 col-md-6 col-lg-3[\s\S]*id="inp_funder"/);
  assert.match(viewSource, /col-12 col-md-6 col-lg-3[\s\S]*id="inp_sessionCapacityType"/);
  assert.match(viewSource, /col-12 col-md-6 col-lg-3[\s\S]*id="inp_claimNumber"/);
  assert.match(viewSource, /id="inp_reasonStart"[\s\S]*textarea/);
});

test('group enrollment shows anticipated finish hints under cap inputs', () => {
  assert.match(viewSource, /id="hint_inp_targetSessionCount_finish"/);
  assert.match(viewSource, /id="hint_inp_targetHours_finish"/);
  assert.match(viewSource, /function updateAnticipatedFinishHint\(/);
  assert.match(viewSource, /function resolveAnticipatedFinishDateClient\(/);
  assert.match(viewSource, /Anticipated finish:/);
  assert.match(viewSource, /isGroupSessionCapacityEnrollment\(\)/);
  assert.match(viewSource, /unmarkSessionIds/);
  assert.match(viewSource, /id="enrollWizardStepUnmarkSessions"/);
  assert.match(viewSource, /pendingUnmarkSessionIds/);
});

test('rolling enrollment row actions include enrollment note menu item', () => {
  assert.match(viewSource, /btn-row-note/);
  assert.match(viewSource, /id="enrollmentNoteModal"/);
  assert.match(viewSource, /function openEnrollmentNoteModal\(/);
  assert.match(viewSource, /function saveEnrollmentNote\(/);
});

test('rolling enrollment includes modal cleanup helpers for stacked workflow modals', () => {
  assert.match(viewSource, /function cleanupRollingModalLayer\(/);
  assert.match(viewSource, /function hideBootstrapModalAndWait\(/);
  assert.match(viewSource, /function dismissEnrollmentWorkflowModals\(/);
  assert.match(viewSource, /function finalizeEnrollmentWorkflowDismissal\(/);
  assert.match(viewSource, /getElementById\('globalLoadingModal'\)/);
  assert.match(viewSource, /getElementById\('sessionEnrollmentCalendarModal'\)/);
  assert.match(viewSource, /getElementById\('genericPickerModal'\)/);
});

test('openRollingClassPicker dismisses workflow modals before opening class picker', () => {
  const pickerFn = viewSource.slice(
    viewSource.indexOf('async function openRollingClassPicker('),
    viewSource.indexOf('function pickGroupEntryStudent(')
  );
  assert.match(pickerFn, /await dismissEnrollmentWorkflowModals\(\)/);
  assert.match(pickerFn, /cleanupRollingModalLayer\(\)/);
  assert.match(pickerFn, /GenericPicker\.open\(GenericPickerPresets\.class\(/);
  assert.doesNotMatch(pickerFn, /addEnrollmentModal\?\.hide\(\)/);
});

test('enrollment success paths finalize workflow modals before success message', () => {
  const proceedFn = viewSource.slice(
    viewSource.indexOf('async function proceedWithEnrollmentAfterAlignment('),
    viewSource.indexOf('function formatAccountLabel(')
  );
  const chargeFn = viewSource.slice(
    viewSource.indexOf('async function submitChargeableEnrollment('),
    viewSource.indexOf('async function saveExistingDraftEnrollment(')
  );
  assert.match(proceedFn, /await finalizeEnrollmentWorkflowDismissal\(\)/);
  assert.match(proceedFn, /cleanupRollingModalLayer\(\)/);
  assert.match(chargeFn, /await finalizeEnrollmentWorkflowDismissal\(\)/);
  assert.match(chargeFn, /cleanupRollingModalLayer\(\)/);
});

test('program registration shortcut retry hides shortcut modal on normal path', () => {
  const retryFn = viewSource.slice(
    viewSource.indexOf('async function retryProgramRegistrationShortcutEligibility('),
    viewSource.indexOf('function mergeRollingPrerequisiteSlice(')
  );
  assert.match(retryFn, /programShortcutModal\?\.hide\(\)/);
  assert.match(retryFn, /await hideBootstrapModalAndWait\(programShortcutModalEl\)/);
  assert.match(retryFn, /cleanupRollingModalLayer\(\)/);
});

test('rolling enrollment row actions include CLB entries manager', () => {
  assert.match(viewSource, /btn-row-clb-entries/);
  assert.match(viewSource, /CLB entries/);
  assert.match(viewSource, /id="rollingStudentClbModal"/);
  assert.match(viewSource, /async function openRollingStudentClbModal\(/);
  assert.match(viewSource, /function prefillRollingClbCurrentFromLatest\(/);
  assert.match(viewSource, /function renderRollingClbPreviousEntryHeadsUp\(/);
  assert.match(viewSource, /id="rollingClb_previousEntryHeadsUp"/);
  assert.match(viewSource, /rolling-clb-heads-up/);
  assert.match(viewSource, /latest\?\.result\?\.\[skill\]/);
  assert.match(viewSource, /\/school\/students\/api\/\$\{encodeURIComponent\(studentId\)\}\/clb-level-history/);
  assert.match(viewSource, /canEditStudentClb/);
  assert.match(viewSource, /function sortRollingClbHistory\(/);
  assert.match(viewSource, /function resolveEnrollmentPeriodStudentId\(/);
  assert.match(viewSource, /resolveEnrollmentPeriodStudentId\(row\)/);
  assert.match(viewSource, /data-student-id="/);
  assert.match(viewSource, /function refreshRollingClbEditorWarnings\(/);
  assert.match(viewSource, /clbLevelValueParser\.js/);
  assert.match(viewSource, /clb-level-value-warning/);
  const renderRowsFn = viewSource.slice(
    viewSource.indexOf('function renderRows('),
    viewSource.indexOf('function isGenericPickerOpen(')
  );
  assert.match(renderRowsFn, /const isVoid = status === 'void'/);
  assert.match(renderRowsFn, /btn-row-clb-entries/);
  assert.match(renderRowsFn, /btn-row-details/);
});

test('rolling enrollment student name supports context menu and claim number management', () => {
  const profileModalSource = fs.readFileSync(
    path.join(__dirname, '../../../public/scripts/schoolPersonProfileModal.js'),
    'utf8'
  );
  assert.match(viewSource, /id="rollingStudentContextMenu"/);
  assert.match(viewSource, /rolling-student-name-target/);
  assert.match(viewSource, /Manage Phone Numbers/);
  assert.match(viewSource, /Manage Addresses/);
  assert.match(viewSource, /Manage Email Addresses/);
  assert.match(viewSource, /Manage Gender/);
  assert.match(viewSource, /id="rollingStudentContextMenuEmails"/);
  assert.match(viewSource, /id="rollingStudentContextMenuGender"/);
  assert.match(viewSource, /function openRollingStudentEmailsModal\(/);
  assert.match(viewSource, /function openRollingStudentGenderModal\(/);
  assert.match(viewSource, /Manage Claim Numbers/);
  assert.match(viewSource, /id="rollingStudentClaimNumbersModal"/);
  assert.match(viewSource, /async function openRollingStudentClaimNumbersModal\(/);
  assert.match(viewSource, /function refreshClaimNumberSelect\(/);
  assert.match(viewSource, /CLAIM_NUMBER_ADD_NEW/);
  assert.match(viewSource, /readClaimNumberSelectValue\(/);
  assert.match(viewSource, /\/school\/students\/api\/\$\{encodeURIComponent\(studentId\)\}\/claim-numbers/);
  assert.match(viewSource, /personProfileEditModal/);
  assert.match(viewSource, /focus: 'phones'/);
  assert.match(viewSource, /focus: 'addresses'/);
  assert.match(viewSource, /focus: 'emails'/);
  assert.match(viewSource, /focus: 'gender'/);
  assert.match(profileModalSource, /FOCUSED_PROFILE_MODES/);
  assert.match(profileModalSource, /isEmails/);
  assert.match(profileModalSource, /isGender/);
  assert.match(viewSource, /<select id="inp_claimNumber"/);
  assert.match(viewSource, /<select id="grp_claimNumber"/);
  assert.match(viewSource, /<select id="edit_claimNumber"/);
});

test('rolling enrollment student column shows gender above name and id below', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  assert.match(viewSource, /rolling-student-gender-line/);
  assert.match(viewSource, /rolling-student-id-line/);
  assert.match(viewSource, /function formatStudentGenderLabel\(/);
  assert.match(viewSource, /studentDisplay\.gender/);
  assert.match(controllerSource, /studentGender/);
  assert.match(controllerSource, /resolveStudentGenderToken/);
});

test('edit enrollment modal gates waiting list and to be confirmed by attendance markings', () => {
  assert.match(viewSource, /OPEN_EDITABLE_ENROLLMENT_STATUSES/);
  assert.match(viewSource, /edit_statusAttendanceHelp/);
  assert.match(viewSource, /to_be_confirmed'\]\.includes\(nextOpenStatus\)/);
  assert.match(viewSource, /row\?\.hasNonNaAttendanceMarkings/);
});

test('new enrollment modal freezes and shows waiting overlay during submit', () => {
  assert.match(viewSource, /enrollment-modal-is-busy/);
  assert.match(viewSource, /function beginEnrollmentModalWork\(/);
  assert.match(viewSource, /function endEnrollmentModalWork\(/);
  assert.match(viewSource, /let enrollmentModalBusy = false/);

  const proceedFn = viewSource.slice(
    viewSource.indexOf('async function proceedWithEnrollmentAfterAlignment('),
    viewSource.indexOf('function formatAccountLabel(')
  );
  assert.match(proceedFn, /beginEnrollmentModalWork\('Checking enrollment eligibility\.\.\.'\)/);
  assert.match(proceedFn, /await refreshRollingEligibility\(\)/);
  assert.match(proceedFn, /showBusy\('Saving enrollment\.\.\.'\)/);
  assert.match(proceedFn, /endEnrollmentModalWork\(\)/);

  const addPeriodFn = viewSource.slice(
    viewSource.indexOf('async function addPeriod('),
    viewSource.indexOf('function openCloseModal(')
  );
  assert.match(addPeriodFn, /beginEnrollmentModalWork\('Checking session alignment\.\.\.'\)/);
  assert.match(addPeriodFn, /beginEnrollmentModalWork\('Refreshing session alignment\.\.\.'\)/);
  assert.match(addPeriodFn, /beginEnrollmentModalWork\('Loading conflict review\.\.\.'\)/);

  assert.match(viewSource, /addEnrollmentModalEl\?\.addEventListener\('hide\.bs\.modal'/);
  assert.match(viewSource, /if \(enrollmentModalBusy\)/);
});
