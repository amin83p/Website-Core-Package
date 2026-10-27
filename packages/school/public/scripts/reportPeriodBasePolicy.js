(function (global) {
  'use strict';

  const REPORT_PERIOD_BASE_DEFINITIONS = [
    { value: 'none', label: 'None' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
    { value: 'months', label: 'Months' },
    { value: 'year', label: 'Year' },
    { value: 'enrollment', label: 'Enrollment' }
  ];
  const OFFSET_BASES = new Set(['days', 'weeks', 'months']);

  function normalizeDateOnly(value) {
    const token = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
  }

  function normalizeReportPeriodBase(value) {
    const normalized = String(value || 'none').trim().toLowerCase() || 'none';
    const allowed = new Set(REPORT_PERIOD_BASE_DEFINITIONS.map((row) => row.value));
    return allowed.has(normalized) ? normalized : 'none';
  }

  function isStudentScopedReportScope(scope) {
    const token = String(scope || '').trim().toLowerCase();
    return token === 'each_student' || token === 'selected_students';
  }

  function subtractCalendarUnits(sessionDate, base, offset) {
    const iso = normalizeDateOnly(sessionDate);
    if (!iso) return '';
    const anchor = new Date(`${iso}T12:00:00.000Z`);
    const units = Number(offset) || 1;
    if (base === 'days') anchor.setUTCDate(anchor.getUTCDate() - units);
    else if (base === 'weeks') anchor.setUTCDate(anchor.getUTCDate() - (units * 7));
    else if (base === 'months') anchor.setUTCMonth(anchor.getUTCMonth() - units);
    else return '';
    return anchor.toISOString().slice(0, 10);
  }

  function computeSuggestedReportStartDateSync({
    reportPeriodBase = 'none',
    reportPeriodOffset = null,
    sessionDate = ''
  } = {}) {
    const session = normalizeDateOnly(sessionDate);
    if (!session) return '';
    const base = normalizeReportPeriodBase(reportPeriodBase);
    if (base === 'none') return session;
    if (base === 'year') return `${session.slice(0, 4)}-01-01`;
    if (base === 'enrollment') return session;
    if (OFFSET_BASES.has(base)) {
      const offset = Math.max(1, Number.parseInt(String(reportPeriodOffset ?? 1), 10) || 1);
      return subtractCalendarUnits(session, base, offset);
    }
    return session;
  }

  function buildSuggestionHint(template = {}) {
    const base = normalizeReportPeriodBase(template?.reportPeriodBase);
    const offset = Number(template?.reportPeriodOffset) || 1;
    if (base === 'none') return 'Suggested start matches the session date.';
    if (base === 'year') return 'Suggested start is the first day of the session calendar year.';
    if (base === 'enrollment') {
      return 'Enrollment base applies when exactly one student is selected (Each Student / Specific Students).';
    }
    if (OFFSET_BASES.has(base)) {
      const unit = base === 'days' ? 'day' : base.slice(0, -1);
      const plural = offset === 1 ? unit : `${unit}s`;
      return `Suggested start is ${offset} ${plural} before the session date.`;
    }
    return '';
  }

  async function fetchSuggestedReportStartDate({
    classId,
    sessionDate,
    templateId,
    reportScope = 'class',
    targetStudentIds = []
  } = {}) {
    const res = await fetch('/school/reports/assignments/suggested-report-start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify({
        classId,
        sessionDate,
        templateId,
        reportScope,
        targetStudentIds
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.status === 'error') {
      return { suggestedStartDate: '', hint: '' };
    }
    return {
      suggestedStartDate: normalizeDateOnly(payload.suggestedStartDate),
      hint: String(payload.hint || '').trim()
    };
  }

  async function resolveSuggestedReportStartDate({
    template = {},
    sessionDate = '',
    classId = '',
    templateId = '',
    reportScope = 'class',
    targetStudentIds = []
  } = {}) {
    const base = normalizeReportPeriodBase(template?.reportPeriodBase);
    if (base === 'enrollment') {
      if (classId && templateId && sessionDate) {
        const remote = await fetchSuggestedReportStartDate({
          classId,
          sessionDate,
          templateId,
          reportScope,
          targetStudentIds
        });
        if (remote.suggestedStartDate) return remote;
      }
      return {
        suggestedStartDate: computeSuggestedReportStartDateSync({ reportPeriodBase: base, sessionDate }),
        hint: buildSuggestionHint(template)
      };
    }
    const sync = computeSuggestedReportStartDateSync({
      reportPeriodBase: base,
      reportPeriodOffset: template?.reportPeriodOffset,
      sessionDate
    });
    return {
      suggestedStartDate: sync,
      hint: buildSuggestionHint(template)
    };
  }

  const api = {
    REPORT_PERIOD_BASE_DEFINITIONS,
    OFFSET_BASES,
    normalizeDateOnly,
    normalizeReportPeriodBase,
    isStudentScopedReportScope,
    computeSuggestedReportStartDateSync,
    buildSuggestionHint,
    fetchSuggestedReportStartDate,
    resolveSuggestedReportStartDate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    Object.assign(global, api);
  }
}(typeof window !== 'undefined' ? window : global));
