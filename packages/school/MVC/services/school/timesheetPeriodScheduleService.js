'use strict';

const MONTH_LABELS = Object.freeze([
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
]);

const PERIOD_CADENCES = Object.freeze({
  MONTHLY: 'monthly',
  SEMI_MONTHLY: 'semi_monthly',
  BI_WEEKLY: 'bi_weekly',
  WEEKLY: 'weekly'
});

const CADENCE_LABELS = Object.freeze({
  [PERIOD_CADENCES.MONTHLY]: 'Monthly',
  [PERIOD_CADENCES.SEMI_MONTHLY]: 'Semi-monthly (1st–15th, 16th–end)',
  [PERIOD_CADENCES.BI_WEEKLY]: 'Bi-weekly (every 14 days)',
  [PERIOD_CADENCES.WEEKLY]: 'Weekly'
});

function parseDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
  const [year, month, day] = token.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function resolveSubmissionDeadline(endDate) {
  const end = parseDateOnly(endDate);
  if (!end) throw new Error('Invalid end date for submission deadline resolution.');

  const dayOfWeek = end.getUTCDay();
  const offset = (dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 1) ? 2 : 1;
  let deadline = addDays(end, -offset);

  const deadlineDay = deadline.getUTCDay();
  if (deadlineDay === 6) deadline = addDays(deadline, -1);
  if (deadlineDay === 0) deadline = addDays(deadline, -2);

  return formatDateOnly(deadline);
}

function assertYearAndOrg(orgId, year) {
  const orgToken = String(orgId || '').trim();
  const yearNumber = Number(year);
  if (!orgToken) throw new Error('orgId is required to build timesheet periods.');
  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2999) {
    throw new Error('year must be a valid four-digit year.');
  }
  return { orgToken, yearNumber };
}

function buildPeriodRow({
  orgId,
  id,
  name,
  startDate,
  endDate,
  status = 'open',
  submissionDeadlineTime = '23:59'
}) {
  return {
    id,
    orgId,
    name,
    startDate,
    endDate,
    submissionDeadline: resolveSubmissionDeadline(endDate),
    submissionDeadlineTime,
    status,
    notes: ''
  };
}

function buildPeriodId(year, monthIndex, halfCode) {
  const monthLabel = MONTH_LABELS[monthIndex] || 'UNK';
  return `TSP_${year}_${monthLabel}_${halfCode}`;
}

function buildPeriodName(year, monthIndex, startDay) {
  const monthLabel = MONTH_LABELS[monthIndex] || 'UNK';
  const dayToken = String(startDay).padStart(2, '0');
  return `${year}-${monthLabel}-${dayToken}`;
}

function buildMonthlyPeriods({
  orgId,
  year,
  status = 'open',
  submissionDeadlineTime = '23:59'
} = {}) {
  const { orgToken, yearNumber } = assertYearAndOrg(orgId, year);
  const periods = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthStart = formatDateOnly(new Date(Date.UTC(yearNumber, monthIndex, 1)));
    const monthEnd = formatDateOnly(lastDayOfMonth(yearNumber, monthIndex));
    const monthLabel = MONTH_LABELS[monthIndex];
    periods.push(buildPeriodRow({
      orgId: orgToken,
      id: `TSP_${yearNumber}_${monthLabel}`,
      name: `${yearNumber}-${monthLabel}`,
      startDate: monthStart,
      endDate: monthEnd,
      status,
      submissionDeadlineTime
    }));
  }

  return periods;
}

function buildBiMonthlyPeriods({
  orgId,
  year,
  status = 'open',
  submissionDeadlineTime = '23:59'
} = {}) {
  const { orgToken, yearNumber } = assertYearAndOrg(orgId, year);
  const periods = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthEnd = lastDayOfMonth(yearNumber, monthIndex);
    const firstHalfEnd = formatDateOnly(new Date(Date.UTC(yearNumber, monthIndex, 15)));
    const secondHalfStart = formatDateOnly(new Date(Date.UTC(yearNumber, monthIndex, 16)));
    const secondHalfEnd = formatDateOnly(monthEnd);

    periods.push(buildPeriodRow({
      orgId: orgToken,
      id: buildPeriodId(yearNumber, monthIndex, '01'),
      name: buildPeriodName(yearNumber, monthIndex, 1),
      startDate: formatDateOnly(new Date(Date.UTC(yearNumber, monthIndex, 1))),
      endDate: firstHalfEnd,
      status,
      submissionDeadlineTime
    }));

    periods.push(buildPeriodRow({
      orgId: orgToken,
      id: buildPeriodId(yearNumber, monthIndex, '16'),
      name: buildPeriodName(yearNumber, monthIndex, 16),
      startDate: secondHalfStart,
      endDate: secondHalfEnd,
      status,
      submissionDeadlineTime
    }));
  }

  return periods;
}

function buildRollingPeriods({
  orgId,
  year,
  spanDays,
  idPrefix,
  namePrefix,
  status = 'open',
  submissionDeadlineTime = '23:59'
}) {
  const { orgToken, yearNumber } = assertYearAndOrg(orgId, year);
  const yearEnd = parseDateOnly(`${yearNumber}-12-31`);
  let cursor = parseDateOnly(`${yearNumber}-01-01`);
  const periods = [];
  let index = 1;

  while (cursor.getTime() <= yearEnd.getTime()) {
    const periodStart = cursor;
    let periodEnd = addDays(periodStart, spanDays - 1);
    if (periodEnd.getTime() > yearEnd.getTime()) {
      periodEnd = yearEnd;
    }

    const token = String(index).padStart(2, '0');
    periods.push(buildPeriodRow({
      orgId: orgToken,
      id: `TSP_${yearNumber}_${idPrefix}_${token}`,
      name: `${yearNumber}-${namePrefix}-${token}`,
      startDate: formatDateOnly(periodStart),
      endDate: formatDateOnly(periodEnd),
      status,
      submissionDeadlineTime
    }));

    cursor = addDays(periodEnd, 1);
    index += 1;
  }

  return periods;
}

function buildBiWeeklyPeriods(options = {}) {
  return buildRollingPeriods({
    ...options,
    spanDays: 14,
    idPrefix: 'BW',
    namePrefix: 'BW'
  });
}

function buildWeeklyPeriods(options = {}) {
  return buildRollingPeriods({
    ...options,
    spanDays: 7,
    idPrefix: 'W',
    namePrefix: 'W'
  });
}

function normalizeCadence(value = '') {
  const token = String(value || '').trim().toLowerCase();
  const aliases = {
    monthly: PERIOD_CADENCES.MONTHLY,
    'semi-monthly': PERIOD_CADENCES.SEMI_MONTHLY,
    semi_monthly: PERIOD_CADENCES.SEMI_MONTHLY,
    semimonthly: PERIOD_CADENCES.SEMI_MONTHLY,
    biweekly: PERIOD_CADENCES.BI_WEEKLY,
    bi_weekly: PERIOD_CADENCES.BI_WEEKLY,
    'bi-weekly': PERIOD_CADENCES.BI_WEEKLY,
    weekly: PERIOD_CADENCES.WEEKLY
  };
  return aliases[token] || '';
}

function buildPeriodsForYear({
  orgId,
  year,
  cadence,
  status = 'open',
  submissionDeadlineTime = '23:59'
} = {}) {
  const normalizedCadence = normalizeCadence(cadence);
  if (!normalizedCadence) {
    throw new Error('A valid period cadence is required.');
  }

  const options = { orgId, year, status, submissionDeadlineTime };
  if (normalizedCadence === PERIOD_CADENCES.MONTHLY) return buildMonthlyPeriods(options);
  if (normalizedCadence === PERIOD_CADENCES.SEMI_MONTHLY) return buildBiMonthlyPeriods(options);
  if (normalizedCadence === PERIOD_CADENCES.BI_WEEKLY) return buildBiWeeklyPeriods(options);
  if (normalizedCadence === PERIOD_CADENCES.WEEKLY) return buildWeeklyPeriods(options);
  throw new Error('Unsupported period cadence.');
}

module.exports = {
  MONTH_LABELS,
  PERIOD_CADENCES,
  CADENCE_LABELS,
  parseDateOnly,
  formatDateOnly,
  resolveSubmissionDeadline,
  normalizeCadence,
  buildMonthlyPeriods,
  buildBiMonthlyPeriods,
  buildBiWeeklyPeriods,
  buildWeeklyPeriods,
  buildPeriodsForYear,
  buildPeriodId,
  buildPeriodName
};
