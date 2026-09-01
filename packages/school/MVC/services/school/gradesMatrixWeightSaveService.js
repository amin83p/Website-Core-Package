const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const schoolDependencyService = require('./schoolDependencyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function activityListForKind(session, kind) {
  const key = String(kind || '').trim().toLowerCase();
  if (key === 'gradebook') return Array.isArray(session?.gradebooks) ? session.gradebooks : [];
  if (key === 'quiz') return Array.isArray(session?.quizzes) ? session.quizzes : [];
  if (key === 'assignment') return Array.isArray(session?.assignments) ? session.assignments : [];
  return [];
}

function setActivityList(session, kind, list) {
  const key = String(kind || '').trim().toLowerCase();
  if (key === 'gradebook') session.gradebooks = list;
  else if (key === 'quiz') session.quizzes = list;
  else if (key === 'assignment') session.assignments = list;
}

function findActivityIndex(session, kind, itemId) {
  const id = String(itemId || '').trim();
  const list = activityListForKind(session, kind);
  return list.findIndex((row) => String(row?.id || '').trim() === id);
}

async function saveActivityWeights({ classId, updates = [] }, reqUser, options = {}) {
  const normalizedClassId = String(classId || '').trim();
  if (!normalizedClassId) throw new Error('Class ID is required.');

  const classData = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  if (!classData) throw new Error('Class not found.');

  const sessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
  const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || reqUser?.activeOrgId || '', {
    includeInactive: true
  });

  const canOverride = options.canOverrideLocked === true
    || await adminAuthorityService.isAdminForRequestAsync(
      reqUser,
      SECTIONS.SCHOOL_CLASSES,
      OPERATIONS.UPDATE,
      { section: { id: SECTIONS.SCHOOL_CLASSES } }
    );

  const sessionById = new Map(
    (Array.isArray(sessions) ? sessions : []).map((row) => [String(row?.sessionId || row?.id || '').trim(), row])
  );

  let saved = 0;
  const touchedSessions = new Set();

  (Array.isArray(updates) ? updates : []).forEach((update) => {
    const sessionId = String(update?.sessionId || '').trim();
    const kind = String(update?.kind || '').trim().toLowerCase();
    const itemId = String(update?.itemId || '').trim();
    const weight = Number(update?.weight);
    if (!sessionId || !kind || !itemId) return;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Weight must be greater than zero for activity ${itemId}.`);
    }

    const session = sessionById.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}.`);

    if (sessionStatusPolicyService.isMakeUpRequiredByMap(statusMap, {
      status: session?.status,
      notes: session?.notes
    })) {
      throw new Error('Cannot update weights on a session that requires a make-up session.');
    }

    const isSessionLocked = session.locked === true || String(session.locked) === 'true';
    schoolDependencyService.assertSessionNotTimesheetLocked(session, 'This session');
    if (isSessionLocked && !canOverride) {
      throw new Error('One or more sessions are locked and cannot be edited.');
    }

    const list = activityListForKind(session, kind);
    const index = findActivityIndex(session, kind, itemId);
    if (index < 0) throw new Error(`Activity not found: ${kind} ${itemId} in session ${sessionId}.`);

    list[index] = { ...list[index], weight };
    setActivityList(session, kind, list);
    touchedSessions.add(sessionId);
    saved += 1;
  });

  if (!saved) throw new Error('No activity weights to save.');

  await schoolDataService.saveClassSessions(normalizedClassId, sessions, reqUser);

  const indexService = require('./schoolIndexService');
  await indexService.rebuildIndexesForClass(normalizedClassId);

  return { saved, touchedSessions: Array.from(touchedSessions) };
}

module.exports = {
  saveActivityWeights,
  findActivityIndex,
  activityListForKind
};
