const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classDeleteCascadeService = require('../MVC/services/school/classDeleteCascadeService');
const classDeletePreparationService = require('../MVC/services/school/classDeletePreparationService');

const CLASS_ID = 'CLASS/CASCADE-1';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

test('cascadeDeleteClassSessionAssets deletes session student cases for class', async () => {
  const originalFetch = schoolDataService.fetchData;
  const originalDelete = schoolDataService.deleteData;

  const deleted = [];
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'sessionStudentCases' && query?.classId__eq === CLASS_ID) {
      return [
        { id: 'SSC/1', classId: CLASS_ID, orgId: ORG_ID },
        { id: 'SSC/2', classId: CLASS_ID, orgId: ORG_ID }
      ];
    }
    return [];
  };
  schoolDataService.deleteData = async (entityType, id, reqUser, context) => {
    deleted.push({ entityType, id, context });
    return { id };
  };

  try {
    const result = await classDeleteCascadeService.cascadeDeleteClassSessionAssets(CLASS_ID, REQ_USER, ORG_ID);
    assert.equal(result.deletedCaseCount, 2);
    assert.deepEqual(result.deletedCases, ['SSC/1', 'SSC/2']);
    assert.equal(deleted.length, 2);
    assert.equal(deleted[0].entityType, 'sessionStudentCases');
    assert.equal(deleted[0].context.skipDeletionGuard, true);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.deleteData = originalDelete;
  }
});

test('delete preparation allows class ready when only session cases remain', async () => {
  const schoolDeletionGuardService = require('../MVC/services/school/schoolDeletionGuardService');
  const originalGetById = schoolDataService.getDataById;
  const originalFetch = schoolDataService.fetchData;
  const originalSessions = schoolDataService.getClassSessions;
  const originalPreview = schoolDeletionGuardService.previewDelete;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Cascade Class', nextClassId: '' };
    }
    return null;
  };
  schoolDataService.fetchData = async (entityType, query) => {
    if (entityType === 'sessionStudentCases' && query?.classId__eq === CLASS_ID) {
      return [{ id: 'SSC/ONLY', classId: CLASS_ID, orgId: ORG_ID }];
    }
    if (entityType === 'classEnrollmentPeriods') return [];
    return [];
  };
  schoolDataService.getClassSessions = async () => ([{ sessionId: 'SESSION/1', roster: [], gradebooks: [], contentItems: [] }]);
  schoolDeletionGuardService.previewDelete = async () => ({
    canDelete: false,
    blockers: [{ code: 'SESSION_CASE', message: 'Session Student Cases', count: 1 }]
  });

  try {
    const plan = await classDeletePreparationService.buildDeletePreparationPlan(CLASS_ID, REQ_USER);
    const cycle = plan.chain.find((row) => row.id === CLASS_ID);
    assert.equal(cycle.referenceBlockerCount, 0);
    assert.equal(cycle.cascadeAssets.sessionCaseCount, 1);
    assert.equal(cycle.canDeleteClass, true);
    await classDeletePreparationService.assertClassDeleteAllowed(CLASS_ID, REQ_USER);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetch;
    schoolDataService.getClassSessions = originalSessions;
    schoolDeletionGuardService.previewDelete = originalPreview;
  }
});

test('classController voids class without cascading physical session assets', () => {
  const controller = read('MVC/controllers/school/classController.js');
  const deleteBody = controller.slice(controller.indexOf('async function deleteClass'), controller.indexOf('async function checkConflicts'));
  assert.match(deleteBody, /operation: 'void'/);
  assert.doesNotMatch(deleteBody, /cascadeDeleteClassSessionAssets/);
  assert.doesNotMatch(deleteBody, /cleanupClassRelatedFolders/);
});

test('school deletion registry marks session cases as physical children', () => {
  const source = read('MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(source, /code: 'SESSION_CASE'[\s\S]*childPolicy: 'physical_child'/);
});
