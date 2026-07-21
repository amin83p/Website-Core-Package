const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const reportViewService = require('../MVC/services/school/reportViewService');
const {
  mapAssignmentDeletePreviewInstances
} = require('../MVC/services/school/reportViewService');

const ROOT = path.resolve(__dirname, '../../..');

function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('resolveInstanceUnlockTargetStatus always returns submitted', () => {
  assert.equal(reportIntegrityService.resolveInstanceUnlockTargetStatus({
    status: 'locked',
    audit: { submittedAt: '2026-03-01T10:00:00.000Z' }
  }), 'submitted');
  assert.equal(reportIntegrityService.resolveInstanceUnlockTargetStatus({
    status: 'locked',
    audit: { lockedAt: '2026-03-01T10:00:00.000Z' }
  }), 'submitted');
});

test('resolveInstanceDeleteEligibility still blocks locked instances', () => {
  const locked = reportIntegrityService.resolveInstanceDeleteEligibility('locked');
  assert.equal(locked.allowed, false);
  assert.match(locked.reason, /locked/i);
});

test('mapAssignmentDeletePreviewInstances sets canUnlock only for locked rows when admin flag is true', () => {
  const rows = mapAssignmentDeletePreviewInstances([
    {
      id: 'RI-1',
      isPendingAssignment: false,
      teacherName: 'Teacher A',
      studentName: 'Student A',
      sessionDate: '2026-03-01',
      status: 'draft'
    },
    {
      id: 'RI-2',
      isPendingAssignment: false,
      teacherName: 'Teacher B',
      studentName: 'Whole class',
      sessionDate: '2026-03-02',
      status: 'locked'
    }
  ], { canUnlockAssignmentInstances: true });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].canUnlock, false);
  assert.equal(rows[1].canUnlock, true);
});

test('mapAssignmentDeletePreviewInstances does not set canUnlock without admin flag', () => {
  const rows = mapAssignmentDeletePreviewInstances([
    {
      id: 'RI-2',
      isPendingAssignment: false,
      teacherName: 'Teacher B',
      studentName: 'Whole class',
      sessionDate: '2026-03-02',
      status: 'locked'
    }
  ]);

  assert.equal(rows[0].canUnlock, false);
});

test('canEditReportInstanceAnswers allows draft, blocks locked, gates submitted by admin editor', async () => {
  const draftOk = await reportViewService.canEditReportInstanceAnswers({ status: 'draft' }, { id: 'u1' });
  assert.equal(draftOk, true);

  const lockedBlocked = await reportViewService.canEditReportInstanceAnswers({ status: 'locked' }, { id: 'u1' });
  assert.equal(lockedBlocked, false);

  // Non-admin (no super, no admin flags) cannot edit submitted.
  const submittedTeacher = await reportViewService.canEditReportInstanceAnswers(
    { status: 'submitted' },
    { id: 'teacher-1' }
  );
  assert.equal(submittedTeacher, false);
});

test('canUnlockReportInstance is super-only (source + helper)', async () => {
  const source = readRoot('packages/school/MVC/services/school/reportViewService.js');
  assert.match(source, /async function canUnlockReportInstance/);
  assert.match(source, /isSuperAdmin\(reqUser\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf('async function canUnlockReportInstance'), source.indexOf('async function canReopenReportInstanceToDraft')),
    /SCHOOL_REPORTS_ASSIGNMENT/
  );

  const nonSuper = await reportViewService.canUnlockReportInstance({ id: 'admin-1' });
  assert.equal(nonSuper, false);
});

test('report workflow wires reopen endpoint and editor gates', () => {
  const routes = readRoot('packages/school/MVC/routes/reportRoutes.js');
  assert.match(routes, /router\.post\('\/instances\/reopen\/:id'/);
  assert.match(routes, /ctrl\.reopenInstance/);
  assert.match(
    routes,
    /router\.post\('\/instances\/unlock\/:id',\s*requireAccess\(REPORT_INSTANCE_SECTION,\s*OPERATIONS\.UPDATE\),\s*trackActionState\(REPORT_INSTANCE_SECTION,\s*OPERATIONS\.UPDATE/
  );
  assert.doesNotMatch(
    routes,
    /router\.post\('\/instances\/unlock\/:id',\s*requireAccess\(REPORT_ASSIGNMENT_SECTION/
  );

  const controller = readRoot('packages/school/MVC/controllers/school/reportController.js');
  assert.match(controller, /async function reopenInstance/);
  assert.match(controller, /canReopenReportInstanceToDraft/);
  assert.match(controller, /Only a super user can unlock/);
  assert.match(controller, /sharedFieldsWillBeLocked/);

  const editor = readRoot('packages/school/MVC/views/school/report/instanceEditor.ejs');
  assert.match(editor, /isReadOnly/);
  assert.match(editor, /js-reopen-report-instance/);
  assert.match(editor, /js-unlock-report-instance/);
  assert.match(editor, /reportAssignmentDelete\.js/);
  assert.match(editor, /saveDraftDisabled/);
  assert.match(editor, /submitDisabled/);
  assert.match(editor, /Unlock Report/);
  assert.match(editor, /Shared fields are read-only/);
  assert.match(editor, /fieldIsDisabled/);
  assert.match(editor, /data-shared-will-lock/);
  assert.doesNotMatch(editor, /js-unlock-report-instance-form/);

  const list = readRoot('packages/school/MVC/views/school/report/instanceList.ejs');
  assert.match(list, /js-reopen-report-instance/);
  assert.match(list, /data-shared-will-lock/);

  const matrix = readRoot('packages/school/MVC/views/school/report/instanceMatrix.ejs');
  assert.match(matrix, /MATRIX_HAS_SHARED_FIELDS/);
  assert.match(matrix, /shared fields will stay read-only/);
  assert.match(matrix, /sharedFieldsEditableSafe/);

  const saveService = readRoot('packages/school/MVC/services/school/reportInstanceSaveService.js');
  assert.match(saveService, /sharedAnswersSkipped/);
  assert.match(saveService, /evaluateSharedFieldsEditability/);

  const integrity = readRoot('packages/school/MVC/services/school/reportIntegrityService.js');
  assert.match(integrity, /REPORT_INSTANCE_SUBMITTED_READONLY/);
  assert.match(integrity, /assertInstanceReopenable/);
});

test('evaluateSharedFieldsEditability locks shared fields when siblings are not draft', () => {
  const assignment = { id: 'ASN-1', reportScope: 'each_student' };
  const template = {
    schema: {
      fields: [
        { id: 'shared_note', type: 'textarea', sharedAcrossStudents: true },
        { id: 'private_note', type: 'textarea', sharedAcrossStudents: false }
      ]
    }
  };
  const instances = [
    { id: 'RI-1', assignmentId: 'ASN-1', status: 'draft', studentId: 'S1' },
    { id: 'RI-2', assignmentId: 'ASN-1', status: 'submitted', studentId: 'S2' }
  ];

  const locked = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances,
    currentInstanceId: 'RI-1'
  });
  assert.equal(locked.hasSharedFields, true);
  assert.equal(locked.sharedFieldsEditable, false);
  assert.equal(locked.blockingSiblingCount, 1);
  assert.match(locked.reason, /read-only/i);

  const unlocked = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances: [
      { id: 'RI-1', assignmentId: 'ASN-1', status: 'draft' },
      { id: 'RI-2', assignmentId: 'ASN-1', status: 'draft' }
    ],
    currentInstanceId: 'RI-1'
  });
  assert.equal(unlocked.sharedFieldsEditable, true);
  assert.equal(unlocked.blockingSiblingCount, 0);

  const single = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances: [{ id: 'RI-1', assignmentId: 'ASN-1', status: 'draft' }],
    currentInstanceId: 'RI-1'
  });
  assert.equal(single.sharedFieldsEditable, true);

  const classScope = reportViewService.evaluateSharedFieldsEditability({
    assignment: { id: 'ASN-2', reportScope: 'class' },
    template,
    instances,
    currentInstanceId: 'RI-1'
  });
  assert.equal(classScope.hasSharedFields, false);
  assert.equal(classScope.sharedFieldsEditable, true);

  const adminOverride = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances,
    currentInstanceId: 'RI-1',
    allowAdminOverride: true
  });
  assert.equal(adminOverride.hasSharedFields, true);
  assert.equal(adminOverride.sharedFieldsEditable, true);
  assert.equal(adminOverride.adminOverride, true);
  assert.equal(adminOverride.blockingSiblingCount, 1);
});

test('evaluateSharedFieldsLockAfterReopen warns when other instances remain non-draft', () => {
  const assignment = { id: 'ASN-1', reportScope: 'each_student' };
  const template = {
    schema: {
      fields: [{ id: 'shared_note', type: 'textarea', sharedAcrossStudents: true }]
    }
  };
  const preview = reportViewService.evaluateSharedFieldsLockAfterReopen({
    assignment,
    template,
    instances: [
      { id: 'RI-1', assignmentId: 'ASN-1', status: 'submitted' },
      { id: 'RI-2', assignmentId: 'ASN-1', status: 'locked' }
    ],
    reopeningInstanceId: 'RI-1'
  });
  assert.equal(preview.sharedFieldsWillBeLocked, true);
  assert.equal(preview.blockingSiblingCount, 1);
});
