const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const sessionStudentCaseWorkspaceService = require('./sessionStudentCaseWorkspaceService');
const sessionStudentCaseAccessService = require('./sessionStudentCaseAccessService');
const { getPresetConfig } = require('./sessionStudentCasePresetService');
const sessionStudentCaseResultVisibilityService = require('./sessionStudentCaseResultVisibilityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

async function loadCaseForRequest(req, caseId) {
  const orgId = getActiveOrgId(req.user);
  const existing = await schoolRepositories.sessionStudentCases.getById(caseId, {
    scope: { activeOrgId: orgId }
  });
  if (!existing) throw sessionStudentCaseAccessService.createDeniedError('Student case not found.', 404);

  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const scoped = await sessionStudentCaseWorkspaceService.filterCasesByAccessScope({
    rows: [existing],
    req,
    accessContext,
    applyAccessScope: true
  });
  if (!scoped.length) throw sessionStudentCaseAccessService.createDeniedError();

  return existing;
}

async function loadClassSessionContext(req, classId, sessionId) {
  const classData = await schoolDataService.getDataById('classes', classId, req.user);
  if (!classData) throw sessionStudentCaseAccessService.createDeniedError('Class not found.', 404);
  const sessions = await schoolDataService.getClassSessions(classId, req.user);
  const session = (Array.isArray(sessions) ? sessions : []).find((row) => toPublicId(row?.sessionId || row?.id) === toPublicId(sessionId)) || null;
  if (!session) throw sessionStudentCaseAccessService.createDeniedError('Session not found.', 404);
  return { classData, session };
}

function buildSessionLabel(session = {}) {
  const date = normalizeText(session.date || session.sessionDate);
  const start = normalizeText(session.startTime || session.sessionStartTime);
  const end = normalizeText(session.endTime || session.sessionEndTime);
  if (date && start && end) return `${date} ${start}-${end}`;
  if (date && start) return `${date} ${start}`;
  return date || normalizeText(session.sessionId || session.id);
}

function buildRoster(session = {}) {
  return (Array.isArray(session.roster) ? session.roster : [])
    .map((row) => ({
      personId: toPublicId(row?.personId),
      name: normalizeText(row?.name || row?.studentName || row?.personId)
    }))
    .filter((row) => row.personId);
}

async function getReviewContext(req, caseId) {
  const existing = await loadCaseForRequest(req, caseId);
  const classId = toPublicId(existing.classId);
  const sessionId = toPublicId(existing.sessionId);
  const { classData, session } = await loadClassSessionContext(req, classId, sessionId);
  await sessionStudentCaseAccessService.assertCanRead(req, classData, session, existing);
  const capabilities = sessionStudentCaseResultVisibilityService.enrichCapabilities(
    existing,
    req.user,
    await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session, caseRow: existing })
  );
  const manageSessionHref = `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}?caseId=${encodeURIComponent(caseId)}`;

  return {
    case: sessionStudentCaseResultVisibilityService.redactCaseForViewer(existing, {
      reqUser: req.user,
      capabilities
    }),
    classId,
    sessionId,
    classTitle: normalizeText(existing.classTitle || classData.title || classData.name || classId),
    sessionLabel: buildSessionLabel(session),
    roster: buildRoster(session),
    presets: getPresetConfig(),
    capabilities,
    manageSessionHref
  };
}

async function assertCanMutate(req, caseId, action = 'edit') {
  const existing = await loadCaseForRequest(req, caseId);
  const { classData, session } = await loadClassSessionContext(req, existing.classId, existing.sessionId);
  let capabilities;
  if (action === 'delete') {
    await sessionStudentCaseAccessService.assertCanDelete(req, classData, session, existing);
    capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session, caseRow: existing });
    sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(existing, capabilities, { action: 'delete' });
  } else if (action === 'resolve') {
    await sessionStudentCaseAccessService.assertCanResolve(req, classData, session, existing);
    capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session, caseRow: existing });
  } else if (action === 'reopen') {
    await sessionStudentCaseAccessService.assertCanUpdate(req, classData, session, existing);
    capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session, caseRow: existing });
    sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(existing, capabilities, { action: 'reopen' });
  } else {
    await sessionStudentCaseAccessService.assertCanUpdate(req, classData, session, existing);
    capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session, caseRow: existing });
    sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(existing, capabilities, { action: 'edit' });
  }
  return { existing, classData, session, capabilities };
}

module.exports = {
  getReviewContext,
  assertCanMutate,
  loadCaseForRequest,
  loadClassSessionContext,
  resolveCapabilities: sessionStudentCaseAccessService.resolveCaseCapabilities
};
