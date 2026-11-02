const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolIndexService = require('../MVC/services/school/schoolIndexService');
const reportViewService = require('../MVC/services/school/reportViewService');
const classReferenceSyncService = require('../MVC/services/school/classReferenceSyncService');

const CLASS_ID = 'CLASS/SYNC-2';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

test('listReportInstancesForRemovedTargetStudents finds instances for unassigned students', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalPersonMap = reportViewService.buildPersonNameMap;

  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'reportInstances' && query?.assignmentId__eq === 'RA/2') {
      return [
        {
          id: 'RI/KEEP',
          assignmentId: 'RA/2',
          assignmentRowId: 'ROW/1',
          studentId: 'STU-KEEP',
          status: 'draft'
        },
        {
          id: 'RI/REMOVE',
          assignmentId: 'RA/2',
          assignmentRowId: 'ROW/1',
          studentId: 'STU-REMOVE',
          status: 'draft'
        }
      ];
    }
    return [];
  };
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'reportTemplates' && id === 'TPL/1') {
      return { id: 'TPL/1', title: 'Progress Report' };
    }
    return null;
  };
  reportViewService.buildPersonNameMap = async () => new Map([
    ['STU-KEEP', 'Ada Active'],
    ['STU-REMOVE', 'Jatinder Bains']
  ]);

  try {
    const rows = await classReferenceSyncService.listReportInstancesForRemovedTargetStudents({
      assignmentId: 'RA/2',
      previousAssignment: {
        id: 'RA/2',
        classId: CLASS_ID,
        orgId: ORG_ID,
        templateId: 'TPL/1',
        targetRows: [{
          rowId: 'ROW/1',
          reportStartDate: '2026-09-01',
          reportDueDate: '2026-09-15',
          sessionId: 'SES/1',
          targetStudentIds: ['STU-KEEP', 'STU-REMOVE']
        }]
      },
      nextAssignment: {
        id: 'RA/2',
        classId: CLASS_ID,
        orgId: ORG_ID,
        templateId: 'TPL/1',
        targetRows: [{
          rowId: 'ROW/1',
          reportStartDate: '2026-09-01',
          reportDueDate: '2026-09-15',
          sessionId: 'SES/1',
          targetStudentIds: ['STU-KEEP']
        }]
      },
      reqUser: REQ_USER
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].instanceId, 'RI/REMOVE');
    assert.equal(rows[0].studentName, 'Jatinder Bains');
    assert.match(rows[0].rowLabel, /2026-09-01/);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    reportViewService.buildPersonNameMap = originalPersonMap;
  }
});

test('cleanupReportInstancesForRemovedTargetStudents deletes explicit stale instance ids', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalGetById = schoolDataService.getDataById;
  const originalDelete = schoolDataService.deleteData;
  const originalUpdate = schoolDataService.updateData;
  const originalRebuild = schoolIndexService.rebuildIndexesForClass;

  const deleted = [];
  schoolDataService.fetchData = async () => [];
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'reportInstances' && id === 'RI/REMOVE') {
      return {
        id: 'RI/REMOVE',
        assignmentId: 'RA/2',
        assignmentRowId: 'ROW/1',
        classId: CLASS_ID,
        orgId: ORG_ID,
        status: 'draft'
      };
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

  const assignment = {
    id: 'RA/2',
    classId: CLASS_ID,
    orgId: ORG_ID,
    targetRows: [{
      rowId: 'ROW/1',
      reportStartDate: '2026-09-01',
      reportDueDate: '2026-09-15',
      targetStudentIds: ['STU-KEEP']
    }]
  };

  try {
    const result = await classReferenceSyncService.cleanupReportInstancesForRemovedTargetStudents({
      assignmentId: 'RA/2',
      previousAssignment: assignment,
      nextAssignment: assignment,
      reqUser: REQ_USER,
      instanceIds: ['RI/REMOVE']
    });
    assert.equal(result.deletedCount, 1);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].id, 'RI/REMOVE');
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getDataById = originalGetById;
    schoolDataService.deleteData = originalDelete;
    schoolDataService.updateData = originalUpdate;
    schoolIndexService.rebuildIndexesForClass = originalRebuild;
  }
});
