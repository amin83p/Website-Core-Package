'use strict';

const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');

const STAT_HOLIDAY_DAY_START = '08:00';
const STAT_HOLIDAY_DAY_END = '20:00';
const STAT_HOLIDAY_DAY_DURATION_HOURS = 12;

function cleanId(value) {
  return String(value ?? '').trim();
}

function normalizeYear(value) {
  const year = String(value ?? '').trim();
  if (!/^\d{4}$/.test(year)) return '';
  return year;
}

function buildExistingEntryDates(entries = []) {
  const dates = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const date = cleanId(entry?.date);
    if (date) dates.add(date);
  });
  return dates;
}

function buildStatHolidayDayEntryDraft(holiday = {}) {
  const holidayId = cleanId(holiday?.id || holiday?.holidayId);
  const date = statutoryHolidayEligibilityService.resolveHolidayDate(holiday);
  const title = statutoryHolidayEligibilityService.resolveHolidayTitle(holiday);
  if (!holidayId || !date) return null;
  return {
    title,
    date,
    startTime: STAT_HOLIDAY_DAY_START,
    endTime: STAT_HOLIDAY_DAY_END,
    durationHours: STAT_HOLIDAY_DAY_DURATION_HOURS,
    status: 'posted',
    notes: 'Statutory holiday',
    statHolidayId: holidayId,
    assignees: [],
    excludedPersonIds: []
  };
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

async function listPayableHolidaysForYear({
  orgId,
  year,
  policy,
  reqUser
} = {}) {
  const targetYear = normalizeYear(year);
  if (!targetYear) return [];

  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  const payableTypes = resolvedPolicy?.statutoryHolidayPay?.payableHolidayTypes
    || timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes;

  const holidays = await schoolDataService.fetchAllData('holidays', {}, reqUser);
  return (Array.isArray(holidays) ? holidays : [])
    .filter((holiday) => {
      const date = statutoryHolidayEligibilityService.resolveHolidayDate(holiday);
      return date.startsWith(`${targetYear}-`)
        && statutoryHolidayEligibilityService.isPayableHoliday(holiday, payableTypes);
    })
    .sort((a, b) => statutoryHolidayEligibilityService.resolveHolidayDate(a)
      .localeCompare(statutoryHolidayEligibilityService.resolveHolidayDate(b)));
}

async function previewHolidayDayMapping({
  orgId,
  year,
  activityId,
  policy,
  reqUser
} = {}) {
  const targetYear = normalizeYear(year);
  const targetActivityId = cleanId(activityId);
  if (!targetYear) throw new Error('A valid year is required.');
  if (!targetActivityId) throw new Error('A public statutory holiday activity is required.');

  const activity = await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
    orgId,
    reqUser,
    activityId: targetActivityId
  });
  const payableHolidays = await listPayableHolidaysForYear({ orgId, year: targetYear, policy, reqUser });
  const existingDates = buildExistingEntryDates(activityService.getActivityEntries(activity));

  const rows = payableHolidays.map((holiday) => {
    const holidayId = cleanId(holiday?.id);
    const date = statutoryHolidayEligibilityService.resolveHolidayDate(holiday);
    const title = statutoryHolidayEligibilityService.resolveHolidayTitle(holiday);
    if (existingDates.has(date)) {
      return {
        holidayId,
        date,
        title,
        action: 'skip',
        reason: 'Activity already has a work session on this date.'
      };
    }
    return {
      holidayId,
      date,
      title,
      action: 'create',
      reason: 'Will create an 08:00–20:00 work session.'
    };
  });

  return {
    year: targetYear,
    activityId: targetActivityId,
    activityTitle: String(activity?.title || targetActivityId).trim(),
    rows,
    createCount: rows.filter((row) => row.action === 'create').length,
    skipCount: rows.filter((row) => row.action === 'skip').length
  };
}

async function mapHolidayDaysToActivity({
  orgId,
  year,
  activityId,
  policy,
  reqUser,
  persistActivityId = true
} = {}) {
  const preview = await previewHolidayDayMapping({ orgId, year, activityId, policy, reqUser });
  const activity = await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
    orgId,
    reqUser,
    activityId: preview.activityId
  });
  const existingEntries = activityService.getActivityEntries(activity);
  const drafts = preview.rows
    .filter((row) => row.action === 'create')
    .map((row) => buildStatHolidayDayEntryDraft({
      id: row.holidayId,
      date: row.date,
      title: row.title
    }))
    .filter(Boolean);

  let createdEntryIds = [];
  if (drafts.length) {
    const entriesWithIds = assignEntryIds(activity.id, existingEntries, drafts);
    const combinedEntries = [...existingEntries, ...entriesWithIds];
    await timesheetImportWorkSessionBuilderService.persistImportActivityEntryUpdates(
      activity,
      combinedEntries,
      reqUser
    );
    createdEntryIds = entriesWithIds.map((row) => cleanId(row.entryId)).filter(Boolean);
  }

  if (persistActivityId) {
    const currentPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
    const currentActivityId = cleanId(currentPolicy?.statutoryHolidayPay?.activityId);
    if (!currentActivityId) {
      await timesheetParametersPolicyModel.savePolicyForOrg(
        orgId,
        {
          ...currentPolicy,
          statutoryHolidayPay: {
            ...(currentPolicy.statutoryHolidayPay || {}),
            activityId: preview.activityId
          }
        },
        reqUser?.id
      );
    }
  }

  return {
    year: preview.year,
    activityId: preview.activityId,
    createdCount: createdEntryIds.length,
    skippedCount: preview.skipCount,
    createdEntryIds,
    skippedDates: preview.rows.filter((row) => row.action === 'skip').map((row) => row.date)
  };
}

module.exports = {
  STAT_HOLIDAY_DAY_START,
  STAT_HOLIDAY_DAY_END,
  STAT_HOLIDAY_DAY_DURATION_HOURS,
  buildStatHolidayDayEntryDraft,
  listPayableHolidaysForYear,
  previewHolidayDayMapping,
  mapHolidayDaysToActivity
};
