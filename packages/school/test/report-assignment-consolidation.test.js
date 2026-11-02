const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportAssignmentConsolidationService = require('../MVC/services/school/reportAssignmentConsolidationService');
const classReferenceSyncService = require('../MVC/services/school/classReferenceSyncService');

const reqUser = { id: 'USR-1', activeOrgId: '900000' };
const classId = 'CLS-RON';
const scope = 'each_student';

const classData = {
  id: classId,
  orgId: '900000',
  title: reportAssignmentConsolidationService.REPAIR_CLASS_TITLE
};

function buildAssignment(id, rowId, start, end) {
  return {
    id,
    orgId: '900000',
    classId,
    reportScope: scope,
    templateId: 'TPL-1',
    templateVersion: 1,
    teacherIds: ['TCH-1'],
    targetStudentIds: [],
    status: 'active',
    audit: {
      createUser: 'USR-1',
      createDateTime: id === 'ASN-OLD' ? '2026-01-01T00:00:00.000Z' : '2026-02-01T00:00:00.000Z',
      lastUpdateUser: 'USR-1',
      lastUpdateDateTime: '2026-02-01T00:00:00.000Z'
    },
    targetRows: [{
      rowId,
      targetType: 'session',
      sessionId: `SES-${rowId}`,
      sessionDate: start,
      reportStartDate: start,
      reportDueDate: end,
      taskStartTime: '09:00',
      taskEndTime: '10:00',
      conflictPermitted: true,
      teacherId: 'TCH-1',
      status: 'active'
    }]
  };
}

test('mergeTargetRowsFromAssignments preserves distinct rowIds and dates', () => {
  const merged = reportAssignmentConsolidationService.mergeTargetRowsFromAssignments([
    buildAssignment('ASN-1', 'row-a', '2026-09-01', '2026-09-15'),
    buildAssignment('ASN-2', 'row-b', '2026-10-01', '2026-10-15')
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((row) => row.rowId).sort(),
    ['row-a', 'row-b']
  );
  assert.equal(merged.find((row) => row.rowId === 'row-a')?.reportDueDate, '2026-09-15');
  assert.equal(merged.find((row) => row.rowId === 'row-b')?.reportDueDate, '2026-10-15');
});

test('consolidateReportAssignmentsForClass repoints instances and removes duplicates', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    fetchAllData: schoolDataService.fetchAllData,
    updateData: schoolDataService.updateData,
    deleteData: schoolDataService.deleteData,
    cleanupReportInstancesForRemovedTargetRows: classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows,
    notifyClassReferencesChanged: classReferenceSyncService.notifyClassReferencesChanged
  };

  const assignments = [
    buildAssignment('ASN-OLD', 'row-a', '2026-09-01', '2026-09-15'),
    buildAssignment('ASN-DUP', 'row-b', '2026-10-01', '2026-10-15')
  ];
  const instances = [
    { id: 'INS-1', assignmentId: 'ASN-OLD', assignmentRowId: 'row-a', orgId: '900000' },
    { id: 'INS-2', assignmentId: 'ASN-DUP', assignmentRowId: 'row-b', orgId: '900000' }
  ];
  const updates = [];
  const deleted = [];

  try {
    schoolDataService.getDataById = async (entityType, id) => (
      entityType === 'classes' && id === classId ? classData : null
    );
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'reportAssignments') return assignments.map((row) => ({ ...row }));
      if (entityType === 'reportInstances') return instances.map((row) => ({ ...row }));
      return [];
    };
    schoolDataService.updateData = async (entityType, id, payload) => {
      updates.push({ entityType, id, payload });
      if (entityType === 'reportAssignments' && id === 'ASN-OLD') {
        const index = assignments.findIndex((row) => row.id === 'ASN-OLD');
        assignments[index] = { ...assignments[index], ...payload, id: 'ASN-OLD' };
      }
      if (entityType === 'reportInstances') {
        const index = instances.findIndex((row) => row.id === id);
        if (index >= 0) instances[index] = { ...instances[index], ...payload };
      }
      return payload;
    };
    schoolDataService.deleteData = async (entityType, id) => {
      deleted.push({ entityType, id });
      const index = assignments.findIndex((row) => row.id === id);
      if (index >= 0) assignments.splice(index, 1);
      return true;
    };
    classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows = async () => {};
    classReferenceSyncService.notifyClassReferencesChanged = async () => {};

    const result = await reportAssignmentConsolidationService.consolidateReportAssignmentsForClass({
      classId,
      reportScope: scope,
      reqUser,
      dryRun: false
    });

    assert.equal(result.merged, true);
    assert.equal(result.canonicalAssignmentId, 'ASN-OLD');
    assert.deepEqual(result.removedAssignmentIds, ['ASN-DUP']);
    assert.equal(result.repointedInstances, 1);
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].targetRows.length, 2);
    assert.equal(instances.find((row) => row.id === 'INS-2')?.assignmentId, 'ASN-OLD');
    assert.equal(instances.find((row) => row.id === 'INS-2')?.assignmentRowId, 'row-b');
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].entityType, 'reportAssignments');
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolDataService.updateData = originals.updateData;
    schoolDataService.deleteData = originals.deleteData;
    classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows = originals.cleanupReportInstancesForRemovedTargetRows;
    classReferenceSyncService.notifyClassReferencesChanged = originals.notifyClassReferencesChanged;
  }
});
