'use strict';

const dataService = require('./schoolDataService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const timesheetPayRateService = require('./timesheetPayRateService');
const timesheetEffectiveEntryService = require('./timesheetEffectiveEntryService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');

function cleanId(value) {
  return String(value ?? '').trim();
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
  allowManagerOverride = true
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
  );

  const autoEntries = (Array.isArray(effective?.entries) ? effective.entries : [])
    .filter((entry) => entry?.isDeleted !== true)
    .filter((entry) => entry?.isManual !== true)
    .filter((entry) => !timesheetLegacyImportService.isLegacyImportEntry(entry));

  const statHolidayContext = await statutoryHolidayEligibilityService.buildStatutoryHolidayTimesheetContext({
    orgId: activeOrgId,
    personId: targetPersonId,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    policy: timesheetParametersPolicy,
    holidays: allHolidays,
    supplementalEntries: filteredLiveEntries,
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
  buildImportedTimesheetEntries
};
