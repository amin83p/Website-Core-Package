const schoolDataService = require('./schoolDataService');
const registrationIntegrityService = require('./registrationIntegrityService');
const classEnrollmentDeleteService = require('./classEnrollmentDeleteService');
const classFolderPaths = require('./classFolderPaths');
const reportIntegrityService = require('./reportIntegrityService');
const { SECTION_HREFS } = require('./schoolDeletionRuleRegistry');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_SAMPLES = 5;

const INTEGRITY_MAINTENANCE_ENTITY_KEYS = new Set([
  'reportInstances',
  'reportAssignments',
  'sessionStudentCases',
  'examAllocations',
  'examAssignments'
]);

const DB_ORPHAN_COLLECTIONS = Object.freeze([
  {
    key: 'classEnrollmentPeriods',
    entityType: 'classEnrollmentPeriods',
    label: 'Class Enrollment Periods',
    href: (row) => SECTION_HREFS.enrollments(toPublicId(row?.id))
  },
  {
    key: 'reportInstances',
    entityType: 'reportInstances',
    label: 'Report Instances',
    href: (row) => SECTION_HREFS.reports.instance(toPublicId(row?.id))
  },
  {
    key: 'reportAssignments',
    entityType: 'reportAssignments',
    label: 'Report Assignments',
    href: (row) => SECTION_HREFS.reports.assignment(toPublicId(row?.id))
  },
  {
    key: 'sessionStudentCases',
    entityType: 'sessionStudentCases',
    label: 'Session Student Cases',
    href: (row) => SECTION_HREFS.cases(row?.classId, row?.sessionId)
  },
  {
    key: 'examAllocations',
    entityType: 'examAllocations',
    label: 'Exam Allocations',
    href: (row) => SECTION_HREFS.exams.allocation(toPublicId(row?.id))
  },
  {
    key: 'examAssignments',
    entityType: 'examAssignments',
    label: 'Exam Assignments',
    href: (row) => SECTION_HREFS.exams.assignment(toPublicId(row?.id))
  }
]);

const DANGLING_REF_GROUPS = Object.freeze([
  {
    key: 'reportInstances',
    entityType: 'reportInstances',
    label: 'Report Instances',
    href: (row) => SECTION_HREFS.reports.instance(toPublicId(row?.id))
  },
  {
    key: 'sessionStudentCases',
    entityType: 'sessionStudentCases',
    label: 'Session Student Cases',
    href: (row) => SECTION_HREFS.cases(row?.classId, row?.sessionId)
  },
  {
    key: 'examAssignments',
    entityType: 'examAssignments',
    label: 'Exam Assignments',
    href: (row) => SECTION_HREFS.exams.assignment(toPublicId(row?.id))
  },
  {
    key: 'examAllocations',
    entityType: 'examAllocations',
    label: 'Exam Allocations',
    href: (row) => SECTION_HREFS.exams.allocation(toPublicId(row?.id))
  }
]);

function resolveActor(reqUser) {
  return String(
    reqUser?.id || reqUser?.userId || reqUser?.username || reqUser?.email || 'system'
  ).trim() || 'system';
}

function buildSample(row, labelFn, hrefFn) {
  const id = toPublicId(row?.id);
  return {
    id,
    label: typeof labelFn === 'function' ? labelFn(row) : String(row?.title || row?.name || id || ''),
    href: typeof hrefFn === 'function' ? hrefFn(row) : ''
  };
}

async function fetchOrgClasses(orgId, reqUser) {
  const rows = await schoolDataService.fetchData('classes', { page: 1, orgId__eq: orgId }, reqUser);
  return Array.isArray(rows) ? rows : [];
}

async function fetchAllClassIds(reqUser) {
  const rows = await schoolDataService.fetchData('classes', { page: 1 }, reqUser);
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = toPublicId(row?.id);
    if (id) set.add(id);
  }
  return set;
}

async function scanStaleCycleLinks(classRows, liveClassIds) {
  const stalePointers = [];
  const liveById = new Map(classRows.map((row) => [toPublicId(row?.id), row]));

  for (const row of classRows) {
    const classId = toPublicId(row?.id);
    if (!classId) continue;

    for (const field of ['previousClassId', 'nextClassId']) {
      const pointsTo = toPublicId(row?.[field]);
      if (!pointsTo) continue;
      if (!liveClassIds.has(pointsTo)) {
        stalePointers.push({
          classId,
          classTitle: String(row?.title || row?.name || classId).trim(),
          field,
          pointsTo,
          action: 'clear_field'
        });
      }
    }
  }

  return { stalePointers, liveById };
}

function classifyEnrollmentOrphanSeverity(eligibility = {}) {
  if (eligibility.canDelete) return 'safe_draft_delete';
  if (eligibility.blockCode === 'ENROLLMENT_POSTED') return 'needs_rollback';
  if (eligibility.blockCode === 'TERM_REGISTRATION') return 'review_only';
  if (eligibility.blockCode === 'TIMESHEET_LOCKED_SESSION') return 'review_only';
  return 'review_only';
}

async function classifyDbOrphanRow(collection, row, reqUser, liveClassIds) {
  const classId = toPublicId(row?.classId);
  if (!classId || liveClassIds.has(classId)) {
    return null;
  }

  const base = {
    id: toPublicId(row?.id),
    classId,
    label: String(row?.title || row?.name || row?.studentId || row?.id || '').trim(),
    href: collection.href(row),
    severity: 'review_only',
    canSelect: false,
    blockReason: ''
  };

  if (collection.key === 'classEnrollmentPeriods') {
    const classRow = await schoolDataService.getDataById('classes', classId, reqUser);
    const eligibility = await classEnrollmentDeleteService.assessEnrollmentDeleteEligibility(
      row,
      classRow || { id: classId },
      reqUser
    );
    const severity = classifyEnrollmentOrphanSeverity(eligibility);
    return {
      ...base,
      studentId: toPublicId(row?.studentId),
      status: String(row?.status || '').trim().toLowerCase(),
      severity,
      canSelect: severity === 'safe_draft_delete',
      blockReason: eligibility.blockReason || '',
      warnings: eligibility.warnings || []
    };
  }

  if (INTEGRITY_MAINTENANCE_ENTITY_KEYS.has(collection.key)) {
    const maintenanceNotes = {
      sessionStudentCases: 'Parent class was deleted and the session case cannot be opened. Remove it here to clear the orphaned reference.',
      reportInstances: 'Parent class was deleted. This report instance is orphaned and should be removed here.',
      reportAssignments: 'Parent class was deleted. This report assignment is orphaned and should be removed here.',
      examAllocations: 'Parent class was deleted. This exam allocation is orphaned and should be removed here.',
      examAssignments: 'Parent class was deleted. This exam assignment is orphaned and should be removed here.'
    };
    const maintenanceHrefs = {
      reportInstances: (item) => SECTION_HREFS.reports.instance(toPublicId(item?.id)),
      reportAssignments: (item) => SECTION_HREFS.reports.assignment(toPublicId(item?.id)),
      examAllocations: (item) => SECTION_HREFS.exams.allocation(toPublicId(item?.id)),
      examAssignments: (item) => SECTION_HREFS.exams.assignment(toPublicId(item?.id)),
      sessionStudentCases: () => ''
    };
    return {
      ...base,
      issueCode: 'missing_class',
      severity: 'safe_delete',
      canSelect: true,
      href: maintenanceHrefs[collection.key] ? maintenanceHrefs[collection.key](row) : '',
      blockReason: maintenanceNotes[collection.key] || 'Parent class was deleted.'
    };
  }

  return {
    ...base,
    severity: 'review_only',
    canSelect: true,
    blockReason: ''
  };
}

async function scanDbOrphans(orgId, reqUser, liveClassIds) {
  const dbOrphans = {};

  for (const collection of DB_ORPHAN_COLLECTIONS) {
    const rows = await schoolDataService.fetchData(
      collection.entityType,
      { page: 1, orgId__eq: orgId },
      reqUser
    );
    const orphans = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      // eslint-disable-next-line no-await-in-loop
      const classified = await classifyDbOrphanRow(collection, row, reqUser, liveClassIds);
      if (classified) orphans.push(classified);
    }

    dbOrphans[collection.key] = {
      label: collection.label,
      entityType: collection.entityType,
      count: orphans.length,
      samples: orphans.slice(0, MAX_SAMPLES).map((item) => ({
        id: item.id,
        label: item.label || item.id,
        href: item.href,
        severity: item.severity
      })),
      rows: orphans
    };
  }

  return dbOrphans;
}

function buildIdSet(rows = []) {
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = toPublicId(row?.id);
    if (id) set.add(id);
  }
  return set;
}

async function buildClassSessionIdSet(classId, reqUser, cache = new Map()) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return new Set();
  if (cache.has(normalizedClassId)) return cache.get(normalizedClassId);

  const sessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
  const sessionIds = new Set(
    (Array.isArray(sessions) ? sessions : [])
      .map((row) => toPublicId(row?.sessionId || row?.id))
      .filter(Boolean)
  );
  cache.set(normalizedClassId, sessionIds);
  return sessionIds;
}

async function buildDanglingScanContext(orgId, reqUser, classRows, liveClassIds) {
  const classTitleById = new Map(
    classRows.map((row) => [
      toPublicId(row?.id),
      String(row?.title || row?.name || row?.id || '').trim()
    ])
  );
  const [
    reportAssignments,
    examAllocations,
    examTemplates,
    examRevisions
  ] = await Promise.all([
    schoolDataService.fetchData('reportAssignments', { page: 1, orgId__eq: orgId }, reqUser),
    schoolDataService.fetchData('examAllocations', { page: 1, orgId__eq: orgId }, reqUser),
    schoolDataService.fetchData('examTemplates', { page: 1, orgId__eq: orgId }, reqUser),
    schoolDataService.fetchData('examRevisions', { page: 1, orgId__eq: orgId }, reqUser)
  ]);

  const sessionIdsByClass = new Map();
  for (const classRow of classRows) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    await buildClassSessionIdSet(classId, reqUser, sessionIdsByClass);
  }

  return {
    liveClassIds,
    classTitleById,
    assignmentIds: buildIdSet(reportAssignments),
    allocationIds: buildIdSet(examAllocations),
    templateIds: buildIdSet(examTemplates),
    revisionIds: buildIdSet(examRevisions),
    sessionIdsByClass
  };
}

function buildDanglingRowBase(row, classId, context, group) {
  return {
    id: toPublicId(row?.id),
    classId,
    classTitle: context.classTitleById.get(classId) || classId,
    label: String(row?.title || row?.studentId || row?.templateId || row?.id || '').trim(),
    href: group.href(row),
    issueCode: '',
    blockReason: ''
  };
}

function classifyDanglingReportInstance(row, context, group) {
  const classId = toPublicId(row?.classId);
  if (!classId || !context.liveClassIds.has(classId)) return null;

  const assignmentId = toPublicId(row?.assignmentId);
  const sessionId = toPublicId(row?.sessionId);
  const status = String(row?.status || '').trim().toLowerCase();
  let issueCode = '';
  let blockReason = '';

  if (status === 'archived') {
    issueCode = 'archived_hidden';
    blockReason = 'Archived report instance (hidden from Report Instances list).';
  } else if (!assignmentId) {
    issueCode = 'missing_assignment';
    blockReason = 'Report instance has no assignment link (hidden from Report Instances list).';
  } else if (!context.assignmentIds.has(assignmentId)) {
    issueCode = 'missing_assignment';
    blockReason = 'Parent report assignment no longer exists (hidden from Report Instances list).';
  } else if (sessionId) {
    const sessionIds = context.sessionIdsByClass.get(classId) || new Set();
    if (!sessionIds.has(sessionId)) {
      issueCode = 'missing_session';
      blockReason = 'Referenced session is not on this class.';
    }
  }

  if (!issueCode) return null;

  const base = buildDanglingRowBase(row, classId, context, group);
  const deleteEligibility = reportIntegrityService.resolveInstanceDeleteEligibility(row?.status);
  if (!deleteEligibility.allowed && status === 'locked') {
    return {
      ...base,
      issueCode,
      severity: 'safe_delete',
      canSelect: true,
      blockReason: `${blockReason} Locked instance will be unlocked automatically during integrity cleanup.`
    };
  }
  if (!deleteEligibility.allowed) {
    return {
      ...base,
      issueCode: 'locked',
      severity: 'review_only',
      canSelect: false,
      blockReason: deleteEligibility.reason || 'Unlock the report instance before deleting it.'
    };
  }

  return {
    ...base,
    issueCode,
    severity: 'safe_delete',
    canSelect: true,
    blockReason
  };
}

function classifyDanglingSessionCase(row, context, group) {
  const classId = toPublicId(row?.classId);
  if (!classId || !context.liveClassIds.has(classId)) return null;

  const sessionId = toPublicId(row?.sessionId);
  if (!sessionId) return null;

  const sessionIds = context.sessionIdsByClass.get(classId) || new Set();
  if (sessionIds.has(sessionId)) return null;

  return {
    ...buildDanglingRowBase(row, classId, context, group),
    href: '',
    issueCode: 'missing_session',
    severity: 'safe_delete',
    canSelect: true,
    blockReason: 'Referenced session was removed from this class. The case cannot be opened; remove it here to clear the orphaned reference.'
  };
}

function classifyDanglingExamAssignment(row, context, group) {
  const classId = toPublicId(row?.classId);
  if (!classId || !context.liveClassIds.has(classId)) return null;

  const allocationId = toPublicId(row?.allocationId);
  if (!allocationId || context.allocationIds.has(allocationId)) return null;

  return {
    ...buildDanglingRowBase(row, classId, context, group),
    issueCode: 'missing_allocation',
    severity: 'safe_delete',
    canSelect: true,
    blockReason: 'Parent exam allocation no longer exists.'
  };
}

function classifyDanglingExamAllocation(row, context, group) {
  const classId = toPublicId(row?.classId);
  if (!classId || !context.liveClassIds.has(classId)) return null;

  const templateId = toPublicId(row?.templateId);
  const revisionId = toPublicId(row?.revisionId);
  const missingTemplate = templateId && !context.templateIds.has(templateId);
  const missingRevision = revisionId && !context.revisionIds.has(revisionId);
  if (!missingTemplate && !missingRevision) return null;

  const issues = [];
  if (missingTemplate) issues.push('exam template');
  if (missingRevision) issues.push('exam revision');

  return {
    ...buildDanglingRowBase(row, classId, context, group),
    issueCode: missingTemplate && missingRevision ? 'missing_template_and_revision' : (missingTemplate ? 'missing_template' : 'missing_revision'),
    severity: 'review_only',
    canSelect: false,
    blockReason: `Missing ${issues.join(' and ')}. Cancel and clean up via Exams module.`
  };
}

const DANGLING_CLASSIFIERS = Object.freeze({
  reportInstances: classifyDanglingReportInstance,
  sessionStudentCases: classifyDanglingSessionCase,
  examAssignments: classifyDanglingExamAssignment,
  examAllocations: classifyDanglingExamAllocation
});

async function scanDanglingClassReferences(orgId, reqUser, classRows, liveClassIds) {
  const context = await buildDanglingScanContext(orgId, reqUser, classRows, liveClassIds);
  const danglingRefs = {};

  for (const group of DANGLING_REF_GROUPS) {
    const classifier = DANGLING_CLASSIFIERS[group.key];
    const rows = await schoolDataService.fetchData(
      group.entityType,
      { page: 1, orgId__eq: orgId },
      reqUser
    );
    const danglingRows = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const classified = classifier ? classifier(row, context, group) : null;
      if (classified) danglingRows.push(classified);
    }

    danglingRefs[group.key] = {
      label: group.label,
      entityType: group.entityType,
      count: danglingRows.length,
      samples: danglingRows.slice(0, MAX_SAMPLES).map((item) => ({
        id: item.id,
        label: item.label || item.id,
        href: item.href,
        severity: item.severity,
        issueCode: item.issueCode
      })),
      rows: danglingRows
    };
  }

  return danglingRefs;
}

function countDanglingSelectableRows(danglingRefs = {}) {
  return Object.values(danglingRefs).reduce(
    (sum, group) => sum + (group.rows || []).filter((row) => row.canSelect).length,
    0
  );
}

function countDanglingRows(danglingRefs = {}) {
  return Object.values(danglingRefs).reduce(
    (sum, group) => sum + Number(group.count || 0),
    0
  );
}

async function scanClassStorageIntegrity(orgId, reqUser) {
  const normalizedOrgId = String(orgId || '').trim();
  if (!normalizedOrgId) throw new Error('orgId is required.');

  const classRows = await fetchOrgClasses(normalizedOrgId, reqUser);
  const liveClassIds = new Set(classRows.map((row) => toPublicId(row?.id)).filter(Boolean));
  const globalLiveClassIds = await fetchAllClassIds(reqUser);

  const orphanDirs = await classFolderPaths.scanOrphanClassFolders(
    normalizedOrgId,
    liveClassIds,
    globalLiveClassIds
  );
  const missingDirsForClasses = await classFolderPaths.scanMissingFoldersForLiveClasses(classRows);
  const cycleLinks = await scanStaleCycleLinks(classRows, liveClassIds);
  const ledgerOrphans = await registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg(
    normalizedOrgId,
    reqUser
  );
  const dbOrphans = await scanDbOrphans(normalizedOrgId, reqUser, liveClassIds);
  const danglingRefs = await scanDanglingClassReferences(normalizedOrgId, reqUser, classRows, liveClassIds);

  const deletableFolderCount = orphanDirs.filter((row) => !row.blockedByGlobalClass).length;
  const dbOrphanSelectableCount = Object.values(dbOrphans).reduce(
    (sum, group) => sum + (group.rows || []).filter((row) => row.canSelect).length,
    0
  );
  const danglingSelectableCount = countDanglingSelectableRows(danglingRefs);
  const selectableDeleteCount = dbOrphanSelectableCount + danglingSelectableCount;

  const issueCount = deletableFolderCount
    + cycleLinks.stalePointers.length
    + ledgerOrphans.length
    + Object.values(dbOrphans).reduce((sum, group) => sum + Number(group.count || 0), 0)
    + countDanglingRows(danglingRefs);

  const scanPayload = {
    orgId: normalizedOrgId,
    scannedAt: new Date().toISOString(),
    liveClassCount: liveClassIds.size,
    folders: {
      orphanDirs,
      missingDirsForClasses
    },
    cycleLinks,
    ledger: {
      orphanEntries: ledgerOrphans
    },
    dbOrphans,
    danglingRefs,
    safeFixPreview: {
      folderCount: deletableFolderCount,
      staleLinkCount: cycleLinks.stalePointers.length,
      ledgerVoidCount: ledgerOrphans.length
    },
    totals: {
      issueCount,
      safeFixCount: deletableFolderCount + cycleLinks.stalePointers.length + ledgerOrphans.length,
      selectableDeleteCount
    }
  };

  return scanPayload;
}

async function applySafeFixes(scanSnapshot, reqUser, globalLiveClassIds) {
  const applied = {
    foldersRemoved: 0,
    staleLinksCleared: 0,
    ledgerVoided: 0
  };
  const errors = [];

  for (const orphan of scanSnapshot?.folders?.orphanDirs || []) {
    if (orphan.blockedByGlobalClass) continue;
    try {
      const result = await classFolderPaths.deleteOrphanFolderTarget(orphan, reqUser, globalLiveClassIds);
      if (result.removed) applied.foldersRemoved += 1;
      if (result.skipped && result.reason) {
        errors.push(`${orphan.path}: ${result.reason}`);
      }
    } catch (error) {
      errors.push(`${orphan.path}: ${error.message}`);
    }
  }

  for (const pointer of scanSnapshot?.cycleLinks?.stalePointers || []) {
    try {
      const classRow = await schoolDataService.getDataById('classes', pointer.classId, reqUser);
      if (!classRow) continue;
      const patch = { updatedBy: resolveActor(reqUser) };
      patch[pointer.field] = '';
      await schoolDataService.updateData('classes', pointer.classId, patch, reqUser);
      applied.staleLinksCleared += 1;
    } catch (error) {
      errors.push(`Cycle link ${pointer.classId}.${pointer.field}: ${error.message}`);
    }
  }

  const ledgerResult = await registrationIntegrityService.reconcileOrphanedClassEnrollmentLedgerForOrg(
    scanSnapshot.orgId,
    reqUser,
    { reason: `Class storage integrity safe fix for org ${scanSnapshot.orgId}.` }
  );
  applied.ledgerVoided = (ledgerResult?.voidedEntryIds || []).length;
  errors.push(...(ledgerResult?.issues || []));

  return { applied, errors };
}

async function deleteIntegrityMaintenanceRecord(entityType, recordId, reqUser, orgId) {
  await schoolDataService.deleteData(entityType, recordId, reqUser, {
    orgId,
    skipDeletionGuard: true
  });
}

async function deleteDanglingReportInstance(recordId, reqUser, orgId) {
  let instance = await schoolDataService.getDataById('reportInstances', recordId, reqUser);
  if (!instance) throw new Error('Report instance not found.');

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
    orgId,
    skipDeletionGuard: true
  });
}

async function deleteSelectedDanglingRefs(orgId, reqUser, selectedDangling = {}, scanSnapshot, deleted, errors, skipped) {
  const danglingIndex = {};
  for (const [key, group] of Object.entries(scanSnapshot.danglingRefs || {})) {
    danglingIndex[key] = new Map((group.rows || []).map((row) => [toPublicId(row.id), row]));
  }

  for (const group of DANGLING_REF_GROUPS) {
    const ids = Array.isArray(selectedDangling[group.key]) ? selectedDangling[group.key] : [];
    if (!ids.length) continue;
    const indexKey = `danglingRefs.${group.key}`;
    if (!deleted[indexKey]) deleted[indexKey] = 0;
    if (!skipped[indexKey]) skipped[indexKey] = 0;

    for (const rawId of ids) {
      const recordId = toPublicId(rawId);
      const rowMeta = danglingIndex[group.key]?.get(recordId);
      if (!rowMeta) {
        errors.push(`${group.label} ${recordId}: not found in latest scan.`);
        continue;
      }
      if (!rowMeta.canSelect) {
        skipped[indexKey] += 1;
        errors.push(`${group.label} ${recordId}: ${rowMeta.blockReason || 'not eligible for delete'}`);
        continue;
      }

      try {
        if (group.key === 'reportInstances') {
          await deleteDanglingReportInstance(recordId, reqUser, orgId);
        } else {
          await deleteIntegrityMaintenanceRecord(group.entityType, recordId, reqUser, orgId);
        }
        deleted[indexKey] += 1;
      } catch (error) {
        skipped[indexKey] += 1;
        errors.push(`${group.label} ${recordId}: ${error.message}`);
      }
    }
  }
}

async function deleteSelectedOrphans(orgId, reqUser, selected = {}, scanSnapshot = null) {
  const deleted = {};
  const errors = [];
  const skipped = {};

  const snapshot = scanSnapshot || await scanClassStorageIntegrity(orgId, reqUser);
  const rowIndex = {};
  for (const [key, group] of Object.entries(snapshot.dbOrphans || {})) {
    rowIndex[key] = new Map((group.rows || []).map((row) => [toPublicId(row.id), row]));
  }

  const selectedDangling = selected.danglingRefs && typeof selected.danglingRefs === 'object'
    ? selected.danglingRefs
    : {};
  await deleteSelectedDanglingRefs(orgId, reqUser, selectedDangling, snapshot, deleted, errors, skipped);

  for (const collection of DB_ORPHAN_COLLECTIONS) {
    const ids = Array.isArray(selected[collection.key]) ? selected[collection.key] : [];
    if (!ids.length) continue;
    deleted[collection.key] = 0;
    skipped[collection.key] = 0;

    for (const rawId of ids) {
      const periodId = toPublicId(rawId);
      const rowMeta = rowIndex[collection.key]?.get(periodId);
      if (!rowMeta) {
        errors.push(`${collection.label} ${periodId}: not found in latest scan.`);
        continue;
      }
      if (!rowMeta.canSelect) {
        skipped[collection.key] += 1;
        errors.push(`${collection.label} ${periodId}: ${rowMeta.blockReason || 'not eligible for delete'}`);
        continue;
      }

      try {
        if (collection.key === 'classEnrollmentPeriods') {
          const periodRow = await schoolDataService.getDataById('classEnrollmentPeriods', periodId, reqUser);
          const classRow = periodRow
            ? await schoolDataService.getDataById('classes', periodRow.classId, reqUser)
            : null;
          const eligibility = await classEnrollmentDeleteService.assessEnrollmentDeleteEligibility(
            periodRow,
            classRow || { id: periodRow?.classId },
            reqUser
          );
          if (!eligibility.canDelete) {
            skipped[collection.key] += 1;
            errors.push(`${collection.label} ${periodId}: ${eligibility.blockReason || 'not deletable'}`);
            continue;
          }
          const academicEntryIds = await registrationIntegrityService.discoverRollingClassEnrollmentLedgerEntryIds({
            periodId,
            classId: periodRow?.classId,
            studentId: periodRow?.studentId,
            reqUser
          });
          if (academicEntryIds.length) {
            await registrationIntegrityService.rollbackRegistrationSideEffects({
              registrationId: periodId,
              transactionIds: [],
              academicEntryIds,
              reqUser,
              reason: `Orphan enrollment cleanup for period ${periodId}.`,
              reverseEventPrefix: 'CLSENRREV'
            });
          }
          await schoolDataService.deleteData('classEnrollmentPeriods', periodId, reqUser, { orgId });
        } else if (collection.key === 'reportInstances') {
          await deleteDanglingReportInstance(periodId, reqUser, orgId);
        } else if (INTEGRITY_MAINTENANCE_ENTITY_KEYS.has(collection.key)) {
          await deleteIntegrityMaintenanceRecord(collection.entityType, periodId, reqUser, orgId);
        } else {
          await schoolDataService.deleteData(collection.entityType, periodId, reqUser, { orgId });
        }
        deleted[collection.key] += 1;
      } catch (error) {
        skipped[collection.key] += 1;
        errors.push(`${collection.label} ${periodId}: ${error.message}`);
      }
    }
  }

  return { deleted, skipped, errors };
}

async function applyClassStorageIntegrity({ orgId, reqUser, mode, selected = {} } = {}) {
  const normalizedOrgId = String(orgId || '').trim();
  if (!normalizedOrgId) throw new Error('orgId is required.');
  const normalizedMode = String(mode || '').trim();
  if (!['safe_fixes', 'delete_selected'].includes(normalizedMode)) {
    throw new Error('mode must be safe_fixes or delete_selected.');
  }

  const scanSnapshot = await scanClassStorageIntegrity(normalizedOrgId, reqUser);
  const globalLiveClassIds = await fetchAllClassIds(reqUser);

  if (normalizedMode === 'safe_fixes') {
    const result = await applySafeFixes(scanSnapshot, reqUser, globalLiveClassIds);
    return {
      mode: normalizedMode,
      scanBefore: scanSnapshot,
      ...result
    };
  }

  const result = await deleteSelectedOrphans(normalizedOrgId, reqUser, selected, scanSnapshot);
  return {
    mode: normalizedMode,
    scanBefore: scanSnapshot,
    ...result
  };
}

module.exports = {
  scanClassStorageIntegrity,
  scanDanglingClassReferences,
  applyClassStorageIntegrity,
  DB_ORPHAN_COLLECTIONS,
  DANGLING_REF_GROUPS,
  INTEGRITY_MAINTENANCE_ENTITY_KEYS
};
