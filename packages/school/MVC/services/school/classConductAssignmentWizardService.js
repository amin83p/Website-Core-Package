'use strict';

const schoolDataService = require('./schoolDataService');
const conductMatrixSessionVisibilityService = require('./conductMatrixSessionVisibilityService');
const conductMatrixService = require('./conductMatrixService');
const sessionConductService = require('./sessionConductService');
const classSessionCapacityService = require('./classSessionCapacityService');
const semiMonthlyWizard = require('./semiMonthlyReportAssignmentWizardService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CONDUCT_SESSION_LOOKBACK_DAYS = 3;

let dependencies = {
  schoolDataService,
  conductMatrixSessionVisibilityService,
  semiMonthlyWizard
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function pickSessionNearAnchorDate(sessions = [], anchorDate = '', maxLookbackDays = CONDUCT_SESSION_LOOKBACK_DAYS) {
  const anchor = normalizeDateOnly(anchorDate);
  if (!anchor) return null;
  const lookback = Math.max(1, Math.floor(Number(maxLookbackDays) || CONDUCT_SESSION_LOOKBACK_DAYS));
  const start = semiMonthlyWizard.addDaysIso(anchor, -(lookback - 1));
  return semiMonthlyWizard.pickClosestSessionNearPeriodEnd(
    sessions,
    start,
    anchor,
    lookback
  );
}

async function loadScopeContext(reqUser) {
  const [assignments, classes] = await Promise.all([
    dependencies.schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    dependencies.schoolDataService.fetchAllData('classes', {}, reqUser)
  ]);
  const orgId = toPublicId(reqUser?.activeOrgId);
  const scopedAssignments = (Array.isArray(assignments) ? assignments : []).filter((row) => (
    !orgId || !row?.orgId || idsEqual(row.orgId, orgId)
  ));
  const scopedClasses = (Array.isArray(classes) ? classes : []).filter((row) => (
    !orgId || !row?.orgId || idsEqual(row.orgId, orgId)
  ));
  return { assignments: scopedAssignments, classes: scopedClasses };
}

async function countProgramClasses({ programId, classCapacityTarget = 'all', reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  const capacityTarget = semiMonthlyWizard.normalizeClassCapacityTarget(classCapacityTarget);
  return {
    programId: toPublicId(programId),
    classCapacityTarget: capacityTarget,
    classCount: semiMonthlyWizard.countClassesForProgram({
      classes: context.classes,
      programId,
      classCapacityTarget: capacityTarget
    })
  };
}

function sessionDate(session = {}) {
  const token = String(session?.date || session?.sessionDate || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function buildPreviewRow({
  classRow = {},
  pick = null,
  assignments = []
} = {}) {
  const classId = toPublicId(classRow.id);
  const session = pick?.session || null;
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const conductRequiredForReports = session
    ? conductMatrixService.resolveSessionConductRequired(assignments, session, classId)
    : false;
  const conductReportStepEnabled = session
    ? sessionConductService.parseConductReportStepEnabled(session)
    : false;
  const blocked = !session || !sessionId;
  const frozen = conductRequiredForReports === true;
  const noSessionMessage = `No scheduled session within ${CONDUCT_SESSION_LOOKBACK_DAYS} days of the selected date.`;
  let statusLabel = 'Ready to assign';
  if (blocked) statusLabel = noSessionMessage;
  else if (frozen) statusLabel = 'Report assignment requires conduct (frozen)';
  else if (conductReportStepEnabled) statusLabel = 'Class conduct already enabled';
  else statusLabel = 'Not enabled yet';

  return {
    classId,
    title: String(classRow.title || classId).trim(),
    maxCapacity: classSessionCapacityService.resolveClassMaxCapacity(classRow),
    sessionId,
    sessionDate: session ? sessionDate(session) : '',
    matchedDate: pick?.matchedDate || '',
    daysFromAnchor: Number.isFinite(Number(pick?.daysFromEnd)) ? pick.daysFromEnd : null,
    startTime: String(session?.startTime || '').trim(),
    endTime: String(session?.endTime || '').trim(),
    conductRequiredForReports: frozen,
    conductReportStepEnabled,
    frozen,
    blocked,
    blockedReason: blocked ? noSessionMessage : '',
    defaultChecked: frozen || conductReportStepEnabled,
    checkboxDisabled: blocked || frozen,
    selectable: !blocked && !frozen,
    statusLabel,
    href: sessionId && classId
      ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`
      : ''
  };
}

async function previewRows({
  programIds = [],
  classCapacityTarget = 'all',
  anchorDate = '',
  reqUser
} = {}) {
  const anchor = normalizeDateOnly(anchorDate);
  if (!anchor) {
    throw new Error('Anchor date is required.');
  }
  const capacityTarget = semiMonthlyWizard.normalizeClassCapacityTarget(classCapacityTarget);
  const context = await loadScopeContext(reqUser);
  const matched = semiMonthlyWizard.classesForPrograms({
    classes: context.classes,
    programIds,
    classCapacityTarget: capacityTarget
  });
  const classes = [];
  for (const classRow of matched) {
    const classId = toPublicId(classRow.id);
    const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    const pick = pickSessionNearAnchorDate(sessions, anchor, CONDUCT_SESSION_LOOKBACK_DAYS);
    classes.push(buildPreviewRow({
      classRow,
      pick,
      assignments: context.assignments
    }));
  }
  const blockedCount = classes.filter((row) => row.blocked).length;
  const frozenCount = classes.filter((row) => row.frozen).length;
  return {
    anchorDate: anchor,
    sessionLookbackDays: CONDUCT_SESSION_LOOKBACK_DAYS,
    classCapacityTarget: capacityTarget,
    classCapacityLabel: semiMonthlyWizard.classCapacityLabel(capacityTarget),
    classCount: classes.length,
    blockedCount,
    frozenCount,
    message: `Each class uses the nearest scheduled session on or within ${CONDUCT_SESSION_LOOKBACK_DAYS} days before ${anchor}.`,
    classes
  };
}

async function applySelections({ selections = [], reqUser, req } = {}) {
  const rows = Array.isArray(selections) ? selections : [];
  const context = await loadScopeContext(reqUser);
  const summary = {
    enabled: 0,
    disabled: 0,
    unchanged: 0,
    skippedFrozen: 0,
    skippedBlocked: 0,
    failed: 0,
    results: []
  };
  const request = req && typeof req === 'object' ? req : { user: reqUser };

  for (const raw of rows) {
    const classId = toPublicId(raw?.classId);
    const sessionId = toPublicId(raw?.sessionId);
    const wantEnabled = raw?.enabled === true
      || String(raw?.enabled || '').trim().toLowerCase() === 'true'
      || String(raw?.enabled || '').trim() === '1';
    const classRow = context.classes.find((row) => idsEqual(row?.id, classId));
    const title = String(classRow?.title || classId).trim();
    if (!classId || !sessionId) {
      summary.failed += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: 'failed',
        message: 'Class and session are required.'
      });
      continue;
    }
    const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    const session = (Array.isArray(sessions) ? sessions : []).find((row) => (
      idsEqual(row?.sessionId || row?.id, sessionId)
    ));
    if (!session) {
      summary.skippedBlocked += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: 'skipped',
        message: 'Session not found.'
      });
      continue;
    }
    const conductRequiredForReports = conductMatrixService.resolveSessionConductRequired(
      context.assignments,
      session,
      classId
    );
    if (conductRequiredForReports) {
      summary.skippedFrozen += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: 'skipped_frozen',
        message: 'Report assignment requires conduct for this session.'
      });
      continue;
    }
    const currentEnabled = sessionConductService.parseConductReportStepEnabled(session);
    if (wantEnabled === currentEnabled) {
      summary.unchanged += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: 'unchanged',
        message: wantEnabled ? 'Already enabled.' : 'Already disabled.'
      });
      continue;
    }
    try {
      await dependencies.conductMatrixSessionVisibilityService.setSessionConductReportStepEnabled(request, {
        classId,
        sessionId,
        enabled: wantEnabled
      });
      if (wantEnabled) summary.enabled += 1;
      else summary.disabled += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: wantEnabled ? 'enabled' : 'disabled',
        message: wantEnabled
          ? 'Class conduct enabled for Manage Session → Reports.'
          : 'Voluntary class conduct hidden for this session.'
      });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({
        classId,
        title,
        sessionId,
        outcome: 'failed',
        message: String(error?.message || 'Update failed.')
      });
    }
  }
  return summary;
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    conductMatrixSessionVisibilityService,
    semiMonthlyWizard
  };
}

module.exports = {
  CONDUCT_SESSION_LOOKBACK_DAYS,
  countProgramClasses,
  previewRows,
  applySelections,
  pickSessionNearAnchorDate,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
