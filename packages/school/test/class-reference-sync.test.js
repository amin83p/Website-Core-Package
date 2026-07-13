const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolIndexService = require('../MVC/services/school/schoolIndexService');
const classReferenceSyncService = require('../MVC/services/school/classReferenceSyncService');

const CLASS_ID = 'CLASS/SYNC-1';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

test('notifyClassReferencesChanged updates class metadata and rebuilds indexes', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalUpdate = schoolDataService.updateData;
  const originalRebuild = schoolIndexService.rebuildIndexesForClass;

  let updatedPatch = null;
  let rebuiltClassId = '';

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Sync Class' };
    }
    return null;
  };
  schoolDataService.updateData = async (entityType, id, patch) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      updatedPatch = patch;
      return { id: CLASS_ID, ...patch };
    }
    return null;
  };
  schoolIndexService.rebuildIndexesForClass = async (classId) => {
    rebuiltClassId = classId;
  };

  try {
    const result = await classReferenceSyncService.notifyClassReferencesChanged({
      classId: CLASS_ID,
      reason: 'test_sync',
      reqUser: REQ_USER
    });
    assert.equal(result.updated, true);
    assert.ok(updatedPatch?.updatedAt);
    assert.equal(updatedPatch?.updatedBy, 'USER-1');
    assert.equal(updatedPatch?.referenceSync?.lastReason, 'test_sync');
    assert.equal(rebuiltClassId, CLASS_ID);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.updateData = originalUpdate;
    schoolIndexService.rebuildIndexesForClass = originalRebuild;
  }
});

test('cleanupReportInstancesForRemovedTargetRows deletes instances for removed rows', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalDelete = schoolDataService.deleteData;
  const originalUpdate = schoolDataService.updateData;
  const originalRebuild = schoolIndexService.rebuildIndexesForClass;

  const deleted = [];
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'reportInstances' && query?.assignmentId__eq === 'RA/1') {
      return [
        { id: 'RI/KEEP', assignmentId: 'RA/1', assignmentRowId: 'ROW/KEEP', classId: CLASS_ID, status: 'draft' },
        { id: 'RI/REMOVE', assignmentId: 'RA/1', assignmentRowId: 'ROW/REMOVE', classId: CLASS_ID, status: 'draft' }
      ];
    }
    return [];
  };
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'reportInstances' && id === 'RI/REMOVE') {
      return { id: 'RI/REMOVE', assignmentId: 'RA/1', assignmentRowId: 'ROW/REMOVE', classId: CLASS_ID, status: 'draft' };
    }
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID };
    }
    return null;
  };
  schoolDataService.deleteData = async (entityType, id, reqUser, context) => {
    deleted.push({ entityType, id, context });
    return { id };
  };
  schoolDataService.updateData = async (entityType, id, patch) => ({ id, ...patch });
  schoolIndexService.rebuildIndexesForClass = async () => {};

  try {
    const result = await classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows({
      assignmentId: 'RA/1',
      previousAssignment: {
        id: 'RA/1',
        classId: CLASS_ID,
        orgId: ORG_ID,
        targetRows: [
          { rowId: 'ROW/KEEP' },
          { rowId: 'ROW/REMOVE' }
        ]
      },
      nextAssignment: {
        id: 'RA/1',
        classId: CLASS_ID,
        orgId: ORG_ID,
        targetRows: [{ rowId: 'ROW/KEEP' }]
      },
      reqUser: REQ_USER
    });
    assert.equal(result.deletedCount, 1);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].id, 'RI/REMOVE');
    assert.equal(deleted[0].context.skipDeletionGuard, true);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    schoolDataService.deleteData = originalDelete;
    schoolDataService.updateData = originalUpdate;
    schoolIndexService.rebuildIndexesForClass = originalRebuild;
  }
});
