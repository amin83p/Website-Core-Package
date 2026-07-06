function normalizeId(value) {
  return String(value || '').trim();
}

function dateOrBoundary(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function profileOverlapsPeriod(profile, period) {
  const profileStart = dateOrBoundary(profile?.effectiveFrom, '0001-01-01');
  const profileEnd = dateOrBoundary(profile?.effectiveTo, '9999-12-31');
  const periodStart = dateOrBoundary(period?.startDate, '0001-01-01');
  const periodEnd = dateOrBoundary(period?.endDate, '9999-12-31');
  return profileStart <= periodEnd && periodStart <= profileEnd;
}

function resolveHourlyRate({ compensationProfiles = [], departmentId, period } = {}) {
  const deptId = normalizeId(departmentId);
  if (!deptId) return null;

  const candidates = (Array.isArray(compensationProfiles) ? compensationProfiles : [])
    .filter((profile) => normalizeId(profile?.departmentId) === deptId)
    .filter((profile) => String(profile?.paymentMethod || 'hourly').trim().toLowerCase() === 'hourly')
    .filter((profile) => profileOverlapsPeriod(profile, period))
    .map((profile) => {
      const hourlyRate = Number(profile?.hourlyRate);
      if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) return null;
      return {
        profileId: normalizeId(profile?.id),
        hourlyRate,
        paymentMethod: 'hourly',
        contractId: normalizeId(profile?.contractId),
        effectiveFrom: dateOrBoundary(profile?.effectiveFrom, ''),
        effectiveTo: dateOrBoundary(profile?.effectiveTo, ''),
        notes: String(profile?.notes || '').trim()
      };
    })
    .filter(Boolean);

  candidates.sort((a, b) => dateOrBoundary(b.effectiveFrom, '0001-01-01').localeCompare(dateOrBoundary(a.effectiveFrom, '0001-01-01')));
  return candidates[0] || null;
}

function computeGrossPay(hours, hourlyRate) {
  const h = Number(hours);
  const rate = Number(hourlyRate);
  if (!Number.isFinite(h) || !Number.isFinite(rate) || h <= 0 || rate <= 0) return null;
  return Number((h * rate).toFixed(2));
}

function formatHourlyRateLabel(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 'N/D';
  return `$${amount.toFixed(2)}/hr`;
}

function formatGrossPayLabel(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 'N/D';
  return `$${amount.toFixed(2)}`;
}

module.exports = {
  resolveHourlyRate,
  computeGrossPay,
  formatHourlyRateLabel,
  formatGrossPayLabel,
  profileOverlapsPeriod
};
