const schoolDataService = require('./schoolDataService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportAssignmentIdService = require('./reportAssignmentIdService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function clean(value) {
  return String(value || '').trim();
}

function filterByOrg(rows, orgId) {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => !row?.orgId || idsEqual(row.orgId, orgToken));
}

function instancesForAssignment(instances, assignmentId) {
  const id = toPublicId(assignmentId);
  if (!id) return [];
  return (Array.isArray(instances) ? instances : []).filter((row) => idsEqual(row?.assignmentId, id));
}

function distinctInstanceRowIds(instances = []) {
  const rowIds = new Set();
  instances.forEach((row) => {
    const token = clean(row?.assignmentRowId);
    if (token) rowIds.add(token);
  });
  return [...rowIds];
}

function collectRowGroups(assignment, instances = []) {
  const rowIds = new Set();
  reportAssignmentModel.getEffectiveTargetRows(assignment).forEach((row) => {
    const token = clean(row?.rowId);
    if (token) rowIds.add(token);
  });
  distinctInstanceRowIds(instances).forEach((token) => rowIds.add(token));
  return [...rowIds].filter(Boolean);
}

function assignmentNeedsSplit(assignment, instances = []) {
  const rowGroups = collectRowGroups(assignment, instances);
  const targetRows = reportAssignmentModel.getEffectiveTargetRows(assignment);
  if (targetRows.length > 1) return true;
  if (rowGroups.length > 1) return true;
  return false;
}

function inferTargetRowFromInstances(rowId, instances = []) {
  const token = clean(rowId);
  const matched = instances.filter((row) => clean(row?.assignmentRowId) === token);
  const sample = matched[0] || null;
  if (!sample) {
    return {
      rowId: token,
      targetType: 'session',
      sessionId: '',
      sessionDate: '',
      status: 'active',
      teacherId: ''
    };
  }
  return {
    rowId: token,
    targetType: String(sample?.sessionId || '').trim() ? 'session' : 'date',
    sessionId: clean(sample?.sessionId),
    sessionDate: clean(sample?.sessionDate),
    reportStartDate: '',
    reportDueDate: clean(sample?.sessionDate),
    teacherId: clean(sample?.teacherId),
    status: 'active'
  };
}

function resolveRowForSplit(assignment, rowId, instances = []) {
  const fromAssignment = reportAssignmentModel.findEffectiveTargetRow(assignment, rowId);
  if (fromAssignment && clean(fromAssignment.rowId) === clean(rowId)) return fromAssignment;
  return inferTargetRowFromInstances(rowId, instances);
}

function buildSplitAssignmentPayload(parent, row, { newId }) {
  const activeRow = {
    ...row,
    rowId: clean(row?.rowId),
    status: clean(row?.status).toLowerCase() || 'active'
  };
  const merged = reportAssignmentModel.applyTargetRowToAssignment(parent, activeRow);
  const {
    id: _dropId,
    audit: parentAudit,
    ...rest
  } = merged;
  return reportAssignmentModel.sanitizeAssignment({
    ...rest,
    id: newId,
    status: 'active',
    targetRows: [activeRow],
    sharedAnswers: parent?.sharedAnswers,
    notes: [clean(parent?.notes), `Split from assignment ${toPublicId(parent?.id)} on ${new Date().toISOString()}`]
      .filter(Boolean)
      .join('\n'),
    audit: {
      ...(parentAudit || {}),
      lastUpdateUser: 'reportAssignmentSplitMigration',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, { isUpdate: false });
}

function planSplitForAssignment(assignment, instances = [], reservedIds = new Set()) {
  const assignmentId = toPublicId(assignment?.id);
  const classId = toPublicId(assignment?.classId);
  if (!assignmentId || !classId) return null;
  const scopedInstances = instancesForAssignment(instances, assignmentId);
  if (!assignmentNeedsSplit(assignment, scopedInstances)) return null;

  const rowIds = collectRowGroups(assignment, scopedInstances);
  const splits = [];
  const localReserved = new Set(reservedIds);

  rowIds.forEach((rowId) => {
    const rowInstances = scopedInstances.filter((row) => clean(row?.assignmentRowId) === clean(rowId));
    const row = resolveRowForSplit(assignment, rowId, rowInstances);
    splits.push({
      rowId,
      instanceCount: rowInstances.length,
      instanceIds: rowInstances.map((row) => toPublicId(row?.id)).filter(Boolean),
      row
    });
  });

  return {
    assignmentId,
    classId,
    orgId: toPublicId(assignment?.orgId),
    rowCount: splits.length,
    splits,
    reservedIds: localReserved
  };
}

async function allocateSplitIds(plan, assignmentsForClass, reservedIds) {
  const classId = plan.classId;
  const existingIds = (Array.isArray(assignmentsForClass) ? assignmentsForClass : [])
    .map((row) => toPublicId(row?.id))
    .filter(Boolean);
  const withIds = [];
  for (const split of plan.splits) {
    // eslint-disable-next-line no-await-in-loop
    const newId = await reportAssignmentIdService.allocateNextReportAssignmentId(classId, {
      existingIds: [...existingIds, ...withIds.map((row) => row.newId)],
      reservedIds
    });
    reservedIds.add(newId);
    existingIds.push(newId);
    withIds.push({ ...split, newId });
  }
  return withIds;
}

async function listReportAssignmentSplitCandidates({ reqUser, orgId = '' } = {}) {
  const [assignments, instances] = await Promise.all([
    schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    schoolDataService.fetchAllData('reportInstances', {}, reqUser)
  ]);
  const scopedAssignments = filterByOrg(assignments, orgId);
  const scopedInstances = filterByOrg(instances, orgId);
  const reservedIds = new Set(scopedAssignments.map((row) => toPublicId(row?.id)).filter(Boolean));

  const candidates = [];
  scopedAssignments.forEach((assignment) => {
    const plan = planSplitForAssignment(assignment, scopedInstances, reservedIds);
    if (plan) candidates.push(plan);
  });
  return {
    orgId: toPublicId(orgId),
    candidateCount: candidates.length,
    candidates
  };
}

async function runReportAssignmentSplitMigration({
  reqUser,
  orgId = '',
  dryRun = true,
  assignmentIds = []
} = {}) {
  const [assignments, instances] = await Promise.all([
    schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    schoolDataService.fetchAllData('reportInstances', {}, reqUser)
  ]);
  const scopedAssignments = filterByOrg(assignments, orgId);
  const scopedInstances = filterByOrg(instances, orgId);
  const filterIds = new Set((Array.isArray(assignmentIds) ? assignmentIds : []).map((id) => toPublicId(id)).filter(Boolean));
  const reservedIds = new Set(scopedAssignments.map((row) => toPublicId(row?.id)).filter(Boolean));

  const assignmentsByClass = new Map();
  scopedAssignments.forEach((row) => {
    const classToken = toPublicId(row?.classId);
    if (!classToken) return;
    if (!assignmentsByClass.has(classToken)) assignmentsByClass.set(classToken, []);
    assignmentsByClass.get(classToken).push(row);
  });

  const results = [];
  const targets = scopedAssignments.filter((assignment) => {
    if (filterIds.size && !filterIds.has(toPublicId(assignment?.id))) return false;
    return assignmentNeedsSplit(assignment, instancesForAssignment(scopedInstances, assignment?.id));
  });

  for (const parent of targets) {
    const plan = planSplitForAssignment(parent, scopedInstances, reservedIds);
    if (!plan) continue;
    const classAssignments = assignmentsByClass.get(plan.classId) || [];
    const splitsWithIds = await allocateSplitIds(plan, classAssignments, reservedIds);

    const entry = {
      parentAssignmentId: plan.assignmentId,
      classId: plan.classId,
      dryRun: dryRun !== false,
      splits: splitsWithIds.map((split) => ({
        rowId: split.rowId,
        newAssignmentId: split.newId,
        instanceCount: split.instanceCount,
        instanceIds: split.instanceIds
      }))
    };

    if (dryRun !== false) {
      results.push({ ...entry, status: 'planned' });
      continue;
    }

    for (const split of splitsWithIds) {
      const payload = buildSplitAssignmentPayload(parent, split.row, { newId: split.newId });
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.addData('reportAssignments', payload, reqUser, { skipDeletionGuard: true });
      for (const instanceId of split.instanceIds) {
        // eslint-disable-next-line no-await-in-loop
        await schoolDataService.updateData('reportInstances', instanceId, {
          assignmentId: split.newId
        }, reqUser, { skipDeletionGuard: true });
      }
    }

    await schoolDataService.updateData('reportAssignments', parent.id, {
      status: 'archived',
      notes: [clean(parent?.notes), `Archived after split into ${splitsWithIds.map((row) => row.newId).join(', ')}`]
        .filter(Boolean)
        .join('\n'),
      audit: {
        ...(parent?.audit || {}),
        lastUpdateUser: 'reportAssignmentSplitMigration',
        lastUpdateDateTime: new Date().toISOString()
      }
    }, reqUser, { skipDeletionGuard: true });

    results.push({ ...entry, status: 'applied' });
  }

  return {
    orgId: toPublicId(orgId),
    dryRun: dryRun !== false,
    processedCount: results.length,
    results
  };
}

module.exports = {
  assignmentNeedsSplit,
  collectRowGroups,
  planSplitForAssignment,
  listReportAssignmentSplitCandidates,
  runReportAssignmentSplitMigration
};
