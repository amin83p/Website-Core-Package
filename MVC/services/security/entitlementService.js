const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { resolveOrgTodayFromContext } = require('../../utils/timezoneUtils');

const MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS = Object.freeze([
  { value: 'manual', label: 'Manual' },
  { value: 'payment', label: 'Payment' },
  { value: 'trial', label: 'Trial' },
  { value: 'admin_grant', label: 'Admin Grant' },
  { value: 'activity_quota_package', label: 'Activity Quota Package' }
]);

const MEMBERSHIP_PERIOD_SOURCE_TYPE_SET = new Set(
  MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS.map((item) => String(item.value || '').trim().toLowerCase()).filter(Boolean)
);

const MEMBERSHIP_PERIOD_SOURCE_TYPE_ALIASES = Object.freeze({
  package: 'activity_quota_package'
});

function normalizeMembershipPeriodSourceTypeToken(value, { fallback = 'manual' } = {}) {
  const token = String(value || '').trim().toLowerCase();
  const canonical = MEMBERSHIP_PERIOD_SOURCE_TYPE_ALIASES[token] || token;
  if (MEMBERSHIP_PERIOD_SOURCE_TYPE_SET.has(canonical)) return canonical;

  const fallbackToken = String(fallback || '').trim().toLowerCase();
  if (MEMBERSHIP_PERIOD_SOURCE_TYPE_SET.has(fallbackToken)) return fallbackToken;
  return '';
}

function getMembershipPeriodSourceTypeOptions() {
  return MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS.map((item) => ({ ...item }));
}

function toDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const candidate = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const [y, m, d] = candidate.split('-').map((part) => Number(part));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return null;
  }
  return candidate;
}

function getTodayDateKey() {
  return resolveOrgTodayFromContext({});
}

function addDays(dateKey, days) {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function normalizePeriodOrgId(value) {
  const token = toPublicId(value);
  if (!token) return null;
  if (idsEqual(token, 'SYSTEM')) return null;
  if (String(token).trim().toUpperCase() === 'GLOBAL') return null;
  return token;
}

function isPeriodApplicableToOrg(period = {}, targetOrgId = null) {
  const scopedOrgId = normalizePeriodOrgId(targetOrgId);
  const periodOrgId = normalizePeriodOrgId(period?.orgId);
  if (!scopedOrgId) return true;
  if (!periodOrgId) return true;
  return idsEqual(periodOrgId, scopedOrgId);
}

function normalizeMembershipPeriods(periods = [], options = {}) {
  const rows = Array.isArray(periods) ? periods : [];
  const membershipOrgId = normalizePeriodOrgId(options?.membershipOrgId);
  const normalized = [];

  rows.forEach((period, index) => {
    if (!period || typeof period !== 'object') return;
    const startDate = toDateKey(period.startDate);
    const endDate = toDateKey(period.endDate);
    if (!startDate || !endDate) return;
    if (startDate > endDate) return;

    const requestedPeriodOrgId = normalizePeriodOrgId(period.orgId);
    const periodOrgId = membershipOrgId || requestedPeriodOrgId || null;

    normalized.push({
      id: String(period.id || `period_${index + 1}`).trim(),
      startDate,
      endDate,
      orgId: periodOrgId,
      sourceType: normalizeMembershipPeriodSourceTypeToken(period.sourceType, { fallback: 'manual' }),
      sourceRef: String(period.sourceRef || '').trim(),
      note: String(period.note || '').trim()
    });
  });

  normalized.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
    return String(a.orgId || '').localeCompare(String(b.orgId || ''));
  });

  return normalized;
}

function mergeMembershipPeriods(periods = [], options = {}) {
  const normalized = normalizeMembershipPeriods(periods, options);
  const grouped = new Map();

  normalized.forEach((period) => {
    const key = String(period.orgId || '__ALL_ORGS__');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(period);
  });

  const merged = [];

  grouped.forEach((rows) => {
    rows.forEach((period) => {
      if (!merged.length) {
        merged.push({ ...period });
        return;
      }

      const prev = merged[merged.length - 1];
      const sameOrg = idsEqual(
        normalizePeriodOrgId(prev.orgId),
        normalizePeriodOrgId(period.orgId)
      ) || (!normalizePeriodOrgId(prev.orgId) && !normalizePeriodOrgId(period.orgId));

      if (!sameOrg) {
        merged.push({ ...period });
        return;
      }

      const prevEndPlusOne = addDays(prev.endDate, 1);
      if (period.startDate <= prevEndPlusOne) {
        if (period.endDate > prev.endDate) prev.endDate = period.endDate;
        if (!prev.sourceRef && period.sourceRef) prev.sourceRef = period.sourceRef;
        if (!prev.note && period.note) prev.note = period.note;
        return;
      }

      merged.push({ ...period });
    });
  });

  merged.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
    return String(a.orgId || '').localeCompare(String(b.orgId || ''));
  });

  return merged;
}

function summarizeEntitlementPeriods(periods = [], options = {}) {
  const normalizedPeriods = mergeMembershipPeriods(periods, options);
  const targetOrgId = normalizePeriodOrgId(options?.targetOrgId);
  const scopedPeriods = targetOrgId
    ? normalizedPeriods.filter((period) => isPeriodApplicableToOrg(period, targetOrgId))
    : normalizedPeriods;
  const today = toDateKey(options.today) || getTodayDateKey();

  if (!scopedPeriods.length) {
    return {
      hasPeriods: false,
      active: false,
      status: 'no_period',
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      activePeriod: null,
      periods: []
    };
  }

  const activePeriod = scopedPeriods.find((period) => period.startDate <= today && period.endDate >= today) || null;
  const effectiveStartDate = scopedPeriods[0].startDate;
  const effectiveEndDate = scopedPeriods[scopedPeriods.length - 1].endDate;
  const nextStart = scopedPeriods.find((period) => period.startDate > today) || null;

  let status = 'expired';
  if (activePeriod) status = 'active';
  else if (nextStart) status = 'upcoming';

  return {
    hasPeriods: true,
    active: Boolean(activePeriod),
    status,
    effectiveStartDate,
    effectiveEndDate,
    nextStartDate: nextStart ? nextStart.startDate : null,
    activePeriod,
    periods: scopedPeriods
  };
}

function buildMembershipStatus(activeFlag, summary) {
  if (!activeFlag) return 'disabled';
  return summary?.status || 'no_period';
}

function normalizeMembershipPayload(input = {}) {
  const userId = toPublicId(input.userId) || null;
  const orgIdRaw = toPublicId(input.orgId);
  const orgIdUpper = String(orgIdRaw || '').trim().toUpperCase();
  const orgId = orgIdRaw && !idsEqual(orgIdRaw, 'SYSTEM') && orgIdUpper !== 'GLOBAL' ? orgIdRaw : null;
  const active = input.active !== false;
  const periods = normalizeMembershipPeriods(input.periods, { membershipOrgId: orgId });
  const summary = summarizeEntitlementPeriods(periods, { targetOrgId: orgId || null });

  return {
    userId,
    orgId,
    active,
    periods,
    summary: {
      ...summary,
      enforced: active,
      status: buildMembershipStatus(active, summary)
    },
    notes: String(input.notes || '').trim(),
    source: {
      paymentProvider: String(input?.source?.paymentProvider || '').trim(),
      paymentReference: String(input?.source?.paymentReference || '').trim()
    }
  };
}

function selectApplicableMemberships(records = [], userId, orgId, options = {}) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  const rows = Array.isArray(records) ? records : [];
  const includeInactive = options?.includeInactive === true;

  return rows.filter((row) => {
    if (!row) return false;
    if (!includeInactive && row.active === false) return false;
    if (!idsEqual(row.userId, normalizedUserId)) return false;
    if (!normalizedOrgId || idsEqual(normalizedOrgId, 'SYSTEM')) return true;
    const rowOrgId = toPublicId(row.orgId) || null;
    return !rowOrgId || idsEqual(rowOrgId, normalizedOrgId);
  });
}

function evaluateUserEntitlement(records = [], userId, orgId, options = {}) {
  const targetOrgId = normalizePeriodOrgId(orgId);
  const today = toDateKey(options.today) || getTodayDateKey();
  const applicableAll = selectApplicableMemberships(records, userId, orgId, { includeInactive: true });
  const hasGlobalRow = applicableAll.some((row) => !toPublicId(row?.orgId));
  const hasScopedRow = applicableAll.some((row) => idsEqual(toPublicId(row?.orgId), toPublicId(orgId)));

  if (!applicableAll.length) {
    return {
      enforced: false,
      hasRecords: false,
      active: true,
      status: 'not_configured',
      reason: 'No membership rule configured for this user yet.',
      appliesToAllOrgs: false,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const globalDeactivated = applicableAll.find((row) => row?.active === false && !toPublicId(row?.orgId));
  if (globalDeactivated) {
    return {
      enforced: true,
      hasRecords: true,
      active: false,
      status: 'deactivated_global',
      reason: 'Membership is deactivated for all organizations. Contact your administrator or organization.',
      appliesToAllOrgs: true,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const scopedDeactivated = applicableAll.find(
    (row) => row?.active === false && idsEqual(toPublicId(row?.orgId), toPublicId(orgId))
  );
  if (scopedDeactivated) {
    return {
      enforced: true,
      hasRecords: true,
      active: false,
      status: 'deactivated_org',
      reason: 'Membership is deactivated for this organization. Contact your administrator or organization.',
      appliesToAllOrgs: false,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const applicable = applicableAll.filter((row) => row?.active !== false);
  if (!applicable.length) {
    return {
      enforced: false,
      hasRecords: true,
      active: true,
      status: 'not_configured',
      reason: 'No active membership rule configured for this organization.',
      appliesToAllOrgs: false,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const allPeriods = applicable.flatMap((row) => normalizeMembershipPeriods(row?.periods, {
    membershipOrgId: toPublicId(row?.orgId) || null
  }));
  if (!allPeriods.length) {
    return {
      enforced: false,
      hasRecords: true,
      active: true,
      status: 'no_period_bypass',
      reason: 'Membership is active with no validity periods configured.',
      appliesToAllOrgs: hasGlobalRow && !hasScopedRow,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const scopedPeriods = allPeriods.filter((period) => isPeriodApplicableToOrg(period, targetOrgId));
  if (!scopedPeriods.length) {
    return {
      enforced: true,
      hasRecords: true,
      active: false,
      status: 'no_period_for_org',
      reason: 'Membership period is not configured for this organization.',
      appliesToAllOrgs: false,
      effectiveStartDate: null,
      effectiveEndDate: null,
      nextStartDate: null,
      periods: []
    };
  }

  const summary = summarizeEntitlementPeriods(scopedPeriods, { today, targetOrgId });
  if (summary.active) {
    return {
      enforced: true,
      hasRecords: true,
      active: true,
      status: 'active',
      reason: 'Membership is active.',
      appliesToAllOrgs: hasGlobalRow && !hasScopedRow,
      effectiveStartDate: summary.effectiveStartDate,
      effectiveEndDate: summary.effectiveEndDate,
      nextStartDate: summary.nextStartDate,
      periods: summary.periods
    };
  }

  if (summary.status === 'upcoming') {
    return {
      enforced: true,
      hasRecords: true,
      active: false,
      status: 'upcoming',
      reason: `Membership starts on ${summary.nextStartDate}.`,
      appliesToAllOrgs: hasGlobalRow && !hasScopedRow,
      effectiveStartDate: summary.effectiveStartDate,
      effectiveEndDate: summary.effectiveEndDate,
      nextStartDate: summary.nextStartDate,
      periods: summary.periods
    };
  }

  return {
    enforced: true,
    hasRecords: true,
    active: false,
    status: 'expired',
    reason: summary.effectiveEndDate
      ? `Membership expired on ${summary.effectiveEndDate}.`
      : 'Membership has expired.',
    appliesToAllOrgs: hasGlobalRow && !hasScopedRow,
    effectiveStartDate: summary.effectiveStartDate,
    effectiveEndDate: summary.effectiveEndDate,
    nextStartDate: summary.nextStartDate,
    periods: summary.periods
  };
}

module.exports = {
  MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS,
  getMembershipPeriodSourceTypeOptions,
  normalizeMembershipPeriodSourceTypeToken,
  toDateKey,
  addDays,
  normalizePeriodOrgId,
  isPeriodApplicableToOrg,
  normalizeMembershipPeriods,
  mergeMembershipPeriods,
  summarizeEntitlementPeriods,
  normalizeMembershipPayload,
  evaluateUserEntitlement
};
