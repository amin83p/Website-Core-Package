'use strict';

const dataService = require('./schoolDataService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const timesheetPayRateService = require('./timesheetPayRateService');
const timesheetEffectiveEntryService = require('./timesheetEffectiveEntryService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
}

const MAX_ASSEMBLY_ENTRY_HOURS = 24;

function resolveAssemblyEntryHours(entry = {}) {
  return Number(parseFloat(entry?.hours ?? entry?.timesheetHours ?? entry?.durationHours) || 0);
}

function findAssemblyEntriesExceedingHourLimit(entries = [], maxHours = MAX_ASSEMBLY_ENTRY_HOURS) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.isDeleted !== true)
    .map((entry) => {
      const hours = resolveAssemblyEntryHours(entry);
      const metaHours = Number(entry?.statHolidayMeta?.calculatedHours || 0);
      if (hours <= maxHours && metaHours <= maxHours) return null;
      return {
        sessionId: cleanId(entry?.sessionId),
        date: cleanId(entry?.date),
        className: cleanId(entry?.className),
        hours,
        metaHours,
        isStatutoryHoliday: entry?.isStatutoryHoliday === true
      };
    })
    .filter(Boolean);
}

function buildAssemblyHourLimitError(offenders = []) {
  const details = offenders.map((entry) => {
    const label = entry.className || entry.sessionId || 'entry';
    const suffix = entry.isStatutoryHoliday ? ', statutory holiday' : '';
    return `${entry.date || 'unknown date'} / ${label} (${entry.hours}h${suffix})`;
  }).join('; ');
  return new Error(`Timesheet assembly includes hour value(s) above ${MAX_ASSEMBLY_ENTRY_HOURS}: ${details}`);
}

function passesImportActivitySessionGuard(entry, guard = null) {
  if (!guard || !(guard.allowedSessionIds instanceof Set) || !guard.allowedSessionIds.size) return true;
  const sessionId = cleanId(entry?.sessionId);
  if (!sessionId) return true;
  if (guard.allowedSessionIds.has(sessionId)) return true;

  const importActivityId = cleanId(guard.activityId);
  const entryActivityId = cleanId(entry?.activityId);
  if (importActivityId && entryActivityId && idsEqual(entryActivityId, importActivityId)) return false;
  if (importActivityId) {
    const importPrefix = `act-${importActivityId}-`;
    if (sessionId.startsWith(importPrefix)) return false;
  }

  if (cleanId(entry?.legacyImportBatchId) || cleanId(entry?.legacyImportPersonId) || cleanId(entry?.legacyImportPeriodId)) {
    return false;
  }

  const personId = cleanId(guard.personId);
  const actSuffix = personId ? `-${personId}` : '';
  if (actSuffix && sessionId.startsWith('act-') && sessionId.endsWith(actSuffix)) {
    const className = cleanId(entry?.className).toLowerCase();
    if (className.includes('import')) return false;
  }

  return true;
}

function normalizePayrollRole(value) {
  return timesheetPayrollContextService.normalizePayrollRole(value);
}

function resolveTimesheetEntryHours(entry) {
  if (!entry || entry.isDeleted) return 0;
  const approvalStatus = String(entry?.approvalStatus || '').trim().toLowerCase();
  if (entry?.excludeFromTotals === true || ['pending_approval', 'rejected', 'unpaid'].includes(approvalStatus)) return 0;
  if (entry.isManual || entry.isPriorPeriodAdjustment) {
    return Number(parseFloat(entry.requestedHours ?? entry.durationHours ?? entry.hours) || 0);
  }
  const formulaHours = Number(entry.timesheetHours);
  if (Number.isFinite(formulaHours)) return Number(formulaHours.toFixed(2));
  return Number(parseFloat(entry.durationHours ?? entry.hours) || 0);
}

function calculateTimesheetTotal(entries = []) {
  const total = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    if (!entry || entry.isDeleted === true) return sum;
    return sum + resolveTimesheetEntryHours(entry);
  }, 0);
  return Number(total.toFixed(2));
}

function withPayrollStamp(entry, payrollContext, period, personRole = '') {
  if (!entry || entry.isDeleted === true) return entry;
  const hours = resolveTimesheetEntryHours(entry);
  const requestedRole = normalizePayrollRole(personRole) || normalizePayrollRole(entry?.personRole);
  const payrollFields = timesheetPayrollContextService.stampEntryPayrollFields({
    entry: requestedRole ? { ...entry, personRole: requestedRole } : entry,
    payrollContext,
    period,
    payRateService: timesheetPayRateService,
    hours
  });
  return { ...entry, ...payrollFields };
}

async function buildImportedTimesheetEntries({
  orgId,
  personId,
  period,
  reqUser,
  personRole = '',
  allowManagerOverride = true,
  supplementalEntryFilter = null,
  importActivitySessionGuard = null
}) {
  const activeOrgId = cleanId(orgId);
  const targetPersonId = cleanId(personId);
  if (!activeOrgId || !targetPersonId || !period?.id) {
    throw new Error('Organization, person, and period are required to assemble imported timesheet entries.');
  }

  const [timesheetParametersPolicy, effective, allHolidays, payrollContext] = await Promise.all([
    timesheetParametersPolicyModel.getPolicyForOrg(activeOrgId),
    timesheetEffectiveEntryService.buildEffectiveTimesheetEntries({
      period,
      personId: targetPersonId,
      activeOrgId,
      reqUser
    }),
    dataService.fetchAllData('holidays', {}, reqUser),
    timesheetPayrollContextService.resolvePayrollPersonContext({
      orgId: activeOrgId,
      personId: targetPersonId,
      reqUser
    })
  ]);

  const liveEntries = Array.isArray(effective?.liveEntries) ? effective.liveEntries : [];
  const filteredLiveEntries = timesheetParametersPolicyService.applyEmptyEnrollmentSessionsPolicy(
    liveEntries,
    timesheetParametersPolicy
  ).filter((entry) => passesImportActivitySessionGuard(entry, importActivitySessionGuard));

  const autoEntries = (Array.isArray(effective?.entries) ? effective.entries : [])
    .filter((entry) => entry?.isDeleted !== true)
    .filter((entry) => entry?.isManual !== true)
    .filter((entry) => !timesheetLegacyImportService.isLegacyImportEntry(entry))
    .filter((entry) => passesImportActivitySessionGuard(entry, importActivitySessionGuard));

  const statHolidayContext = await statutoryHolidayEligibilityService.buildStatutoryHolidayTimesheetContext({
    orgId: activeOrgId,
    personId: targetPersonId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    policy: timesheetParametersPolicy,
    holidays: allHolidays,
    supplementalEntries: filteredLiveEntries,
    supplementalEntryFilter,
    existingEntries: [],
    reqUser,
    allowManagerOverride
  });

  const autoSessionIds = new Set(
    autoEntries.map((entry) => cleanId(entry?.sessionId)).filter(Boolean)
  );
  const statHolidayRows = (Array.isArray(statHolidayContext?.rows) ? statHolidayContext.rows : [])
    .filter((row) => !autoSessionIds.has(cleanId(row?.sessionId)));

  const mergedEntries = [...autoEntries, ...statHolidayRows];
  const resolvedRole = normalizePayrollRole(personRole) || payrollContext.defaultRole || 'teacher';
  const stampedEntries = mergedEntries.map((entry) => withPayrollStamp(entry, payrollContext, period, resolvedRole));
  const offenders = findAssemblyEntriesExceedingHourLimit(stampedEntries);
  if (offenders.length) {
    throw buildAssemblyHourLimitError(offenders);
  }

  return {
    entries: stampedEntries,
    totalHours: calculateTimesheetTotal(stampedEntries),
    statHolidayWarnings: Array.isArray(statHolidayContext?.warnings) ? statHolidayContext.warnings : [],
    payrollContext,
    personRole: resolvedRole
  };
}

module.exports = {
  resolveTimesheetEntryHours,
  calculateTimesheetTotal,
  withPayrollStamp,
  findAssemblyEntriesExceedingHourLimit,
  passesImportActivitySessionGuard,
  buildImportedTimesheetEntries
};
