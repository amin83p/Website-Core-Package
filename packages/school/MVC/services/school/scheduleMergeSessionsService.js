'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const sessionMergeService = require('./sessionMergeService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  schoolDataService,
  sessionMergeService
};

function parseSelectedSessions(body = {}) {
  const rows = Array.isArray(body.sessions) ? body.sessions : [];
  const seen = new Set();
  const sessions = [];
  rows.forEach((row) => {
    const classId = toPublicId(row?.classId);
    const sessionId = toPublicId(row?.sessionId || row?.id);
    if (!classId || !sessionId) return;
    const key = `${classId}::${sessionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push({ classId, sessionId });
  });
  return sessions;
}

function buildMergePreviewHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function matchKey(match = {}) {
  const partner = match.partner || {};
  return [
    toPublicId(match.sourceClassId),
    toPublicId(match.sourceSessionId),
    toPublicId(partner.classId || match.partnerClassId),
    toPublicId(partner.sessionId || match.partnerSessionId)
  ].join('::');
}

async function loadSelectedSessions({
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  if (!sessions.length) throw new Error('Select at least one saved session.');
  const byClass = new Map();
  for (const row of sessions) {
    if (byClass.has(row.classId)) continue;
    const classData = await dependencies.schoolDataService.getDataById('classes', row.classId, reqUser, accessContext);
    if (!classData) throw new Error('Source class not found.');
    const classSessions = await dependencies.schoolDataService.getClassSessions(row.classId, reqUser);
    byClass.set(row.classId, {
      classData,
      sessions: Array.isArray(classSessions) ? classSessions : []
    });
  }

  const orgIds = new Set();
  byClass.forEach((bucket) => {
    const orgId = toPublicId(bucket.classData?.orgId);
    if (orgId) orgIds.add(orgId);
  });
  if (orgIds.size > 1) throw new Error('Selected sessions must belong to the same organization.');

  const sourceRows = [];
  for (const row of sessions) {
    const bucket = byClass.get(row.classId);
    const session = (bucket?.sessions || []).find((item) => idsEqual(item?.sessionId || item?.id, row.sessionId));
    if (!session) throw new Error('One or more selected sessions could not be found. Refresh the schedule and try again.');
    sourceRows.push({ classId: row.classId, session });
  }
  return {
    sourceRows,
    orgId: [...orgIds][0] || ''
  };
}

async function buildMergePreview({
  mergingTeacherId = '',
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  const selected = Array.isArray(sessions) ? sessions : [];
  const loaded = await loadSelectedSessions({ sessions: selected, reqUser, accessContext });
  const preview = await dependencies.sessionMergeService.previewSessionMergeBatch({
    orgId: loaded.orgId,
    mergingTeacherId,
    sourceRows: loaded.sourceRows,
    reqUser
  });
  const hashPayload = {
    mergingTeacherId: preview.mergingTeacherId,
    sessionKeys: selected.map((row) => `${row.classId}::${row.sessionId}`).sort(),
    matches: (preview.matches || []).map(matchKey).sort()
  };
  return {
    canContinue: preview.canContinue === true,
    blockers: preview.blockers || [],
    matches: preview.matches || [],
    mergingTeacherId: preview.mergingTeacherId,
    mergingTeacherName: preview.mergingTeacherName,
    previewHash: buildMergePreviewHash(hashPayload),
    orgId: loaded.orgId
  };
}

async function applyMergeSessions({
  mergingTeacherId = '',
  sessions = [],
  previewHash = '',
  reqUser,
  accessContext
} = {}) {
  const preview = await buildMergePreview({
    mergingTeacherId,
    sessions,
    reqUser,
    accessContext
  });
  if (!String(mergingTeacherId || '').trim()) throw new Error('Choose a teacher.');
  if (!preview.canContinue) {
    const error = new Error(preview.blockers[0]?.message || 'Resolve the listed issues before merging sessions.');
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Review the merge again before applying.');
  }
  const result = await dependencies.sessionMergeService.executeSessionMergeBatch({
    orgId: preview.orgId,
    mergingTeacherId: preview.mergingTeacherId,
    matches: preview.matches,
    reqUser
  });
  return {
    ...result,
    mergedCount: result.mergedCount
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    sessionMergeService
  };
}

module.exports = {
  parseSelectedSessions,
  buildMergePreviewHash,
  buildMergePreview,
  applyMergeSessions,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
