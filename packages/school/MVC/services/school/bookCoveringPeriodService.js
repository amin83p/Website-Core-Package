'use strict';

function clean(value) {
  return String(value || '').trim();
}

function parseDateOnly(value) {
  const token = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
  const [y, m, d] = token.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeekSunday(date) {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function resolveBiweeklyWindow(anchorDate, cycleStartDate) {
  const anchor = parseDateOnly(anchorDate);
  if (!anchor) throw new Error('Anchor date is required.');
  let cycleStart = parseDateOnly(cycleStartDate);
  if (!cycleStart) {
    cycleStart = startOfWeekMonday(anchor);
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSince = Math.floor((anchor - cycleStart) / msPerDay);
  const periodIndex = Math.floor(daysSince / 14);
  const start = new Date(cycleStart);
  start.setDate(start.getDate() + periodIndex * 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { periodStartDate: formatDateOnly(start), periodEndDate: formatDateOnly(end) };
}

function resolvePeriodWindow({ periodType, anchorDate, cycleStartDate } = {}) {
  const type = clean(periodType).toLowerCase() || 'daily';
  const anchor = parseDateOnly(anchorDate);
  if (!anchor) throw new Error('Anchor date is required.');

  if (type === 'daily') {
    const day = formatDateOnly(anchor);
    return { periodStartDate: day, periodEndDate: day };
  }
  if (type === 'weekly') {
    return {
      periodStartDate: formatDateOnly(startOfWeekMonday(anchor)),
      periodEndDate: formatDateOnly(endOfWeekSunday(anchor))
    };
  }
  if (type === 'biweekly') {
    return resolveBiweeklyWindow(formatDateOnly(anchor), cycleStartDate);
  }
  if (type === 'monthly') {
    return {
      periodStartDate: formatDateOnly(startOfMonth(anchor)),
      periodEndDate: formatDateOnly(endOfMonth(anchor))
    };
  }
  throw new Error(`Unsupported period type: ${type}`);
}

module.exports = {
  resolvePeriodWindow,
  formatDateOnly,
  parseDateOnly
};
