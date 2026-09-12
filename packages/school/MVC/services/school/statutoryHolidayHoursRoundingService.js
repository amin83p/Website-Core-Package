'use strict';

function roundStatutoryHolidayHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac > 0.5) return whole + 1;
  if (frac === 0.5) return whole + 0.5;
  return whole;
}

function isStatutoryHolidayRoundingEnabled(policy = {}) {
  const statPay = policy?.statutoryHolidayPay;
  if (!statPay || typeof statPay !== 'object') return false;
  return statPay.roundCalculatedHours === true;
}

function applyStatutoryHolidayHoursRounding(hours, { enabled = false } = {}) {
  if (!enabled) {
    const n = Number(hours);
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0;
  }
  return roundStatutoryHolidayHours(hours);
}

module.exports = {
  roundStatutoryHolidayHours,
  isStatutoryHolidayRoundingEnabled,
  applyStatutoryHolidayHoursRounding
};
