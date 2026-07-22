const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
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
  if (!sessionId.startsWith('MAN_')) return false;
  return Boolean(normalizeId(entry.classId) || normalizeId(entry.activityId));
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

function nextClassSessionId(sessions = []) {
  const nums = (Array.isArray(sessions) ? sessions : [])
    .map((row) => {
      const token = normalizeId(row?.sessionId || row?.id);
      const match = token.match(/^SES-(\d+)$/i);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `SES-${String(next).padStart(3, '0')}`;
}

async function resolveNextTimesheetPeriodId({ orgId, currentPeriod = {}, reqUser } = {}) {
  const endDate = normalizeDate(currentPeriod?.endDate);
  if (!endDate) return '';
  const rows = await schoolDataService.fetchData('timesheetPeriods', {}, reqUser);
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
  const sessionId = nextClassSessionId(sessions);
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

async function materializeActivityManualEntry({
  entry,
  timesheet,
  teacherId,
  reqUser
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
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const paid = activity.paid === true && entry?.activityPaid !== false;
  const nowIso = new Date().toISOString();
  const assigneeBase = {
    personId: normalizeId(teacherId),
    personName: '',
    paid,
    paidHours: paid ? hours : 0,
    notes: String(entry?.comment || entry?.description || '').trim(),
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

  // Public activities link an existing work session; individual suggests create a new ENTRY.
  if (existingEntryId) {
    if (visibilityScope === 'individual') {
      throw new Error('Individual activity manual rows cannot materialize against an existing work session.');
    }
    const index = mutableEntries.findIndex((row) => normalizeId(row?.entryId || row?.id) === existingEntryId);
    if (index < 0) {
      throw new Error(`Work session ${existingEntryId} is no longer available on activity ${activityId}.`);
    }
    const workEntry = { ...mutableEntries[index] };
    if (normalizeId(workEntry.status || 'posted').toLowerCase() !== 'posted') {
      throw new Error(`Work session ${existingEntryId} must be posted before timesheet processing.`);
    }
    if (!activityService.isPersonEligibleForEntry(activity, workEntry, teacherId)) {
      throw new Error('Teacher is no longer eligible for the selected work session.');
    }
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
    mutableEntries[index] = {
      ...workEntry,
      assignees
    };
    const updated = {
      ...activity,
      entries: mutableEntries,
      attendees: activityService.flattenActivityAssignees(mutableEntries)
    };
    await schoolDataService.updateData('activities', activityId, updated, reqUser);
    const sessionId = `act-${activityId}-${existingEntryId}-${normalizeId(teacherId)}`;
    return { activityId, activityEntryId: existingEntryId, sessionId, assignee, linkedExisting: true };
  }

  if (visibilityScope === 'school') {
    throw new Error('Public activity manual rows must select an existing work session before processing.');
  }

  const entryId = nextActivityEntryId(mutableEntries);
  const workEntry = {
    entryId,
    title: String(entry?.description || entry?.className || activity.title || '').trim(),
    date: normalizeDate(entry?.date),
    startTime: String(entry?.startTime || '').trim(),
    endTime: String(entry?.endTime || '').trim(),
    durationHours: hours,
    status: 'posted',
    notes: String(entry?.comment || '').trim(),
    assignees: [assignee]
  };
  mutableEntries.push(workEntry);
  const updated = {
    ...activity,
    entries: mutableEntries,
    attendees: activityService.flattenActivityAssignees(mutableEntries)
  };
  await schoolDataService.updateData('activities', activityId, updated, reqUser);
  const sessionId = `act-${activityId}-${entryId}-${normalizeId(teacherId)}`;
  return { activityId, activityEntryId: entryId, sessionId, assignee, linkedExisting: false };
}

async function materializeApprovedTimesheetManualEntries({ timesheet = {}, period = {}, reqUser } = {}) {
  const sourceEntries = Array.isArray(timesheet?.submissionSnapshot?.entries)
    ? timesheet.submissionSnapshot.entries
    : (Array.isArray(timesheet?.entries) ? timesheet.entries : []);
  const teacherId = normalizeId(timesheet?.teacherId);
  const orgId = normalizeId(timesheet?.orgId || period?.orgId);
  const attendanceDuePeriodId = await resolveNextTimesheetPeriodId({
    orgId,
    currentPeriod: period,
    reqUser
  });

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
          reqUser
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

async function revertMaterializedRecordsForTimesheet({ timesheetId, reqUser } = {}) {
  const token = normalizeId(timesheetId);
  if (!token) return { revertedClassSessions: 0, revertedActivityEntries: 0, entryRestorations: [] };

  let revertedClassSessions = 0;
  let revertedActivityEntries = 0;
  const entryRestorations = [];
  const classes = await schoolDataService.fetchData('classes', {}, reqUser);
  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = normalizeId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    let changed = false;
    const kept = (Array.isArray(sessions) ? sessions : []).filter((session) => {
      if (normalizeId(session?.materializedFromTimesheetId) !== token) return true;
      entryRestorations.push({
        materializedSessionId: normalizeId(session?.sessionId),
        originalEntryId: normalizeId(session?.materializedFromTimesheetEntryId)
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

  const activities = await schoolDataService.fetchData('activities', {}, reqUser);
  for (const activity of Array.isArray(activities) ? activities : []) {
    const activityId = normalizeId(activity?.id);
    if (!activityId) continue;
    const entries = activityService.getActivityEntries(activity);
    const nextEntries = [];
    let changed = false;
    entries.forEach((entry) => {
      const assignees = (Array.isArray(entry.assignees) ? entry.assignees : []).filter((assignee) => {
        if (normalizeId(assignee?.materializedFromTimesheetId) === token) {
          entryRestorations.push({
            materializedSessionId: `act-${activityId}-${normalizeId(entry?.entryId || entry?.id)}-${normalizeId(assignee?.personId)}`,
            activityEntryId: normalizeId(entry?.entryId || entry?.id),
            originalEntryId: normalizeId(assignee?.materializedFromTimesheetEntryId)
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
  revertMaterializedActivityManualEntry,
  revertMaterializedRecordsForTimesheet
};
