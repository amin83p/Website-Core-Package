'use strict';

const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const dataService = require('./schoolDataService');
const schoolDependencyService = require('./schoolDependencyService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const { normalizeDateToken } = require('./timesheetExcel/timesheetExcelCellUtils');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const MINUTES_PER_DAY = 24 * 60;

function cleanId(value) {
  return String(value ?? '').trim();
}

function entryHasTimesheetLock(entry = {}) {
  if (entry?.locked === true || String(entry?.lockReason || '') === 'timesheet_approved') return true;
  return (Array.isArray(entry.assignees) ? entry.assignees : []).some((assignee) => (
    assignee?.locked === true || String(assignee?.lockReason || '') === 'timesheet_approved'
  ));
}

function recomputeActivityLockedFromEntries(activity = {}, entries = []) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const stillLocked = normalizedEntries.some(entryHasTimesheetLock);
  const firstEntry = normalizedEntries[0] || {};
  const totalDurationHours = Number(normalizedEntries.reduce((sum, entry) => {
    return sum + (Number(entry.durationHours) || 0);
  }, 0).toFixed(2));
  const next = {
    ...activity,
    entries: normalizedEntries,
    attendees: activityService.flattenActivityAssignees(normalizedEntries),
    locked: stillLocked,
    date: firstEntry.date || '',
    startTime: firstEntry.startTime || '',
    endTime: firstEntry.endTime || '',
    durationHours: normalizedEntries.length ? Number(firstEntry.durationHours || 0) : 0,
    totalDurationHours
  };
  if (!stillLocked) {
    delete next.lockReason;
    delete next.lockedTimesheetId;
  }
  return next;
}

async function persistImportActivityEntryUpdates(activity, entries, reqUser) {
  const activityId = cleanId(activity?.id);
  if (!activityId) throw new Error('Import activity is required.');
  const payload = recomputeActivityLockedFromEntries(activity, entries);
  await dataService.updateData('activities', activityId, payload, reqUser, {
    maintenanceActivityEntries: true
  });
  return payload;
}

function normalizePayrollRole(value) {
  return timesheetPayrollContextService.normalizePayrollRole(value);
}

function buildAssigneeRoleFields(role) {
  const normalized = normalizePayrollRole(role) || 'teacher';
  return { role: normalized, roles: [normalized] };
}

function resolveImportBillableHours(row = {}) {
  const regular = Math.max(0, Number(parseFloat(row?.hours) || 0));
  const optional = row?.optionalHours != null && Number.isFinite(Number(row.optionalHours))
    ? Math.max(0, Number(row.optionalHours))
    : 0;
  return Number((regular + optional).toFixed(2));
}

function buildImportOptionalHoursComment(optionalHours) {
  const value = Number(optionalHours);
  if (!Number.isFinite(value) || value <= 0) return '';
  const label = value === 1 ? 'hr' : 'hrs';
  return `This hour was optional (${value} ${label})`;
}

function buildImportRowNotes(row = {}) {
  const commentParts = [];
  if (row?.comment) commentParts.push(String(row.comment).trim());
  if (row?.studentName) commentParts.push(`Student: ${String(row.studentName).trim()}`);
  const optionalComment = buildImportOptionalHoursComment(row?.optionalHours);
  if (optionalComment) commentParts.push(optionalComment);
  return commentParts.filter(Boolean).join(' | ');
}

function normalizeImportRowDate(value) {
  return normalizeDateToken(value);
}

function resolveSourceRowNumber(row = {}, fallbackIndex = 0) {
  const parsed = Number(row?.sourceRowNumber);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallbackIndex + 1;
}

function clockTimeFromDayOffsetMinutes(minutesFromMidnight) {
  return sessionStatusPolicyService.addMinutesToClockTime('00:00', minutesFromMidnight) || '00:00';
}

function stackCompiledRowsByDate(compiledRows = []) {
  const prepared = (Array.isArray(compiledRows) ? compiledRows : [])
    .map((row, index) => {
      const date = normalizeImportRowDate(row?.date);
      const hours = resolveImportBillableHours(row);
      return {
        ...row,
        date,
        hours,
        __sortIndex: index,
        __sourceRowNumber: resolveSourceRowNumber(row, index)
      };
    })
    .filter((row) => row.date && Number.isFinite(row.hours) && row.hours > 0);

  prepared.sort((left, right) => {
    const dateCompare = String(left.date).localeCompare(String(right.date));
    if (dateCompare !== 0) return dateCompare;
    if (left.__sourceRowNumber !== right.__sourceRowNumber) {
      return left.__sourceRowNumber - right.__sourceRowNumber;
    }
    return left.__sortIndex - right.__sortIndex;
  });

  const dayStackCursorMinutes = new Map();
  return prepared.map((row) => {
    const dayKey = row.date;
    const startMinutes = dayStackCursorMinutes.has(dayKey)
      ? dayStackCursorMinutes.get(dayKey)
      : 0;
    const endMinutes = startMinutes + (row.hours * 60);
    if (endMinutes > MINUTES_PER_DAY) {
      const dayTotalHours = Number((endMinutes / 60).toFixed(2));
      throw new Error(
        `Import rows for ${dayKey} total ${dayTotalHours} hours, which exceeds 24 hours in one day.`
      );
    }

    dayStackCursorMinutes.set(dayKey, endMinutes);
    const startTime = clockTimeFromDayOffsetMinutes(startMinutes);
    const endTime = clockTimeFromDayOffsetMinutes(endMinutes);
    const { __sortIndex, __sourceRowNumber, ...rest } = row;
    return {
      ...rest,
      startTime,
      endTime,
      durationHours: Number(row.hours.toFixed(2))
    };
  });
}

function buildCompletedAssignee({
  activity = {},
  personId = '',
  personName = '',
  personRole = '',
  hours = 0,
  notes = '',
  importTrace = {}
}) {
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const paid = activity.paid === true;
  const safeHours = Number(Number(hours || 0).toFixed(2));
  const roleFields = buildAssigneeRoleFields(personRole);
  const nowIso = new Date().toISOString();
  const base = {
    personId: cleanId(personId),
    personName: String(personName || personId || '').trim(),
    paid,
    paidHours: paid ? safeHours : 0,
    notes: String(notes || '').trim(),
    ...roleFields,
    ...importTrace
  };
  if (evaluationType === 'completion') {
    return {
      ...base,
      status: paid ? 'attended' : 'attended',
      completionStatus: 'completed',
      completedAt: nowIso,
      completedBy: cleanId(personId)
    };
  }
  return {
    ...base,
    status: 'attended',
    completionStatus: 'pending'
  };
}

function buildImportWorkSessionEntryDrafts({
  compiledRows = [],
  activity = {},
  personId = '',
  personName = '',
  personRole = '',
  periodId = '',
  batchId = '',
  sourceFileName = ''
}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  const importTrace = {
    legacyImportBatchId: cleanId(batchId),
    legacyImportSourceFileName: String(sourceFileName || '').trim(),
    legacyImportPeriodId: targetPeriodId,
    legacyImportPersonId: targetPersonId
  };

  return stackCompiledRowsByDate(compiledRows).map((row, index) => {
    const title = String(row?.className || '').trim();
    const notes = buildImportRowNotes(row);
    return {
      title,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      durationHours: row.durationHours,
      status: 'posted',
      notes,
      assignees: [buildCompletedAssignee({
        activity,
        personId: targetPersonId,
        personName,
        personRole,
        hours: row.durationHours,
        notes,
        importTrace
      })],
      excludedPersonIds: [],
      ...importTrace,
      legacyImportRowIndex: index + 1
    };
  });
}

function assignImportEntryIds(activityId, existingEntries = [], drafts = []) {
  const sequences = (Array.isArray(existingEntries) ? existingEntries : [])
    .map((row) => activityEntryIdService.parseEntryId(row?.entryId))
    .filter(Boolean)
    .map((parsed) => Number(parsed.sequence || 0))
    .filter((value) => Number.isFinite(value));
  let nextSequence = sequences.length ? Math.max(...sequences) : 0;
  return (Array.isArray(drafts) ? drafts : []).map((draft) => {
    nextSequence += 1;
    return {
      ...draft,
      entryId: activityEntryIdService.buildEntryId(activityId, nextSequence)
    };
  });
}

async function createImportWorkSessions({
  orgId,
  activity,
  compiledRows = [],
  personId,
  personName = '',
  personRole = '',
  periodId = '',
  batchId = '',
  sourceFileName = '',
  reqUser
}) {
  const targetPersonId = cleanId(personId);
  if (!targetPersonId) throw new Error('Person is required to create import work sessions.');
  if (!activity || !cleanId(activity.id)) throw new Error('Import activity is required.');
  if (!idsEqual(activity.orgId, orgId)) throw new Error('Import activity is not in the active organization.');
  if (!activityService.isPersonEligibleForActivity(activity, targetPersonId)) {
    throw new Error('The import person is not eligible for the configured import activity.');
  }

  const drafts = buildImportWorkSessionEntryDrafts({
    compiledRows,
    activity,
    personId: targetPersonId,
    personName,
    personRole,
    periodId,
    batchId,
    sourceFileName
  });
  if (!drafts.length) {
    throw new Error('No import rows were available to create work sessions.');
  }

  const existingEntries = activityService.getActivityEntries(activity);
  const entriesWithIds = assignImportEntryIds(activity.id, existingEntries, drafts);
  const combinedEntries = [...existingEntries, ...entriesWithIds];

  const saved = await persistImportActivityEntryUpdates(activity, combinedEntries, reqUser);

  const createdEntryIds = entriesWithIds.map((row) => cleanId(row.entryId)).filter(Boolean);
  return {
    activityId: cleanId(activity.id),
    batchId: cleanId(batchId),
    createdEntryIds,
    rowCount: createdEntryIds.length,
    activity: saved
  };
}

function entryDateInImportPeriod(date, periodStartDate = '', periodEndDate = '') {
  const token = cleanId(date);
  const start = cleanId(periodStartDate);
  const end = cleanId(periodEndDate);
  if (!token) return false;
  if (start && token < start) return false;
  if (end && token > end) return false;
  return true;
}

function importStampMatchesPersonPeriod(entry = {}, {
  personId = '',
  periodId = ''
} = {}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  if (!targetPersonId) return false;

  const stampedPersonId = cleanId(entry?.legacyImportPersonId);
  const stampedPeriodId = cleanId(entry?.legacyImportPeriodId);
  if (stampedPersonId && idsEqual(stampedPersonId, targetPersonId)) {
    if (stampedPeriodId && targetPeriodId && idsEqual(stampedPeriodId, targetPeriodId)) return true;
    if (stampedPeriodId && !targetPeriodId) return true;
    if (!stampedPeriodId) return true;
  }

  return activityService.normalizeActivityAssigneeRows(entry.assignees).some((assignee) => {
    const assigneePersonId = cleanId(assignee?.legacyImportPersonId);
    const assigneePeriodId = cleanId(assignee?.legacyImportPeriodId);
    if (!assigneePersonId || !idsEqual(assigneePersonId, targetPersonId)) return false;
    if (assigneePeriodId && targetPeriodId && idsEqual(assigneePeriodId, targetPeriodId)) return true;
    if (assigneePeriodId && !targetPeriodId) return true;
    return !assigneePeriodId;
  });
}

function isImportWorkSessionEntryForTarget(entry, activity = {}, {
  personId = '',
  periodId = '',
  periodStartDate = '',
  periodEndDate = ''
} = {}) {
  const targetPersonId = cleanId(personId);
  const date = cleanId(entry?.date);
  if (!targetPersonId || !date) return false;
  if (!entryDateInImportPeriod(date, periodStartDate, periodEndDate)) return false;

  if (importStampMatchesPersonPeriod(entry, { personId: targetPersonId, periodId })) {
    return true;
  }

  if (!activityService.isPersonEligibleForEntry(activity, entry, targetPersonId)) return false;
  const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
  return assignees.some((assignee) => idsEqual(assignee.personId, targetPersonId)
    && activityService.isAssigneeEligibleForTimesheet(activity, assignee));
}

function countImportWorkSessionsForTarget(entries = [], activity = {}, options = {}) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => isImportWorkSessionEntryForTarget(entry, activity, options)).length;
}

async function unlockImportWorkSessionsForTarget(activity = {}, options = {}) {
  return schoolDependencyService.forceUnlockImportStampedActivityEntries({
    activity,
    ...options
  });
}

function filterImportWorkSessionsForTarget(entries = [], activity = {}, options = {}) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => !isImportWorkSessionEntryForTarget(entry, activity, options));
}

function activityQualifiesForImportCleanup(activity = {}, entries = [], importActivityId = '') {
  if (importActivityId && idsEqual(activity.id, importActivityId)) return true;
  if (/import/i.test(String(activity.title || ''))) return true;
  return (Array.isArray(entries) ? entries : []).some((entry) => cleanId(entry?.legacyImportBatchId)
    || cleanId(entry?.legacyImportPersonId)
    || cleanId(entry?.legacyImportPeriodId));
}

function buildImportActivitySessionIds({ activityId = '', personId = '', entryIds = [] } = {}) {
  const actId = cleanId(activityId);
  const targetPersonId = cleanId(personId);
  return new Set((Array.isArray(entryIds) ? entryIds : [])
    .map((entryId) => cleanId(entryId))
    .filter(Boolean)
    .map((entryId) => `act-${actId}-${entryId}-${targetPersonId}`));
}

function parseActivityEntryIdFromSessionId(sessionId = '', { activityId = '', personId = '' } = {}) {
  const sid = cleanId(sessionId);
  const actId = cleanId(activityId);
  const targetPersonId = cleanId(personId);
  if (!sid.startsWith('act-') || !actId || !targetPersonId) return '';
  const prefix = `act-${actId}-`;
  const suffix = `-${targetPersonId}`;
  if (!sid.startsWith(prefix) || !sid.endsWith(suffix)) return '';
  return sid.slice(prefix.length, sid.length - suffix.length);
}

function extractActivityEntryIdsFromTimesheetEntries(entries = [], { activityId = '', personId = '' } = {}) {
  const ids = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || entry.isDeleted === true) return;
    const entryId = parseActivityEntryIdFromSessionId(entry?.sessionId, { activityId, personId });
    if (entryId) ids.add(entryId);
  });
  return [...ids];
}

function mergeImportWorkSessionCleanupTotals(target = {}, source = {}) {
  return {
    removedEntries: Number(target.removedEntries || 0) + Number(source.removedEntries || 0),
    removedAssignees: Number(target.removedAssignees || 0) + Number(source.removedAssignees || 0)
  };
}

async function removeImportWorkSessionsForTarget({
  activityId,
  personId,
  periodId = '',
  periodStartDate = '',
  periodEndDate = '',
  reqUser
}) {
  const targetActivityId = cleanId(activityId);
  const targetPersonId = cleanId(personId);
  if (!targetActivityId || !targetPersonId) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) return { removedEntries: 0, removedAssignees: 0 };

  const targetOptions = {
    personId: targetPersonId,
    periodId: cleanId(periodId),
    periodStartDate,
    periodEndDate
  };
  const unlockResult = await unlockImportWorkSessionsForTarget(activity, {
    ...targetOptions,
    reqUser,
    note: 'Legacy import delete cleanup'
  });
  const workingActivity = unlockResult.changed ? unlockResult.activity : activity;
  const existingEntries = activityService.getActivityEntries(workingActivity);
  const nextEntries = filterImportWorkSessionsForTarget(existingEntries, workingActivity, targetOptions);
  const removedEntries = existingEntries.length - nextEntries.length;
  if (!removedEntries) {
    if (unlockResult.changed) {
      await persistImportActivityEntryUpdates(workingActivity, existingEntries, reqUser);
    }
    return { removedEntries: 0, removedAssignees: 0, activityId: targetActivityId };
  }

  await persistImportActivityEntryUpdates(workingActivity, nextEntries, reqUser);

  return { removedEntries, removedAssignees: 0, activityId: targetActivityId };
}

async function removeTrackedImportWorkSessionsForPersonPeriod({
  orgId,
  personId,
  periodId = '',
  periodStartDate = '',
  periodEndDate = '',
  importActivityId = '',
  reqUser
}) {
  const targetPersonId = cleanId(personId);
  if (!targetPersonId || !cleanId(orgId)) {
    return { removedEntries: 0, scannedActivities: 0, cleanedActivities: [] };
  }

  const targetOptions = {
    personId: targetPersonId,
    periodId: cleanId(periodId),
    periodStartDate,
    periodEndDate
  };
  const activities = await activityService.listActivities({ orgId, reqUser });
  let removedEntries = 0;
  let scannedActivities = 0;
  const cleanedActivities = [];

  for (const activity of (Array.isArray(activities) ? activities : [])) {
    if (String(activity?.status || '').trim().toLowerCase() !== 'posted' || activity.paid !== true) continue;
    scannedActivities += 1;
    const unlockResult = await unlockImportWorkSessionsForTarget(activity, {
      ...targetOptions,
      reqUser,
      note: 'Legacy import delete cleanup'
    });
    const workingActivity = unlockResult.changed ? unlockResult.activity : activity;
    const existingEntries = activityService.getActivityEntries(workingActivity);
    if (!activityQualifiesForImportCleanup(workingActivity, existingEntries, importActivityId)) continue;
    const nextEntries = filterImportWorkSessionsForTarget(existingEntries, workingActivity, targetOptions);
    const removedForActivity = existingEntries.length - nextEntries.length;
    if (!removedForActivity && !unlockResult.changed) continue;
    if (removedForActivity) {
      await persistImportActivityEntryUpdates(workingActivity, nextEntries, reqUser);
    } else if (unlockResult.changed) {
      await persistImportActivityEntryUpdates(workingActivity, existingEntries, reqUser);
    }
    if (!removedForActivity) continue;
    removedEntries += removedForActivity;
    cleanedActivities.push({
      activityId: cleanId(activity.id),
      removedEntries: removedForActivity
    });
  }

  return { removedEntries, scannedActivities, cleanedActivities };
}

async function removeImportWorkSessionsByBatchId({ activityId, batchId, reqUser }) {
  const targetActivityId = cleanId(activityId);
  const targetBatchId = cleanId(batchId);
  if (!targetActivityId || !targetBatchId) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) return { removedEntries: 0, removedAssignees: 0 };

  const unlockResult = await schoolDependencyService.forceUnlockImportBatchActivityEntries({
    activity,
    batchId: targetBatchId,
    reqUser,
    note: 'Legacy import delete cleanup'
  });
  const workingActivity = unlockResult.changed ? unlockResult.activity : activity;

  let removedEntries = 0;
  let removedAssignees = 0;
  const nextEntries = [];

  activityService.getActivityEntries(workingActivity).forEach((entry) => {
    const entryBatchId = cleanId(entry?.legacyImportBatchId);
    if (entryBatchId && idsEqual(entryBatchId, targetBatchId)) {
      removedEntries += 1;
      return;
    }
    const assignees = Array.isArray(entry.assignees) ? entry.assignees : [];
    const keptAssignees = assignees.filter((assignee) => {
      const assigneeBatchId = cleanId(assignee?.legacyImportBatchId);
      if (assigneeBatchId && idsEqual(assigneeBatchId, targetBatchId)) {
        removedAssignees += 1;
        return false;
      }
      return true;
    });
    if (!keptAssignees.length && assignees.length) {
      removedEntries += 1;
      return;
    }
    if (keptAssignees.length !== assignees.length) {
      nextEntries.push({ ...entry, assignees: keptAssignees });
      return;
    }
    nextEntries.push(entry);
  });

  if (!removedEntries && !removedAssignees) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  await persistImportActivityEntryUpdates(workingActivity, nextEntries, reqUser);

  return { removedEntries, removedAssignees };
}

async function removeImportWorkSessionsByEntryIds({ activityId, entryIds = [], reqUser }) {
  const targetActivityId = cleanId(activityId);
  const targetEntryIds = new Set(
    (Array.isArray(entryIds) ? entryIds : []).map((entryId) => cleanId(entryId)).filter(Boolean)
  );
  if (!targetActivityId || !targetEntryIds.size) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) return { removedEntries: 0, removedAssignees: 0 };

  const unlockResult = await schoolDependencyService.forceUnlockActivityEntryIdsTimesheetLocks({
    activity,
    entryIds: [...targetEntryIds],
    reqUser,
    note: 'Legacy import delete cleanup'
  });
  const workingActivity = unlockResult.changed ? unlockResult.activity : activity;

  let removedEntries = 0;
  const nextEntries = activityService.getActivityEntries(workingActivity).filter((entry) => {
    const entryId = cleanId(entry?.entryId);
    if (entryId && targetEntryIds.has(entryId)) {
      removedEntries += 1;
      return false;
    }
    return true;
  });

  if (!removedEntries) {
    if (unlockResult.changed) {
      await persistImportActivityEntryUpdates(
        workingActivity,
        activityService.getActivityEntries(workingActivity),
        reqUser
      );
    }
    return { removedEntries: 0, removedAssignees: 0 };
  }

  await persistImportActivityEntryUpdates(workingActivity, nextEntries, reqUser);

  return { removedEntries, removedAssignees: 0 };
}

async function countOrphanImportWorkSessionsByPerson({
  orgId,
  periodId = '',
  periodStartDate = '',
  periodEndDate = '',
  importActivityId = '',
  reqUser
} = {}) {
  const countsByPerson = new Map();
  const targetPeriodId = cleanId(periodId);
  const targetImportActivityId = cleanId(importActivityId);
  if (!cleanId(orgId) || !targetPeriodId || !targetImportActivityId) {
    return countsByPerson;
  }

  const activity = await activityService.getActivity(targetImportActivityId, reqUser);
  if (!activity || !idsEqual(activity.orgId, orgId)) return countsByPerson;

  activityService.getActivityEntries(activity).forEach((entry) => {
    const stampedPersonId = cleanId(entry?.legacyImportPersonId)
      || activityService.normalizeActivityAssigneeRows(entry.assignees)
        .map((assignee) => cleanId(assignee?.legacyImportPersonId))
        .find(Boolean);
    if (!stampedPersonId) return;
    const targetOptions = {
      personId: stampedPersonId,
      periodId: targetPeriodId,
      periodStartDate,
      periodEndDate
    };
    if (!isImportWorkSessionEntryForTarget(entry, activity, targetOptions)) return;
    countsByPerson.set(stampedPersonId, (countsByPerson.get(stampedPersonId) || 0) + 1);
  });

  return countsByPerson;
}

function buildImportBatchId({ periodId = '', personId = '', sourceFileName = '' } = {}) {
  const token = `${cleanId(periodId)}-${cleanId(personId)}-${Date.now()}`;
  const fileToken = String(sourceFileName || 'import')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .slice(0, 24)
    .toLowerCase();
  return `legacyimp-batch-${fileToken}-${token}`;
}

module.exports = {
  normalizeImportRowDate,
  resolveImportBillableHours,
  buildImportOptionalHoursComment,
  stackCompiledRowsByDate,
  buildImportRowNotes,
  buildCompletedAssignee,
  buildImportWorkSessionEntryDrafts,
  importStampMatchesPersonPeriod,
  entryDateInImportPeriod,
  isImportWorkSessionEntryForTarget,
  countImportWorkSessionsForTarget,
  filterImportWorkSessionsForTarget,
  activityQualifiesForImportCleanup,
  buildImportActivitySessionIds,
  parseActivityEntryIdFromSessionId,
  extractActivityEntryIdsFromTimesheetEntries,
  mergeImportWorkSessionCleanupTotals,
  recomputeActivityLockedFromEntries,
  persistImportActivityEntryUpdates,
  createImportWorkSessions,
  removeImportWorkSessionsForTarget,
  removeTrackedImportWorkSessionsForPersonPeriod,
  removeImportWorkSessionsByBatchId,
  removeImportWorkSessionsByEntryIds,
  countOrphanImportWorkSessionsByPerson,
  buildImportBatchId
};
