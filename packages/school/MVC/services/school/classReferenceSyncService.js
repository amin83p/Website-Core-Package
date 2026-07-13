const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const reportIntegrityService = require('./reportIntegrityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function resolveActor(reqUser) {
  return String(reqUser?.id || reqUser?.userId || reqUser?.username || 'system').trim() || 'system';
}

function collectTargetRowIds(assignment = {}) {
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  return new Set(rows.map((row) => toPublicId(row?.rowId || row?.id)).filter(Boolean));
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
  notifyAfterReportDelete,
  notifyAfterExamMutation,
  deleteReportInstanceForSync
};
