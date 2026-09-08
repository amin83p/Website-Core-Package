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

function daysBetween(isoA, isoB) {
  const a = normalizeDate(isoA);
  const b = normalizeDate(isoB);
  if (!a || !b) return 0;
  const da = Date.parse(`${a}T00:00:00.000Z`);
  const db = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.round((db - da) / 86400000);
}

function describeBoundaryDiff(boundaryLabel, excelDate, appDate) {
  const excel = normalizeDate(excelDate);
  const app = normalizeDate(appDate);
  if (!excel || !app) return `${boundaryLabel} dates could not be compared.`;
  if (excel === app) return `${boundaryLabel} dates match.`;

  const diff = daysBetween(excel, app);
  const absDays = Math.abs(diff);
  const dayWord = absDays === 1 ? 'day' : 'days';
  if (diff > 0) {
    return `Excel ${boundaryLabel.toLowerCase()} date is ${absDays} ${dayWord} before app period ${boundaryLabel.toLowerCase()} (${app}).`;
  }
  return `Excel ${boundaryLabel.toLowerCase()} date is ${absDays} ${dayWord} after app period ${boundaryLabel.toLowerCase()} (${app}).`;
}

function formatPeriodLabel(period) {
  const id = String(period?.id || '').trim();
  const name = String(period?.name || period?.id || '').trim();
  const startDate = normalizeDate(period?.startDate);
  const endDate = normalizeDate(period?.endDate);
  const identity = name && id && name !== id ? `${name} (${id})` : (name || id || 'Unknown period');
  return `${identity}: ${startDate} to ${endDate}`;
}

function buildPartialMatchNote({ kind, excelStart, excelEnd, period }) {
  const appStart = normalizeDate(period?.startDate);
  const appEnd = normalizeDate(period?.endDate);
  const appPeriodId = String(period?.id || '').trim();
  const appPeriodName = String(period?.name || period?.id || '').trim();
  const boundaryNotes = [
    describeBoundaryDiff('Start', excelStart, appStart),
    describeBoundaryDiff('End', excelEnd, appEnd)
  ];

  let overlapStart = '';
  let overlapEnd = '';
  const matchDetails = {
    kind,
    excelStart,
    excelEnd,
    appPeriodId,
    appPeriodName,
    appStart,
    appEnd,
    overlapStart: '',
    overlapEnd: '',
    boundaryNotes: [...boundaryNotes]
  };

  let headline = '';
  if (kind === 'contained') {
    headline = 'Excel period falls inside this app period but dates do not match exactly.';
  } else {
    overlapStart = excelStart > appStart ? excelStart : appStart;
    overlapEnd = excelEnd < appEnd ? excelEnd : appEnd;
    matchDetails.overlapStart = overlapStart;
    matchDetails.overlapEnd = overlapEnd;
    headline = 'Excel period partially overlaps this app period.';
    boundaryNotes.push(`Shared overlap window: ${overlapStart} to ${overlapEnd}.`);
    if (excelStart < appStart) {
      boundaryNotes.push(`Excel starts ${daysBetween(excelStart, appStart)} day(s) before the app period start (${appStart}).`);
    }
    if (excelEnd > appEnd) {
      boundaryNotes.push(`Excel ends ${daysBetween(appEnd, excelEnd)} day(s) after the app period end (${appEnd}).`);
    }
    matchDetails.boundaryNotes = [...boundaryNotes];
  }

  const matchNote = [
    headline,
    `Excel: ${excelStart} to ${excelEnd}.`,
    `App period ${formatPeriodLabel(period)}.`,
    ...boundaryNotes
  ].join(' ');

  return { matchNote, matchDetails };
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
      matchNote: 'Missing source period dates.',
      matchDetails: null
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
      matchNote: 'Exact start/end date match.',
      matchDetails: null
    };
  }

  const containing = scoped.find((period) => periodContainsRange(
    normalizeDate(period.startDate),
    normalizeDate(period.endDate),
    startDate,
    endDate
  ));
  if (containing) {
    const partial = buildPartialMatchNote({
      kind: 'contained',
      excelStart: startDate,
      excelEnd: endDate,
      period: containing
    });
    return {
      matchedPeriod: shapeMatchedPeriod(containing, 'partial', partial.matchNote),
      matchStatus: 'partial',
      matchNote: partial.matchNote,
      matchDetails: partial.matchDetails
    };
  }

  const overlapping = scoped.find((period) => periodOverlaps(
    startDate,
    endDate,
    normalizeDate(period.startDate),
    normalizeDate(period.endDate)
  ));
  if (overlapping) {
    const partial = buildPartialMatchNote({
      kind: 'overlap',
      excelStart: startDate,
      excelEnd: endDate,
      period: overlapping
    });
    return {
      matchedPeriod: shapeMatchedPeriod(overlapping, 'partial', partial.matchNote),
      matchStatus: 'partial',
      matchNote: partial.matchNote,
      matchDetails: partial.matchDetails
    };
  }

  return {
    matchedPeriod: null,
    matchStatus: 'none',
    matchNote: `No timesheet period found for ${startDate} to ${endDate} in year ${year}.`,
    matchDetails: null
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
