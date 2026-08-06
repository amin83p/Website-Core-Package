const schoolDataService = require('./schoolDataService');
const schoolDeletionGuardService = require('./schoolDeletionGuardService');
const makeupSessionAllocationService = require('./makeupSessionAllocationService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const AUTO_CASCADE_GUARD_CODES = new Set([
  'REPORT_INSTANCE',
  'REPORT_ASSIGNMENT',
  'SESSION_CASE'
]);

function buildSessionLabel(session = {}, sessionId = '') {
  const date = String(session?.date || '').trim();
  const id = toPublicId(session?.sessionId || session?.id || sessionId);
  if (date && id) return `${date} (${id})`;
  if (date) return date;
  return id || 'Session';
}

function summarizeEmbeddedSessionAssets(session = {}) {
  const gradebooks = Array.isArray(session?.gradebooks) ? session.gradebooks : [];
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const contentItems = Array.isArray(session?.contentItems) ? session.contentItems : [];
  const skillsCovered = Array.isArray(session?.skillsCovered) ? session.skillsCovered : [];
  const gradebookScoreRows = gradebooks.reduce((sum, row) => {
    const scores = Array.isArray(row?.scores) ? row.scores.length : 0;
    return sum + scores;
  }, 0);
  const attendanceMarkedCount = roster.filter((row) => (
    String(row?.attendanceStatus || row?.attendance || '').trim()
  )).length;
  const conductReady = session?.conductReadyForReports === true
    || String(session?.conductReadyForReports) === 'true';

  return {
    gradebookCount: gradebooks.length,
    gradebookScoreRows,
    rosterCount: roster.length,
    attendanceMarkedCount,
    conductReady,
    contentItemCount: contentItems.length,
    skillsCoveredCount: skillsCovered.length,
    isMakeupSession: session?.makeup?.isMakeup === true,
    originalSessionId: toPublicId(session?.makeup?.originalSessionId || ''),
    makeupHistoryCount: Array.isArray(session?.makeupHistory) ? session.makeupHistory.length : 0
  };
}

function mapGuardBlockerToAutoCascade(blocker = {}) {
  return {
    code: String(blocker.code || '').trim(),
    label: String(blocker.label || blocker.message || blocker.code || 'Related records').trim(),
    count: Number(blocker.count || 0),
    samples: Array.isArray(blocker.samples) ? blocker.samples : []
  };
}

function buildMakeupChildBlocker(childSessions = [], classId = '') {
  const safeClassId = toPublicId(classId);
  const rows = Array.isArray(childSessions) ? childSessions : [];
  if (!rows.length) return null;
  return {
    code: 'MAKEUP_CHILD_SESSIONS_EXIST',
    label: 'Linked make-up sessions',
    message: 'Remove linked make-up sessions before deleting this session.',
    count: rows.length,
    resolveHint: 'Delete each linked make-up session from Session Manager first.',
    samples: rows.map((row) => {
      const sessionId = toPublicId(row?.sessionId || row?.id);
      const labelParts = [sessionId, row?.date, row?.statusLabel || row?.status].filter(Boolean);
      const href = row?.manageUrl
        || (safeClassId && sessionId
          ? `/school/classes/${encodeURIComponent(safeClassId)}/sessions/${encodeURIComponent(sessionId)}`
          : '');
      return {
        id: sessionId,
        label: labelParts.join(' · ') || sessionId || 'Make-up session',
        href
      };
    }),
    childSessions: rows
  };
}

async function buildSessionDeletePreview({ classId, sessionId, reqUser, orgId = '' }) {
  const safeClassId = toPublicId(classId);
  const safeSessionId = toPublicId(sessionId);
  if (!safeClassId || !safeSessionId) throw new Error('classId and sessionId are required.');

  const classRow = await schoolDataService.getDataById('classes', safeClassId, reqUser);
  if (!classRow) throw new Error('Class not found or inaccessible.');

  const sessions = await schoolDataService.getClassSessions(safeClassId, reqUser);
  const session = (Array.isArray(sessions) ? sessions : []).find((row) => (
    idsEqual(row?.sessionId || row?.id, safeSessionId)
  ));
  if (!session) throw new Error('Session not found.');

  const resolvedOrgId = toPublicId(orgId || classRow?.orgId || reqUser?.activeOrgId);
  const statusDefinitions = await sessionStatusPolicyService.getStatusDefinitions(resolvedOrgId, {
    includeInactive: true
  });

  const guardPreview = await schoolDeletionGuardService.previewDelete({
    entityKey: 'session',
    id: safeSessionId,
    orgId: resolvedOrgId,
    reqUser,
    context: { classId: safeClassId }
  });

  const guardBlockers = Array.isArray(guardPreview?.blockers) ? guardPreview.blockers : [];
  const autoCascadeFromGuard = guardBlockers
    .filter((row) => AUTO_CASCADE_GUARD_CODES.has(String(row?.code || '').trim()))
    .map(mapGuardBlockerToAutoCascade);
  const protectedGuardBlockers = guardBlockers.filter((row) => (
    !AUTO_CASCADE_GUARD_CODES.has(String(row?.code || '').trim())
  ));

  const childMakeups = makeupSessionAllocationService.findDirectChildMakeupSessions(
    sessions,
    safeClassId,
    safeSessionId
  );
  const childRows = makeupSessionAllocationService.buildChildMakeupSessionRows(childMakeups, {
    classId: safeClassId,
    statusDefinitions
  });
  const makeupBlocker = buildMakeupChildBlocker(childRows, safeClassId);

  const embeddedSummary = summarizeEmbeddedSessionAssets(session);
  const autoCascade = [
    ...autoCascadeFromGuard,
    ...(embeddedSummary.gradebookCount > 0 ? [{
      code: 'EMBEDDED_GRADEBOOKS',
      label: 'Session gradebooks',
      count: embeddedSummary.gradebookCount,
      detail: `${embeddedSummary.gradebookScoreRows} score row${embeddedSummary.gradebookScoreRows === 1 ? '' : 's'}`
    }] : []),
    ...(embeddedSummary.rosterCount > 0 ? [{
      code: 'EMBEDDED_ATTENDANCE',
      label: 'Attendance roster',
      count: embeddedSummary.rosterCount,
      detail: `${embeddedSummary.attendanceMarkedCount} marked attendance record${embeddedSummary.attendanceMarkedCount === 1 ? '' : 's'}`
    }] : []),
    ...(embeddedSummary.contentItemCount > 0 ? [{
      code: 'EMBEDDED_CONTENT',
      label: 'Session content items',
      count: embeddedSummary.contentItemCount
    }] : []),
    ...(embeddedSummary.skillsCoveredCount > 0 ? [{
      code: 'EMBEDDED_SKILLS',
      label: 'Skills covered entries',
      count: embeddedSummary.skillsCoveredCount
    }] : []),
    ...(embeddedSummary.conductReady ? [{
      code: 'EMBEDDED_CONDUCT',
      label: 'Conduct ratings',
      count: embeddedSummary.rosterCount
    }] : [])
  ];

  const blockers = [...protectedGuardBlockers];
  if (makeupBlocker) blockers.push(makeupBlocker);

  const label = buildSessionLabel(session, safeSessionId);
  const canDelete = blockers.length === 0;

  return {
    canDelete,
    entityKey: 'session',
    id: safeSessionId,
    classId: safeClassId,
    label,
    session: {
      sessionId: safeSessionId,
      date: String(session?.date || '').trim(),
      startTime: String(session?.startTime || '').trim(),
      endTime: String(session?.endTime || '').trim(),
      status: String(session?.status || '').trim(),
      isMakeupSession: embeddedSummary.isMakeupSession,
      originalSessionId: embeddedSummary.originalSessionId
    },
    blockers,
    autoCascade,
    embeddedSummary,
    warnings: Array.isArray(guardPreview?.warnings) ? guardPreview.warnings : [],
    policy: guardPreview?.policy || 'deletable',
    confirmationText: canDelete ? `DELETE ${label}` : ''
  };
}

module.exports = {
  AUTO_CASCADE_GUARD_CODES,
  buildSessionDeletePreview,
  buildSessionLabel,
  summarizeEmbeddedSessionAssets
};
