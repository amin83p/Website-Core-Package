const schoolDataService = require('./schoolDataService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportScopePolicy = require('./reportScopePolicy');
const sessionReportAssignmentService = require('./sessionReportAssignmentService');
const classReferenceSyncService = require('./classReferenceSyncService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

/** One-class repair guard (EAL-AM-O/G-Low Intermediate Conversation-RON). */
const REPAIR_CLASS_TITLE = 'EAL-AM-O/G-Low Intermediate Conversation-RON';

function clean(value) {
  return String(value || '').trim();
}

function normalizeClassTitle(value) {
  return clean(value).replace(/\s+/g, ' ').toLowerCase();
}

function inferAssignmentReportScope(row) {
  try {
    return reportScopePolicy.normalizeReportScope(row?.reportScope);
  } catch (_) {
    return 'class';
  }
}

function listAssignmentsForClassScope(assignments = [], classId = '', reportScope = 'class') {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classToken = toPublicId(classId);
  if (!classToken) return [];
  return (Array.isArray(assignments) ? assignments : []).filter((row) => (
    idsEqual(row?.classId, classToken) && inferAssignmentReportScope(row) === scope
  ));
}

function countInstancesByAssignmentId(instances = []) {
  const counts = new Map();
  (Array.isArray(instances) ? instances : []).forEach((row) => {
    const id = toPublicId(row?.assignmentId);
    if (!id) return;
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
}

function pickCanonicalAssignment(assignments = [], instanceCounts = new Map()) {
  const rows = Array.isArray(assignments) ? assignments : [];
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];

  const scored = rows.map((assignment) => {
    const id = toPublicId(assignment?.id);
    const targetRowCount = reportAssignmentModel.getEffectiveTargetRows(assignment).length;
    const instanceCount = instanceCounts.get(id) || 0;
    const created = clean(assignment?.audit?.createDateTime);
    return {
      assignment,
      id,
      targetRowCount,
      instanceCount,
      created
    };
  });

  scored.sort((a, b) => {
    if (b.instanceCount !== a.instanceCount) return b.instanceCount - a.instanceCount;
    if (b.targetRowCount !== a.targetRowCount) return b.targetRowCount - a.targetRowCount;
    if (a.created && b.created && a.created !== b.created) return a.created.localeCompare(b.created);
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  return scored[0]?.assignment || rows[0];
}

function mergeTargetRowsFromAssignments(assignments = []) {
  let merged = [];
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    const rows = reportAssignmentModel.getEffectiveTargetRows(assignment);
    rows.forEach((row) => {
      merged = sessionReportAssignmentService.mergeTargetRows(merged, row);
    });
  });
  return merged;
}

function unionPersonIds(assignments = []) {
  const seen = new Set();
  const ids = [];
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    (Array.isArray(assignment?.targetStudentIds) ? assignment.targetStudentIds : []).forEach((id) => {
      const token = toPublicId(id);
      if (!token || seen.has(token)) return;
      seen.add(token);
      ids.push(token);
    });
  });
  return ids;
}

function unionTeacherIds(assignments = [], mergedRows = []) {
  const seen = new Set();
  const ids = [];
  const push = (value) => {
    const token = toPublicId(value);
    if (!token || seen.has(token)) return;
    seen.add(token);
    ids.push(token);
  };
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    (Array.isArray(assignment?.teacherIds) ? assignment.teacherIds : []).forEach(push);
  });
  mergedRows.forEach((row) => push(row?.teacherId));
  return ids;
}

async function assertRepairClassTitle(classData, classId = '') {
  const title = clean(classData?.title);
  if (normalizeClassTitle(title) !== normalizeClassTitle(REPAIR_CLASS_TITLE)) {
    throw new Error(
      `This repair is limited to class "${REPAIR_CLASS_TITLE}". `
      + `Resolved class ${toPublicId(classId) || classId} has title "${title || '(empty)'}".`
    );
  }
}

async function auditReportAssignmentDuplicatesForClass({
  classId,
  reportScope = 'each_student',
  reqUser,
  skipTitleGuard = false
} = {}) {
  const classToken = toPublicId(classId);
  if (!classToken) throw new Error('classId is required.');

  const classData = await schoolDataService.getDataById('classes', classToken, reqUser);
  if (!classData) throw new Error('Class not found or inaccessible.');
  if (!skipTitleGuard) await assertRepairClassTitle(classData, classToken);

  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const [assignments, instances] = await Promise.all([
    schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    schoolDataService.fetchAllData('reportInstances', {}, reqUser)
  ]);

  const matches = listAssignmentsForClassScope(assignments, classToken, scope);
  const instanceCounts = countInstancesByAssignmentId(instances);
  const canonical = pickCanonicalAssignment(matches, instanceCounts);

  const assignmentDetails = matches.map((assignment) => {
    const id = toPublicId(assignment?.id);
    const rows = reportAssignmentModel.getEffectiveTargetRows(assignment);
    return {
      assignmentId: id,
      targetRowCount: rows.length,
      instanceCount: instanceCounts.get(id) || 0,
      createdAt: clean(assignment?.audit?.createDateTime),
      targetRows: rows.map((row) => ({
        rowId: clean(row?.rowId),
        reportStartDate: clean(row?.reportStartDate),
        reportDueDate: clean(row?.reportDueDate),
        sessionId: clean(row?.sessionId),
        sessionDate: clean(row?.sessionDate || row?.dueDate)
      }))
    };
  });

  const duplicateIds = matches
    .map((row) => toPublicId(row?.id))
    .filter((id) => id && canonical?.id && !idsEqual(id, canonical.id));

  const instancesToRepoint = (Array.isArray(instances) ? instances : []).filter((row) => (
    duplicateIds.some((dupId) => idsEqual(row?.assignmentId, dupId))
  )).length;

  return {
    classId: classToken,
    classTitle: clean(classData?.title),
    reportScope: scope,
    assignmentCount: matches.length,
    canonicalAssignmentId: toPublicId(canonical?.id),
    duplicateAssignmentIds: duplicateIds,
    instancesToRepoint,
    mergedTargetRowCount: mergeTargetRowsFromAssignments(matches).length,
    assignments: assignmentDetails
  };
}

async function consolidateReportAssignmentsForClass({
  classId,
  reportScope = 'each_student',
  reqUser,
  dryRun = true,
  skipTitleGuard = false
} = {}) {
  const audit = await auditReportAssignmentDuplicatesForClass({
    classId,
    reportScope,
    reqUser,
    skipTitleGuard
  });

  if (audit.assignmentCount <= 1) {
    return {
      ...audit,
      dryRun: Boolean(dryRun),
      merged: false,
      message: 'No duplicate assignments to merge for this class and scope.'
    };
  }

  const classToken = audit.classId;
  const scope = audit.reportScope;
  const [assignments, instances] = await Promise.all([
    schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    schoolDataService.fetchAllData('reportInstances', {}, reqUser)
  ]);
  const matches = listAssignmentsForClassScope(assignments, classToken, scope);
  const instanceCounts = countInstancesByAssignmentId(instances);
  const canonical = pickCanonicalAssignment(matches, instanceCounts);
  const canonicalId = toPublicId(canonical?.id);
  if (!canonicalId) throw new Error('Unable to resolve canonical assignment.');

  const duplicateAssignments = matches.filter((row) => !idsEqual(row?.id, canonicalId));
  const mergedTargetRows = mergeTargetRowsFromAssignments(matches);
  const mergedTargetStudentIds = unionPersonIds(matches);
  const mergedTeacherIds = unionTeacherIds(matches, mergedTargetRows);
  const firstActiveRow = mergedTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active')
    || mergedTargetRows[0]
    || {};

  const now = new Date().toISOString();
  const basePayload = {
    orgId: toPublicId(canonical.orgId || reqUser?.activeOrgId),
    classId: classToken,
    reportScope: scope,
    targetStudentIds: mergedTargetStudentIds,
    templateId: toPublicId(canonical.templateId),
    templateVersion: Number(canonical.templateVersion || 1),
    teacherIds: mergedTeacherIds,
    targetRows: mergedTargetRows,
    targetType: firstActiveRow.targetType || canonical.targetType,
    sessionId: firstActiveRow.sessionId || canonical.sessionId,
    sessionDate: firstActiveRow.sessionDate || canonical.sessionDate,
    dueDate: firstActiveRow.dueDate || canonical.dueDate,
    conflictPermitted: firstActiveRow.conflictPermitted !== undefined
      ? Boolean(firstActiveRow.conflictPermitted)
      : Boolean(canonical.conflictPermitted),
    taskStartTime: firstActiveRow.taskStartTime || canonical.taskStartTime,
    taskEndTime: firstActiveRow.taskEndTime || canonical.taskEndTime,
    reportStartDate: firstActiveRow.reportStartDate || canonical.reportStartDate,
    reportDueDate: firstActiveRow.reportDueDate || canonical.reportDueDate,
    status: clean(canonical.status) || 'active',
    notes: clean(canonical.notes),
    timesheetReflection: Boolean(firstActiveRow.timesheetReflection || canonical.timesheetReflection),
    allocatedHours: Number(firstActiveRow.allocatedHours || canonical.allocatedHours || 0),
    conductRequiredBeforeFill: firstActiveRow.conductRequiredBeforeFill !== undefined
      ? Boolean(firstActiveRow.conductRequiredBeforeFill)
      : Boolean(canonical.conductRequiredBeforeFill !== false),
    sharedAnswers: canonical.sharedAnswers || {},
    audit: {
      createUser: canonical?.audit?.createUser || reqUser?.id || '',
      createDateTime: canonical?.audit?.createDateTime || now,
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  };

  if (dryRun) {
    return {
      ...audit,
      dryRun: true,
      merged: false,
      message: `Dry run: would merge ${duplicateAssignments.length} duplicate assignment(s) into ${canonicalId}.`,
      payloadPreview: {
        targetRowCount: mergedTargetRows.length,
        targetStudentCount: mergedTargetStudentIds.length,
        teacherCount: mergedTeacherIds.length
      }
    };
  }

  let repointedInstances = 0;
  for (const duplicate of duplicateAssignments) {
    const duplicateId = toPublicId(duplicate?.id);
    if (!duplicateId) continue;
    const ownedInstances = (Array.isArray(instances) ? instances : []).filter((row) => (
      idsEqual(row?.assignmentId, duplicateId)
    ));
    // eslint-disable-next-line no-restricted-syntax
    for (const instance of ownedInstances) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData(
        'reportInstances',
        instance.id,
        {
          ...instance,
          assignmentId: canonicalId
        },
        reqUser
      );
      repointedInstances += 1;
    }
  }

  await schoolDataService.updateData('reportAssignments', canonicalId, basePayload, reqUser);
  await classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows({
    assignmentId: canonicalId,
    previousAssignment: canonical,
    nextAssignment: { ...canonical, ...basePayload, id: canonicalId },
    reqUser
  });

  const removedAssignmentIds = [];
  for (const duplicate of duplicateAssignments) {
    const duplicateId = toPublicId(duplicate?.id);
    if (!duplicateId) continue;
    // eslint-disable-next-line no-await-in-loop
    await schoolDataService.deleteData('reportAssignments', duplicateId, reqUser, { skipDeletionGuard: true });
    removedAssignmentIds.push(duplicateId);
  }

  await classReferenceSyncService.notifyClassReferencesChanged({
    classId: classToken,
    reason: `report_assignment_consolidated:${canonicalId}`,
    reqUser
  });

  return {
    ...audit,
    dryRun: false,
    merged: true,
    canonicalAssignmentId: canonicalId,
    removedAssignmentIds,
    repointedInstances,
    targetRowCount: mergedTargetRows.length,
    message: `Merged ${removedAssignmentIds.length} duplicate assignment(s) into ${canonicalId}.`
  };
}

async function resolveClassIdByRepairTitle(reqUser) {
  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser);
  const target = normalizeClassTitle(REPAIR_CLASS_TITLE);
  const match = (Array.isArray(classes) ? classes : []).find((row) => (
    normalizeClassTitle(row?.title) === target
  ));
  return toPublicId(match?.id) || '';
}

module.exports = {
  REPAIR_CLASS_TITLE,
  listAssignmentsForClassScope,
  pickCanonicalAssignment,
  mergeTargetRowsFromAssignments,
  auditReportAssignmentDuplicatesForClass,
  consolidateReportAssignmentsForClass,
  resolveClassIdByRepairTitle
};
