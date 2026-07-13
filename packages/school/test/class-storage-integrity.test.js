const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classStorageIntegrityService = require('../MVC/services/school/classStorageIntegrityService');
const classFolderPaths = require('../MVC/services/school/classFolderPaths');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');

const ORG_1 = 'ORG-1';
const ORG_2 = 'ORG-2';
const LIVE_CLASS = 'CLASS/LIVE';
const DELETED_CLASS = 'CLASS/DELETED';
const STALE_TARGET = 'CLASS/MISSING';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_1 };

function stubFetchForOrgClasses(classRowsByOrg = {}, otherFetches = {}) {
  return async (entityType, filters = {}) => {
    if (entityType === 'classes') {
      const orgId = filters.orgId__eq;
      if (orgId) return classRowsByOrg[orgId] || [];
      return Object.values(classRowsByOrg).flat();
    }
    if (typeof otherFetches[entityType] === 'function') {
      return otherFetches[entityType](filters);
    }
    return [];
  };
}

test('class routes expose storage integrity endpoints', () => {
  const routes = read('MVC/routes/classRoutes.js');
  assert.match(routes, /\/storage-integrity/);
  assert.match(routes, /\/api\/storage-integrity\/scan/);
  assert.match(routes, /\/api\/storage-integrity\/apply/);
  assert.match(routes, /showClassStorageIntegrityPage/);
  assert.match(routes, /getClassStorageIntegrityScanApi/);
  assert.match(routes, /postClassStorageIntegrityApplyApi/);
  assert.match(routes, /\/storage-integrity'[\s\S]*trackActionState\(SECTIONS\.SCHOOL_CLASSES,\s*OPERATIONS\.UPDATE,\s*\{\s*keepActive:\s*true\s*\}\)/);
  assert.match(routes, /\/api\/storage-integrity\/apply'[\s\S]*trackActionState\(SECTIONS\.SCHOOL_CLASSES,\s*OPERATIONS\.UPDATE,\s*\{\s*requireToken:\s*true,\s*keepActive:\s*true\s*\}\)/);
});

test('classes list includes Storage & Integrity maintenance button', () => {
  const view = read('MVC/views/school/class/classes.ejs');
  assert.match(view, /Storage\s*&(?:amp;)?\s*Integrity/);
  assert.match(view, /\/school\/classes\/storage-integrity/);
  assert.match(view, /btn-outline-warning/);
});

test('storage integrity page uses message modals and loading overlay for scan/apply', () => {
  const view = read('MVC/views/school/class/classStorageIntegrity.ejs');
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(view, /showMessageModal/);
  assert.match(view, /showLoading/);
  assert.match(view, /applyGuardedApiResult/);
  assert.match(view, /actionStateId/);
  assert.match(view, /confirmAction/);
  assert.match(view, /No scan has been run yet/);
  assert.match(view, /renderScanResults/);
  assert.match(view, /\/api\/storage-integrity\/scan/);
  assert.doesNotMatch(view, /integrityFeedback/);
  assert.doesNotMatch(view, /window\.alert/);
  assert.doesNotMatch(view, /window\.confirm/);
  assert.doesNotMatch(view, /location\.assign\('\/school\/classes\/storage-integrity/);
  assert.match(controller, /classStorageIntegrity[\s\S]*includeModal:\s*true/);
});

test('storage integrity page load skips scan until user requests it', () => {
  const controller = read('MVC/controllers/school/classController.js');
  const pageHandler = controller.match(/async function showClassStorageIntegrityPage[\s\S]*?^}/m);
  assert.ok(pageHandler, 'showClassStorageIntegrityPage should exist');
  assert.match(pageHandler[0], /scan:\s*null/);
  assert.doesNotMatch(pageHandler[0], /scanClassStorageIntegrity/);
});

test('scanClassStorageIntegrity detects orphan folder when class row is missing', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;

  schoolDataService.fetchData = stubFetchForOrgClasses({
    [ORG_1]: [{ id: LIVE_CLASS, orgId: ORG_1, title: 'Live Class' }]
  });
  classFolderPaths.scanOrphanClassFolders = async () => ([
    {
      classId: DELETED_CLASS,
      source: 'classes_storage',
      path: `/data/school/classes_storage/${DELETED_CLASS}`,
      blockedByGlobalClass: false
    }
  ]);
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];

  try {
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(ORG_1, REQ_USER);
    assert.equal(scan.folders.orphanDirs.length, 1);
    assert.equal(scan.folders.orphanDirs[0].classId, DELETED_CLASS);
    assert.equal(scan.safeFixPreview.folderCount, 1);
    assert.ok(scan.totals.issueCount >= 1);
  } finally {
    schoolDataService.fetchData = originalFetch;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
  }
});

test('scanClassStorageIntegrity flags stale nextClassId pointing to missing class', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;

  schoolDataService.fetchData = stubFetchForOrgClasses({
    [ORG_1]: [{
      id: LIVE_CLASS,
      orgId: ORG_1,
      title: 'Cycle 1',
      nextClassId: STALE_TARGET,
      previousClassId: ''
    }]
  });
  classFolderPaths.scanOrphanClassFolders = async () => [];
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];

  try {
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(ORG_1, REQ_USER);
    assert.equal(scan.cycleLinks.stalePointers.length, 1);
    assert.equal(scan.cycleLinks.stalePointers[0].field, 'nextClassId');
    assert.equal(scan.cycleLinks.stalePointers[0].pointsTo, STALE_TARGET);
    assert.equal(scan.safeFixPreview.staleLinkCount, 1);
  } finally {
    schoolDataService.fetchData = originalFetch;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
  }
});

test('applyClassStorageIntegrity safe_fixes clears stale nextClassId', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalDeleteOrphan = classFolderPaths.deleteOrphanFolderTarget;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;
  const originalLedgerReconcile = registrationIntegrityService.reconcileOrphanedClassEnrollmentLedgerForOrg;

  const classRow = {
    id: LIVE_CLASS,
    orgId: ORG_1,
    title: 'Cycle 1',
    nextClassId: STALE_TARGET,
    previousClassId: ''
  };
  const updates = [];

  schoolDataService.fetchData = stubFetchForOrgClasses({ [ORG_1]: [classRow] });
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === LIVE_CLASS) return { ...classRow };
    return null;
  };
  schoolDataService.updateData = async (entityType, id, patch) => {
    updates.push({ entityType, id, patch });
    return { id, ...patch };
  };
  classFolderPaths.scanOrphanClassFolders = async () => [];
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  classFolderPaths.deleteOrphanFolderTarget = async () => ({ removed: false });
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];
  registrationIntegrityService.reconcileOrphanedClassEnrollmentLedgerForOrg = async () => ({
    voidedEntryIds: [],
    issues: []
  });

  try {
    const result = await classStorageIntegrityService.applyClassStorageIntegrity({
      orgId: ORG_1,
      reqUser: REQ_USER,
      mode: 'safe_fixes'
    });
    assert.equal(result.mode, 'safe_fixes');
    assert.equal(result.applied.staleLinksCleared, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].entityType, 'classes');
    assert.equal(updates[0].id, LIVE_CLASS);
    assert.equal(updates[0].patch.nextClassId, '');
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    classFolderPaths.deleteOrphanFolderTarget = originalDeleteOrphan;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
    registrationIntegrityService.reconcileOrphanedClassEnrollmentLedgerForOrg = originalLedgerReconcile;
  }
});

test('scanClassStorageIntegrity classifies draft enrollment orphan as safe_draft_delete', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;
  const originalSessions = schoolDataService.getClassSessions;

  const periodId = 'CEP/DRAFT-1';
  schoolDataService.fetchData = stubFetchForOrgClasses(
    { [ORG_1]: [{ id: LIVE_CLASS, orgId: ORG_1 }] },
    {
      classEnrollmentPeriods: () => ([{
        id: periodId,
        orgId: ORG_1,
        classId: DELETED_CLASS,
        studentId: 'STU/1',
        status: 'draft'
      }])
    }
  );
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === DELETED_CLASS) return null;
    return null;
  };
  schoolDataService.getClassSessions = async () => [];
  classFolderPaths.scanOrphanClassFolders = async () => [];
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];

  try {
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(ORG_1, REQ_USER);
    const group = scan.dbOrphans.classEnrollmentPeriods;
    assert.equal(group.count, 1);
    assert.equal(group.rows[0].severity, 'safe_draft_delete');
    assert.equal(group.rows[0].canSelect, true);
    assert.equal(scan.totals.selectableDeleteCount, 1);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('scanClassStorageIntegrity classifies posted enrollment orphan as needs_rollback', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;
  const originalSessions = schoolDataService.getClassSessions;

  schoolDataService.fetchData = stubFetchForOrgClasses(
    { [ORG_1]: [{ id: LIVE_CLASS, orgId: ORG_1 }] },
    {
      classEnrollmentPeriods: () => ([{
        id: 'CEP/POSTED-1',
        orgId: ORG_1,
        classId: DELETED_CLASS,
        studentId: 'STU/1',
        status: 'active',
        transactionSummary: { postedTransactionIds: ['TX/1'] }
      }])
    }
  );
  schoolDataService.getDataById = async () => null;
  schoolDataService.getClassSessions = async () => [];
  classFolderPaths.scanOrphanClassFolders = async () => [];
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];

  try {
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(ORG_1, REQ_USER);
    const row = scan.dbOrphans.classEnrollmentPeriods.rows[0];
    assert.equal(row.severity, 'needs_rollback');
    assert.equal(row.canSelect, false);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
    schoolDataService.getClassSessions = originalSessions;
  }
});

test('scanClassStorageIntegrity is org-scoped and ignores another org classes', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalScanFolders = classFolderPaths.scanOrphanClassFolders;
  const originalScanMissing = classFolderPaths.scanMissingFoldersForLiveClasses;
  const originalLedgerPreview = registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg;

  schoolDataService.fetchData = stubFetchForOrgClasses({
    [ORG_1]: [{ id: LIVE_CLASS, orgId: ORG_1, title: 'Org 1 Class' }],
    [ORG_2]: [{ id: 'CLASS/OTHER-ORG', orgId: ORG_2, title: 'Org 2 Class', nextClassId: STALE_TARGET }]
  });
  classFolderPaths.scanOrphanClassFolders = async () => [];
  classFolderPaths.scanMissingFoldersForLiveClasses = async () => [];
  registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = async () => [];

  try {
    const scan = await classStorageIntegrityService.scanClassStorageIntegrity(ORG_1, REQ_USER);
    assert.equal(scan.liveClassCount, 1);
    assert.equal(scan.cycleLinks.stalePointers.length, 0);
    assert.ok(!scan.folders.orphanDirs.some((row) => row.classId === 'CLASS/OTHER-ORG'));
  } finally {
    schoolDataService.fetchData = originalFetch;
    classFolderPaths.scanOrphanClassFolders = originalScanFolders;
    classFolderPaths.scanMissingFoldersForLiveClasses = originalScanMissing;
    registrationIntegrityService.previewOrphanedClassEnrollmentLedgerForOrg = originalLedgerPreview;
  }
});

test('classController delegates folder cleanup to classFolderPaths helper', () => {
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(controller, /classFolderPaths/);
  assert.match(controller, /deleteClassFolderTargets/);
});
