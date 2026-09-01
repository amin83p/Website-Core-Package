const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
const gradesMatrixWeightSaveService = require('../MVC/services/school/gradesMatrixWeightSaveService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/1';
const REQ_USER = { id: 'USER/1', activeOrgId: 'ORG/1' };

function makeSessions(overrides = {}) {
  return [{
    sessionId: SESSION_ID,
    locked: false,
    gradebooks: [{ id: 'gb1', name: 'Quiz', weight: 10, totalScore: 20 }],
    quizzes: [{ id: 'q1', name: 'Pop quiz', weight: 15, totalScore: 15 }],
    assignments: [{ id: 'a1', name: 'HW', weight: 5, totalScore: 5 }],
    ...overrides
  }];
}

test('saveActivityWeights patches gradebook, quiz, and assignment weights', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalSaveSessions = schoolDataService.saveClassSessions;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalMakeUp = sessionStatusPolicyService.isMakeUpRequiredByMap;
  const originalAssertLock = schoolDependencyService.assertSessionNotTimesheetLocked;

  const sessions = makeSessions();
  let savedSessions = null;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) return { id: CLASS_ID, orgId: 'ORG/1' };
    return null;
  };
  schoolDataService.getClassSessions = async () => sessions;
  schoolDataService.saveClassSessions = async (_classId, nextSessions) => {
    savedSessions = nextSessions;
  };
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionStatusPolicyService.isMakeUpRequiredByMap = () => false;
  schoolDependencyService.assertSessionNotTimesheetLocked = () => {};

  const indexService = require('../MVC/services/school/schoolIndexService');
  const originalRebuild = indexService.rebuildIndexesForClass;
  let rebuiltClassId = null;
  indexService.rebuildIndexesForClass = async (classId) => {
    rebuiltClassId = classId;
  };

  try {
    const result = await gradesMatrixWeightSaveService.saveActivityWeights({
      classId: CLASS_ID,
      updates: [
        { sessionId: SESSION_ID, kind: 'gradebook', itemId: 'gb1', weight: 25 },
        { sessionId: SESSION_ID, kind: 'quiz', itemId: 'q1', weight: 20 },
        { sessionId: SESSION_ID, kind: 'assignment', itemId: 'a1', weight: 8 }
      ]
    }, REQ_USER);

    assert.equal(result.saved, 3);
    assert.deepEqual(result.touchedSessions, [SESSION_ID]);
    assert.equal(savedSessions[0].gradebooks[0].weight, 25);
    assert.equal(savedSessions[0].quizzes[0].weight, 20);
    assert.equal(savedSessions[0].assignments[0].weight, 8);
    assert.equal(rebuiltClassId, CLASS_ID);
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    schoolDataService.saveClassSessions = originalSaveSessions;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
    sessionStatusPolicyService.isMakeUpRequiredByMap = originalMakeUp;
    schoolDependencyService.assertSessionNotTimesheetLocked = originalAssertLock;
    indexService.rebuildIndexesForClass = originalRebuild;
  }
});

test('saveActivityWeights rejects locked sessions without override', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalMakeUp = sessionStatusPolicyService.isMakeUpRequiredByMap;
  const originalAssertLock = schoolDependencyService.assertSessionNotTimesheetLocked;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) return { id: CLASS_ID, orgId: 'ORG/1' };
    return null;
  };
  schoolDataService.getClassSessions = async () => makeSessions({ locked: true });
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionStatusPolicyService.isMakeUpRequiredByMap = () => false;
  schoolDependencyService.assertSessionNotTimesheetLocked = () => {};

  try {
    await assert.rejects(
      () => gradesMatrixWeightSaveService.saveActivityWeights({
        classId: CLASS_ID,
        updates: [{ sessionId: SESSION_ID, kind: 'gradebook', itemId: 'gb1', weight: 25 }]
      }, REQ_USER),
      /locked/i
    );
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
    sessionStatusPolicyService.isMakeUpRequiredByMap = originalMakeUp;
    schoolDependencyService.assertSessionNotTimesheetLocked = originalAssertLock;
  }
});

test('saveActivityWeights rejects make-up required sessions', async () => {
  const originalGetById = schoolDataService.getDataById;
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalMakeUp = sessionStatusPolicyService.isMakeUpRequiredByMap;
  const originalAssertLock = schoolDependencyService.assertSessionNotTimesheetLocked;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) return { id: CLASS_ID, orgId: 'ORG/1' };
    return null;
  };
  schoolDataService.getClassSessions = async () => makeSessions();
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionStatusPolicyService.isMakeUpRequiredByMap = () => true;
  schoolDependencyService.assertSessionNotTimesheetLocked = () => {};

  try {
    await assert.rejects(
      () => gradesMatrixWeightSaveService.saveActivityWeights({
        classId: CLASS_ID,
        updates: [{ sessionId: SESSION_ID, kind: 'gradebook', itemId: 'gb1', weight: 25 }]
      }, REQ_USER),
      /make-up/i
    );
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalGetSessions;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
    sessionStatusPolicyService.isMakeUpRequiredByMap = originalMakeUp;
    schoolDependencyService.assertSessionNotTimesheetLocked = originalAssertLock;
  }
});

test('activityListForKind and findActivityIndex resolve session activities', () => {
  const session = makeSessions()[0];
  assert.equal(gradesMatrixWeightSaveService.activityListForKind(session, 'gradebook').length, 1);
  assert.equal(gradesMatrixWeightSaveService.findActivityIndex(session, 'quiz', 'q1'), 0);
  assert.equal(gradesMatrixWeightSaveService.findActivityIndex(session, 'assignment', 'missing'), -1);
});
