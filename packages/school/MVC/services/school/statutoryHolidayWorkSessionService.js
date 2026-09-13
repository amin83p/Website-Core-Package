'use strict';

const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const statutoryHolidaySchemeService = require('./statutoryHolidaySchemeService');
const statutoryHolidayDayMappingService = require('./statutoryHolidayDayMappingService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const activityAssigneeTimingService = require('./activityAssigneeTimingService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const {
  STAT_HOLIDAY_DAY_START,
  STAT_HOLIDAY_DAY_END,
  STAT_HOLIDAY_DAY_DURATION_HOURS
} = statutoryHolidayDayMappingService;

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

function assigneeMatchesStatHolidayPerson(assignee = {}, personId = '') {
  const targetPersonId = cleanId(personId);
  if (!targetPersonId) return false;
  return idsEqual(assignee?.statHolidayPersonId, targetPersonId)
    || idsEqual(assignee?.personId, targetPersonId);
}

function assigneeMatchesStatHolidayRemovalTarget(assignee = {}, {
  personId = '',
  periodId = '',
  entryDate = '',
  periodStartDate = '',
  periodEndDate = ''
} = {}) {
  if (!assigneeHasStatHolidayStamp(assignee)) return false;
  if (!assigneeMatchesStatHolidayPerson(assignee, personId)) return false;

  const targetPeriodId = cleanId(periodId);
  const assigneePeriodId = cleanId(assignee?.statHolidayPeriodId);
  if (targetPeriodId && assigneePeriodId && !idsEqual(assigneePeriodId, targetPeriodId)) {
    return entryDateInPeriod(entryDate, periodStartDate, periodEndDate);
  }
  return true;
}

function entryHasStatHolidayStamp(entry = {}, personId = '', periodId = '') {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  const entryDate = cleanId(entry?.date);
  if (cleanId(entry?.statHolidayPersonId) && idsEqual(entry.statHolidayPersonId, targetPersonId)) {
    if (targetPeriodId && cleanId(entry?.statHolidayPeriodId) && !idsEqual(entry.statHolidayPeriodId, targetPeriodId)) {
      return false;
    }
    return Boolean(cleanId(entry?.statHolidayId));
  }
  return activityService.normalizeActivityAssigneeRows(entry.assignees).some((assignee) => (
    assigneeMatchesStatHolidayRemovalTarget(assignee, {
      personId: targetPersonId,
      periodId: targetPeriodId,
      entryDate
    })
  ));
}

function countStatHolidayAssigneesForPersonPeriod({
  entries = [],
  personId = '',
  periodStartDate = '',
  periodEndDate = ''
} = {}) {
  const targetPersonId = cleanId(personId);
  if (!targetPersonId) return 0;
  let count = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const date = cleanId(entry?.date);
    if (!entryDateInPeriod(date, periodStartDate, periodEndDate)) return;
    activityService.normalizeActivityAssigneeRows(entry.assignees).forEach((assignee) => {
      if (!assigneeHasStatHolidayStamp(assignee)) return;
      if (!assigneeMatchesStatHolidayPerson(assignee, targetPersonId)) return;
      count += 1;
    });
  });
  return count;
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
  const sameDateEntries = list.filter((entry) => cleanId(entry?.date) === targetDate);
  if (!sameDateEntries.length) return null;

  if (targetHolidayId) {
    const byStamp = sameDateEntries.find((entry) => cleanId(entry?.statHolidayId) === targetHolidayId);
    if (byStamp) return byStamp;
  }

  // Legacy/mapped shells may exist by date only (settings mapping skips create when date is taken).
  const unstampedEntries = sameDateEntries.filter((entry) => !cleanId(entry?.statHolidayId));
  if (unstampedEntries.length === 1 && sameDateEntries.length === 1) {
    return unstampedEntries[0];
  }

  return null;
}

function collectMissingStatHolidayDayEntries(activityEntries = [], payItems = []) {
  const missing = [];
  const seen = new Set();
  (Array.isArray(payItems) ? payItems : []).forEach((item) => {
    const evaluation = item?.evaluation || {};
    const holidayId = cleanId(evaluation?.holidayId);
    const date = cleanId(evaluation?.date);
    if (!holidayId || !date) return;
    const key = `${holidayId}|${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!findStatHolidayDayEntry(activityEntries, { holidayId, date })) {
      missing.push({
        holidayId,
        date,
        title: String(evaluation?.title || '').trim() || holidayId
      });
    }
  });
  return missing;
}

function buildStatHolidayBlockingErrors(missingDayEntries = [], activityLabel = '') {
  const activitySuffix = String(activityLabel || '').trim()
    ? ` on statutory holiday activity "${String(activityLabel).trim()}"`
    : '';
  return (Array.isArray(missingDayEntries) ? missingDayEntries : []).map((row) => {
    const title = String(row?.title || row?.holidayId || 'Statutory holiday').trim();
    const date = cleanId(row?.date);
    return `Missing pre-mapped statutory holiday work session for ${title}${date ? ` (${date})` : ''}${activitySuffix}. Map holiday day work sessions in Settings before submitting.`;
  });
}

function groupPayItemsByScheme(payItems = []) {
  const grouped = new Map();
  (Array.isArray(payItems) ? payItems : []).forEach((item) => {
    const schemeId = cleanId(item?.schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
    if (!grouped.has(schemeId)) grouped.set(schemeId, []);
    grouped.get(schemeId).push(item);
  });
  return grouped;
}

async function resolveStatHolidayMissingDayEntries({
  policy,
  evaluations = [],
  rows = [],
  existingEntries = [],
  overrideMap = null,
  allowManagerOverride = false,
  personId = '',
  orgId,
  reqUser,
  activeSchemes = []
} = {}) {
  const evaluationRows = Array.isArray(evaluations) ? evaluations : [];
  if (!evaluationRows.length) {
    return {
      activityId: '',
      activityTitle: '',
      activity: null,
      missingDayEntries: [],
      blockingErrors: [],
      schemeOutcomes: []
    };
  }

  const activeSchemeSet = new Set(
    (Array.isArray(activeSchemes) ? activeSchemes : []).map((schemeId) => cleanId(schemeId)).filter(Boolean)
  );
  const schemesInUse = statutoryHolidaySchemeService.resolveSchemesWithAssignedDepartments(policy)
    .filter(({ schemeId }) => !activeSchemeSet.size || activeSchemeSet.has(cleanId(schemeId)));
  const schemeOutcomes = [];
  const missingDayEntries = [];
  const blockingErrors = [];
  let primaryActivity = null;
  let primaryActivityId = '';

  for (const { schemeId, config } of schemesInUse) {
    const schemeConfig = statutoryHolidaySchemeService.resolveSchemeConfig(schemeId, policy) || config || {};
    const schemeName = String(schemeConfig?.name || schemeId).trim();
    const activityId = cleanId(schemeConfig?.activityId);
    if (!activityId) {
      const error = `Statutory holiday scheme "${schemeName}" has no public activity configured. Assign an activity in School Settings before importing.`;
      schemeOutcomes.push({
        schemeId,
        schemeName,
        activityId: '',
        activityTitle: '',
        activity: null,
        missingDayEntries: [],
        configurationError: error
      });
      blockingErrors.push(error);
      continue;
    }
    try {
      const activity = await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
        orgId,
        reqUser,
        activityId
      });
      const activityTitle = String(activity?.title || '').trim();
      const schemePayItems = evaluationRows
        .filter((evaluation) => cleanId(evaluation?.schemeId) === cleanId(schemeId))
        .map((evaluation) => ({
          evaluation,
          schemeId
        }));
      const schemeMissing = collectMissingStatHolidayDayEntries(
        activityService.getActivityEntries(activity),
        schemePayItems
      ).map((row) => ({
        ...row,
        schemeId,
        schemeName
      }));
      schemeOutcomes.push({
        schemeId,
        schemeName,
        activityId: cleanId(activity.id),
        activityTitle,
        activity,
        missingDayEntries: schemeMissing
      });
      if (!primaryActivity) {
        primaryActivity = activity;
        primaryActivityId = cleanId(activity.id);
      }
      if (schemeMissing.length) {
        missingDayEntries.push(...schemeMissing);
      }
    } catch (error) {
      blockingErrors.push(String(error?.message || 'Unable to resolve statutory holiday activity.'));
    }
  }

  return {
    activityId: primaryActivityId,
    activityTitle: String(primaryActivity?.title || '').trim(),
    activity: primaryActivity,
    missingDayEntries,
    blockingErrors,
    schemeOutcomes
  };
}

function normalizeStatHolidayDayEntryShape(entry = {}, holidayId = '') {
  return {
    ...entry,
    statHolidayId: cleanId(entry?.statHolidayId || holidayId),
    startTime: entry.startTime || STAT_HOLIDAY_DAY_START,
    endTime: entry.endTime || STAT_HOLIDAY_DAY_END,
    durationHours: STAT_HOLIDAY_DAY_DURATION_HOURS
  };
}

function assignStatHolidayDayEntryIds(activityId, existingEntries = [], drafts = []) {
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

async function ensureStatHolidayDayEntriesForPayItems({
  activity,
  payItems = [],
  reqUser
} = {}) {
  const activityId = cleanId(activity?.id);
  if (!activityId) {
    return { activity, createdEntryIds: [], changed: false };
  }

  let workingEntries = [...activityService.getActivityEntries(activity)];
  const drafts = [];
  const stampByEntryId = new Map();
  const seen = new Set();

  (Array.isArray(payItems) ? payItems : []).forEach((item) => {
    const evaluation = item?.evaluation || {};
    const holidayId = cleanId(evaluation?.holidayId);
    const date = cleanId(evaluation?.date);
    const title = String(evaluation?.title || evaluation?.holidayId || 'Statutory holiday').trim();
    if (!holidayId || !date) return;
    const key = `${holidayId}|${date}`;
    if (seen.has(key)) return;
    seen.add(key);

    const existing = findStatHolidayDayEntry(workingEntries, { holidayId, date });
    if (existing) {
      const entryId = cleanId(existing?.entryId);
      if (entryId && cleanId(existing.statHolidayId) !== holidayId) {
        stampByEntryId.set(entryId, {
          ...existing,
          statHolidayId: holidayId,
          notes: String(existing.notes || 'Statutory holiday').trim() || 'Statutory holiday'
        });
      }
      return;
    }

    const draft = statutoryHolidayDayMappingService.buildStatHolidayDayEntryDraft({
      id: holidayId,
      date,
      title
    });
    if (draft) drafts.push(draft);
  });

  const hasEntryChanges = drafts.length > 0 || stampByEntryId.size > 0;
  if (!hasEntryChanges) {
    return { activity, createdEntryIds: [], changed: false };
  }

  const entriesWithIds = assignStatHolidayDayEntryIds(activityId, workingEntries, drafts);
  const combinedEntries = [...workingEntries, ...entriesWithIds].map((entry) => {
    const entryId = cleanId(entry?.entryId);
    return entryId && stampByEntryId.has(entryId) ? stampByEntryId.get(entryId) : entry;
  });

  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    activity,
    combinedEntries,
    reqUser,
    { preserveActivityAttendees: true }
  );

  const refreshedActivity = await activityService.getActivity(activityId, reqUser);
  return {
    activity: refreshedActivity || activity,
    createdEntryIds: entriesWithIds.map((row) => cleanId(row.entryId)).filter(Boolean),
    changed: true
  };
}

function assigneeMatchesStatHolidayTarget(assignee = {}, {
  personId = '',
  periodId = '',
  holidayId = '',
  schemeId = ''
} = {}) {
  if (!assigneeHasStatHolidayStamp(assignee)) return false;
  if (!idsEqual(assignee?.personId, personId)) return false;
  if (periodId && cleanId(assignee?.statHolidayPeriodId) && !idsEqual(assignee.statHolidayPeriodId, periodId)) {
    return false;
  }
  if (holidayId && cleanId(assignee?.statHolidayId) && !idsEqual(assignee.statHolidayId, holidayId)) {
    return false;
  }
  if (schemeId && cleanId(assignee?.statHolidaySchemeId)
    && cleanId(assignee.statHolidaySchemeId) !== cleanId(schemeId)) {
    return false;
  }
  return true;
}

function buildAssigneeRoleFields(role) {
  const normalized = timesheetPayrollContextService.normalizePayrollRole(role) || 'teacher';
  return { role: normalized, roles: [normalized] };
}

function buildStatHolidayWorkSessionAssignee({
  activity = {},
  entry = {},
  personId = '',
  personName = '',
  personRole = '',
  hours = 0,
  holidayId = '',
  schemeId = '',
  periodId = '',
  notes = ''
}) {
  const paid = activity.paid === true;
  const safeHours = Number(Number(hours || 0).toFixed(2));
  const roleFields = buildAssigneeRoleFields(personRole);
  const trace = {
    statHolidayId: cleanId(holidayId),
    statHolidaySchemeId: cleanId(schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM,
    statHolidayPeriodId: cleanId(periodId),
    statHolidayPersonId: cleanId(personId)
  };
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const base = {
    personId: cleanId(personId),
    personName: String(personName || personId || '').trim(),
    paid,
    paidHours: safeHours,
    notes: String(notes || '').trim(),
    ...roleFields,
    ...trace
  };
  const timedBase = activityAssigneeTimingService.applyAssigneeTiming(base, entry, {
    startTime: entry?.startTime || STAT_HOLIDAY_DAY_START,
    paidHours: safeHours
  });
  if (evaluationType === 'completion') {
    const nowIso = new Date().toISOString();
    return {
      ...timedBase,
      status: 'attended',
      completionStatus: 'completed',
      completedAt: nowIso,
      completedBy: cleanId(personId)
    };
  }
  return {
    ...timedBase,
    status: 'attended',
    completionStatus: 'pending'
  };
}

function upsertStatHolidayAssigneeOnEntry(entry = {}, assignee = {}) {
  const targetPersonId = cleanId(assignee?.personId);
  const targetPeriodId = cleanId(assignee?.statHolidayPeriodId);
  const targetHolidayId = cleanId(assignee?.statHolidayId);
  const targetSchemeId = cleanId(assignee?.statHolidaySchemeId);
  const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
  const nextAssignees = assignees.filter((row) => !assigneeMatchesStatHolidayTarget(row, {
    personId: targetPersonId,
    periodId: targetPeriodId,
    holidayId: targetHolidayId,
    schemeId: targetSchemeId
  }));
  nextAssignees.push(assignee);
  return {
    ...entry,
    statHolidayId: cleanId(entry?.statHolidayId || assignee?.statHolidayId),
    assignees: nextAssignees
  };
}

function assigneeHasStatHolidayStamp(assignee = {}) {
  return Boolean(cleanId(assignee?.statHolidayId) || cleanId(assignee?.statHolidayPersonId));
}

function stripStatHolidayAssigneesFromEntries(entries = [], {
  personId = '',
  stripAllActivityAssignees = false
} = {}) {
  const targetPersonId = cleanId(personId);
  let removedAssignees = 0;
  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
    const entryHasStamp = Boolean(cleanId(entry?.statHolidayId) || cleanId(entry?.statHolidayPersonId));
    const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
    const nextAssignees = assignees.filter((assignee) => {
      const hasStatStamp = assigneeHasStatHolidayStamp(assignee) || entryHasStamp;
      const shouldConsider = stripAllActivityAssignees || hasStatStamp;
      if (!shouldConsider) return true;
      if (targetPersonId) {
        const matchesPerson = idsEqual(assignee?.statHolidayPersonId, targetPersonId)
          || idsEqual(assignee?.personId, targetPersonId);
        if (!matchesPerson) return true;
      }
      removedAssignees += 1;
      return false;
    });
    const nextEntry = { ...entry, assignees: nextAssignees };
    if (targetPersonId && idsEqual(entry?.statHolidayPersonId, targetPersonId)) {
      const { statHolidayPersonId, ...rest } = nextEntry;
      return rest;
    }
    return nextEntry;
  });
  return { entries: nextEntries, removedEntries: 0, removedAssignees };
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
      const matches = assigneeMatchesStatHolidayRemovalTarget(assignee, {
        personId: targetPersonId,
        periodId: targetPeriodId,
        entryDate: date,
        periodStartDate: options.periodStartDate,
        periodEndDate: options.periodEndDate
      });
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

  const activityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(policy);
  if (!activityIds.length || !targetPersonId || !targetPeriodId) {
    return { removedEntries: 0, removedAssignees: 0, skipped: true, reason: 'missing_target' };
  }

  let removedEntries = 0;
  let removedAssignees = 0;
  const cleanedActivityIds = [];
  const errors = [];

  for (const activityId of activityIds) {
    try {
      const outcome = await removeStatHolidayWorkSessionsForTarget({
        activityId,
        personId: targetPersonId,
        periodId: targetPeriodId,
        periodStartDate: period?.startDate,
        periodEndDate: period?.endDate,
        reqUser
      });
      removedEntries += Number(outcome.removedEntries || 0);
      removedAssignees += Number(outcome.removedAssignees || 0);
      if (outcome.removedEntries || outcome.removedAssignees) {
        cleanedActivityIds.push(activityId);
      }
    } catch (error) {
      errors.push({ activityId, message: String(error?.message || error) });
      console.warn(`Stat holiday assignee cleanup failed for activity ${activityId}: ${error.message}`);
    }
  }

  if (errors.length && !removedEntries && !removedAssignees) {
    return { removedEntries: 0, removedAssignees: 0, error: errors.map((row) => row.message).join('; ') };
  }

  return {
    removedEntries,
    removedAssignees,
    activityIds: cleanedActivityIds,
    activityId: cleanedActivityIds[0] || activityIds[0] || ''
  };
}

async function countStatHolidayAssigneesForPersonPeriodRemote({
  orgId,
  personId,
  period = {},
  policy,
  reqUser
} = {}) {
  const usesActivityMode = statutoryHolidayEligibilityService.usesStatHolidayActivityMode(policy);
  if (!usesActivityMode) return 0;
  const activityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(policy);
  const targetPersonId = cleanId(personId);
  if (!activityId || !targetPersonId) return 0;
  const activity = await activityService.getActivity(activityId, reqUser);
  if (!activity || !idsEqual(activity.orgId, orgId)) return 0;
  return countStatHolidayAssigneesForPersonPeriod({
    entries: activityService.getActivityEntries(activity),
    personId: targetPersonId,
    periodStartDate: period?.startDate,
    periodEndDate: period?.endDate
  });
}

async function clearStatHolidayActivityLevelAttendees({
  activityId,
  reqUser
} = {}) {
  const targetActivityId = cleanId(activityId);
  if (!targetActivityId) return { cleared: false };

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) return { cleared: false };

  const attendees = activityService.normalizeActivityAssigneeRows(activity.attendees);
  const hasStatStamp = attendees.some((row) => assigneeHasStatHolidayStamp(row));
  if (!hasStatStamp) return { cleared: false };

  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    activity,
    activityService.getActivityEntries(activity),
    reqUser,
    { preserveActivityAttendees: true }
  );
  return { cleared: true };
}

async function cleanupStatHolidayActivityAssignees({
  orgId,
  activityId,
  personId = '',
  reqUser
} = {}) {
  const targetActivityId = cleanId(activityId);
  if (!targetActivityId) {
    return { removedEntries: 0, removedAssignees: 0, skipped: true, reason: 'missing_activity' };
  }

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) throw new Error('Statutory holiday activity was not found.');
  if (!idsEqual(activity.orgId, orgId)) {
    throw new Error('Statutory holiday activity is not in the active organization.');
  }

  const existingEntries = activityService.getActivityEntries(activity);
  const cleanup = stripStatHolidayAssigneesFromEntries(existingEntries, {
    personId,
    stripAllActivityAssignees: true
  });
  if (!cleanup.removedAssignees) {
    return {
      activityId: targetActivityId,
      removedEntries: 0,
      removedAssignees: 0,
      skipped: true,
      reason: 'no_assignees'
    };
  }

  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    activity,
    cleanup.entries,
    reqUser,
    { preserveActivityAttendees: true }
  );
  return {
    activityId: targetActivityId,
    removedEntries: cleanup.removedEntries,
    removedAssignees: cleanup.removedAssignees
  };
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
    reqUser,
    { preserveActivityAttendees: true }
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

  const missingDayEntries = collectMissingStatHolidayDayEntries(workingEntries, payItems);
  if (missingDayEntries.length) {
    return {
      activityId: cleanId(activity.id),
      createdEntryIds: [],
      rowCount: 0,
      blocked: true,
      missingDayEntries
    };
  }

  let updatedAssigneeCount = 0;

  (Array.isArray(payItems) ? payItems : []).forEach((item) => {
    const hours = Number(Number(item?.hours || 0).toFixed(2));
    const evaluation = item?.evaluation || {};
    const holidayId = cleanId(evaluation?.holidayId);
    const date = cleanId(evaluation?.date);
    if (!holidayId || !date) return;
    if (!entryDateInPeriod(date, periodStartDate, periodEndDate)) return;

    const dayEntry = findStatHolidayDayEntry(workingEntries, { holidayId, date });
    if (!dayEntry) return;

    const normalizedDayEntry = normalizeStatHolidayDayEntryShape(dayEntry, holidayId);
    const assignee = buildStatHolidayWorkSessionAssignee({
      activity,
      entry: normalizedDayEntry,
      personId: targetPersonId,
      personName,
      personRole,
      hours,
      holidayId,
      schemeId: cleanId(item?.schemeId),
      periodId: targetPeriodId,
      notes: hours > 0 ? 'Statutory holiday pay' : 'Statutory holiday pay (not qualified)'
    });

    const index = workingEntries.findIndex((entry) => entry === dayEntry);
    const nextEntry = upsertStatHolidayAssigneeOnEntry(
      normalizedDayEntry,
      assignee
    );
    workingEntries[index] = nextEntry;
    updatedAssigneeCount += 1;
  });

  const shouldPersist = cleanup.removedEntries > 0
    || cleanup.removedAssignees > 0
    || updatedAssigneeCount > 0;
  if (!shouldPersist) {
    return { activityId: cleanId(activity.id), createdEntryIds: [], rowCount: 0 };
  }

  const combinedEntries = [...workingEntries];
  await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
    refreshedActivity,
    combinedEntries,
    reqUser,
    { preserveActivityAttendees: true }
  );

  return {
    activityId: cleanId(activity.id),
    createdEntryIds: [],
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

  if (!context.usesActivityMode) {
    return { ...context, syncOutcome: null, syncOutcomes: [] };
  }

  const missingDayOutcome = await resolveStatHolidayMissingDayEntries({
    policy,
    evaluations: context.evaluations,
    rows: context.rows,
    existingEntries,
    overrideMap,
    allowManagerOverride,
    personId,
    orgId,
    reqUser,
    activeSchemes: context.activeSchemes
  });
  if (missingDayOutcome.blockingErrors.length) {
    return {
      ...context,
      syncOutcome: {
        blocked: true,
        missingDayEntries: missingDayOutcome.missingDayEntries,
        schemeOutcomes: missingDayOutcome.schemeOutcomes,
        activityId: missingDayOutcome.activityId,
        createdEntryIds: [],
        rowCount: 0
      },
      syncOutcomes: [],
      blockingErrors: missingDayOutcome.blockingErrors
    };
  }

  const canPersistToActivity = shouldPersistStatHolidayToSharedActivity(period, persistToActivity);
  if (!canPersistToActivity) {
    return {
      ...context,
      syncOutcome: {
        activityId: missingDayOutcome.activityId,
        missingDayEntries: missingDayOutcome.missingDayEntries,
        schemeOutcomes: missingDayOutcome.schemeOutcomes,
        blocked: false
      },
      syncOutcomes: missingDayOutcome.schemeOutcomes || [],
      blockingErrors: missingDayOutcome.blockingErrors
    };
  }

  const existingBySchemeHoliday = statutoryHolidayEligibilityService.buildOverrideLookup(
    existingEntries,
    overrideMap,
    { personId }
  );
  const payItems = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    rows: context.rows,
    evaluations: context.evaluations,
    existingBySchemeHoliday,
    allowManagerOverride,
    policy
  });
  const grouped = groupPayItemsByScheme(payItems);
  const syncOutcomes = [];
  for (const [schemeId, schemePayItems] of grouped.entries()) {
    const activityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(policy, schemeId);
    if (!cleanId(activityId) || !schemePayItems.length) continue;
    const schemeOutcome = missingDayOutcome.schemeOutcomes?.find((row) => row.schemeId === schemeId);
    const activity = schemeOutcome?.activity
      || await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
        orgId,
        reqUser,
        activityId
      });
    const ensureOutcome = await ensureStatHolidayDayEntriesForPayItems({
      activity,
      payItems: schemePayItems,
      reqUser
    });
    const syncOutcome = await syncStatHolidayWorkSessionsForPersonPeriod({
      orgId,
      personId,
      personName,
      personRole,
      period,
      activity: ensureOutcome.activity || activity,
      payItems: schemePayItems,
      reqUser
    });
    syncOutcomes.push({ schemeId, ...syncOutcome });
    if (syncOutcome?.blocked) {
      const blockingErrors = buildStatHolidayBlockingErrors(syncOutcome.missingDayEntries || []);
      return { ...context, syncOutcome, syncOutcomes, blockingErrors };
    }
  }
  const primarySync = syncOutcomes[0] || null;
  return { ...context, syncOutcome: primarySync, syncOutcomes, blockingErrors: [] };
}

function normalizeStatHolidayOverrideMap(overrides = []) {
  const map = {};
  (Array.isArray(overrides) ? overrides : []).forEach((row) => {
    const holidayId = cleanId(row?.holidayId);
    if (!holidayId) return;
    const schemeId = cleanId(row?.schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
    const key = statutoryHolidaySchemeService.buildStatHolidayOverrideKey(schemeId, holidayId);
    map[key] = {
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
  collectMissingStatHolidayDayEntries,
  buildStatHolidayBlockingErrors,
  resolveStatHolidayMissingDayEntries,
  ensureStatHolidayDayEntriesForPayItems,
  assigneeHasStatHolidayStamp,
  stripStatHolidayAssigneesFromEntries,
  removeStatHolidayTargetFromEntries,
  shouldPersistStatHolidayToSharedActivity,
  cleanupStatHolidayActivityAssignees,
  clearStatHolidayActivityLevelAttendees,
  cleanupStatHolidayWorkSessionsOnImportDelete,
  removeStatHolidayWorkSessionsForTarget,
  syncStatHolidayWorkSessionsForPersonPeriod,
  materializeStatHolidayForPersonPeriod,
  normalizeStatHolidayOverrideMap,
  countStatHolidayAssigneesForPersonPeriod,
  countStatHolidayAssigneesForPersonPeriodRemote,
  assigneeMatchesStatHolidayRemovalTarget
};
