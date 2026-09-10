'use strict';

const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const statutoryHolidayDayMappingService = require('./statutoryHolidayDayMappingService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
}

function entryDateInPeriod(date, periodStartDate = '', periodEndDate = '') {
  return timesheetImportWorkSessionBuilderService.entryDateInImportPeriod(
    date,
    periodStartDate,
    periodEndDate
  );
}

function entryHasStatHolidayStamp(entry = {}, personId = '', periodId = '') {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  if (cleanId(entry?.statHolidayPersonId) && idsEqual(entry.statHolidayPersonId, targetPersonId)) {
    if (targetPeriodId && cleanId(entry?.statHolidayPeriodId) && !idsEqual(entry.statHolidayPeriodId, targetPeriodId)) {
      return false;
    }
    return Boolean(cleanId(entry?.statHolidayId));
  }
  return activityService.normalizeActivityAssigneeRows(entry.assignees).some((assignee) => {
    if (!idsEqual(assignee?.statHolidayPersonId, targetPersonId)) return false;
    if (targetPeriodId && cleanId(assignee?.statHolidayPeriodId) && !idsEqual(assignee.statHolidayPeriodId, targetPeriodId)) {
      return false;
    }
    return Boolean(cleanId(assignee?.statHolidayId));
  });
}

function isStatHolidayWorkSessionEntryForTarget(entry, activity = {}, options = {}) {
  const targetPersonId = cleanId(options.personId);
  const date = cleanId(entry?.date);
  if (!targetPersonId || !date) return false;
  if (!entryDateInPeriod(date, options.periodStartDate, options.periodEndDate)) return false;
  if (!entryHasStatHolidayStamp(entry, targetPersonId, options.periodId)) return false;
  if (!activityService.isPersonEligibleForEntry(activity, entry, targetPersonId)) return false;
  const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
  return assignees.some((assignee) => idsEqual(assignee.personId, targetPersonId)
    && activityService.isAssigneeEligibleForTimesheet(activity, assignee));
}

function findStatHolidayDayEntry(entries = [], { holidayId = '', date = '' } = {}) {
  const targetHolidayId = cleanId(holidayId);
  const targetDate = cleanId(date);
  if (!targetDate) return null;
  const list = Array.isArray(entries) ? entries : [];
  const byStamp = list.find((entry) => cleanId(entry?.date) === targetDate
    && targetHolidayId
    && cleanId(entry?.statHolidayId) === targetHolidayId);
  if (byStamp) return byStamp;
  return list.find((entry) => cleanId(entry?.date) === targetDate) || null;
}

function buildAssigneeRoleFields(role) {
  const normalized = timesheetPayrollContextService.normalizePayrollRole(role) || 'teacher';
  return { role: normalized, roles: [normalized] };
}

function buildStatHolidayWorkSessionAssignee({
  activity = {},
  personId = '',
  personName = '',
  personRole = '',
  hours = 0,
  holidayId = '',
  periodId = '',
  notes = ''
}) {
  const paid = activity.paid === true;
  const safeHours = Number(Number(hours || 0).toFixed(2));
  const roleFields = buildAssigneeRoleFields(personRole);
  const trace = {
    statHolidayId: cleanId(holidayId),
    statHolidayPeriodId: cleanId(periodId),
    statHolidayPersonId: cleanId(personId)
  };
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const base = {
    personId: cleanId(personId),
    personName: String(personName || personId || '').trim(),
    paid,
    paidHours: paid ? safeHours : 0,
    notes: String(notes || '').trim(),
    ...roleFields,
    ...trace
  };
  if (evaluationType === 'completion') {
    const nowIso = new Date().toISOString();
    return {
      ...base,
      status: 'attended',
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

function upsertStatHolidayAssigneeOnEntry(entry = {}, assignee = {}) {
  const targetPersonId = cleanId(assignee?.personId);
  const targetPeriodId = cleanId(assignee?.statHolidayPeriodId);
  const targetHolidayId = cleanId(assignee?.statHolidayId);
  const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
  const nextAssignees = assignees.filter((row) => {
    if (!idsEqual(row?.personId, targetPersonId)) return true;
    if (targetPeriodId && cleanId(row?.statHolidayPeriodId) && !idsEqual(row.statHolidayPeriodId, targetPeriodId)) {
      return true;
    }
    if (targetHolidayId && cleanId(row?.statHolidayId) && !idsEqual(row.statHolidayId, targetHolidayId)) {
      return true;
    }
    return false;
  });
  nextAssignees.push(assignee);
  return {
    ...entry,
    statHolidayId: cleanId(entry?.statHolidayId || assignee?.statHolidayId),
    assignees: nextAssignees
  };
}

function removeStatHolidayTargetFromEntries(entries = [], options = {}) {
  const targetPersonId = cleanId(options.personId);
  const targetPeriodId = cleanId(options.periodId);
  let removedEntries = 0;
  let removedAssignees = 0;
  const nextEntries = [];

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const date = cleanId(entry?.date);
    const inPeriod = entryDateInPeriod(date, options.periodStartDate, options.periodEndDate);

    if (inPeriod && cleanId(entry?.statHolidayPersonId) && entryHasStatHolidayStamp(entry, targetPersonId, targetPeriodId)) {
      removedEntries += 1;
      return;
    }

    if (!inPeriod) {
      nextEntries.push(entry);
      return;
    }

    const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
    const nextAssignees = assignees.filter((assignee) => {
      const matches = idsEqual(assignee?.statHolidayPersonId, targetPersonId)
        && Boolean(cleanId(assignee?.statHolidayId))
        && (!targetPeriodId || !cleanId(assignee?.statHolidayPeriodId) || idsEqual(assignee.statHolidayPeriodId, targetPeriodId));
      if (matches) removedAssignees += 1;
      return !matches;
    });
    nextEntries.push({ ...entry, assignees: nextAssignees });
  });

  return { entries: nextEntries, removedEntries, removedAssignees };
}

function assignEntryIds(activityId, existingEntries = [], drafts = []) {
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

function shouldPersistStatHolidayToSharedActivity(period = {}, persistToActivity = false) {
  if (persistToActivity !== true) return false;
  const periodStartDate = cleanId(period?.startDate);
  if (!periodStartDate) return true;
  const today = new Date().toISOString().slice(0, 10);
  return periodStartDate <= today;
}

async function cleanupStatHolidayWorkSessionsOnImportDelete({
  orgId,
  personId,
  period = {},
  policy,
  reqUser
} = {}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(period?.id);
  const usesActivityMode = statutoryHolidayEligibilityService.usesStatHolidayActivityMode(policy);
  if (!usesActivityMode) {
    return { removedEntries: 0, removedAssignees: 0, skipped: true, reason: 'activity_mode_disabled' };
  }

  const activityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(policy);
  if (!activityId || !targetPersonId || !targetPeriodId) {
    return { removedEntries: 0, removedAssignees: 0, skipped: true, reason: 'missing_target' };
  }

  try {
    const outcome = await removeStatHolidayWorkSessionsForTarget({
      activityId,
      personId: targetPersonId,
      periodId: targetPeriodId,
      periodStartDate: period?.startDate,
      periodEndDate: period?.endDate,
      reqUser
    });
    return { ...outcome, activityId };
  } catch (error) {
    console.warn(`Stat holiday assignee cleanup failed for period ${targetPeriodId}: ${error.message}`);
    return { removedEntries: 0, removedAssignees: 0, error: error.message };
  }
}

async function removeStatHolidayWorkSessionsForTarget({
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
  if (!activity) throw new Error('Statutory holiday activity was not found.');

  const existingEntries = activityService.getActivityEntries(activity);
  const cleanup = removeStatHolidayTargetFromEntries(existingEntries, {
    personId: targetPersonId,
    periodId,
    periodStartDate,
    periodEndDate
  });
  if (!cleanup.removedEntries && !cleanup.removedAssignees) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    activity,
    cleanup.entries,
    reqUser
  );
  return {
    removedEntries: cleanup.removedEntries,
    removedAssignees: cleanup.removedAssignees
  };
}

async function syncStatHolidayWorkSessionsForPersonPeriod({
  orgId,
  personId,
  personName = '',
  personRole = '',
  period = {},
  activity,
  payItems = [],
  reqUser
}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(period?.id);
  const periodStartDate = cleanId(period?.startDate);
  const periodEndDate = cleanId(period?.endDate);
  if (!targetPersonId || !targetPeriodId || !activity || !cleanId(activity.id)) {
    throw new Error('Person, period, and statutory holiday activity are required.');
  }
  if (!idsEqual(activity.orgId, orgId)) {
    throw new Error('Statutory holiday activity is not in the active organization.');
  }
  if (!activityService.isPersonEligibleForActivity(activity, targetPersonId)) {
    throw new Error('The person is not eligible for the configured statutory holiday activity.');
  }

  const refreshedActivity = await activityService.getActivity(activity.id, reqUser);
  let workingEntries = activityService.getActivityEntries(refreshedActivity);
  const cleanup = removeStatHolidayTargetFromEntries(workingEntries, {
    personId: targetPersonId,
    periodId: targetPeriodId,
    periodStartDate,
    periodEndDate
  });
  workingEntries = cleanup.entries;

  const newDayDrafts = [];
  let updatedAssigneeCount = 0;

  (Array.isArray(payItems) ? payItems : []).forEach((item) => {
    const hours = Number(Number(item?.hours || 0).toFixed(2));
    if (!hours || hours <= 0) return;

    const evaluation = item?.evaluation || {};
    const holidayId = cleanId(evaluation?.holidayId);
    const date = cleanId(evaluation?.date);
    if (!holidayId || !date) return;

    const assignee = buildStatHolidayWorkSessionAssignee({
      activity,
      personId: targetPersonId,
      personName,
      personRole,
      hours,
      holidayId,
      periodId: targetPeriodId,
      notes: 'Statutory holiday pay'
    });

    let dayEntry = findStatHolidayDayEntry(workingEntries, { holidayId, date });
    if (dayEntry) {
      const index = workingEntries.findIndex((entry) => entry === dayEntry);
      workingEntries[index] = upsertStatHolidayAssigneeOnEntry({
        ...dayEntry,
        statHolidayId: cleanId(dayEntry.statHolidayId || holidayId)
      }, assignee);
      updatedAssigneeCount += 1;
      return;
    }

    const pendingDraft = newDayDrafts.find((entry) => cleanId(entry?.date) === date
      && cleanId(entry?.statHolidayId) === holidayId);
    if (pendingDraft) {
      const index = newDayDrafts.indexOf(pendingDraft);
      newDayDrafts[index] = upsertStatHolidayAssigneeOnEntry(pendingDraft, assignee);
      updatedAssigneeCount += 1;
      return;
    }

    const draft = statutoryHolidayDayMappingService.buildStatHolidayDayEntryDraft({
      id: holidayId,
      date,
      title: evaluation?.title
    });
    if (!draft) return;
    newDayDrafts.push(upsertStatHolidayAssigneeOnEntry(draft, assignee));
    updatedAssigneeCount += 1;
  });

  const shouldPersist = cleanup.removedEntries > 0
    || cleanup.removedAssignees > 0
    || newDayDrafts.length > 0
    || updatedAssigneeCount > 0;
  if (!shouldPersist) {
    return { activityId: cleanId(activity.id), createdEntryIds: [], rowCount: 0 };
  }

  const entriesWithIds = assignEntryIds(activity.id, workingEntries, newDayDrafts);
  const combinedEntries = [...workingEntries, ...entriesWithIds];
  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    refreshedActivity,
    combinedEntries,
    reqUser
  );

  return {
    activityId: cleanId(activity.id),
    createdEntryIds: entriesWithIds.map((row) => cleanId(row.entryId)).filter(Boolean),
    rowCount: updatedAssigneeCount
  };
}

async function materializeStatHolidayForPersonPeriod({
  orgId,
  personId,
  personName = '',
  personRole = '',
  period = {},
  policy,
  holidays = [],
  periodEntries = [],
  supplementalEntries = [],
  supplementalEntryFilter = null,
  existingEntries = [],
  reqUser,
  allowManagerOverride = false,
  overrideMap = null,
  persistToActivity = true
} = {}) {
  const context = await statutoryHolidayEligibilityService.buildStatutoryHolidayTimesheetContext({
    orgId,
    personId,
    periodStartDate: period?.startDate,
    periodEndDate: period?.endDate,
    policy,
    holidays,
    periodEntries,
    supplementalEntries,
    supplementalEntryFilter,
    existingEntries,
    reqUser,
    allowManagerOverride,
    overrideMap
  });

  if (!context.usesActivityMode || !cleanId(context.activityId)) {
    return { ...context, syncOutcome: null };
  }
  const canPersistToActivity = shouldPersistStatHolidayToSharedActivity(period, persistToActivity);
  if (!canPersistToActivity) {
    return { ...context, syncOutcome: null };
  }

  const activity = await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
    orgId,
    reqUser,
    activityId: context.activityId
  });
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup(
    existingEntries,
    overrideMap
  );
  const payItems = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: context.evaluations,
    existingByHolidayId,
    allowManagerOverride
  });
  const syncOutcome = await syncStatHolidayWorkSessionsForPersonPeriod({
    orgId,
    personId,
    personName,
    personRole,
    period,
    activity,
    payItems,
    reqUser
  });
  return { ...context, syncOutcome };
}

function normalizeStatHolidayOverrideMap(overrides = []) {
  const map = {};
  (Array.isArray(overrides) ? overrides : []).forEach((row) => {
    const holidayId = cleanId(row?.holidayId);
    if (!holidayId) return;
    map[holidayId] = {
      forcePay: row?.forcePay !== false,
      hours: Number.isFinite(Number(row?.hours)) && Number(row.hours) > 0
        ? Number(Number(row.hours).toFixed(2))
        : undefined,
      reason: String(row?.reason || 'Manager adjusted statutory holiday hours').trim()
    };
  });
  return map;
}

module.exports = {
  entryHasStatHolidayStamp,
  isStatHolidayWorkSessionEntryForTarget,
  findStatHolidayDayEntry,
  removeStatHolidayTargetFromEntries,
  shouldPersistStatHolidayToSharedActivity,
  cleanupStatHolidayWorkSessionsOnImportDelete,
  removeStatHolidayWorkSessionsForTarget,
  syncStatHolidayWorkSessionsForPersonPeriod,
  materializeStatHolidayForPersonPeriod,
  normalizeStatHolidayOverrideMap
};
