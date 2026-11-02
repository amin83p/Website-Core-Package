const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const reportIntegrityService = require('./reportIntegrityService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportViewService = require('./reportViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function resolveActor(reqUser) {
  return String(reqUser?.id || reqUser?.userId || reqUser?.username || 'system').trim() || 'system';
}

function collectTargetRowIds(assignment = {}) {
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  return new Set(rows.map((row) => toPublicId(row?.rowId || row?.id)).filter(Boolean));
}

function collectTargetRowsById(assignment = {}) {
  const map = new Map();
  reportAssignmentModel.getEffectiveTargetRows(assignment).forEach((row) => {
    const rowId = toPublicId(row?.rowId || row?.id);
    if (rowId) map.set(rowId, row);
  });
  return map;
}

function resolveRowStudentIds(row = {}) {
  return (Array.isArray(row?.targetStudentIds) ? row.targetStudentIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean);
}

function buildTargetRowLabel(row = {}) {
  const start = String(row?.reportStartDate || '').trim();
  const end = String(row?.reportDueDate || row?.dueDate || '').trim();
  const sessionId = String(row?.sessionId || '').trim();
  if (start && end) {
    return sessionId ? `${start} to ${end} (${sessionId})` : `${start} to ${end}`;
  }
  return sessionId || toPublicId(row?.rowId) || 'Target row';
}

function collectRemovedTargetStudentsByRow(previousAssignment = {}, nextAssignment = {}) {
  const previousRows = collectTargetRowsById(previousAssignment);
  const nextRows = collectTargetRowsById(nextAssignment);
  const removedByRow = [];
  nextRows.forEach((nextRow, rowId) => {
    const previousRow = previousRows.get(rowId);
    if (!previousRow) return;
    const previousSet = new Set(resolveRowStudentIds(previousRow));
    const nextSet = new Set(resolveRowStudentIds(nextRow));
    const removedStudentIds = [...previousSet].filter((studentId) => !nextSet.has(studentId));
    if (removedStudentIds.length) {
      removedByRow.push({ rowId, row: nextRow, removedStudentIds });
    }
  });
  return removedByRow;
}

async function deleteReportInstanceForSync(recordId, reqUser, orgId) {
  let instance = await schoolDataService.getDataById('reportInstances', recordId, reqUser);
  if (!instance) return false;

  const status = String(instance?.status || '').trim().toLowerCase();
  if (status === 'locked') {
    const nextStatus = reportIntegrityService.resolveInstanceUnlockTargetStatus(instance);
    const now = new Date().toISOString();
    instance = await schoolDataService.updateData('reportInstances', recordId, {
      status: nextStatus,
      audit: {
        ...(instance.audit || {}),
        lastUpdateUser: toPublicId(reqUser?.id || reqUser?.userId || ''),
        lastUpdateDateTime: now,
        unlockedAt: now,
        unlockedBy: toPublicId(reqUser?.id || reqUser?.userId || '')
      }
    }, reqUser);
  }

  const eligibility = reportIntegrityService.resolveInstanceDeleteEligibility(instance?.status);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason || 'Report instance is not deletable.');
  }

  await schoolDataService.deleteData('reportInstances', recordId, reqUser, {
    orgId: orgId || instance?.orgId,
    skipDeletionGuard: true
  });
  return true;
}

async function notifyClassReferencesChanged({ classId, reason = '', reqUser } = {}) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return { updated: false, reason: 'missing_class_id' };

  const classRow = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  if (!classRow) return { updated: false, reason: 'class_not_found' };

  const now = new Date().toISOString();
  await schoolDataService.updateData('classes', normalizedClassId, {
    updatedAt: now,
    updatedBy: resolveActor(reqUser),
    referenceSync: {
      ...(classRow.referenceSync || {}),
      lastReason: String(reason || '').trim(),
      lastSyncedAt: now
    }
  }, reqUser);

  await schoolIndexService.rebuildIndexesForClass(normalizedClassId);
  return { updated: true, classId: normalizedClassId };
}

async function cleanupReportInstancesForRemovedTargetRows({
  assignmentId,
  previousAssignment,
  nextAssignment,
  reqUser
} = {}) {
  const normalizedAssignmentId = toPublicId(assignmentId);
  if (!normalizedAssignmentId || !previousAssignment) {
    return { deletedCount: 0, errors: [] };
  }

  const previousRowIds = collectTargetRowIds(previousAssignment);
  const nextRowIds = collectTargetRowIds(nextAssignment || {});
  const removedRowIds = [...previousRowIds].filter((rowId) => !nextRowIds.has(rowId));
  if (!removedRowIds.length) {
    return { deletedCount: 0, errors: [] };
  }

  const classId = toPublicId(nextAssignment?.classId || previousAssignment?.classId);
  const orgId = toPublicId(nextAssignment?.orgId || previousAssignment?.orgId || reqUser?.activeOrgId);
  const instances = await schoolDataService.fetchData(
    'reportInstances',
    { page: 1, assignmentId__eq: normalizedAssignmentId },
    reqUser
  );
  const removedSet = new Set(removedRowIds);
  const toDelete = (Array.isArray(instances) ? instances : []).filter((row) => {
    const rowId = toPublicId(row?.assignmentRowId || row?.rowId);
    return rowId && removedSet.has(rowId);
  });

  const errors = [];
  let deletedCount = 0;
  for (const instance of toDelete) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const deleted = await deleteReportInstanceForSync(toPublicId(instance?.id), reqUser, orgId);
      if (deleted) deletedCount += 1;
    } catch (error) {
      errors.push(`${toPublicId(instance?.id)}: ${error.message}`);
    }
  }

  if (classId && (deletedCount > 0 || errors.length === 0)) {
    await notifyClassReferencesChanged({
      classId,
      reason: `report_assignment_target_rows_removed:${normalizedAssignmentId}`,
      reqUser
    });
  }

  return { deletedCount, errors };
}

async function listReportInstancesForRemovedTargetStudents({
  assignmentId,
  previousAssignment,
  nextAssignment,
  reqUser
} = {}) {
  const normalizedAssignmentId = toPublicId(assignmentId);
  if (!normalizedAssignmentId || !previousAssignment || !nextAssignment) {
    return [];
  }

  const removedByRow = collectRemovedTargetStudentsByRow(previousAssignment, nextAssignment);
  if (!removedByRow.length) return [];

  const instances = await schoolDataService.fetchData(
    'reportInstances',
    { page: 1, assignmentId__eq: normalizedAssignmentId },
    reqUser
  );
  const personMap = await reportViewService.buildPersonNameMap(reqUser);
  const templateId = toPublicId(nextAssignment?.templateId || previousAssignment?.templateId);
  let templateTitle = templateId || 'Report';
  if (templateId) {
    const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    templateTitle = String(template?.title || templateId).trim();
  }

  const matches = [];
  for (const entry of removedByRow) {
    const rowId = entry.rowId;
    const removedSet = new Set(entry.removedStudentIds);
    const rowLabel = buildTargetRowLabel(entry.row);
    (Array.isArray(instances) ? instances : []).forEach((instance) => {
      const instanceRowId = toPublicId(instance?.assignmentRowId || instance?.rowId);
      const studentId = toPublicId(instance?.studentId);
      if (!studentId || !removedSet.has(studentId)) return;
      if (rowId && instanceRowId && !idsEqual(instanceRowId, rowId)) return;
      if (rowId && !instanceRowId) return;
      const instanceId = toPublicId(instance?.id);
      if (!instanceId) return;
      matches.push({
        instanceId,
        studentId,
        studentName: String(personMap.get(studentId) || instance?.studentName || studentId).trim(),
        assignmentRowId: rowId,
        rowLabel,
        templateTitle,
        status: String(instance?.status || '').trim().toLowerCase()
      });
    });
  }

  const unique = new Map();
  matches.forEach((row) => {
    if (row.instanceId) unique.set(row.instanceId, row);
  });
  return [...unique.values()];
}

async function listStaleReportInstancesForAssignmentTargetRows({
  assignmentId,
  assignment,
  reqUser
} = {}) {
  const normalizedAssignmentId = toPublicId(assignmentId);
  if (!normalizedAssignmentId || !assignment) return [];

  const targetRows = reportAssignmentModel.getEffectiveTargetRows(assignment);
  if (!targetRows.length) return [];

  const instances = await schoolDataService.fetchData(
    'reportInstances',
    { page: 1, assignmentId__eq: normalizedAssignmentId },
    reqUser
  );
  const personMap = await reportViewService.buildPersonNameMap(reqUser);
  const templateId = toPublicId(assignment?.templateId);
  let templateTitle = templateId || 'Report';
  if (templateId) {
    const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    templateTitle = String(template?.title || templateId).trim();
  }

  const stale = [];
  targetRows.forEach((row) => {
    const rowId = toPublicId(row?.rowId);
    const expectedSet = new Set(resolveRowStudentIds(row));
    if (!expectedSet.size) return;
    const rowLabel = buildTargetRowLabel(row);
    (Array.isArray(instances) ? instances : []).forEach((instance) => {
      const instanceRowId = toPublicId(instance?.assignmentRowId || instance?.rowId);
      const studentId = toPublicId(instance?.studentId);
      if (!studentId || expectedSet.has(studentId)) return;
      if (rowId && instanceRowId && !idsEqual(instanceRowId, rowId)) return;
      if (rowId && !instanceRowId) return;
      const instanceId = toPublicId(instance?.id);
      if (!instanceId) return;
      stale.push({
        instanceId,
        studentId,
        studentName: String(personMap.get(studentId) || instance?.studentName || studentId).trim(),
        assignmentRowId: rowId,
        rowLabel,
        templateTitle,
        status: String(instance?.status || '').trim().toLowerCase()
      });
    });
  });

  const unique = new Map();
  stale.forEach((row) => {
    if (row.instanceId) unique.set(row.instanceId, row);
  });
  return [...unique.values()];
}

async function deleteReportInstancesByIds({
  instanceIds = [],
  reqUser,
  orgId = '',
  classId = '',
  reason = ''
} = {}) {
  const ids = [...new Set(
    (Array.isArray(instanceIds) ? instanceIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean)
  )];
  const errors = [];
  let deletedCount = 0;
  for (const instanceId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const deleted = await deleteReportInstanceForSync(instanceId, reqUser, orgId);
      if (deleted) deletedCount += 1;
    } catch (error) {
      errors.push(`${instanceId}: ${error.message}`);
    }
  }
  if (classId && deletedCount > 0) {
    await notifyClassReferencesChanged({
      classId,
      reason: reason || 'report_instances_removed_for_unassigned_students',
      reqUser
    });
  }
  return { deletedCount, errors };
}

async function cleanupReportInstancesForRemovedTargetStudents({
  assignmentId,
  previousAssignment,
  nextAssignment,
  reqUser,
  instanceIds = null
} = {}) {
  const classId = toPublicId(nextAssignment?.classId || previousAssignment?.classId);
  const orgId = toPublicId(nextAssignment?.orgId || previousAssignment?.orgId || reqUser?.activeOrgId);
  const explicitIds = [...new Set(
    (Array.isArray(instanceIds) ? instanceIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean)
  )];
  if (explicitIds.length) {
    return deleteReportInstancesByIds({
      instanceIds: explicitIds,
      reqUser,
      orgId,
      classId,
      reason: `report_assignment_students_removed:${toPublicId(assignmentId)}`
    });
  }

  let toDelete = [];
  const pending = await listReportInstancesForRemovedTargetStudents({
    assignmentId,
    previousAssignment,
    nextAssignment,
    reqUser
  });
  if (pending.length) {
    toDelete = pending.map((row) => row.instanceId).filter(Boolean);
  } else {
    const stale = await listStaleReportInstancesForAssignmentTargetRows({
      assignmentId,
      assignment: nextAssignment,
      reqUser
    });
    toDelete = stale.map((row) => row.instanceId).filter(Boolean);
  }
  if (!toDelete.length) return { deletedCount: 0, errors: [] };
  return deleteReportInstancesByIds({
    instanceIds: toDelete,
    reqUser,
    orgId,
    classId,
    reason: `report_assignment_students_removed:${toPublicId(assignmentId)}`
  });
}

async function notifyAfterReportDelete({ record, reqUser } = {}) {
  const classId = toPublicId(record?.classId);
  if (!classId) return { updated: false };
  return notifyClassReferencesChanged({
    classId,
    reason: `report_deleted:${toPublicId(record?.id)}`,
    reqUser
  });
}

async function notifyAfterExamMutation({ allocation, reqUser } = {}) {
  const classId = toPublicId(allocation?.classId);
  if (!classId) return { updated: false };
  return notifyClassReferencesChanged({
    classId,
    reason: `exam_allocation_changed:${toPublicId(allocation?.id)}`,
    reqUser
  });
}

module.exports = {
  notifyClassReferencesChanged,
  cleanupReportInstancesForRemovedTargetRows,
  listReportInstancesForRemovedTargetStudents,
  listStaleReportInstancesForAssignmentTargetRows,
  cleanupReportInstancesForRemovedTargetStudents,
  deleteReportInstancesByIds,
  notifyAfterReportDelete,
  notifyAfterExamMutation,
  deleteReportInstanceForSync
};
