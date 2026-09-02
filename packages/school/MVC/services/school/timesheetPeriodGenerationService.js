'use strict';

const schoolDataService = require('./schoolDataService');
const {
  buildPeriodsForYear,
  normalizeCadence,
  PERIOD_CADENCES
} = require('./timesheetPeriodScheduleService');

function periodRangeKey(row = {}) {
  return [
    String(row.orgId || '').trim(),
    String(row.startDate || '').trim(),
    String(row.endDate || '').trim()
  ].join('|');
}

function isPeriodInYear(row = {}, year) {
  const startDate = String(row?.startDate || '').trim();
  return startDate.startsWith(`${year}-`);
}

function hasMatchingRange(existingRows = [], candidate = {}) {
  const candidateKey = periodRangeKey(candidate);
  return (Array.isArray(existingRows) ? existingRows : []).some((row) => (
    periodRangeKey(row) === candidateKey
  ));
}

async function loadExistingOrgPeriods(orgId, reqUser) {
  const rows = await schoolDataService.fetchData(
    'timesheetPeriods',
    { orgId__eq: orgId },
    reqUser
  );
  return Array.isArray(rows) ? rows : [];
}

async function generateYearPeriods({
  orgId,
  year,
  cadence,
  reqUser
} = {}) {
  const orgToken = String(orgId || '').trim();
  const yearNumber = Number(year);
  const normalizedCadence = normalizeCadence(cadence);

  if (!orgToken) throw new Error('Organization is required to generate timesheet periods.');
  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2999) {
    throw new Error('A valid four-digit year is required.');
  }
  if (!normalizedCadence) {
    throw new Error('A valid period cadence is required.');
  }

  const [existingRows, candidates] = await Promise.all([
    loadExistingOrgPeriods(orgToken, reqUser),
    Promise.resolve(buildPeriodsForYear({
      orgId: orgToken,
      year: yearNumber,
      cadence: normalizedCadence
    }))
  ]);

  const existingForYear = existingRows.filter((row) => isPeriodInYear(row, yearNumber));
  const created = [];
  const skipped = [];

  for (const candidate of candidates) {
    if (hasMatchingRange(existingRows, candidate)) {
      skipped.push({
        id: candidate.id,
        name: candidate.name,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        reason: 'A period with the same date range already exists.'
      });
      continue;
    }

    const saved = await schoolDataService.addData('timesheetPeriods', candidate, reqUser);
    created.push(saved);
    existingRows.push(saved);
  }

  return {
    year: yearNumber,
    cadence: normalizedCadence,
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
    skipped,
    existingCount: existingForYear.length
  };
}

module.exports = {
  PERIOD_CADENCES,
  periodRangeKey,
  hasMatchingRange,
  generateYearPeriods
};
