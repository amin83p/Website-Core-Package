'use strict';

function normalizeDate(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function periodOverlaps(sourceStart, sourceEnd, periodStart, periodEnd) {
  return sourceStart <= periodEnd && sourceEnd >= periodStart;
}

function periodContainsRange(periodStart, periodEnd, sourceStart, sourceEnd) {
  return periodStart <= sourceStart && periodEnd >= sourceEnd;
}

function filterPeriodsForYear(periods = [], year) {
  const yearToken = String(year || '').trim();
  if (!/^\d{4}$/.test(yearToken)) return [];
  const yearStart = `${yearToken}-01-01`;
  const yearEnd = `${yearToken}-12-31`;
  return (Array.isArray(periods) ? periods : [])
    .filter((period) => {
      const startDate = normalizeDate(period?.startDate);
      const endDate = normalizeDate(period?.endDate);
      if (!startDate || !endDate) return false;
      return periodOverlaps(startDate, endDate, yearStart, yearEnd);
    })
    .sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')));
}

function matchTimesheetPeriod(sourcePeriod = {}, periods = [], year = '') {
  const startDate = normalizeDate(sourcePeriod.startDate);
  const endDate = normalizeDate(sourcePeriod.endDate);
  if (!startDate || !endDate) {
    return {
      matchedPeriod: null,
      matchStatus: 'none',
      matchNote: 'Missing source period dates.'
    };
  }

  const scoped = filterPeriodsForYear(periods, year);
  const exact = scoped.find((period) => (
    normalizeDate(period.startDate) === startDate
    && normalizeDate(period.endDate) === endDate
  ));
  if (exact) {
    return {
      matchedPeriod: shapeMatchedPeriod(exact, 'exact', 'Exact start/end date match.'),
      matchStatus: 'exact',
      matchNote: 'Exact start/end date match.'
    };
  }

  const containing = scoped.find((period) => periodContainsRange(
    normalizeDate(period.startDate),
    normalizeDate(period.endDate),
    startDate,
    endDate
  ));
  if (containing) {
    return {
      matchedPeriod: shapeMatchedPeriod(
        containing,
        'partial',
        'Excel period falls inside this app period but dates do not match exactly.'
      ),
      matchStatus: 'partial',
      matchNote: 'Excel period falls inside this app period but dates do not match exactly.'
    };
  }

  const overlapping = scoped.find((period) => periodOverlaps(
    startDate,
    endDate,
    normalizeDate(period.startDate),
    normalizeDate(period.endDate)
  ));
  if (overlapping) {
    return {
      matchedPeriod: shapeMatchedPeriod(
        overlapping,
        'partial',
        'Excel period partially overlaps this app period.'
      ),
      matchStatus: 'partial',
      matchNote: 'Excel period partially overlaps this app period.'
    };
  }

  return {
    matchedPeriod: null,
    matchStatus: 'none',
    matchNote: `No timesheet period found for ${startDate} to ${endDate} in year ${year}.`
  };
}

function shapeMatchedPeriod(period, matchStatus, matchNote) {
  return {
    id: String(period?.id || '').trim(),
    name: String(period?.name || period?.id || '').trim(),
    startDate: normalizeDate(period?.startDate),
    endDate: normalizeDate(period?.endDate),
    matchStatus,
    matchNote
  };
}

module.exports = {
  filterPeriodsForYear,
  matchTimesheetPeriod
};
