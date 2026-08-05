const schoolDataService = require('./schoolDataService');
const sessionIdService = require('./sessionIdService');
const indexService = require('./schoolIndexService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  sortSessionsChronologically,
  normalizeSessionDate
} = require('./sessionNavigationService');

const MAINTENANCE_ACCESS_CONTEXT = Object.freeze({ scopeId: 'SCP_ORG' });

function buildMaintenanceRequestUser(orgId) {
  return {
    id: 'SYS_MAINTENANCE',
    activeOrgId: toPublicId(orgId)
  };
}

function resolveMaintenanceUser(orgId, reqUser) {
  if (reqUser && typeof reqUser === 'object') return reqUser;
  return buildMaintenanceRequestUser(orgId);
}

function emptySummary(options = {}) {
  return {
    dryRun: options.dryRun !== false,
    orgId: toPublicId(options.orgId),
    classesScanned: 0,
    classesUpdated: 0,
    sessionsReassigned: 0,
    dependentsUpdated: 0,
    errors: [],
    classReports: []
  };
}

function classNeedsSessionIdMigration(classId, sessions = []) {
  const classToken = toPublicId(classId);
  const rows = Array.isArray(sessions) ? sessions : [];
  if (!classToken || !rows.length) return false;
  if (sessionIdService.findDuplicateSessionIds(rows).length > 0) return true;
  return rows.some((row) => !sessionIdService.isClassScopedSessionId(
    sessionIdService.resolveSessionId(row),
    classToken
  ));
}

function buildClassSessionRemapPlan(classId, sessions = []) {
  const classToken = toPublicId(classId);
  const originalSessions = Array.isArray(sessions) ? sessions : [];
  if (!classToken || !originalSessions.length) {
    return {
      classId: classToken,
      reassignedSessions: originalSessions,
      changes: [],
      remapByDateKey: new Map(),
      remapByIdOnly: new Map()
    };
  }

  const sortedOriginal = sortSessionsChronologically(originalSessions.map((row) => ({ ...row })));
  const reassignedSessions = sessionIdService.assignSequentialSessionIds(classToken, originalSessions);
  const sortedReassigned = sortSessionsChronologically(reassignedSessions.map((row) => ({ ...row })));

  const idCounts = new Map();
  sortedOriginal.forEach((row) => {
    const oldId = sessionIdService.resolveSessionId(row);
    if (!oldId) return;
    idCounts.set(oldId, (idCounts.get(oldId) || 0) + 1);
  });

  const changes = [];
  const remapByDateKey = new Map();
  const remapByIdOnly = new Map();

  sortedOriginal.forEach((oldRow, index) => {
    const newRow = sortedReassigned[index];
    const oldId = sessionIdService.resolveSessionId(oldRow);
    const newId = sessionIdService.resolveSessionId(newRow);
    if (!oldId || !newId) return;
    if (oldId === newId && sessionIdService.isClassScopedSessionId(newId, classToken)) return;
    const date = normalizeSessionDate(oldRow?.date);
    changes.push({ oldSessionId: oldId, newSessionId: newId, date });
    remapByDateKey.set(sessionIdService.buildSessionRemapKey(oldId, date), newId);
    if ((idCounts.get(oldId) || 0) === 1) {
      remapByIdOnly.set(oldId, newId);
    }
  });

  return {
    classId: classToken,
    reassignedSessions,
    changes,
    remapByDateKey,
    remapByIdOnly
  };
}

function resolveRemappedSessionId(plan, oldSessionId, sessionDate = '') {
  const oldId = toPublicId(oldSessionId);
  if (!oldId || !plan) return oldSessionId;
  const dateKey = sessionIdService.buildSessionRemapKey(oldId, sessionDate);
  if (plan.remapByDateKey.has(dateKey)) return plan.remapByDateKey.get(dateKey);
  if (plan.remapByIdOnly.has(oldId)) return plan.remapByIdOnly.get(oldId);
  return oldSessionId;
}

function patchTimesheetRow(plan, timesheet = {}) {
  let changed = false;
  const patchEntries = (entries) => {
    if (!Array.isArray(entries)) return entries;
    return entries.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      if (!idsEqual(entry.classId, plan.classId)) return entry;
      const sessionDate = normalizeSessionDate(entry.date || entry.sessionDate);
      const nextSessionId = resolveRemappedSessionId(plan, entry.sessionId, sessionDate);
      let next = entry;
      if (nextSessionId !== entry.sessionId) {
        next = { ...next, sessionId: nextSessionId };
        changed = true;
      }
      if (entry.materializedSessionId) {
        const nextMaterialized = resolveRemappedSessionId(plan, entry.materializedSessionId, sessionDate);
        if (nextMaterialized !== entry.materializedSessionId) {
          next = { ...next, materializedSessionId: nextMaterialized };
          changed = true;
        }
      }
      if (entry.adjustmentMeta?.sourceSessionId) {
        const nextSourceId = resolveRemappedSessionId(
          plan,
          entry.adjustmentMeta.sourceSessionId,
          normalizeSessionDate(entry.adjustmentMeta.sourceSessionDate || sessionDate)
        );
        if (nextSourceId !== entry.adjustmentMeta.sourceSessionId) {
          next = {
            ...next,
            adjustmentMeta: {
              ...entry.adjustmentMeta,
              sourceSessionId: nextSourceId
            }
          };
          changed = true;
        }
      }
      return next;
    });
  };

  const next = { ...timesheet };
  if (Array.isArray(timesheet.entries)) {
    const patched = patchEntries(timesheet.entries);
    if (patched !== timesheet.entries) next.entries = patched;
  }
  if (timesheet.submissionSnapshot && Array.isArray(timesheet.submissionSnapshot.entries)) {
    const patchedSnapshotEntries = patchEntries(timesheet.submissionSnapshot.entries);
    if (patchedSnapshotEntries !== timesheet.submissionSnapshot.entries) {
      next.submissionSnapshot = {
        ...timesheet.submissionSnapshot,
        entries: patchedSnapshotEntries
      };
    }
  }
  return { row: next, changed };
}

function patchReportInstanceRow(plan, row = {}) {
  if (!idsEqual(row.classId, plan.classId)) return { row, changed: false };
  const sessionDate = normalizeSessionDate(row.sessionDate || row.date);
  const nextSessionId = resolveRemappedSessionId(plan, row.sessionId, sessionDate);
  if (nextSessionId === row.sessionId) return { row, changed: false };
  return { row: { ...row, sessionId: nextSessionId }, changed: true };
}

function patchReportAssignmentRow(plan, row = {}) {
  if (!idsEqual(row.classId, plan.classId)) return { row, changed: false };
  let changed = false;
  let next = { ...row };
  const topSessionDate = normalizeSessionDate(row.sessionDate || row.date);
  if (row.sessionId) {
    const nextSessionId = resolveRemappedSessionId(plan, row.sessionId, topSessionDate);
    if (nextSessionId !== row.sessionId) {
      next.sessionId = nextSessionId;
      changed = true;
    }
  }
  if (Array.isArray(row.targetRows)) {
    next.targetRows = row.targetRows.map((target) => {
      if (!target || typeof target !== 'object') return target;
      if (!target.sessionId) return target;
      const targetDate = normalizeSessionDate(target.sessionDate || target.date || topSessionDate);
      const nextTargetSessionId = resolveRemappedSessionId(plan, target.sessionId, targetDate);
      if (nextTargetSessionId === target.sessionId) return target;
      changed = true;
      return { ...target, sessionId: nextTargetSessionId };
    });
  }
  return { row: next, changed };
}

function patchExamAllocationRow(plan, row = {}) {
  if (!idsEqual(row.classId, plan.classId)) return { row, changed: false };
  const sourceSession = row?.extensions?.sourceSession;
  if (!sourceSession?.sessionId) return { row, changed: false };
  const sessionDate = normalizeSessionDate(sourceSession.sessionDate || sourceSession.date);
  const nextSessionId = resolveRemappedSessionId(plan, sourceSession.sessionId, sessionDate);
  if (nextSessionId === sourceSession.sessionId) return { row, changed: false };
  return {
    row: {
      ...row,
      extensions: {
        ...(row.extensions || {}),
        sourceSession: {
          ...sourceSession,
          sessionId: nextSessionId
        }
      }
    },
    changed: true
  };
}

function patchSessionStudentCaseRow(plan, row = {}) {
  if (!idsEqual(row.classId, plan.classId)) return { row, changed: false };
  const sessionDate = normalizeSessionDate(row.sessionDate || row.date);
  const nextSessionId = resolveRemappedSessionId(plan, row.sessionId, sessionDate);
  if (nextSessionId === row.sessionId) return { row, changed: false };
  return { row: { ...row, sessionId: nextSessionId }, changed: true };
}

function patchLeaveRequestRow(plan, row = {}) {
  let changed = false;
  let next = { ...row };
  if (Array.isArray(row.sessionResolutions)) {
    next.sessionResolutions = row.sessionResolutions.map((resolution) => {
      if (!resolution || typeof resolution !== 'object') return resolution;
      if (!idsEqual(resolution.classId, plan.classId)) return resolution;
      const nextSessionId = resolveRemappedSessionId(plan, resolution.sessionId);
      if (nextSessionId === resolution.sessionId) return resolution;
      changed = true;
      return { ...resolution, sessionId: nextSessionId };
    });
  }
  return { row: next, changed };
}

async function listOrgClasses(orgId, reqUser) {
  const effectiveUser = resolveMaintenanceUser(orgId, reqUser);
  const rows = await schoolDataService.fetchData('classes', {
    orgId__eq: toPublicId(orgId),
    page: 1,
    limit: 10000
  }, effectiveUser, MAINTENANCE_ACCESS_CONTEXT);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
}

async function remapDependentsForClass(plan, orgId, reqUser, options = {}) {
  const dryRun = options.dryRun !== false;
  const effectiveUser = resolveMaintenanceUser(orgId, reqUser);
  const summary = {
    timesheets: 0,
    reportInstances: 0,
    reportAssignments: 0,
    examAllocations: 0,
    sessionStudentCases: 0,
    leaveRequests: 0
  };

  const entityConfigs = [
    {
      key: 'timesheets',
      entityType: 'timesheets',
      patch: patchTimesheetRow
    },
    {
      key: 'reportInstances',
      entityType: 'reportInstances',
      patch: patchReportInstanceRow
    },
    {
      key: 'reportAssignments',
      entityType: 'reportAssignments',
      patch: patchReportAssignmentRow
    },
    {
      key: 'examAllocations',
      entityType: 'examAllocations',
      patch: patchExamAllocationRow
    },
    {
      key: 'sessionStudentCases',
      entityType: 'sessionStudentCases',
      patch: patchSessionStudentCaseRow
    },
    {
      key: 'leaveRequests',
      entityType: 'leaveRequests',
      patch: patchLeaveRequestRow
    }
  ];

  for (const config of entityConfigs) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await schoolDataService.fetchData(config.entityType, {
      orgId__eq: toPublicId(orgId),
      page: 1,
      limit: 10000
    }, effectiveUser, MAINTENANCE_ACCESS_CONTEXT);

    for (const row of Array.isArray(rows) ? rows : []) {
      const { row: nextRow, changed } = config.patch(plan, row);
      if (!changed) continue;
      summary[config.key] += 1;
      if (!dryRun) {
        // eslint-disable-next-line no-await-in-loop
        await schoolDataService.updateData(config.entityType, row.id, nextRow, effectiveUser);
      }
    }
  }

  if (!dryRun) {
    await indexService.rebuildIndexesForClass(plan.classId);
  }

  return summary;
}

async function migrateClassSessionIds(classId, reqUser, options = {}) {
  const dryRun = options.dryRun !== false;
  const classToken = toPublicId(classId);
  if (!classToken) throw new Error('classId is required.');

  const orgId = toPublicId(options.orgId || reqUser?.activeOrgId);
  const effectiveUser = resolveMaintenanceUser(orgId, reqUser);
  const classRow = await schoolDataService.getDataById(
    'classes',
    classToken,
    effectiveUser,
    MAINTENANCE_ACCESS_CONTEXT
  );
  if (!classRow) throw new Error(`Class ${classToken} was not found.`);

  const sessions = await schoolDataService.getClassSessions(
    classToken,
    effectiveUser,
    MAINTENANCE_ACCESS_CONTEXT
  );
  if (!classNeedsSessionIdMigration(classToken, sessions)) {
    return {
      classId: classToken,
      classTitle: String(classRow?.title || classToken).trim(),
      updated: false,
      sessionsReassigned: 0,
      dependentsUpdated: 0,
      dependentCounts: {},
      changes: []
    };
  }

  const plan = buildClassSessionRemapPlan(classToken, sessions);
  if (!plan.changes.length) {
    return {
      classId: classToken,
      classTitle: String(classRow?.title || classToken).trim(),
      updated: false,
      sessionsReassigned: 0,
      dependentsUpdated: 0,
      dependentCounts: {},
      changes: []
    };
  }

  if (!dryRun) {
    await schoolDataService.saveClassSessions(
      classToken,
      plan.reassignedSessions,
      effectiveUser,
      MAINTENANCE_ACCESS_CONTEXT
    );
  }

  const dependentCounts = await remapDependentsForClass(plan, classRow.orgId, effectiveUser, { dryRun });
  const dependentsUpdated = Object.values(dependentCounts).reduce((sum, count) => sum + Number(count || 0), 0);

  return {
    classId: classToken,
    classTitle: String(classRow?.title || classToken).trim(),
    updated: true,
    sessionsReassigned: plan.changes.length,
    dependentsUpdated,
    dependentCounts,
    changes: plan.changes
  };
}

async function migrateClassSessionIdsForOrg(orgId, reqUser, options = {}) {
  const dryRun = options.dryRun !== false;
  const summary = emptySummary({ dryRun, orgId });
  const classes = await listOrgClasses(orgId, reqUser);
  const classFilter = new Set(
    (Array.isArray(options.classIds) ? options.classIds : [])
      .map((value) => toPublicId(value))
      .filter(Boolean)
  );

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    if (classFilter.size && !classFilter.has(classId)) continue;
    summary.classesScanned += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const report = await migrateClassSessionIds(classId, reqUser, { dryRun, orgId });
      summary.classReports.push(report);
      if (report.updated) {
        summary.classesUpdated += 1;
        summary.sessionsReassigned += Number(report.sessionsReassigned || 0);
        summary.dependentsUpdated += Number(report.dependentsUpdated || 0);
      }
    } catch (error) {
      summary.errors.push({
        classId,
        classTitle: String(classRow?.title || classId).trim(),
        message: String(error?.message || error || 'Migration failed.')
      });
    }
  }

  return summary;
}

module.exports = {
  emptySummary,
  classNeedsSessionIdMigration,
  buildClassSessionRemapPlan,
  resolveRemappedSessionId,
  migrateClassSessionIds,
  migrateClassSessionIdsForOrg
};
