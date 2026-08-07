'use strict';

const applicabilityService = require('./classEnrollmentSessionApplicabilityService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const settingService = requireCoreModule('MVC/services/settingService');

const OPEN_WORKFLOW_STATUSES = new Set([
  'draft',
  'planned',
  'to_be_confirmed',
  'waiting_list',
  'active'
]);

const PRE_START_WORKFLOW_STATUSES = new Set([
  'draft',
  'planned',
  'to_be_confirmed',
  'waiting_list'
]);

const ENDED_STATUSES = new Set([
  'completed',
  'withdrawn',
  'cancelled',
  'archived',
  'void',
  'error'
]);

const VALID_SESSION_STATUSES = new Set(['active', 'planned']);

const ENROLLMENT_GROUP_OPTIONS = Object.freeze([
  { value: 'all', label: 'All enrollments' },
  { value: 'current', label: 'Current (today in window)' },
  { value: 'future', label: 'Future / Not started' },
  { value: 'past', label: 'Past / Ended' },
  { value: 'open', label: 'Open workflow' },
  { value: 'valid', label: 'Valid for sessions today' }
]);

const PERIOD_STATUS_OPTIONS = Object.freeze([
  'draft',
  'planned',
  'to_be_confirmed',
  'waiting_list',
  'active',
  'completed',
  'withdrawn',
  'cancelled',
  'archived',
  'void',
  'error'
]);

const TARGET_TYPE_OPTIONS = Object.freeze([
  { value: 'all', label: 'All target types' },
  { value: 'session_target', label: 'Session target' },
  { value: 'date_window', label: 'Date window only' }
]);

function normalizeDateOnly(value) {
  return applicabilityService.normalizeDateOnly(value);
}

function periodStatus(period = {}) {
  return String(period?.status || '').trim().toLowerCase();
}

function hasTargetSessionCount(period = {}) {
  return applicabilityService.normalizeTargetSessionCount(period?.targetSessionCount) > 0;
}

function periodEffectiveEndDate(period = {}) {
  return applicabilityService.periodEffectiveEndDate(period);
}

function isDateWithinPeriodWindow(period = {}, orgToday = '') {
  const today = normalizeDateOnly(orgToday);
  const start = normalizeDateOnly(period?.startDate);
  const end = periodEffectiveEndDate(period);
  if (!today || !start) return false;
  return start <= today && end >= today;
}

function isFuturePeriod(period = {}, orgToday = '') {
  const today = normalizeDateOnly(orgToday);
  const start = normalizeDateOnly(period?.startDate);
  const status = periodStatus(period);
  if (start && today && start > today) return true;
  return PRE_START_WORKFLOW_STATUSES.has(status) && (!start || !today || start >= today);
}

function isPastPeriod(period = {}, orgToday = '') {
  const status = periodStatus(period);
  if (ENDED_STATUSES.has(status)) return true;
  const today = normalizeDateOnly(orgToday);
  const end = periodEffectiveEndDate(period);
  if (!today || !end) return false;
  return end < today;
}

function isCurrentPeriod(period = {}, orgToday = '') {
  if (isPastPeriod(period, orgToday)) return false;
  return isDateWithinPeriodWindow(period, orgToday);
}

function isOpenWorkflowPeriod(period = {}) {
  return OPEN_WORKFLOW_STATUSES.has(periodStatus(period));
}

function isValidForSessionsToday(period = {}, orgToday = '') {
  const status = periodStatus(period);
  if (!VALID_SESSION_STATUSES.has(status)) return false;
  return isDateWithinPeriodWindow(period, orgToday);
}

function classifyEnrollmentPeriodGroup(period = {}, orgToday = '') {
  if (isValidForSessionsToday(period, orgToday)) return 'valid';
  if (isOpenWorkflowPeriod(period)) return 'open';
  if (isCurrentPeriod(period, orgToday)) return 'current';
  if (isFuturePeriod(period, orgToday)) return 'future';
  if (isPastPeriod(period, orgToday)) return 'past';
  return 'other';
}

function matchesEnrollmentGroup(period = {}, group = '', orgToday = '') {
  const token = String(group || 'all').trim().toLowerCase();
  if (!token || token === 'all') return true;
  if (token === 'open') return isOpenWorkflowPeriod(period);
  if (token === 'valid') return isValidForSessionsToday(period, orgToday);
  if (token === 'current') return isCurrentPeriod(period, orgToday);
  if (token === 'future') return isFuturePeriod(period, orgToday);
  if (token === 'past') return isPastPeriod(period, orgToday);
  return classifyEnrollmentPeriodGroup(period, orgToday) === token;
}

function matchesPeriodStatus(period = {}, statusFilter = '') {
  const token = String(statusFilter || '').trim().toLowerCase();
  if (!token) return true;
  return periodStatus(period) === token;
}

function matchesFunderFilter(period = {}, funderFilter = '') {
  const token = String(funderFilter || '').trim().toLowerCase();
  if (!token || token === 'all') return true;
  if (token === 'self') {
    return rollingEnrollmentFunderService.isSelfFund(period?.funderId);
  }
  const periodFunderId = toPublicId(period?.funderId);
  return periodFunderId && periodFunderId === toPublicId(funderFilter);
}

function matchesTargetType(period = {}, targetType = '') {
  const token = String(targetType || 'all').trim().toLowerCase();
  if (!token || token === 'all') return true;
  const hasTarget = hasTargetSessionCount(period);
  if (token === 'session_target') return hasTarget;
  if (token === 'date_window') return !hasTarget;
  return true;
}

function filterPeriodRowsBySearchQuery(rows, query, searchableFields = []) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
  let q = String(query?.q || '').trim();
  if (q === searchDefaultKeyword) q = '';
  if (!q) return rows;

  const rawType = String(query?.type || 'contains').trim().toLowerCase().replace(/\s+/g, '');
  let matchMode = 'contains';
  if (rawType === 'startswith' || rawType === 'starts_with') matchMode = 'starts_with';
  else if (rawType === 'exactmatch' || rawType === 'exact_match' || rawType === 'exact') matchMode = 'exact';

  const fieldRaw = String(query?.searchFields || query?.searchField || '').trim();
  const field = fieldRaw && fieldRaw.toLowerCase() !== 'all' ? fieldRaw : '';

  const norm = (v) => String(v ?? '').toLowerCase();
  const needle = norm(q);
  const allKeys = Array.isArray(searchableFields) && searchableFields.length
    ? searchableFields
    : [
      'studentLabel',
      'studentId',
      'startDate',
      'endDate',
      'status',
      'funderLabel',
      'funderType',
      'funderId'
    ];

  const cellText = (row, key) => {
    switch (key) {
      case 'studentLabel': return norm(row.studentLabel || row.studentId || '');
      case 'studentId': return norm(toPublicId(row.studentId));
      case 'startDate': return norm(row.startDate);
      case 'endDate': return norm(row.endDate);
      case 'status': return norm(row.status);
      case 'funderLabel': return norm(row.funderLabel || row.funderType || row.funderId);
      case 'funderType': return norm(row.funderType);
      case 'funderId': return norm(row.funderId);
      default: return '';
    }
  };

  const matches = (hay) => {
    if (hay == null || hay === '') return false;
    if (matchMode === 'exact') return hay === needle;
    if (matchMode === 'starts_with') return hay.startsWith(needle);
    return hay.includes(needle);
  };

  return rows.filter((row) => {
    if (field && allKeys.includes(field)) {
      return matches(cellText(row, field));
    }
    return allKeys.some((k) => matches(cellText(row, k)));
  });
}

function hasRollingEnrollmentFiltersApplied(query = {}) {
  return Boolean(
    String(query?.enrollmentGroup || '').trim()
    || String(query?.periodStatus || '').trim()
    || String(query?.funderId || '').trim()
    || String(query?.targetType || '').trim()
  );
}

function filterEnrollmentPeriodRows(rows, query = {}, options = {}) {
  const orgToday = normalizeDateOnly(options.orgToday);
  const list = Array.isArray(rows) ? rows.slice() : [];

  const enrollmentGroup = String(query?.enrollmentGroup || '').trim().toLowerCase();
  const periodStatusFilter = String(query?.periodStatus || '').trim().toLowerCase();
  const funderFilter = String(query?.funderId || '').trim();
  const targetType = String(query?.targetType || '').trim().toLowerCase();

  let filtered = list.filter((row) => matchesEnrollmentGroup(row, enrollmentGroup, orgToday));
  filtered = filtered.filter((row) => matchesPeriodStatus(row, periodStatusFilter));
  filtered = filtered.filter((row) => matchesFunderFilter(row, funderFilter));
  filtered = filtered.filter((row) => matchesTargetType(row, targetType));
  filtered = filterPeriodRowsBySearchQuery(filtered, query, options.searchableFields);
  return filtered;
}

module.exports = {
  ENROLLMENT_GROUP_OPTIONS,
  PERIOD_STATUS_OPTIONS,
  TARGET_TYPE_OPTIONS,
  OPEN_WORKFLOW_STATUSES,
  classifyEnrollmentPeriodGroup,
  filterEnrollmentPeriodRows,
  filterPeriodRowsBySearchQuery,
  hasRollingEnrollmentFiltersApplied,
  isCurrentPeriod,
  isFuturePeriod,
  isPastPeriod,
  isOpenWorkflowPeriod,
  isValidForSessionsToday
};
