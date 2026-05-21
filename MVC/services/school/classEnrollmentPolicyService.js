const settingService = require('../settingService');

const DEFAULT_POLICY = Object.freeze({
  allowImmediateReentry: true,
  minGapDaysBetweenPeriods: 0,
  maxPeriodsPerStudentPerClass: 0,
  maxCycleGapDaysBetweenCycles: 0,
  maxCycleOverlapDaysBetweenCycles: 0
});

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function toNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readSetting(section, key) {
  return settingService.getValue(section, key);
}

function getPolicy() {
  const allowImmediateReentry = toBoolean(
    process.env.SCHOOL_ALLOW_IMMEDIATE_REENTRY,
    toBoolean(readSetting('school', 'allowImmediateReentry'), DEFAULT_POLICY.allowImmediateReentry)
  );

  const minGapDaysBetweenPeriods = toNonNegativeInt(
    process.env.SCHOOL_MIN_GAP_DAYS_BETWEEN_PERIODS,
    toNonNegativeInt(readSetting('school', 'minGapDaysBetweenPeriods'), DEFAULT_POLICY.minGapDaysBetweenPeriods)
  );

  const maxPeriodsPerStudentPerClass = toNonNegativeInt(
    process.env.SCHOOL_MAX_PERIODS_PER_STUDENT_PER_CLASS,
    toNonNegativeInt(readSetting('school', 'maxPeriodsPerStudentPerClass'), DEFAULT_POLICY.maxPeriodsPerStudentPerClass)
  );

  const maxCycleGapDaysBetweenCycles = toNonNegativeInt(
    process.env.SCHOOL_MAX_CYCLE_GAP_DAYS,
    toNonNegativeInt(readSetting('school', 'maxCycleGapDaysBetweenCycles'), DEFAULT_POLICY.maxCycleGapDaysBetweenCycles)
  );

  const maxCycleOverlapDaysBetweenCycles = toNonNegativeInt(
    process.env.SCHOOL_MAX_CYCLE_OVERLAP_DAYS,
    toNonNegativeInt(readSetting('school', 'maxCycleOverlapDaysBetweenCycles'), DEFAULT_POLICY.maxCycleOverlapDaysBetweenCycles)
  );

  return {
    allowImmediateReentry,
    minGapDaysBetweenPeriods,
    maxPeriodsPerStudentPerClass,
    maxCycleGapDaysBetweenCycles,
    maxCycleOverlapDaysBetweenCycles
  };
}

module.exports = {
  DEFAULT_POLICY,
  getPolicy
};
