const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionIdService = require('./sessionIdService');
const manualSessionIdService = require('./manualSessionIdService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const manualWorkSessionService = require('./timesheetManualWorkSessionService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function isManualMaterializationCandidate(entry = {}) {
  if (!entry || entry.isDeleted === true || entry.isManual !== true) return false;
  if (entry.materializedAt || entry.materializedSessionId) return false;
  if (String(entry.approvalStatus || '').trim().toLowerCase() !== 'approved') return false;
  const sessionId = normalizeId(entry.sessionId);
  if (!manualSessionIdService.isManualSessionId(sessionId)) return false;
  return Boolean(normalizeId(entry.classId) || normalizeId(entry.activityId));
}

function collectPreservedMaterializedManualEntryIds(entries = []) {
  const preserved = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || entry.isDeleted === true || entry.isManual !== true) return;
    if (String(entry.approvalStatus || '').trim().toLowerCase() !== 'approved') return;
    if (!normalizeId(entry.activityId)) return;
    const sessionId = normalizeId(entry.sessionId);
    const originalEntryId = normalizeId(entry.materializedFromTimesheetEntryId);
    if (sessionId) preserved.add(sessionId);
    if (originalEntryId) preserved.add(originalEntryId);
  });
  return preserved;
}

function isPersistedRejectedManualActivityRow(entry = {}) {
  if (!entry || entry.isDeleted === true || entry.isManual !== true) return false;
  if (entry.activityPaid !== true) return false;
  if (!normalizeId(entry.activityId)) return false;
  return String(entry.approvalStatus || '').trim().toLowerCase() === 'rejected';
}

function mergeLiveMaterializationMarkers(snapshotEntry = {}, liveEntry = {}) {
  if (!snapshotEntry || !liveEntry) return snapshotEntry;
  if (!liveEntry.materializedAt && !liveEntry.materializedSessionId) return snapshotEntry;
  return {
    ...snapshotEntry,
    materializedAt: liveEntry.materializedAt || snapshotEntry.materializedAt,
    materializedSessionId: liveEntry.materializedSessionId || snapshotEntry.materializedSessionId,
    materializedFromTimesheetId: liveEntry.materializedFromTimesheetId || snapshotEntry.materializedFromTimesheetId,
    materializedFromTimesheetEntryId: liveEntry.materializedFromTimesheetEntryId || snapshotEntry.materializedFromTimesheetEntryId,
    activityEntryId: liveEntry.activityEntryId || snapshotEntry.activityEntryId,
    hours: liveEntry.hours ?? snapshotEntry.hours,
    timesheetHours: liveEntry.timesheetHours ?? snapshotEntry.timesheetHours
  };
}

function nextActivityEntryId(entries = []) {
  const nums = (Array.isArray(entries) ? entries : [])
    .map((row) => {
      const token = normalizeId(row?.entryId || row?.id);
      const match = token.match(/^ENTRY-(\d+)$/i);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `ENTRY-${next}`;
}

function nextClassSessionId(classId, sessions = []) {
  return sessionIdService.buildNextSessionId(classId, sessions);
}

async function resolveNextTimesheetPeriodId({ orgId, currentPeriod = {}, reqUser } = {}) {
  const endDate = normalizeDate(currentPeriod?.endDate);
  if (!endDate) return '';
  const rows = await schoolDataService.fetchAllData('timesheetPeriods', {}, reqUser);
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => idsEqual(row?.orgId, orgId))
    .filter((row) => normalizeDate(row?.startDate) > endDate)
    .sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')));
  return normalizeId(candidates[0]?.id);
}

async function materializeClassManualEntry({
  entry,
  timesheet,
  teacherId,
  attendanceDuePeriodId,
  reqUser
}) {
  const classId = normalizeId(entry?.classId);
  if (!classId) return null;
  const classRow = await schoolDataService.getDataById('classes', classId, reqUser);
  if (!classRow) throw new Error(`Class ${classId} is no longer available for manual session materialization.`);

  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const sessionId = nextClassSessionId(classId, sessions);
  const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(timesheet?.orgId || classRow?.orgId || '', { includeInactive: true });
  const defaultStatus = sessionStatusPolicyService.normalizeStatusCode(
    (Array.isArray(statusMeta) ? statusMeta : []).find((row) => row?.isDefault)?.code || 'scheduled'
  ) || 'scheduled';

  const durationHours = Number(parseFloat(entry?.durationHours ?? entry?.requestedHours ?? entry?.hours) || 0);
  const newSession = {
    sessionId,
    date: normalizeDate(entry?.date),
    startTime: String(entry?.startTime || '').trim(),
    endTime: String(entry?.endTime || '').trim(),
    durationHours,
    status: defaultStatus,
    notes: String(entry?.comment || entry?.description || '').trim(),
    room: '',
    delivery: {
      deliveredBy: normalizeId(teacherId),
      deliveredByName: ''
    },
    materializedFromTimesheetId: normalizeId(timesheet?.id),
    materializedFromTimesheetEntryId: normalizeId(entry?.sessionId),
    attendanceDuePeriodId: normalizeId(attendanceDuePeriodId)
  };
  sessions.push(newSession);
  await schoolDataService.saveClassSessions(classId, sessions, reqUser);
  return { classId, sessionId, session: newSession };
}

function normalizeWorkSessionAssigneeRole(value) {
  const payrollRole = timesheetPayrollContextService.normalizePayrollRole(value);
  if (payrollRole) return payrollRole;
  const token = String(value || '').trim().toLowerCase();
  if (token.includes('teacher')) return 'teacher';
  if (token === 'staff' || token.includes('staff')) return 'staff';
  return '';
}

function buildAssigneeRoleFields(role) {
  const normalized = normalizeWorkSessionAssigneeRole(role) || 'teacher';
  return { role: normalized, roles: [normalized] };
}

async function resolveMaterializedAssigneeRole({ entry, timesheet, teacherId, reqUser } = {}) {
  const fromEntry = timesheetPayrollContextService.normalizePayrollRole(entry?.personRole);
  if (fromEntry) return buildAssigneeRoleFields(fromEntry);

  const orgId = normalizeId(timesheet?.orgId || entry?.orgId);
  const personId = normalizeId(teacherId);
  if (orgId && personId) {
    try {
      const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
        orgId,
        personId,
        reqUser
      });
      const resolved = timesheetPayrollContextService.resolveRoleForEntry({
        payrollContext,
        requestedRole: entry?.personRole,
        source: 'activity'
      });
      if (resolved) return buildAssigneeRoleFields(resolved);
    } catch (_error) {
      // Fall back to teacher when payroll context cannot be resolved.
    }
  }
  return buildAssigneeRoleFields('teacher');
}

async function resolveManualWorkSessionPolicyForMaterialize({
  timesheet = {},
  manualWorkSessionPolicy = null,
  reqUser
} = {}) {
  if (manualWorkSessionPolicy) {
    return manualWorkSessionService.resolveManualWorkSessionPolicy(manualWorkSessionPolicy);
  }
  const orgId = normalizeId(timesheet?.orgId);
  if (orgId) {
    const orgPolicy = await timesheetParametersPolicyModel.getPolicyForOrg(orgId);
    return timesheetParametersPolicyService.resolveManualActivityWorkSessionPolicy(orgPolicy);
  }
  return timesheetParametersPolicyService.resolveManualActivityWorkSessionPolicy({});
}

function mergeMaterializedAssigneeIntoWorkEntry(workEntry, assignee, teacherId) {
  const assignees = activityService.normalizeActivityAssigneeRows(workEntry.assignees);
  const assigneeIndex = assignees.findIndex((row) => idsEqual(row.personId, teacherId));
  if (assigneeIndex >= 0) {
    assignees[assigneeIndex] = {
      ...assignees[assigneeIndex],
      ...assignee,
      personId: normalizeId(teacherId),
      personName: assignees[assigneeIndex].personName || assignee.personName || ''
    };
  } else {
    assignees.push(assignee);
  }
  return { ...workEntry, assignees };
}

async function persistActivityWorkSessionChanges({
  activity,
  activityId,
  mutableEntries,
  reqUser
}) {
  const updated = {
    ...activity,
    entries: mutableEntries,
    attendees: activityService.flattenActivityAssignees(mutableEntries)
  };
  await schoolDataService.updateData('activities', activityId, updated, reqUser);
  return updated;
}

async function materializeActivityManualEntry({
  entry,
  timesheet,
  teacherId,
  reqUser,
  manualWorkSessionPolicy = null
}) {
  const activityId = normalizeId(entry?.activityId);
  if (!activityId) return null;
  const activity = await schoolDataService.getDataById('activities', activityId, reqUser);
  if (!activity) throw new Error(`Activity ${activityId} is no longer available for manual work session materialization.`);
  if (!activityService.isPersonEligibleForActivity(activity, teacherId)) {
    throw new Error('Teacher is no longer eligible for the selected activity.');
  }

  const visibilityScope = activityService.normalizeActivityVisibilityScope(
    activity.visibilityScope || activity.calendarScope || activity.scope
  );
  const existingEntryId = normalizeId(entry?.activityEntryId);
  const entries = activityService.getActivityEntries(activity);
  const mutableEntries = [...entries];
  const hours = Number(parseFloat(entry?.durationHours ?? entry?.requestedHours ?? entry?.hours) || 0);
  const wsPolicy = await resolveManualWorkSessionPolicyForMaterialize({
    timesheet,
    manualWorkSessionPolicy,
    reqUser
  });
  const assigneeWindow = manualWorkSessionService.resolveAssigneeWindowFromManualEntry(entry);
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const paid = activity.paid === true && entry?.activityPaid !== false;
  const nowIso = new Date().toISOString();
  const assigneeNotes = manualWorkSessionService.resolveAssigneeNotesFromManualEntry(entry, {
    defaultSessionTitle: wsPolicy.defaultTitle
  });
  const assigneeBase = {
    personId: normalizeId(teacherId),
    personName: '',
    paid,
    paidHours: paid ? hours : 0,
    startTime: assigneeWindow.startTime,
    endTime: assigneeWindow.endTime,
    notes: assigneeNotes,
    materializedFromTimesheetId: normalizeId(timesheet?.id),
    materializedFromTimesheetEntryId: normalizeId(entry?.sessionId)
  };
  let assignee;
  if (evaluationType === 'completion') {
    assignee = {
      ...assigneeBase,
      status: paid ? 'attended' : normalizeId(entry?.status) || 'attended',
      completionStatus: 'completed',
      completedAt: nowIso,
      completedBy: normalizeId(teacherId)
    };
  } else {
    assignee = {
      ...assigneeBase,
      status: 'attended',
      completionStatus: 'pending'
    };
  }
  const assigneeRoleFields = await resolveMaterializedAssigneeRole({ entry, timesheet, teacherId, reqUser });
  assignee = { ...assignee, ...assigneeRoleFields };

  const buildMaterializeResult = (activityEntryId, linkedExisting) => {
    const sessionId = `act-${activityId}-${activityEntryId}-${normalizeId(teacherId)}`;
    return { activityId, activityEntryId, sessionId, assignee, linkedExisting };
  };

  // Explicit public picker: link when the selected work session still exists.
  if (existingEntryId) {
    if (visibilityScope === 'individual') {
      throw new Error('Individual activity manual rows cannot materialize against an existing work session.');
    }
    const index = mutableEntries.findIndex((row) => normalizeId(row?.entryId || row?.id) === existingEntryId);
    if (index >= 0) {
      const workEntry = { ...mutableEntries[index] };
      if (normalizeId(workEntry.status || 'posted').toLowerCase() !== 'posted') {
        throw new Error(`Work session ${existingEntryId} must be posted before timesheet processing.`);
      }
      if (!activityService.isPersonEligibleForEntry(activity, workEntry, teacherId)) {
        throw new Error('Teacher is no longer eligible for the selected work session.');
      }
      mutableEntries[index] = mergeMaterializedAssigneeIntoWorkEntry(workEntry, assignee, teacherId);
      await persistActivityWorkSessionChanges({ activity, activityId, mutableEntries, reqUser });
      return buildMaterializeResult(existingEntryId, true);
    }
  }

  const matchedEntryId = manualWorkSessionService.findGenericWorkSessionForAssignee(mutableEntries, {
    date: assigneeWindow.date,
    defaultTitle: wsPolicy.defaultTitle,
    assigneeStart: assigneeWindow.startTime,
    assigneeEnd: assigneeWindow.endTime
  });
  if (matchedEntryId) {
    const index = mutableEntries.findIndex((row) => normalizeId(row?.entryId || row?.id) === matchedEntryId);
    if (index >= 0) {
      const workEntry = { ...mutableEntries[index] };
      if (!activityService.isPersonEligibleForEntry(activity, workEntry, teacherId)) {
        throw new Error('Teacher is no longer eligible for the selected work session.');
      }
      mutableEntries[index] = mergeMaterializedAssigneeIntoWorkEntry(workEntry, assignee, teacherId);
      await persistActivityWorkSessionChanges({ activity, activityId, mutableEntries, reqUser });
      return buildMaterializeResult(matchedEntryId, true);
    }
  }

  const entryId = nextActivityEntryId(mutableEntries);
  const workEntry = {
    ...manualWorkSessionService.buildGenericWorkSessionDraft({
      date: assigneeWindow.date,
      defaultTitle: wsPolicy.defaultTitle,
      defaultStartTime: wsPolicy.defaultStartTime,
      defaultEndTime: wsPolicy.defaultEndTime,
      assignee
    }),
    entryId
  };
  mutableEntries.push(workEntry);
  await persistActivityWorkSessionChanges({ activity, activityId, mutableEntries, reqUser });
  return buildMaterializeResult(entryId, false);
}

async function materializeApprovedTimesheetManualEntries({ timesheet = {}, period = {}, reqUser } = {}) {
  const snapshotEntries = Array.isArray(timesheet?.submissionSnapshot?.entries)
    ? timesheet.submissionSnapshot.entries
    : [];
  const liveEntries = Array.isArray(timesheet?.entries) ? timesheet.entries : [];
  const liveBySessionId = new Map(
    liveEntries
      .filter((row) => row && row.isDeleted !== true)
      .map((row) => [normalizeId(row.sessionId), row])
  );
  const sourceEntries = (snapshotEntries.length ? snapshotEntries : liveEntries)
    .map((entry) => mergeLiveMaterializationMarkers(entry, liveBySessionId.get(normalizeId(entry?.sessionId))));
  const teacherId = normalizeId(timesheet?.teacherId);
  const orgId = normalizeId(timesheet?.orgId || period?.orgId);
  const attendanceDuePeriodId = await resolveNextTimesheetPeriodId({
    orgId,
    currentPeriod: period,
    reqUser
  });
  const manualWorkSessionPolicy = timesheetParametersPolicyService.resolveManualActivityWorkSessionPolicy(
    orgId ? await timesheetParametersPolicyModel.getPolicyForOrg(orgId) : {}
  );

  const summary = {
    classSessions: [],
    activities: [],
    attendanceDuePeriodId,
    errors: []
  };

  const entryBySessionId = new Map(
    sourceEntries
      .filter((row) => row && row.isDeleted !== true)
      .map((row) => [normalizeId(row.sessionId), { ...row }])
  );

  for (const entry of sourceEntries) {
    if (!isManualMaterializationCandidate(entry)) continue;
    try {
      if (normalizeId(entry.classId)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await materializeClassManualEntry({
          entry,
          timesheet,
          teacherId,
          attendanceDuePeriodId,
          reqUser
        });
        if (!result) continue;
        const prior = entryBySessionId.get(normalizeId(entry.sessionId));
        if (prior) {
          const originalManualEntryId = normalizeId(entry.sessionId);
          prior.sessionId = result.sessionId;
          prior.classId = result.classId;
          prior.materializedAt = new Date().toISOString();
          prior.materializedSessionId = result.sessionId;
          prior.materializedFromTimesheetId = normalizeId(timesheet?.id);
          prior.materializedFromTimesheetEntryId = originalManualEntryId;
          prior.attendanceDuePeriodId = attendanceDuePeriodId;
          prior.isManual = true;
          prior.approvalStatus = 'approved';
          prior.excludeFromTotals = false;
          if (prior.activityPaid === undefined) prior.activityPaid = false;
        }
        summary.classSessions.push(result);
      } else if (normalizeId(entry.activityId)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await materializeActivityManualEntry({
          entry,
          timesheet,
          teacherId,
          reqUser,
          manualWorkSessionPolicy
        });
        if (!result) continue;
        const prior = entryBySessionId.get(normalizeId(entry.sessionId));
        if (prior) {
          const originalManualEntryId = normalizeId(entry.sessionId);
          const payableHours = Number(parseFloat(entry?.requestedHours ?? entry?.durationHours ?? entry?.hours) || 0);
          prior.sessionId = result.sessionId;
          prior.activityEntryId = result.activityEntryId;
          prior.materializedAt = new Date().toISOString();
          prior.materializedSessionId = result.sessionId;
          prior.materializedFromTimesheetId = normalizeId(timesheet?.id);
          prior.materializedFromTimesheetEntryId = originalManualEntryId;
          prior.approvalStatus = 'approved';
          prior.excludeFromTotals = false;
          prior.hours = payableHours;
          prior.timesheetHours = payableHours;
          prior.isManual = true;
        }
        summary.activities.push(result);
      }
    } catch (error) {
      summary.errors.push({
        sessionId: normalizeId(entry?.sessionId),
        message: error.message
      });
    }
  }

  if (summary.errors.length) {
    throw new Error(summary.errors.map((row) => row.message).join(' '));
  }

  const patchedEntries = sourceEntries.map((row) => {
    const token = normalizeId(row?.sessionId);
    return entryBySessionId.get(token) || row;
  });

  return {
    timesheet: {
      ...timesheet,
      entries: patchedEntries,
      submissionSnapshot: timesheet?.submissionSnapshot
        ? { ...timesheet.submissionSnapshot, entries: patchedEntries.map((row) => ({ ...row })) }
        : timesheet.submissionSnapshot,
      materializationSummary: summary
    },
    summary
  };
}

function clearActivityMaterializationMarkers(entry = {}) {
  const next = { ...entry };
  delete next.materializedAt;
  delete next.materializedSessionId;
  delete next.materializedFromTimesheetId;
  delete next.materializedFromTimesheetEntryId;
  return next;
}

/**
 * Stamp approve-time activity materialization onto a timesheet row.
 * Keeps the stable MAN_* sessionId so decide/UI APIs keep working; process skips via materializedAt.
 */
function applyActivityMaterializationMarkers(entry = {}, result = {}, timesheet = {}) {
  const originalManualEntryId = normalizeId(entry?.sessionId);
  const payableHours = Number(parseFloat(entry?.requestedHours ?? entry?.durationHours ?? entry?.hours) || 0);
  return {
    ...entry,
    activityEntryId: normalizeId(result?.activityEntryId) || normalizeId(entry?.activityEntryId),
    materializedAt: new Date().toISOString(),
    materializedSessionId: normalizeId(result?.sessionId),
    materializedFromTimesheetId: normalizeId(timesheet?.id),
    materializedFromTimesheetEntryId: originalManualEntryId,
    approvalStatus: 'approved',
    excludeFromTotals: false,
    hours: Number.isFinite(payableHours) ? payableHours : Number(entry?.hours || 0),
    timesheetHours: Number.isFinite(payableHours) ? payableHours : Number(entry?.timesheetHours || 0),
    isManual: true
  };
}

/**
 * Revert activity side-effects for one manual timesheet row (approve-time or process materialization).
 * Public: remove assignees tagged with this timesheet + manual entry id.
 * Individual: drop created ENTRY when it becomes empty after removing those assignees.
 */
async function revertMaterializedActivityManualEntry({
  timesheetId,
  timesheetEntryId,
  activityId,
  activityEntryId,
  reqUser
} = {}) {
  const timesheetToken = normalizeId(timesheetId);
  const manualEntryToken = normalizeId(timesheetEntryId);
  const activityToken = normalizeId(activityId);
  if (!timesheetToken || !manualEntryToken || !activityToken) {
    return { reverted: false, revertedAssignees: 0, removedEntry: false };
  }

  const activity = await schoolDataService.getDataById('activities', activityToken, reqUser);
  if (!activity) return { reverted: false, revertedAssignees: 0, removedEntry: false };

  const preferredEntryId = normalizeId(activityEntryId);
  const entries = activityService.getActivityEntries(activity);
  let revertedAssignees = 0;
  let removedEntry = false;
  const nextEntries = [];

  entries.forEach((entry) => {
    const entryToken = normalizeId(entry?.entryId || entry?.id);
    const priorAssignees = Array.isArray(entry.assignees) ? entry.assignees : [];
    const shouldScan = !preferredEntryId || preferredEntryId === entryToken;
    if (!shouldScan) {
      nextEntries.push(entry);
      return;
    }
    const assignees = priorAssignees.filter((assignee) => {
      const fromTimesheet = normalizeId(assignee?.materializedFromTimesheetId) === timesheetToken;
      const fromEntry = normalizeId(assignee?.materializedFromTimesheetEntryId) === manualEntryToken;
      if (fromTimesheet && fromEntry) {
        revertedAssignees += 1;
        return false;
      }
      return true;
    });
    if (assignees.length !== priorAssignees.length && !assignees.length) {
      removedEntry = true;
      return;
    }
    if (assignees.length !== priorAssignees.length) {
      nextEntries.push({ ...entry, assignees });
      return;
    }
    nextEntries.push(entry);
  });

  if (!revertedAssignees) {
    return { reverted: false, revertedAssignees: 0, removedEntry: false };
  }

  await schoolDataService.updateData('activities', activityToken, {
    ...activity,
    entries: nextEntries,
    attendees: activityService.flattenActivityAssignees(nextEntries)
  }, reqUser);

  return { reverted: true, revertedAssignees, removedEntry };
}

async function revertMaterializedRecordsForTimesheet({
  timesheetId,
  reqUser,
  preserveTimesheetEntryIds = []
} = {}) {
  const token = normalizeId(timesheetId);
  if (!token) return { revertedClassSessions: 0, revertedActivityEntries: 0, entryRestorations: [] };

  const preserveEntryIds = new Set(
    (Array.isArray(preserveTimesheetEntryIds) ? preserveTimesheetEntryIds : [])
      .map(normalizeId)
      .filter(Boolean)
  );

  let revertedClassSessions = 0;
  let revertedActivityEntries = 0;
  const entryRestorations = [];
  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser);
  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = normalizeId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    let changed = false;
    const kept = (Array.isArray(sessions) ? sessions : []).filter((session) => {
      if (normalizeId(session?.materializedFromTimesheetId) !== token) return true;
      const fromEntry = normalizeId(session?.materializedFromTimesheetEntryId);
      if (preserveEntryIds.has(fromEntry)) return true;
      entryRestorations.push({
        materializedSessionId: normalizeId(session?.sessionId),
        originalEntryId: fromEntry
      });
      revertedClassSessions += 1;
      changed = true;
      return false;
    });
    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.saveClassSessions(classId, kept, reqUser);
    }
  }

  const activities = await schoolDataService.fetchAllData('activities', {}, reqUser);
  for (const activity of Array.isArray(activities) ? activities : []) {
    const activityId = normalizeId(activity?.id);
    if (!activityId) continue;
    const entries = activityService.getActivityEntries(activity);
    const nextEntries = [];
    let changed = false;
    entries.forEach((entry) => {
      const assignees = (Array.isArray(entry.assignees) ? entry.assignees : []).filter((assignee) => {
        if (normalizeId(assignee?.materializedFromTimesheetId) === token) {
          const fromEntry = normalizeId(assignee?.materializedFromTimesheetEntryId);
          if (preserveEntryIds.has(fromEntry)) return true;
          entryRestorations.push({
            materializedSessionId: `act-${activityId}-${normalizeId(entry?.entryId || entry?.id)}-${normalizeId(assignee?.personId)}`,
            activityEntryId: normalizeId(entry?.entryId || entry?.id),
            originalEntryId: fromEntry
          });
          revertedActivityEntries += 1;
          changed = true;
          return false;
        }
        return true;
      });
      if (!assignees.length && (Array.isArray(entry.assignees) ? entry.assignees : []).length) {
        changed = true;
        return;
      }
      nextEntries.push({ ...entry, assignees });
    });
    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('activities', activityId, {
        ...activity,
        entries: nextEntries,
        attendees: activityService.flattenActivityAssignees(nextEntries)
      }, reqUser);
    }
  }

  return { revertedClassSessions, revertedActivityEntries, entryRestorations };
}

module.exports = {
  isManualMaterializationCandidate,
  resolveNextTimesheetPeriodId,
  materializeActivityManualEntry,
  applyActivityMaterializationMarkers,
  clearActivityMaterializationMarkers,
  materializeApprovedTimesheetManualEntries,
  collectPreservedMaterializedManualEntryIds,
  isPersistedRejectedManualActivityRow,
  revertMaterializedActivityManualEntry,
  revertMaterializedRecordsForTimesheet
};
