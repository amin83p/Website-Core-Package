const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);

test('rolling enrollment view includes group enrollment entry and modals', () => {
  assert.match(viewSource, /id="btn_openGroupEnrollmentModal"/);
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
