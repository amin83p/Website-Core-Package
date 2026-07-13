const schoolDataService = require('./schoolDataService');
const registrationIntegrityService = require('./registrationIntegrityService');
const classEnrollmentDeleteService = require('./classEnrollmentDeleteService');
const classFolderPaths = require('./classFolderPaths');
const { SECTION_HREFS } = require('./schoolDeletionRuleRegistry');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_SAMPLES = 5;

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

  const deletableFolderCount = orphanDirs.filter((row) => !row.blockedByGlobalClass).length;
  const selectableDeleteCount = Object.values(dbOrphans).reduce(
    (sum, group) => sum + (group.rows || []).filter((row) => row.canSelect).length,
    0
  );

  const issueCount = deletableFolderCount
    + cycleLinks.stalePointers.length
    + ledgerOrphans.length
    + Object.values(dbOrphans).reduce((sum, group) => sum + Number(group.count || 0), 0);

  return {
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

async function deleteSelectedOrphans(orgId, reqUser, selected = {}, scanSnapshot = null) {
  const deleted = {};
  const errors = [];
  const skipped = {};

  const snapshot = scanSnapshot || await scanClassStorageIntegrity(orgId, reqUser);
  const rowIndex = {};
  for (const [key, group] of Object.entries(snapshot.dbOrphans || {})) {
    rowIndex[key] = new Map((group.rows || []).map((row) => [toPublicId(row.id), row]));
  }

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
  applyClassStorageIntegrity,
  DB_ORPHAN_COLLECTIONS
};
