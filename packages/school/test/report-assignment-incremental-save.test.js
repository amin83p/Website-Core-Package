const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const schoolRepositories = require('../MVC/repositories/school');
const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const classReferenceSyncService = require('../MVC/services/school/classReferenceSyncService');

const reqUser = { id: 'USR-1', activeOrgId: '900000' };
const classData = { id: 'CLS-1', orgId: '900000', title: 'Class A', registrationMode: 'term_based' };
const template = {
  id: 'TPL-1',
  orgId: '900000',
  version: 1,
  allowedReportScopes: ['class', 'each_student', 'selected_students']
};

function buildSessionTargetRow(overrides = {}) {
  return {
    rowId: 'row-1',
    targetType: 'session',
    sessionId: 'SES-1',
    sessionDate: '2026-09-15',
    dueDate: '',
    reportStartDate: '2026-09-15',
    reportDueDate: '2026-09-15',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    conflictPermitted: true,
    teacherId: 'TCH-1',
    status: 'active',
    notes: '',
    targetStudentIds: [],
    ...overrides
  };
}

test('validateAssignmentCrossEntityContext with rowValidationMode none skips per-row enrollment checks', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  let enrollmentCalls = 0;
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async () => [];
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => {
      enrollmentCalls += 1;
      return { source: 'canonical', studentIds: new Set(['REG-1']), usedFallback: false };
    };

    const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: 'CLS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'class',
      hasSessionTargets: true,
      selectedSessionIds: ['SES-1'],
      teacherIds: ['TCH-1'],
      requestedReportStartDate: '2026-09-15',
      requestedReportDueDate: '2026-09-15',
      selectedTargetStudentIds: [],
      targetRows: [buildSessionTargetRow({ notes: 'notes-only save' })],
      rowValidationMode: 'none',
      validateOnlyRowIds: []
    });

    assert.equal(enrollmentCalls, 0);
    assert.equal(result.effectiveTargetRows.length, 1);
    assert.equal(result.effectiveTargetRows[0].notes, 'notes-only save');
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('verifyReportAssignmentContext returns stale instances without mutating assignments', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listStale: classReferenceSyncService.listStaleReportInstancesForAssignmentTargetRows,
    listRemoved: classReferenceSyncService.listReportInstancesForRemovedTargetStudents,
    updateData: schoolDataService.updateData
  };
  let updateCalls = 0;
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async () => [];
    schoolRepositories.reportTemplates.getById = async () => template;
    classReferenceSyncService.listStaleReportInstancesForAssignmentTargetRows = async () => ([{
      instanceId: 'RI-STALE',
      assignmentRowId: 'row-1',
      rowLabel: 'Session | SES-1',
      studentName: 'Ada Active',
      status: 'draft'
    }]);
    classReferenceSyncService.listReportInstancesForRemovedTargetStudents = async () => [];
    schoolDataService.updateData = async () => {
      updateCalls += 1;
      return {};
    };

    const previousAssignment = {
      id: 'RA-1',
      classId: 'CLS-1',
      orgId: '900000',
      reportScope: 'class',
      templateId: 'TPL-1',
      targetRows: [buildSessionTargetRow()]
    };

    const result = await reportIntegrityService.verifyReportAssignmentContext({
      assignmentId: 'RA-1',
      previousAssignment,
      nextAssignmentPreview: previousAssignment,
      validationInput: {
        classId: 'CLS-1',
        templateId: 'TPL-1',
        reqUser,
        reportScope: 'class',
        hasSessionTargets: true,
        selectedSessionIds: ['SES-1'],
        teacherIds: ['TCH-1'],
        requestedReportStartDate: '2026-09-15',
        requestedReportDueDate: '2026-09-15',
        selectedTargetStudentIds: [],
        targetRows: [buildSessionTargetRow()],
        excludeAssignmentId: 'RA-1'
      }
    });

    assert.equal(result.status, 'success');
    assert.equal(result.ok, false);
    assert.equal(result.confirmRequired, true);
    assert.deepEqual(result.deletableInstanceIds, ['RI-STALE']);
    assert.equal(result.staleInstances.length, 1);
    assert.equal(result.staleInstances[0].instanceId, 'RI-STALE');
    assert.equal(updateCalls, 0);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classReferenceSyncService.listStaleReportInstancesForAssignmentTargetRows = originals.listStale;
    classReferenceSyncService.listReportInstancesForRemovedTargetStudents = originals.listRemoved;
    schoolDataService.updateData = originals.updateData;
  }
});

test('report routes register verify-all-rows endpoints', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../MVC/routes/reportRoutes.js'),
    'utf8'
  );
  assert.match(routeSource, /verify-all-rows/);
  assert.match(routeSource, /verify-all-rows\/delete-instances/);
  assert.match(routeSource, /ctrl\.verifyAssignmentRows/);
  assert.match(routeSource, /ctrl\.deleteVerifyAssignmentInstances/);
  assert.match(routeSource, /reportAssignmentBulkActionState/);
});

test('parseAssignmentSaveRequest parses dirtyRowIdsJson', () => {
  const reportViewService = require('../MVC/services/school/reportViewService');
  const payload = reportViewService.parseAssignmentSaveRequest({
    dirtyRowIdsJson: '["row-a","row-b"]',
    targetRowsJson: '[]'
  });
  assert.deepEqual(payload.clientDirtyRowIds.sort(), ['row-a', 'row-b']);
});

test('client dirty row ids force listed validation mode on existing assignments', () => {
  const reportAssignmentModel = require('../MVC/models/school/reportAssignmentModel');
  const diffValidateRowIds = [];
  const clientDirtyRowIds = ['row-modal-edited'];
  const validateRowIds = [...new Set([...diffValidateRowIds, ...clientDirtyRowIds])];
  const mode = reportAssignmentModel.resolveSaveRowValidationMode({
    hasExistingAssignment: true,
    validateRowIds
  });
  assert.equal(mode, 'listed');
  assert.deepEqual(validateRowIds, ['row-modal-edited']);
});
