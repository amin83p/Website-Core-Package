(function (global) {
  'use strict';

  const core = global.SessionCalendarCore;
  if (!core) {
    console.error('SessionEnrollmentCalendarModal requires SessionCalendarCore.');
    return;
  }

  const PRESET_LABELS = {
    day: 'Day',
    week: 'Week',
    twoWeeks: '2 Weeks',
    thirtyDays: '30 Days',
    month: 'Month',
    twoMonths: '2 Months',
    threeMonths: '3 Months',
    fourMonths: '4 Months',
    fiveMonths: '5 Months',
    sixMonths: '6 Months',
    wholeCycle: 'Whole Cycle',
    custom: 'Custom'
  };

  let modalEl = null;
  let modalInstance = null;
  let hostEl = null;
  let summaryEl = null;
  let contextLabelEl = null;
  let state = null;
  let allEvents = [];
  let bound = false;
  let hostResizeObserver = null;
  const holidayCacheByYear = {};
  let stageModalEl = null;
  let stageContext = null;
  let stageDurationHours = 1;
  let stageSessionCount = 4;
  let stageWeekdays = new Set();
  let stageModalBound = false;

  function isManageMode() {
    return String(state?.mode || '').trim() === 'manageEnrollmentSessions';
  }

  function isPartialMode() {
    return String(state?.mode || '').trim() === 'partial';
  }

  function isEventNaMarked(ev = {}) {
    if (isManageMode()) {
      return resolveManageNaState(ev) !== 'normal';
    }
    const attendance = String(ev?.attendance || '').trim().toLowerCase();
    return Boolean(ev?.marked) || attendance === 'not_applicable';
  }

  function resolveManageNaState(ev = {}) {
    return core.resolveEnrollmentNaState(ev, state?.pendingMarkChanges);
  }

  function hasPendingMarkChanges() {
    return Boolean(state?.pendingMarkChanges?.size);
  }

  function syncEventNaFromPending(sessionId) {
    const id = String(sessionId || '').trim();
    const ev = allEvents.find((row) => String(row?.sessionId || '').trim() === id);
    if (!ev) return;
    const naState = resolveManageNaState(ev);
    ev.marked = naState !== 'normal';
    ev.pendingNa = naState === 'pending';
  }

  function hasPendingUnmarkOnly() {
    if (!state?.pendingMarkChanges?.size) return false;
    for (const change of state.pendingMarkChanges.values()) {
      if (String(change?.action || '').toLowerCase() !== 'unmark') return false;
    }
    return true;
  }

  function canSavePendingMarks() {
    const pendingCount = state?.pendingMarkChanges?.size || 0;
    if (!pendingCount) return false;
    const balance = getManageCapBalance();
    if (!balance.enforced) return true;
    if (hasPendingUnmarkOnly() && balance.requiredNaCount === 0 && balance.enforcedSessions) {
      return true;
    }
    if (hasPendingUnmarkOnly() && balance.requiredNaHours <= 0 && balance.enforcedHours) {
      return true;
    }
    if (balance.balanced) return true;
    // Hour targets only require enough N/A hours (not an exact session count).
    if (balance.enforcedHours
      && balance.requiredNaHours > 0
      && balance.naHours >= balance.requiredNaHours
      && balance.expectedHours <= balance.targetHours) {
      return true;
    }
    return false;
  }

  function syncDoneButtonLabel() {
    const doneBtn = qs('btn_sessionEnrollmentCalendarDone');
    if (!doneBtn || !isManageMode()) return;
    if (state?.markSaveInFlight) {
      doneBtn.disabled = true;
      doneBtn.textContent = 'Saving...';
      return;
    }
    const pendingCount = state?.pendingMarkChanges?.size || 0;
    if (pendingCount > 0) {
      const canSave = canSavePendingMarks();
      doneBtn.disabled = !canSave;
      doneBtn.textContent = `Save changes (${pendingCount})`;
      const balance = getManageCapBalance();
      doneBtn.title = doneBtn.disabled && balance.message ? balance.message : '';
      return;
    }
    doneBtn.disabled = false;
    doneBtn.textContent = 'Close';
    doneBtn.title = '';
  }

  function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function getEffectiveNaSessionIds(overrideAction = null, overrideSessionId = '', pendingMap = null) {
    const baseMap = pendingMap || state?.pendingMarkChanges;
    const ids = core.getEffectiveNaSessionIdsFromPending(allEvents, baseMap);
    const targetId = String(overrideSessionId || '').trim();
    if (targetId && overrideAction === 'unmark') ids.delete(targetId);
    if (targetId && overrideAction === 'mark_na') ids.add(targetId);
    return ids;
  }

  function getManageCapBalance(overrideAction = null, overrideSessionId = '', pendingMap = null) {
    let previewMap = pendingMap;
    if (!previewMap && overrideAction && overrideSessionId) {
      previewMap = core.clonePendingMap(state?.pendingMarkChanges);
      const targetId = String(overrideSessionId || '').trim();
      if (overrideAction === 'unmark') {
        const ev = allEvents.find((row) => String(row?.sessionId || '').trim() === targetId);
        if (ev?.savedMarked || ev?.savedRosterNa) {
          previewMap.set(targetId, { action: 'unmark', note: '' });
        } else {
          previewMap.delete(targetId);
        }
      } else if (overrideAction === 'mark_na') {
        previewMap.set(targetId, { action: 'mark_na', note: '' });
      }
    }
    return core.getEnrollmentCapBalance(
      allEvents,
      previewMap || state?.pendingMarkChanges,
      state?.targetSessionCount,
      state?.targetHours
    );
  }

  function formatCapSummaryAmount(value, unit) {
    const amount = unit === 'Hrs'
      ? `${roundHours(value)} Hrs`
      : `${Math.max(0, Math.floor(Number(value) || 0))} Sessions`;
    return amount;
  }

  function buildManageCapSummaryTable(balance) {
    const targetValue = balance.enforcedHours
      ? formatCapSummaryAmount(balance.targetHours, 'Hrs')
      : formatCapSummaryAmount(balance.targetSessions, 'Sessions');
    const expectedValue = balance.enforcedHours
      ? formatCapSummaryAmount(balance.expectedHours, 'Hrs')
      : formatCapSummaryAmount(balance.expectedCount, 'Sessions');
    const capClass = balance.balanced ? 'is-ok' : 'is-warn';
    const bulkUnmarkRow = balance.requiredNaCount === 0 && balance.naCount > 0
      ? `<tr><td colspan="3" class="pt-2 pb-0">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btn_stageAllEnrollmentNaUnmarks">
            Stage unmark for all ${balance.naCount} N/A session(s)
          </button>
        </td></tr>`
      : '';
    return ''
      + '<table class="session-enrollment-cap-summary-table table table-sm table-borderless mb-0">'
      +   '<tbody><tr>'
      +     `<td><span class="ses-sum-k">Target:</span> <strong class="ses-sum-v">${core.escapeHtml(targetValue)}</strong></td>`
      +     `<td><span class="ses-sum-k">Expected (Selected):</span> <strong class="ses-sum-v">${core.escapeHtml(expectedValue)}</strong></td>`
      +     `<td><span class="ses-sum-k">Cap:</span> <strong class="ses-sum-v ${capClass}">${core.escapeHtml(balance.needLabel)}</strong></td>`
      +   '</tr>'
      +   bulkUnmarkRow
      +   '</tbody>'
      + '</table>';
  }

  function stageAllSavedNaUnmarks() {
    if (!state) return;
    if (!state.pendingMarkChanges) state.pendingMarkChanges = new Map();
    (Array.isArray(allEvents) ? allEvents : []).forEach((ev) => {
      if (!ev?.savedMarked && !ev?.savedRosterNa) return;
      const sessionId = String(ev?.sessionId || '').trim();
      if (!sessionId) return;
      state.pendingMarkChanges.set(sessionId, { action: 'unmark', note: '' });
      syncEventNaFromPending(sessionId);
    });
    const scrollSnapshot = captureScrollPositions();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateManageSummary();
  }

  function updateManageSummary() {
    summaryEl = qs('sessionEnrollmentCalendarSummary');
    if (!summaryEl || !state) return;
    const balance = getManageCapBalance();
    if (!balance.enforced) {
      summaryEl.classList.add('d-none');
      summaryEl.innerHTML = '';
      syncDoneButtonLabel();
      return;
    }
    summaryEl.classList.remove('is-plain', 'd-none');
    summaryEl.innerHTML = buildManageCapSummaryTable(balance);
    syncDoneButtonLabel();
  }

  function resolveEnrollmentWindowBounds() {
    const minDate = core.normalizeDateOnly(state?.startDate || '');
    let maxDate = core.normalizeDateOnly(state?.endDate || '');
    if (!maxDate) {
      maxDate = core.normalizeDateOnly(state?.cycleEndDate || '');
    }
    if (!maxDate && Array.isArray(allEvents) && allEvents.length) {
      const dates = allEvents
        .map((row) => core.normalizeDateOnly(row?.date))
        .filter(Boolean)
        .sort();
      maxDate = dates[dates.length - 1] || '';
    }
    if (!maxDate) {
      maxDate = core.parseAnchorDate('');
    }
    return { minDate, maxDate };
  }

  function applyViewRange(nextRange = {}) {
    if (!state) return;
    const bounds = resolveEnrollmentWindowBounds();
    const range = core.clampViewRangeToBounds(nextRange, bounds);
    state.viewRange = range;
    state.viewPreset = String(range.preset || state.viewPreset || 'week').trim();
    state.anchorDate = range.anchorDate || range.startDate;
    syncPresetButtons();
  }

  function computePresetViewRange(preset) {
    const key = String(preset || 'week').trim();
    const bounds = resolveEnrollmentWindowBounds();
    const anchor = core.clampAnchorDate(
      state?.anchorDate || state?.viewRange?.anchorDate || bounds.minDate || state?.startDate,
      bounds.minDate
    );
    if (key === 'wholeCycle') {
      return core.computeWholeCycleViewRange({
        startDate: bounds.minDate || anchor,
        endDate: bounds.maxDate || anchor
      });
    }
    const monthPresets = new Set(['month', 'twoMonths', 'threeMonths', 'fourMonths', 'fiveMonths', 'sixMonths']);
    const rangeAnchor = monthPresets.has(key) ? (bounds.minDate || anchor) : anchor;
    return core.computeViewRange(key, rangeAnchor);
  }

  function initDefaultViewRange() {
    if (!state) return;
    const bounds = resolveEnrollmentWindowBounds();
    const rangeStart = bounds.minDate || core.parseAnchorDate('');
    let rangeEnd = core.addDaysIso(rangeStart, 30);
    if (bounds.maxDate && bounds.maxDate < rangeEnd) rangeEnd = bounds.maxDate;
    state.viewPreset = 'thirtyDays';
    state.anchorDate = rangeStart;
    state.viewRange = core.clampViewRangeToBounds({
      startDate: rangeStart,
      endDate: rangeEnd,
      preset: 'thirtyDays',
      anchorDate: rangeStart
    }, bounds);
  }

  const initManageModeViewRange = initDefaultViewRange;

  function initPartialModeViewRange() {
    if (!state) return;
    const startDate = core.normalizeDateOnly(state.startDate || '');
    const endDate = core.normalizeDateOnly(state.endDate || startDate);
    state.viewPreset = 'custom';
    state.anchorDate = startDate;
    state.viewRange = {
      startDate,
      endDate,
      preset: 'custom',
      anchorDate: startDate
    };
  }

  function syncModalChromeForMode() {
    const titleEl = qs('sessionEnrollmentCalendarModalTitle');
    const hintEl = qs('sessionEnrollmentCalendarHint');
    const clearBtn = qs('btn_sessionEnrollmentCalendarClear');
    const saveBtn = qs('btn_sessionEnrollmentCalendarSave');
    const doneBtn = qs('btn_sessionEnrollmentCalendarDone');
    const bulkNaBtn = qs('btn_sessionEnrollmentBulkNa');
    const presetGroup = qs('sessionEnrollmentCalendarPresetGroup');
    const dialogEl = modalEl?.querySelector('.modal-dialog') || qs('sessionEnrollmentCalendarModal')?.querySelector('.modal-dialog');
    const manage = isManageMode();
    const partial = isPartialMode();
    if (titleEl) {
      titleEl.textContent = manage
        ? 'Manage enrollment sessions'
        : (partial ? 'Review staged sessions' : 'Select sessions');
    }
    if (hintEl) {
      hintEl.classList.toggle('d-none', false);
      hintEl.textContent = manage
        ? 'Click sessions to stage N/A mark or unmark changes, then click Save changes.'
        : (partial
          ? 'Click empty grid space to stage sessions; adjust staged sessions, then click Apply to schedule.'
          : 'Click empty grid space to stage sessions; click sessions to include or exclude.');
    }
    if (saveBtn) saveBtn.textContent = partial ? 'Apply to schedule' : 'Save selection';
    clearBtn?.classList.toggle('d-none', manage);
    saveBtn?.classList.toggle('d-none', manage);
    doneBtn?.classList.toggle('d-none', !manage);
    bulkNaBtn?.classList.toggle('d-none', !manage);
    presetGroup?.classList.toggle('d-none', partial);
    if (dialogEl) {
      dialogEl.classList.toggle('session-enrollment-calendar-dialog--manage', manage);
      dialogEl.classList.toggle('session-enrollment-calendar-dialog--partial', partial);
    }
    syncDoneButtonLabel();
    syncPresetButtons();
    renderSessionsLegendForMode();
  }

  function renderSessionsLegendForMode() {
    if (isManageMode()) {
      renderEnrollmentSessionsLegend();
      return;
    }
    if (isPartialMode()) {
      renderPartialSessionsLegend();
      return;
    }
    renderPickerSessionsLegend();
  }

  function renderPartialSessionsLegend() {
    const modalBody = qs('sessionEnrollmentCalendarLegendModalBody');
    if (!modalBody) return;
    modalBody.innerHTML = ''
      + '<div class="session-enrollment-legend-items">'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-attendance" aria-hidden="true"></span><span>Staged session (draft)</span></div>'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-open" aria-hidden="true"></span><span>Existing class session</span></div>'
      +   '<div class="session-enrollment-legend-item session-enrollment-legend-hint text-muted"><i class="bi bi-mouse2" aria-hidden="true"></i><span>Click empty grid space to add more staged sessions</span></div>'
      + '</div>';
  }

  function renderPickerSessionsLegend() {
    const modalBody = qs('sessionEnrollmentCalendarLegendModalBody');
    if (!modalBody) return;
    modalBody.innerHTML = ''
      + '<div class="session-enrollment-legend-items">'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-open" aria-hidden="true"></span><span>Available session (not selected)</span></div>'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-attendance" aria-hidden="true"></span><span>Selected session</span></div>'
      +   '<div class="session-enrollment-legend-item session-enrollment-legend-hint text-muted"><i class="bi bi-hand-index-thumb" aria-hidden="true"></i><span>Click a session to include or exclude it</span></div>'
      +   '<div class="session-enrollment-legend-item session-enrollment-legend-hint text-muted"><i class="bi bi-mouse2" aria-hidden="true"></i><span>Right-click for bulk select by time window</span></div>'
      + '</div>';
  }

  function renderEnrollmentSessionsLegend() {
    const modalBody = qs('sessionEnrollmentCalendarLegendModalBody');
    if (!modalBody) return;
    modalBody.innerHTML = ''
      + '<div class="session-enrollment-legend-items">'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-open" aria-hidden="true"></span><span>Open session (no attendance yet)</span></div>'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-attendance" aria-hidden="true"></span><span>Attendance recorded</span></div>'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-na-saved" aria-hidden="true"></span><span>Saved enrollment N/A (excluded)</span></div>'
      +   '<div class="session-enrollment-legend-item"><span class="session-enrollment-legend-swatch is-na-pending" aria-hidden="true"></span><span>Pending N/A (not saved yet)</span></div>'
      +   '<div class="session-enrollment-legend-item session-enrollment-legend-hint text-muted"><i class="bi bi-hand-index-thumb" aria-hidden="true"></i><span>Click a session to mark or unmark N/A</span></div>'
      + '</div>';
  }

  function openEnrollmentSessionsLegendModal() {
    const legendModalEl = qs('sessionEnrollmentCalendarLegendModal');
    if (!legendModalEl || !global.bootstrap?.Modal) return;
    renderSessionsLegendForMode();
    global.bootstrap.Modal.getOrCreateInstance(legendModalEl).show();
  }

  function syncStudentBanner(options = {}) {
    const banner = qs('sessionEnrollmentCalendarStudentBanner');
    const nameEl = qs('sessionEnrollmentCalendarStudentName');
    const metaEl = qs('sessionEnrollmentCalendarStudentMeta');
    const contextEl = qs('sessionEnrollmentCalendarContext');
    const student = String(options.studentLabel || options.studentName || options.studentId || '').trim();
    const classLabel = String(options.classLabel || options.classId || '').trim();
    const windowStart = String(options.startDate || '').trim();
    const windowEnd = String(options.endDate || '').trim();

    if (contextEl) {
      contextEl.classList.add('d-none');
      contextEl.setAttribute('aria-hidden', 'true');
      contextEl.textContent = '';
    }
    if (!banner || !nameEl || !metaEl) return;

    const hasBannerContent = Boolean(student || classLabel || windowStart || windowEnd);
    banner.classList.toggle('d-none', !hasBannerContent);
    if (!hasBannerContent) {
      nameEl.textContent = '';
      metaEl.textContent = '';
      return;
    }

    nameEl.textContent = student || 'Student';
    const metaParts = [];
    if (classLabel) metaParts.push(classLabel);
    if (windowStart || windowEnd) {
      metaParts.push(`Enrollment window: ${windowStart || '—'} → ${windowEnd || 'Open'}`);
    }
    metaEl.textContent = metaParts.join(' · ');
  }

  function mapSessionWindowRowToEvent(row = {}) {
    const sessionId = String(row?.sessionId || '').trim();
    const date = core.normalizeDateOnly(row?.date);
    const start = String(row?.startTime || '').trim();
    const end = String(row?.endTime || '').trim();
    const startMin = core.timeToMinutes(start);
    const endMin = core.timeToMinutes(end);
    const durationHours = Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin
      ? Math.round(((endMin - startMin) / 60) * 100) / 100
      : 0;
    const attendance = String(row?.attendance || '').trim();
    const savedMarked = Boolean(row?.mark);
    const savedRosterNa = !savedMarked && attendance.toLowerCase() === 'not_applicable';
    const marked = savedMarked || savedRosterNa;
    return {
      sessionId,
      classId: state?.classId || '',
      date,
      start,
      end,
      durationHours,
      teacherName: 'Session',
      manageable: false,
      manageSessionUrl: '',
      selectable: true,
      excludeReason: '',
      isStaged: false,
      selected: false,
      attendance,
      savedMarked,
      savedRosterNa,
      marked,
      pendingNa: false,
      locked: Boolean(row?.mark?.locked),
      markNote: String(row?.mark?.note || '').trim(),
      enrollmentManageMode: true
    };
  }

  function applySessionWindowData(data = {}, options = {}) {
    const preserveViewRange = options.preserveViewRange === true;
    const skipScroll = options.skipScroll === true;
    if (state) {
      state.pendingMarkChanges = new Map();
      state.sessionWindowLoaded = true;
    }
    manageSummaryMeta = {
      startDate: String(data?.startDate || state?.startDate || '').trim(),
      endDate: String(data?.endDate || state?.endDate || '').trim(),
      cycleAttendanceSummary: data?.cycleAttendanceSummary || null
    };
    if (data?.startDate) state.startDate = String(data.startDate).trim();
    if (data?.endDate !== undefined) state.endDate = String(data.endDate || '').trim();
    if (data?.targetSessionCount !== undefined) {
      state.targetSessionCount = Number(data.targetSessionCount) || 0;
    }
    if (data?.targetHours !== undefined) {
      state.targetHours = Number(data.targetHours) || 0;
    }
    syncStudentBanner({
      mode: state.mode,
      studentLabel: state.studentLabel,
      studentId: state.studentId,
      classLabel: state.classLabel,
      classId: state.classId,
      startDate: state.startDate,
      endDate: state.endDate
    });
    allEvents = (Array.isArray(data?.sessions) ? data.sessions : [])
      .map((row) => mapSessionWindowRowToEvent(row))
      .filter((row) => row.sessionId && row.date);

    if (!preserveViewRange) {
      initManageModeViewRange();
    }
    syncPresetButtons();
    syncViewModeButtons();
    renderCalendar();
    updateManageSummary();
    if (!skipScroll) {
      scrollToFirstNaInView();
    }
  }

  function scrollToFirstNaInView() {
    const naEvent = getVisibleEvents().find(isEventNaMarked) || allEvents.find(isEventNaMarked);
    if (!naEvent?.date) return;
    requestAnimationFrame(() => {
      scrollHostToStagedDate(naEvent.date);
    });
  }

  async function fetchSessionWindowData({ reload = false } = {}) {
    if (!state?.periodId) throw new Error('periodId is required for manage enrollment sessions.');
    if (!reload && state.sessionWindowLoaded && isManageMode()) {
      await refreshPickerViewLocally();
      return;
    }
    await ensureHolidaysLoaded();
    const requestJson = state.requestJson || defaultRequestJson;
    let url = `/school/classes/api/enrollment-periods/${encodeURIComponent(state.periodId)}/session-window`;
    if (reload) {
      url += `${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
    }
    const scrollSnapshot = captureScrollPositions();
    const result = await requestJson(url, 'GET');
    const preserveUi = reload && state?.sessionWindowLoaded;
    applySessionWindowData(result?.data || {}, {
      preserveViewRange: preserveUi,
      skipScroll: preserveUi
    });
    restoreScrollPositions(scrollSnapshot);
  }

  function formatManageAttendanceLabel(raw = '') {
    const key = String(raw || '').trim().toLowerCase();
    const labels = {
      present: 'Present',
      late: 'Late',
      absent: 'Absent',
      acf: 'ACF',
      not_applicable: 'N/A',
      excused: 'Excused'
    };
    return labels[key] || String(raw || '').trim();
  }

  function buildManageSessionTimeLabel(ev = {}) {
    const start = String(ev?.start || '').trim();
    const end = String(ev?.end || '').trim();
    if (start && end && typeof core.formatClockTimeRange === 'function') {
      return core.formatClockTimeRange(start, end);
    }
    return [start, end].filter(Boolean).join(' – ') || String(ev?.date || '');
  }

  function buildManageSessionMetaLine(ev = {}, naState = 'normal') {
    const parts = [];
    const attendance = formatManageAttendanceLabel(ev?.attendance);
    if (naState === 'normal' && attendance) parts.push(attendance);
    parts.push(core.formatHours(ev?.durationHours));
    return parts.join(' · ');
  }

  function buildManageNaHeadHtml(naState) {
    if (naState === 'pending') {
      return '<div class="session-manage-na-head is-pending" style="color:#997404;font-weight:800;font-size:0.68rem;line-height:1.1;">N/A · pending</div>';
    }
    if (naState === 'saved') {
      return '<div class="session-manage-na-head is-saved" style="color:#b02a37;font-weight:800;font-size:0.68rem;line-height:1.1;">N/A</div>';
    }
    return '';
  }

  function buildManageBlockInlineStyle(naState, attendance = '') {
    const att = String(attendance || '').trim().toLowerCase();
    const base = 'box-sizing:border-box;border-radius:4px;';
    if (naState === 'saved') {
      return `${base}border:2px solid #f1aeb5;background-color:#fde8ea;`;
    }
    if (naState === 'pending') {
      return `${base}border:2px dashed #ffda6a;background-color:#fff8e1;`;
    }
    if (att && att !== 'not_applicable') {
      return `${base}border:2px solid #a3cfbb;background-color:#e8f5ee;`;
    }
    return `${base}border:2px solid #9ec5fe;background-color:#f0f6ff;`;
  }

  function buildManageEnrollmentBlockHtml(ev) {
    const sessionId = String(ev?.sessionId || '').trim();
    const naState = resolveManageNaState(ev);
    const attendance = String(ev?.attendance || '').trim().toLowerCase();
    const isOpenSession = naState === 'normal' && !attendance;
    const hasAttendance = naState === 'normal' && attendance && attendance !== 'not_applicable';
    const classes = [
      'session-enrollment-block',
      'session-manage-block',
      naState === 'saved' ? 'is-na-saved' : '',
      naState === 'pending' ? 'is-na-pending' : '',
      hasAttendance ? 'has-attendance' : '',
      isOpenSession ? 'is-scheduled-open' : ''
    ].filter(Boolean).join(' ');
    const inlineStyle = buildManageBlockInlineStyle(naState, attendance);
    const timeLabel = buildManageSessionTimeLabel(ev);
    const metaLabel = buildManageSessionMetaLine(ev, naState);
    return `
      <div class="${classes}"
           style="${inlineStyle}"
           data-session-id="${core.escapeHtml(sessionId)}"
           data-selectable="1"
           data-session-kind="scheduled"
           data-na-marked="${naState !== 'normal' ? '1' : '0'}"
           data-na-state="${core.escapeHtml(naState)}"
           role="button"
           aria-selected="false"
           tabindex="0">
        ${buildManageNaHeadHtml(naState)}
        <div class="session-block-time" style="font-weight:600;font-size:0.72rem;line-height:1.2;font-variant-numeric:tabular-nums;">${core.escapeHtml(timeLabel)}</div>
        <div class="session-block-meta" style="font-size:0.64rem;color:#5c636a;line-height:1.2;">${core.escapeHtml(metaLabel)}</div>
      </div>
    `;
  }

  function buildManageListChipHtml(naState, attendance = '') {
    if (naState === 'saved') return '<span class="session-manage-chip is-na-saved">N/A</span>';
    if (naState === 'pending') return '<span class="session-manage-chip is-na-pending">N/A · pending</span>';
    const attendanceLabel = formatManageAttendanceLabel(attendance);
    if (attendanceLabel) {
      return `<span class="session-manage-chip has-attendance">${core.escapeHtml(attendanceLabel)}</span>`;
    }
    return '';
  }

  function buildManageListDayCardHtml(ev) {
    const sessionId = String(ev?.sessionId || '').trim();
    const naState = resolveManageNaState(ev);
    const attendance = String(ev?.attendance || '').trim();
    const isOpenSession = naState === 'normal' && !String(attendance || '').trim();
    const hasAttendance = naState === 'normal' && attendance && attendance.toLowerCase() !== 'not_applicable';
    const classes = [
      'session-day-card',
      'session-manage-card',
      naState === 'saved' ? 'is-na-saved' : '',
      naState === 'pending' ? 'is-na-pending' : '',
      hasAttendance ? 'has-attendance' : '',
      isOpenSession ? 'is-scheduled-open' : ''
    ].filter(Boolean).join(' ');
    const timeLabel = buildManageSessionTimeLabel(ev);
    const metaLabel = buildManageSessionMetaLine(ev, naState);
    const chipHtml = buildManageListChipHtml(naState, attendance);
    const inlineStyle = buildManageBlockInlineStyle(naState, attendance);
    return `
      <div class="${classes}" style="${inlineStyle}" data-session-id="${core.escapeHtml(sessionId)}" data-selectable="1" data-session-kind="scheduled" data-na-marked="${naState !== 'normal' ? '1' : '0'}" data-na-state="${core.escapeHtml(naState)}" role="button" aria-selected="false">
        <div class="flex-grow-1">
          <div class="d-flex align-items-center gap-2 mb-1">
            ${chipHtml}
            <div class="fw-semibold session-manage-list-time">${core.escapeHtml(timeLabel)}</div>
          </div>
          <div class="small text-muted">${core.escapeHtml(metaLabel)}</div>
        </div>
      </div>
    `;
  }

  function resolveMarkOverlayEl() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    return calendarModal?.querySelector('#sessionEnrollmentMarkModal')
      || qs('sessionEnrollmentMarkModal');
  }

  function hideMarkModalLayer() {
    markModalEl = resolveMarkOverlayEl();
    if (!markModalEl) {
      setStageOverlayLock(false);
      markContext = null;
      return;
    }
    markModalEl.classList.add('d-none');
    markModalEl.classList.remove('show');
    markModalEl.style.display = 'none';
    markModalEl.setAttribute('aria-hidden', 'true');
    setStageOverlayLock(false);
    markContext = null;
  }

  function showMarkModalLayer() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    markModalEl = resolveMarkOverlayEl();
    if (!markModalEl) return;
    const dialog = calendarModal?.querySelector('.modal-dialog');
    if (dialog && markModalEl.parentElement !== dialog) {
      dialog.appendChild(markModalEl);
    }
    markModalEl.classList.remove('d-none');
    markModalEl.classList.add('show');
    markModalEl.style.display = 'flex';
    markModalEl.setAttribute('aria-hidden', 'false');
    setStageOverlayLock(true);
    const focusTarget = markModalEl.querySelector('#sessionEnrollmentMarkNote, #btn_sessionEnrollmentMarkUnmark');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function showMarkFormError(message) {
    const errorEl = qs('sessionEnrollmentMarkError');
    if (!errorEl) return;
    errorEl.textContent = String(message || '').trim();
    errorEl.classList.toggle('d-none', !errorEl.textContent);
  }

  function openMarkModalForEvent(ev) {
    if (!ev || !state) return;
    markContext = ev;
    bindMarkModalEvents();
    const naState = resolveManageNaState(ev);
    const naMarked = naState !== 'normal';
    const sessionId = String(ev.sessionId || '').trim();
    const pending = state.pendingMarkChanges?.get(sessionId);
    const contextEl = qs('sessionEnrollmentMarkContext');
    const attendanceEl = qs('sessionEnrollmentMarkAttendance');
    const statusEl = qs('sessionEnrollmentMarkStatus');
    const noteWrap = qs('sessionEnrollmentMarkNoteWrap');
    const noteInput = qs('sessionEnrollmentMarkNote');
    const unmarkBtn = qs('btn_sessionEnrollmentMarkUnmark');
    const applyBtn = qs('btn_sessionEnrollmentMarkApply');
    const dateLabel = core.formatDayHeaderLong(ev.date);
    const timeLabel = buildManageSessionTimeLabel(ev);
    if (contextEl) contextEl.textContent = `${dateLabel} · ${timeLabel}`;
    if (attendanceEl) {
      const attendanceLabel = formatManageAttendanceLabel(ev.attendance);
      attendanceEl.textContent = attendanceLabel
        ? `Attendance: ${attendanceLabel}`
        : 'Attendance: not recorded';
    }
    if (statusEl) {
      if (naState === 'pending') {
        const pendingNote = String(pending?.note || '').trim();
        statusEl.innerHTML = `<span class="badge bg-warning text-dark">N/A · pending</span>${pendingNote ? ` <span class="text-muted">${core.escapeHtml(pendingNote)}</span>` : ''}`;
      } else if (naState === 'saved') {
        statusEl.innerHTML = `<span class="badge text-bg-danger">N/A</span>${ev.markNote ? ` <span class="text-muted">${core.escapeHtml(ev.markNote)}</span>` : ''}`;
      } else {
        statusEl.innerHTML = '<span class="text-muted">Open session</span>';
      }
    }
    if (noteInput) noteInput.value = naState === 'pending' ? String(pending?.note || '').trim() : '';
    if (noteWrap) noteWrap.classList.toggle('d-none', naMarked);
    if (unmarkBtn) unmarkBtn.classList.toggle('d-none', !naMarked);
    if (applyBtn) applyBtn.classList.toggle('d-none', naMarked);
    showMarkFormError('');
    showMarkModalLayer();
  }

  function applyPendingSessionMark(action, note = '') {
    if (!markContext || !state) return;
    const sessionId = String(markContext.sessionId || '').trim();
    if (!sessionId) return;
    if (!state.pendingMarkChanges) state.pendingMarkChanges = new Map();
    const ev = allEvents.find((row) => String(row?.sessionId || '').trim() === sessionId);
    if (action === 'unmark') {
      const preview = getManageCapBalance('unmark', sessionId);
      if (preview.enforcedSessions && preview.expectedCount > preview.targetSessions) {
        showMarkFormError(preview.message || 'Unmarking would exceed the enrollment session target.');
        return;
      }
      if (preview.enforcedHours && preview.expectedHours > preview.targetHours) {
        showMarkFormError(preview.message || 'Unmarking would exceed the enrollment hour target.');
        return;
      }
      if (ev?.savedMarked || ev?.savedRosterNa) {
        state.pendingMarkChanges.set(sessionId, { action: 'unmark', note: '' });
      } else {
        state.pendingMarkChanges.delete(sessionId);
      }
    } else {
      const normalizedNote = String(note || '').trim();
      if (!normalizedNote) {
        showMarkFormError('Enter a note explaining why this session is N/A.');
        return;
      }
      state.pendingMarkChanges.set(sessionId, { action: 'mark_na', note: normalizedNote });
    }
    syncEventNaFromPending(sessionId);
    hideMarkModalLayer();
    const scrollSnapshot = captureScrollPositions();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateManageSummary();
    syncDoneButtonLabel();
  }

  function formatManageSaveError(message = '') {
    const text = String(message || '').trim();
    if (/no n\/a session selection is required/i.test(text)) {
      return 'No N/A sessions are required for this enrollment. Unmark all remaining N/A sessions, then save together.';
    }
    return text || 'Unable to update enrollment session marks.';
  }

  async function flushPendingMarks() {
    if (!state?.periodId || !hasPendingMarkChanges()) return null;
    const changes = [];
    state.pendingMarkChanges.forEach((change, sessionId) => {
      changes.push({
        sessionId: String(sessionId || '').trim(),
        action: change.action,
        note: String(change?.note || '').trim()
      });
    });
    const requestJson = state.requestJson || defaultRequestJson;
    const result = await requestJson(
      `/school/classes/api/enrollment-periods/${encodeURIComponent(state.periodId)}/session-marks`,
      'POST',
      { changes }
    );
    if (!result || String(result?.status || '').toLowerCase() === 'error') {
      throw new Error(formatManageSaveError(result?.message));
    }
    state.pendingMarkChanges.clear();
    return result;
  }

  function bindMarkModalEvents() {
    if (markModalBound) return;
    markModalBound = true;
    bindStackEscapeHandler();
    markModalEl = resolveMarkOverlayEl();

    markModalEl?.addEventListener('click', (event) => {
      if (event.target.closest('#btn_sessionEnrollmentMarkApply')) {
        event.preventDefault();
        const note = String(qs('sessionEnrollmentMarkNote')?.value || '').trim();
        if (!note) {
          showMarkFormError('Enter a note explaining why this session is N/A.');
          return;
        }
        applyPendingSessionMark('mark_na', note);
        return;
      }
      if (event.target.closest('#btn_sessionEnrollmentMarkUnmark')) {
        event.preventDefault();
        applyPendingSessionMark('unmark', '');
        return;
      }
      if (event.target.closest('[data-mark-dismiss]')) {
        hideMarkModalLayer();
      }
    });
  }

  function resolveBulkNaOverlayEl() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    return calendarModal?.querySelector('#sessionEnrollmentBulkNaModal')
      || qs('sessionEnrollmentBulkNaModal');
  }

  function isBulkNaOverlayOpen() {
    const el = resolveBulkNaOverlayEl();
    return Boolean(el && el.classList.contains('show') && !el.classList.contains('d-none'));
  }

  function hideBulkNaModalLayer() {
    bulkNaModalEl = resolveBulkNaOverlayEl();
    if (!bulkNaModalEl) {
      setStageOverlayLock(false);
      return;
    }
    bulkNaModalEl.classList.add('d-none');
    bulkNaModalEl.classList.remove('show');
    bulkNaModalEl.style.display = 'none';
    bulkNaModalEl.setAttribute('aria-hidden', 'true');
    setStageOverlayLock(false);
  }

  function showBulkNaModalLayer() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    bulkNaModalEl = resolveBulkNaOverlayEl();
    if (!bulkNaModalEl) return;
    const dialog = calendarModal?.querySelector('.modal-dialog');
    if (dialog && bulkNaModalEl.parentElement !== dialog) {
      dialog.appendChild(bulkNaModalEl);
    }
    bulkNaModalEl.classList.remove('d-none');
    bulkNaModalEl.classList.add('show');
    bulkNaModalEl.style.display = 'flex';
    bulkNaModalEl.setAttribute('aria-hidden', 'false');
    setStageOverlayLock(true);
    const focusTarget = bulkNaModalEl.querySelector('#sessionEnrollmentBulkNaStart, #sessionEnrollmentBulkNaNote');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function showBulkNaFormError(message) {
    const errorEl = qs('sessionEnrollmentBulkNaError');
    if (!errorEl) return;
    errorEl.textContent = String(message || '').trim();
    errorEl.classList.toggle('d-none', !errorEl.textContent);
  }

  function readBulkNaAction() {
    const fromState = String(bulkNaAction || '').trim().toLowerCase();
    if (fromState === 'unmark' || fromState === 'mark_na') return fromState;
    const scope = bulkNaModalEl || qs('sessionEnrollmentBulkNaModal');
    const active = scope?.querySelector('[data-bulk-na-action].active');
    const action = String(active?.getAttribute('data-bulk-na-action') || 'mark_na').trim().toLowerCase();
    return action === 'unmark' ? 'unmark' : 'mark_na';
  }

  function syncBulkNaActionButtons(forcedAction = '') {
    const raw = String(forcedAction || bulkNaAction || readBulkNaAction() || 'mark_na').trim().toLowerCase();
    const action = raw === 'unmark' ? 'unmark' : 'mark_na';
    bulkNaAction = action;
    const scope = bulkNaModalEl || qs('sessionEnrollmentBulkNaModal');
    (scope ? scope.querySelectorAll('[data-bulk-na-action]') : document.querySelectorAll('[data-bulk-na-action]')).forEach((btn) => {
      const btnAction = String(btn.getAttribute('data-bulk-na-action') || '').trim().toLowerCase();
      btn.classList.toggle('active', btnAction === action);
    });
    const noteWrap = qs('sessionEnrollmentBulkNaNoteWrap');
    noteWrap?.classList.toggle('d-none', action === 'unmark');
  }

  function applyBulkNaInputBounds() {
    const bounds = resolveEnrollmentWindowBounds();
    const startInput = qs('sessionEnrollmentBulkNaStart');
    const endInput = qs('sessionEnrollmentBulkNaEnd');
    if (startInput && bounds.minDate) {
      startInput.min = bounds.minDate;
      startInput.max = bounds.maxDate || '';
    }
    if (endInput && bounds.minDate) {
      endInput.min = bounds.minDate;
      endInput.max = bounds.maxDate || '';
    }
  }

  function readBulkNaDateValues() {
    const bounds = resolveEnrollmentWindowBounds();
    let start = core.normalizeDateOnly(qs('sessionEnrollmentBulkNaStart')?.value);
    let end = core.normalizeDateOnly(qs('sessionEnrollmentBulkNaEnd')?.value);
    if (bounds.minDate && start && start < bounds.minDate) start = bounds.minDate;
    if (bounds.maxDate && start && start > bounds.maxDate) start = bounds.maxDate;
    if (bounds.minDate && end && end < bounds.minDate) end = bounds.minDate;
    if (bounds.maxDate && end && end > bounds.maxDate) end = bounds.maxDate;
    return { startDate: start, endDate: end };
  }

  function clampBulkNaDateInputs() {
    applyBulkNaInputBounds();
    const startInput = qs('sessionEnrollmentBulkNaStart');
    const endInput = qs('sessionEnrollmentBulkNaEnd');
    let { startDate: start, endDate: end } = readBulkNaDateValues();
    if (start && end && start > end) {
      end = start;
    }
    if (startInput && start) startInput.value = start;
    if (endInput && end) endInput.value = end;
    return { startDate: start, endDate: end };
  }

  function collectBulkNaSessionsForForm() {
    const { startDate, endDate } = readBulkNaDateValues();
    const action = readBulkNaAction();
    if (!startDate || !endDate || startDate > endDate) return [];
    return core.collectBulkNaSessions(allEvents, state?.pendingMarkChanges, startDate, endDate, action);
  }

  function buildBulkPendingPreview(sessions, action, note = '') {
    return core.applyBulkPendingChanges(state?.pendingMarkChanges, sessions, action, note);
  }

  function refreshBulkNaPreview() {
    syncBulkNaActionButtons();
    const action = readBulkNaAction();
    const sessions = collectBulkNaSessionsForForm();
    const count = sessions.length;
    const countEl = qs('sessionEnrollmentBulkNaCount');
    const stageBtn = qs('btn_sessionEnrollmentBulkNaStage');
    if (countEl) {
      if (!count) {
        countEl.textContent = action === 'unmark'
          ? 'No N/A sessions in this date range.'
          : 'No open sessions in this date range.';
      } else {
        countEl.textContent = action === 'unmark'
          ? `${count} session(s) will be unmarked from N/A.`
          : `${count} session(s) will be marked N/A.`;
      }
    }
    if (stageBtn) stageBtn.disabled = count === 0;
    showBulkNaFormError('');
  }

  function openBulkNaModal() {
    if (!state || !isManageMode()) return;
    bindBulkNaModalEvents();
    bulkNaAction = 'mark_na';
    const bounds = resolveEnrollmentWindowBounds();
    const defaultStart = core.normalizeDateOnly(state?.viewRange?.startDate || bounds.minDate || state?.startDate);
    const defaultEnd = core.normalizeDateOnly(state?.viewRange?.endDate || bounds.maxDate || state?.endDate || defaultStart);
    const startInput = qs('sessionEnrollmentBulkNaStart');
    const endInput = qs('sessionEnrollmentBulkNaEnd');
    const noteInput = qs('sessionEnrollmentBulkNaNote');
    if (startInput) startInput.value = defaultStart || '';
    if (endInput) endInput.value = defaultEnd || '';
    if (noteInput) noteInput.value = '';
    document.querySelectorAll('[data-bulk-na-action]').forEach((btn) => {
      btn.classList.toggle('active', String(btn.getAttribute('data-bulk-na-action') || '') === 'mark_na');
    });
    applyBulkNaInputBounds();
    clampBulkNaDateInputs();
    refreshBulkNaPreview();
    showBulkNaModalLayer();
  }

  function stageBulkNaChanges() {
    if (!state) return;
    const action = readBulkNaAction();
    const sessions = collectBulkNaSessionsForForm();
    if (!sessions.length) {
      showBulkNaFormError('No sessions match this date range and action.');
      return;
    }
    const note = String(qs('sessionEnrollmentBulkNaNote')?.value || '').trim();
    if (action === 'mark_na' && !note) {
      showBulkNaFormError('Enter a note explaining why these sessions are N/A.');
      return;
    }
    const previewMap = buildBulkPendingPreview(sessions, action, note);
    const preview = getManageCapBalance(null, '', previewMap);
    if (action === 'unmark') {
      if (preview.enforcedSessions && preview.expectedCount > preview.targetSessions) {
        showBulkNaFormError(preview.message || 'Unmarking would exceed the enrollment session target.');
        return;
      }
      if (preview.enforcedHours && preview.expectedHours > preview.targetHours) {
        showBulkNaFormError(preview.message || 'Unmarking would exceed the enrollment hour target.');
        return;
      }
    }
    if (!state.pendingMarkChanges) state.pendingMarkChanges = new Map();
    state.pendingMarkChanges = previewMap;
    allEvents.forEach((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      if (sessionId) syncEventNaFromPending(sessionId);
    });
    hideBulkNaModalLayer();
    const scrollSnapshot = captureScrollPositions();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateManageSummary();
    syncDoneButtonLabel();
  }

  function resolveTimeSlotOverlayEl() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    return calendarModal?.querySelector('#sessionEnrollmentTimeSlotSelectModal')
      || qs('sessionEnrollmentTimeSlotSelectModal');
  }

  function isTimeSlotOverlayOpen() {
    const el = resolveTimeSlotOverlayEl();
    return Boolean(el && el.classList.contains('show') && !el.classList.contains('d-none'));
  }

  function hideTimeSlotModalLayer() {
    timeSlotModalEl = resolveTimeSlotOverlayEl();
    if (!timeSlotModalEl) {
      setStageOverlayLock(false);
      timeSlotContext = null;
      return;
    }
    timeSlotModalEl.classList.add('d-none');
    timeSlotModalEl.classList.remove('show');
    timeSlotModalEl.style.display = 'none';
    timeSlotModalEl.setAttribute('aria-hidden', 'true');
    setStageOverlayLock(false);
    timeSlotContext = null;
  }

  function showTimeSlotModalLayer() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    timeSlotModalEl = resolveTimeSlotOverlayEl();
    if (!timeSlotModalEl) return;
    const dialog = calendarModal?.querySelector('.modal-dialog');
    if (dialog && timeSlotModalEl.parentElement !== dialog) {
      dialog.appendChild(timeSlotModalEl);
    }
    timeSlotModalEl.classList.remove('d-none');
    timeSlotModalEl.classList.add('show');
    timeSlotModalEl.style.display = 'flex';
    timeSlotModalEl.setAttribute('aria-hidden', 'false');
    setStageOverlayLock(true);
    const focusTarget = timeSlotModalEl.querySelector('#sessionEnrollmentTimeSlotStart, #sessionEnrollmentTimeSlotNote');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function showTimeSlotFormError(message) {
    const errorEl = qs('sessionEnrollmentTimeSlotError');
    if (!errorEl) return;
    errorEl.textContent = String(message || '').trim();
    errorEl.classList.toggle('d-none', !errorEl.textContent);
  }

  function readTimeSlotAction() {
    const fromState = String(timeSlotAction || '').trim().toLowerCase();
    if (isManageMode()) {
      if (fromState === 'unmark' || fromState === 'mark_na') return fromState;
      const scope = timeSlotModalEl || qs('sessionEnrollmentTimeSlotSelectModal');
      const active = scope?.querySelector('[data-time-slot-action].active');
      const action = String(active?.getAttribute('data-time-slot-action') || 'mark_na').trim().toLowerCase();
      return action === 'unmark' ? 'unmark' : 'mark_na';
    }
    if (fromState === 'deselect' || fromState === 'select') return fromState;
    const scope = timeSlotModalEl || qs('sessionEnrollmentTimeSlotSelectModal');
    const active = scope?.querySelector('[data-time-slot-action].active');
    const action = String(active?.getAttribute('data-time-slot-action') || 'select').trim().toLowerCase();
    return action === 'deselect' ? 'deselect' : 'select';
  }

  function syncTimeSlotModalChromeForMode() {
    const subtitleEl = qs('sessionEnrollmentTimeSlotSelectModal')?.querySelector('.card-header .small.text-muted');
    const actionGroup = qs('sessionEnrollmentTimeSlotActionGroup');
    const noteWrap = qs('sessionEnrollmentTimeSlotNoteWrap');
    const stageBtn = qs('btn_sessionEnrollmentTimeSlotStage');
    const manage = isManageMode();
    if (subtitleEl) {
      subtitleEl.textContent = manage
        ? 'Stage mark or unmark changes for sessions with the same time window.'
        : 'Select or deselect sessions with the same time window.';
    }
    if (actionGroup) {
      const buttons = actionGroup.querySelectorAll('[data-time-slot-action]');
      if (buttons.length >= 2) {
        if (manage) {
          buttons[0].setAttribute('data-time-slot-action', 'mark_na');
          buttons[0].textContent = 'Mark N/A';
          buttons[1].setAttribute('data-time-slot-action', 'unmark');
          buttons[1].textContent = 'Unmark N/A';
        } else {
          buttons[0].setAttribute('data-time-slot-action', 'select');
          buttons[0].textContent = 'Select';
          buttons[1].setAttribute('data-time-slot-action', 'deselect');
          buttons[1].textContent = 'Deselect';
        }
      }
    }
    noteWrap?.classList.toggle('d-none', !manage || readTimeSlotAction() === 'unmark');
    if (stageBtn) {
      stageBtn.textContent = manage ? 'Stage changes' : 'Apply selection';
    }
  }

  function syncTimeSlotActionButtons(forcedAction = '') {
    const manage = isManageMode();
    const raw = String(forcedAction || timeSlotAction || readTimeSlotAction() || (manage ? 'mark_na' : 'select')).trim().toLowerCase();
    const action = manage
      ? (raw === 'unmark' ? 'unmark' : 'mark_na')
      : (raw === 'deselect' ? 'deselect' : 'select');
    timeSlotAction = action;
    const scope = timeSlotModalEl || qs('sessionEnrollmentTimeSlotSelectModal');
    (scope ? scope.querySelectorAll('[data-time-slot-action]') : document.querySelectorAll('[data-time-slot-action]')).forEach((btn) => {
      const btnAction = String(btn.getAttribute('data-time-slot-action') || '').trim().toLowerCase();
      btn.classList.toggle('active', btnAction === action);
    });
    syncTimeSlotModalChromeForMode();
  }

  function applyTimeSlotInputBounds() {
    const bounds = resolveEnrollmentWindowBounds();
    const startInput = qs('sessionEnrollmentTimeSlotStart');
    const endInput = qs('sessionEnrollmentTimeSlotEnd');
    if (startInput && bounds.minDate) {
      startInput.min = bounds.minDate;
      startInput.max = bounds.maxDate || '';
    }
    if (endInput && bounds.minDate) {
      endInput.min = bounds.minDate;
      endInput.max = bounds.maxDate || '';
    }
  }

  function readTimeSlotDateValues() {
    const bounds = resolveEnrollmentWindowBounds();
    let start = core.normalizeDateOnly(qs('sessionEnrollmentTimeSlotStart')?.value);
    let end = core.normalizeDateOnly(qs('sessionEnrollmentTimeSlotEnd')?.value);
    if (bounds.minDate && start && start < bounds.minDate) start = bounds.minDate;
    if (bounds.maxDate && start && start > bounds.maxDate) start = bounds.maxDate;
    if (bounds.minDate && end && end < bounds.minDate) end = bounds.minDate;
    if (bounds.maxDate && end && end > bounds.maxDate) end = bounds.maxDate;
    return { startDate: start, endDate: end };
  }

  function clampTimeSlotDateInputs() {
    applyTimeSlotInputBounds();
    const startInput = qs('sessionEnrollmentTimeSlotStart');
    const endInput = qs('sessionEnrollmentTimeSlotEnd');
    let { startDate: start, endDate: end } = readTimeSlotDateValues();
    if (start && end && start > end) {
      end = start;
    }
    if (startInput && start) startInput.value = start;
    if (endInput && end) endInput.value = end;
    return { startDate: start, endDate: end };
  }

  function readTimeSlotLimitCount() {
    const parsed = Number.parseInt(String(qs('sessionEnrollmentTimeSlotCount')?.value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function collectTimeSlotSessionsForForm() {
    if (!timeSlotContext) return [];
    const { startDate, endDate } = readTimeSlotDateValues();
    const action = readTimeSlotAction();
    if (!startDate || !endDate || startDate > endDate) return [];
    return core.collectTimeSlotSessions(allEvents, state?.pendingMarkChanges, {
      startTime: timeSlotContext.startTime,
      endTime: timeSlotContext.endTime,
      startDate,
      endDate,
      limitCount: readTimeSlotLimitCount(),
      action,
      selectedSet: state?.selectedSet
    });
  }

  function refreshTimeSlotSelectPreview() {
    if (!timeSlotContext) return;
    syncTimeSlotActionButtons();
    const { startDate, endDate } = clampTimeSlotDateInputs();
    const rangeCount = core.countTimeSlotSessionsInRange(
      allEvents,
      timeSlotContext.startTime,
      timeSlotContext.endTime,
      startDate,
      endDate
    );
    const countInput = qs('sessionEnrollmentTimeSlotCount');
    if (countInput && !timeSlotCountTouched) {
      countInput.value = rangeCount > 0 ? String(rangeCount) : '';
      countInput.max = rangeCount > 0 ? String(rangeCount) : '';
    } else if (countInput && rangeCount > 0) {
      countInput.max = String(rangeCount);
      const current = readTimeSlotLimitCount();
      if (current > rangeCount) countInput.value = String(rangeCount);
    }
    const hintEl = qs('sessionEnrollmentTimeSlotCountHint');
    if (hintEl) {
      hintEl.textContent = rangeCount > 0
        ? `${rangeCount} session(s) of this type fall in the selected date range.`
        : 'No sessions of this type fall in the selected date range.';
    }
    const action = readTimeSlotAction();
    const sessions = collectTimeSlotSessionsForForm();
    const count = sessions.length;
    const previewEl = qs('sessionEnrollmentTimeSlotPreview');
    const stageBtn = qs('btn_sessionEnrollmentTimeSlotStage');
    if (previewEl) {
      if (!count) {
        if (isManageMode()) {
          previewEl.textContent = action === 'unmark'
            ? 'No N/A sessions of this type in the selected range.'
            : 'No open sessions of this type in the selected range.';
        } else {
          previewEl.textContent = action === 'deselect'
            ? 'No selected sessions of this type in the selected range.'
            : 'No selectable sessions of this type in the selected range.';
        }
      } else if (isManageMode()) {
        previewEl.textContent = action === 'unmark'
          ? `${count} session(s) will be unmarked from N/A.`
          : `${count} session(s) will be marked N/A.`;
      } else {
        previewEl.textContent = action === 'deselect'
          ? `${count} session(s) will be deselected.`
          : `${count} session(s) will be selected.`;
      }
    }
    if (stageBtn) stageBtn.disabled = count === 0;
    showTimeSlotFormError('');
  }

  function openTimeSlotSelectModal(ev) {
    if (!state || !ev) return;
    hideContextMenu();
    bindTimeSlotModalEvents();
    timeSlotContext = {
      sessionId: String(ev?.sessionId || '').trim(),
      startTime: String(ev?.start || ev?.startTime || '').trim(),
      endTime: String(ev?.end || ev?.endTime || '').trim(),
      date: core.normalizeDateOnly(ev?.date)
    };
    timeSlotAction = isManageMode() ? 'mark_na' : 'select';
    timeSlotCountTouched = false;
    const bounds = resolveEnrollmentWindowBounds();
    const defaultStart = timeSlotContext.date || bounds.minDate || state?.startDate || '';
    const defaultEnd = core.normalizeDateOnly(state?.cycleEndDate || bounds.maxDate || state?.endDate || defaultStart);
    const windowLabel = buildManageSessionTimeLabel(ev);
    const typeTotal = core.countSessionsByTimeWindow(allEvents, timeSlotContext.startTime, timeSlotContext.endTime);
    const windowLabelEl = qs('sessionEnrollmentTimeSlotWindowLabel');
    const typeTotalEl = qs('sessionEnrollmentTimeSlotTypeTotal');
    if (windowLabelEl) windowLabelEl.textContent = windowLabel || '—';
    if (typeTotalEl) typeTotalEl.textContent = `${typeTotal} session(s)`;
    const startInput = qs('sessionEnrollmentTimeSlotStart');
    const endInput = qs('sessionEnrollmentTimeSlotEnd');
    const noteInput = qs('sessionEnrollmentTimeSlotNote');
    if (startInput) startInput.value = defaultStart || '';
    if (endInput) endInput.value = defaultEnd || '';
    if (noteInput) noteInput.value = '';
    syncTimeSlotModalChromeForMode();
    syncTimeSlotActionButtons(timeSlotAction);
    applyTimeSlotInputBounds();
    clampTimeSlotDateInputs();
    refreshTimeSlotSelectPreview();
    showTimeSlotModalLayer();
  }

  function stageTimeSlotPickerChanges() {
    if (!state || !timeSlotContext) return;
    const action = readTimeSlotAction();
    const sessions = collectTimeSlotSessionsForForm();
    if (!sessions.length) {
      showTimeSlotFormError('No sessions match this time window, date range, and action.');
      return;
    }
    sessions.forEach((row) => {
      const sessionId = String(row?.sessionId || '').trim();
      if (!sessionId) return;
      if (action === 'deselect') state.selectedSet.delete(sessionId);
      else state.selectedSet.add(sessionId);
    });
    hideTimeSlotModalLayer();
    const scrollSnapshot = captureScrollPositions();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateSummary();
  }

  function stageTimeSlotSelectChanges() {
    if (!state || !timeSlotContext) return;
    if (!isManageMode()) {
      stageTimeSlotPickerChanges();
      return;
    }
    const action = readTimeSlotAction();
    const sessions = collectTimeSlotSessionsForForm();
    if (!sessions.length) {
      showTimeSlotFormError('No sessions match this time window, date range, and action.');
      return;
    }
    const note = String(qs('sessionEnrollmentTimeSlotNote')?.value || '').trim();
    if (action === 'mark_na' && !note) {
      showTimeSlotFormError('Enter a note explaining why these sessions are N/A.');
      return;
    }
    const previewMap = core.applyBulkPendingChanges(state.pendingMarkChanges, sessions, action, note);
    const preview = getManageCapBalance(null, '', previewMap);
    if (action === 'unmark') {
      if (preview.enforcedSessions && preview.expectedCount > preview.targetSessions) {
        showTimeSlotFormError(preview.message || 'Unmarking would exceed the enrollment session target.');
        return;
      }
      if (preview.enforcedHours && preview.expectedHours > preview.targetHours) {
        showTimeSlotFormError(preview.message || 'Unmarking would exceed the enrollment hour target.');
        return;
      }
    }
    if (!state.pendingMarkChanges) state.pendingMarkChanges = new Map();
    state.pendingMarkChanges = previewMap;
    allEvents.forEach((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      if (sessionId) syncEventNaFromPending(sessionId);
    });
    hideTimeSlotModalLayer();
    const scrollSnapshot = captureScrollPositions();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateManageSummary();
    syncDoneButtonLabel();
  }

  function bindTimeSlotModalEvents() {
    if (timeSlotModalBound) return;
    timeSlotModalBound = true;
    bindStackEscapeHandler();
    timeSlotModalEl = resolveTimeSlotOverlayEl();

    timeSlotModalEl?.addEventListener('click', (event) => {
      if (event.target.closest('#btn_sessionEnrollmentTimeSlotStage')) {
        event.preventDefault();
        stageTimeSlotSelectChanges();
        return;
      }
      const actionBtn = event.target.closest('[data-time-slot-action]');
      if (actionBtn) {
        event.preventDefault();
        const nextAction = String(actionBtn.getAttribute('data-time-slot-action') || '').trim().toLowerCase();
        if (isManageMode()) {
          timeSlotAction = nextAction === 'unmark' ? 'unmark' : 'mark_na';
        } else {
          timeSlotAction = nextAction === 'deselect' ? 'deselect' : 'select';
        }
        syncTimeSlotActionButtons(timeSlotAction);
        refreshTimeSlotSelectPreview();
        return;
      }
      if (event.target.closest('[data-time-slot-dismiss]')) {
        hideTimeSlotModalLayer();
      }
    });

    qs('sessionEnrollmentTimeSlotStart')?.addEventListener('input', () => {
      if (!isTimeSlotOverlayOpen()) return;
      timeSlotCountTouched = false;
      refreshTimeSlotSelectPreview();
    });
    qs('sessionEnrollmentTimeSlotStart')?.addEventListener('change', () => {
      if (!isTimeSlotOverlayOpen()) return;
      timeSlotCountTouched = false;
      clampTimeSlotDateInputs();
      refreshTimeSlotSelectPreview();
    });
    qs('sessionEnrollmentTimeSlotEnd')?.addEventListener('input', () => {
      if (!isTimeSlotOverlayOpen()) return;
      timeSlotCountTouched = false;
      refreshTimeSlotSelectPreview();
    });
    qs('sessionEnrollmentTimeSlotEnd')?.addEventListener('change', () => {
      if (!isTimeSlotOverlayOpen()) return;
      timeSlotCountTouched = false;
      clampTimeSlotDateInputs();
      refreshTimeSlotSelectPreview();
    });
    qs('sessionEnrollmentTimeSlotCount')?.addEventListener('input', (event) => {
      if (!isTimeSlotOverlayOpen()) return;
      if (event?.target) timeSlotCountTouched = true;
      refreshTimeSlotSelectPreview();
    });
    qs('sessionEnrollmentTimeSlotNote')?.addEventListener('input', () => {
      if (!isTimeSlotOverlayOpen()) return;
      refreshTimeSlotSelectPreview();
    });
  }

  function resolveContextMenuEl() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    return calendarModal?.querySelector('#sessionEnrollmentContextMenu')
      || qs('sessionEnrollmentContextMenu');
  }

  function hideContextMenu() {
    contextMenuEl = resolveContextMenuEl();
    if (!contextMenuEl) return;
    contextMenuEl.classList.add('d-none');
    contextMenuEl.classList.remove('show');
    contextMenuEl.setAttribute('aria-hidden', 'true');
    contextMenuSessionId = '';
  }

  function showContextMenu(event, sessionId) {
    contextMenuEl = resolveContextMenuEl();
    if (!contextMenuEl) return;
    const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === String(sessionId || '').trim());
    if (!eventRow) return;
    contextMenuSessionId = String(sessionId || '').trim();
    const markBtn = qs('btn_sessionEnrollmentContextMark');
    if (markBtn) {
      if (isManageMode()) {
        const naState = resolveManageNaState(eventRow);
        markBtn.textContent = naState !== 'normal' ? 'Unmark N/A' : 'Mark N/A';
      } else {
        const isSelected = state?.selectedSet?.has(contextMenuSessionId);
        markBtn.textContent = isSelected ? 'Exclude session' : 'Include session';
      }
    }
    const menuWidth = 200;
    const menuHeight = 80;
    const left = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const top = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    const appliedLeft = Math.max(8, left);
    const appliedTop = Math.max(8, top);
    if (contextMenuEl.parentElement !== document.body) {
      document.body.appendChild(contextMenuEl);
    }
    contextMenuEl.style.position = 'fixed';
    contextMenuEl.style.left = `${appliedLeft}px`;
    contextMenuEl.style.top = `${appliedTop}px`;
    contextMenuEl.style.zIndex = '2100';
    contextMenuEl.classList.remove('d-none');
    contextMenuEl.classList.add('show');
    contextMenuEl.setAttribute('aria-hidden', 'false');
  }

  function bindContextMenuEvents() {
    contextMenuEl = resolveContextMenuEl();
    qs('btn_sessionEnrollmentContextMark')?.addEventListener('click', (event) => {
      event.preventDefault();
      const sessionId = String(contextMenuSessionId || '').trim();
      hideContextMenu();
      const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === sessionId);
      if (!eventRow) return;
      if (isManageMode()) {
        openMarkModalForEvent(eventRow);
        return;
      }
      if (eventRow.selectable !== true) return;
      toggleSession(sessionId);
    });
    qs('btn_sessionEnrollmentContextSelect')?.addEventListener('click', (event) => {
      event.preventDefault();
      const sessionId = String(contextMenuSessionId || '').trim();
      hideContextMenu();
      const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === sessionId);
      if (eventRow) openTimeSlotSelectModal(eventRow);
    });
    document.addEventListener('click', (event) => {
      if (!contextMenuEl || contextMenuEl.classList.contains('d-none')) return;
      if (event.target.closest('#sessionEnrollmentContextMenu')) return;
      hideContextMenu();
    });
    document.addEventListener('scroll', hideContextMenu, true);
  }

  function handleHostContextMenu(event) {
    const block = event.target.closest('[data-session-id]');
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    const sessionId = String(block.getAttribute('data-session-id') || '').trim();
    const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === sessionId);
    if (isPartialMode() && eventRow?.isStaged === true && global.ScheduleDraftSessionMenu?.show) {
      global.ScheduleDraftSessionMenu.show({
        sessionId,
        classId: state?.classId || eventRow.classId,
        className: state?.classLabel || eventRow.title,
        date: eventRow.date,
        start: eventRow.start,
        end: eventRow.end,
        duration: eventRow.durationHours,
        scheduledDuration: eventRow.durationHours,
        stagingAttemptId: eventRow.stagingAttemptId,
        isDraft: true
      }, event, 'partialModal');
      return;
    }
    showContextMenu(event, sessionId);
  }

  function getPartialBlockingScheduleEvents() {
    if (!state) return [];
    return (Array.isArray(state.conflictScheduleEvents) ? state.conflictScheduleEvents : []).map((row) => ({
      sessionId: String(row?.sessionId || row?.id || '').trim(),
      id: String(row?.id || row?.sessionId || '').trim(),
      date: core.normalizeDateOnly(row?.date),
      startTime: String(row?.startTime || row?.start || '').trim(),
      start: String(row?.startTime || row?.start || '').trim(),
      endTime: String(row?.endTime || row?.end || '').trim(),
      end: String(row?.endTime || row?.end || '').trim()
    })).filter((row) => row.sessionId || row.id);
  }

  function getPartialConflictSessions(excludeSessionId = '') {
    if (!state) return [];
    const excluded = String(excludeSessionId || '').trim();
    const staged = (Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate : []).map((row) => ({
      sessionId: row.sessionId,
      id: row.sessionId,
      date: row.date,
      startTime: row.startTime,
      start: row.startTime,
      endTime: row.endTime,
      end: row.endTime
    }));
    const seen = new Set();
    const merged = [];
    [...getPartialBlockingScheduleEvents(), ...staged].forEach((row) => {
      const id = String(row?.sessionId || row?.id || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push({ ...row, sessionId: id, id });
    });
    return merged.filter((row) => {
      const id = String(row?.sessionId || row?.id || '').trim();
      return !excluded || id !== excluded;
    });
  }

  function refreshPartialPickerFromState() {
    if (!state || !isPartialMode()) return;
    const pickerData = buildPartialPickerData({
      classId: state.classId,
      classLabel: state.classLabel,
      sessionsToCreate: state.sessionsToCreate,
      existingEvents: getExistingSessionsForStaging(),
      startDate: state.startDate,
      endDate: state.endDate,
      stagingAttempts: state.stagingAttempts
    });
    applyPickerData(pickerData, { preserveViewRange: true });
  }

  function notifyPartialStagedSessionsChange() {
    if (!state || typeof state.onStagedSessionsChange !== 'function') return;
    state.onStagedSessionsChange({
      sessionsToCreate: Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate.slice() : [],
      stagingAttempts: Array.isArray(state.stagingAttempts) ? state.stagingAttempts.slice() : [],
      viewRange: state.viewRange ? { ...state.viewRange } : null
    });
  }

  function removePartialStagedAttempt(attemptId) {
    const id = String(attemptId || '').trim();
    if (!state || !id) return;
    const removeIds = new Set(
      (Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate : [])
        .filter((row) => String(row?.stagingAttemptId || '') === id)
        .map((row) => String(row?.sessionId || '').trim())
        .filter(Boolean)
    );
    if (!removeIds.size) {
      const batch = (state.stagingAttempts || []).find((row) => String(row?.attemptId || '') === id);
      (batch?.sessionIds || []).forEach((sid) => removeIds.add(String(sid).trim()));
    }
    state.sessionsToCreate = (state.sessionsToCreate || []).filter((row) => !removeIds.has(String(row?.sessionId || '').trim()));
    removeIds.forEach((sid) => state.selectedSet.delete(sid));
    state.stagingAttempts = (state.stagingAttempts || []).filter((batch) => String(batch?.attemptId || '') !== id);
    allEvents = allEvents.filter((row) => !removeIds.has(String(row?.sessionId || '').trim()));
    refreshPartialPickerFromState();
    notifyPartialStagedSessionsChange();
  }

  function deleteStagedSession(sessionId) {
    if (!state || !isPartialMode()) return;
    const id = String(sessionId || '').trim();
    if (!id) return;
    const removed = (state.sessionsToCreate || []).find((row) => String(row?.sessionId || '') === id);
    state.sessionsToCreate = (state.sessionsToCreate || []).filter((row) => String(row?.sessionId || '') !== id);
    state.selectedSet.delete(id);
    state.stagingAttempts = (state.stagingAttempts || []).map((batch) => ({
      ...batch,
      sessionIds: (batch.sessionIds || []).filter((sid) => String(sid) !== id)
    })).filter((batch) => (batch.sessionIds || []).length > 0);
    if (removed?.stagingAttemptId) {
      const attemptId = String(removed.stagingAttemptId).trim();
      const stillHasAttempt = (state.sessionsToCreate || []).some((row) => String(row?.stagingAttemptId || '') === attemptId);
      if (!stillHasAttempt) {
        state.stagingAttempts = (state.stagingAttempts || []).filter((batch) => String(batch?.attemptId || '') !== attemptId);
      }
    }
    allEvents = allEvents.filter((row) => String(row?.sessionId || '') !== id);
    refreshPartialPickerFromState();
    notifyPartialStagedSessionsChange();
  }

  function deleteStagedAttempt(attemptId) {
    if (!isPartialMode()) return;
    removePartialStagedAttempt(attemptId);
  }

  function applyPartialStagedSessionMove(update = {}) {
    if (!state || !isPartialMode() || !update?.sessionId) return false;
    const id = String(update.sessionId).trim();
    const hasConflict = core.checkScheduleTimeConflict?.({
      date: update.date,
      startTime: update.startTime,
      endTime: update.endTime,
      sessions: getPartialConflictSessions(id),
      excludeSessionId: id
    });
    if (hasConflict) return false;
    state.sessionsToCreate = (state.sessionsToCreate || []).map((row) => {
      if (String(row?.sessionId || '') !== id) return row;
      return {
        ...row,
        date: update.date,
        startTime: update.startTime,
        endTime: update.endTime,
        durationHours: update.durationHours
      };
    });
    const eventIdx = allEvents.findIndex((row) => String(row?.sessionId || '') === id);
    if (eventIdx >= 0) {
      allEvents[eventIdx] = {
        ...allEvents[eventIdx],
        date: core.normalizeDateOnly(update.date),
        start: update.startTime,
        end: update.endTime,
        durationHours: update.durationHours
      };
    }
    refreshPartialPickerFromState();
    notifyPartialStagedSessionsChange();
    return true;
  }

  function applyPartialStagedSessionResize(update = {}) {
    return applyPartialStagedSessionMove(update);
  }

  function moveStagedSession(sessionId, update = {}) {
    if (!state || !isPartialMode()) return false;
    const id = String(sessionId || '').trim();
    const date = core.normalizeDateOnly(update.date);
    const startTime = String(update.startTime || '').trim();
    const endTime = String(update.endTime || update.end || '').trim();
    const durationHours = Number(update.durationHours || 0);
    return applyPartialStagedSessionMove({
      sessionId: id,
      date,
      startTime,
      endTime,
      durationHours
    });
  }

  function editStagedSession(sessionId, values = {}) {
    if (!state || !isPartialMode()) return false;
    const id = String(sessionId || '').trim();
    const date = core.normalizeDateOnly(values.date);
    const startTime = String(values.startTime || '').trim();
    const durationHours = Number(values.durationHours || 0);
    const endTime = core.addDurationToTime(startTime, durationHours);
    const hasConflict = core.checkScheduleTimeConflict?.({
      date,
      startTime,
      endTime,
      sessions: getPartialConflictSessions(id),
      excludeSessionId: id
    });
    if (hasConflict) {
      const errorEl = document.getElementById('scheduleDraftEditError');
      if (errorEl) {
        errorEl.textContent = 'That time slot conflicts with another session.';
        errorEl.classList.remove('d-none');
      }
      return false;
    }
    state.sessionsToCreate = (state.sessionsToCreate || []).map((row) => {
      if (String(row?.sessionId || '') !== id) return row;
      return { ...row, date, startTime, endTime, durationHours };
    });
    refreshPartialPickerFromState();
    notifyPartialStagedSessionsChange();
    return true;
  }

  function editStagedAttempt(attemptId) {
    if (!state || !isPartialMode()) return;
    const batch = (state.stagingAttempts || []).find((row) => String(row?.attemptId || '') === String(attemptId || '').trim());
    if (!batch?.stageParams) return;
    const params = batch.stageParams;
    state.pendingEditAttemptId = String(batch.attemptId || '').trim();
    openStageQuickModal({
      date: String(params.anchorDate || '').trim(),
      startTime24: String(params.startTime || '').trim(),
      startTimeLabel: core.formatClockTime(params.startTime),
      durationHours: Number(params.durationHours || 1)
    });
    stageDurationHours = Number(params.durationHours || 1);
    stageWeekdays = new Set(Array.isArray(params.weekdays) ? params.weekdays : []);
    syncStageCountDisplay(Number(params.count || 4));
    stageModalEl = resolveStageOverlayEl();
    stageModalEl?.querySelectorAll('[data-stage-duration]').forEach((btn) => {
      const hours = Number(btn.getAttribute('data-stage-duration'));
      btn.classList.toggle('active', hours === stageDurationHours);
    });
    stageModalEl?.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
      const dow = Number(btn.getAttribute('data-stage-weekday'));
      btn.classList.toggle('active', stageWeekdays.has(dow));
    });
    const skipEl = stageModalEl?.querySelector('#sessionEnrollmentStageSkipHolidays');
    if (skipEl) skipEl.checked = params.skipHolidays === true;
  }

  function getStagingAttempts(classId = '') {
    if (!state || !isPartialMode()) return [];
    const batches = Array.isArray(state.stagingAttempts) ? state.stagingAttempts : [];
    const filterClassId = String(classId || state.classId || '').trim();
    if (!filterClassId) return batches.slice();
    return batches.filter((batch) => String(batch?.classId || '').trim() === filterClassId);
  }

  function syncFromParentDrafts(payload = {}) {
    if (!state || !isPartialMode()) return;
    state.sessionsToCreate = Array.isArray(payload.sessionsToCreate) ? payload.sessionsToCreate.slice() : [];
    state.stagingAttempts = Array.isArray(payload.stagingAttempts) ? payload.stagingAttempts.slice() : [];
    state.selectedSet = new Set(
      state.sessionsToCreate.map((row) => String(row?.sessionId || '').trim()).filter(Boolean)
    );
    refreshPartialPickerFromState();
  }

  function bindPartialDraftDragMove() {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || hostEl.dataset.partialDraftDragMoveBound === '1' || !core.bindCalendarDragMove) return;
    hostEl.dataset.partialDraftDragMoveBound = '1';
    core.bindCalendarDragMove(hostEl, {
      enabled: true,
      blockSelector: '.session-enrollment-block.is-staged[data-session-id]',
      canStartMove: (sessionId, block) => !block?.closest?.('.session-cal-draft-resize-handle'),
      getConflictSessions: () => getPartialConflictSessions(),
      onMoveComplete: (update) => { applyPartialStagedSessionMove(update); }
    });
    if (core.bindCalendarDragResize) {
      core.bindCalendarDragResize(hostEl, {
        enabled: true,
        blockSelector: '.session-enrollment-block.is-staged[data-session-id]',
        getConflictSessions: () => getPartialConflictSessions(),
        onResizeComplete: (update) => { applyPartialStagedSessionResize(update); }
      });
    }
  }

  function isModalOpen() {
    return Boolean(modalEl && modalEl.classList.contains('show') && state);
  }

  function createPartialStagingAttemptId() {
    return `STAGE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createPartialDraftBatch({ attemptId, classId, classLabel, stageParams, sessionIds } = {}) {
    return {
      attemptId: String(attemptId || createPartialStagingAttemptId()).trim(),
      classId: String(classId || state?.classId || '').trim(),
      classLabel: String(classLabel || state?.classLabel || classId || 'Class').trim(),
      createdAt: new Date().toISOString(),
      stageParams: (stageParams && typeof stageParams === 'object') ? { ...stageParams } : {},
      sessionIds: Array.isArray(sessionIds) ? sessionIds.map((id) => String(id || '').trim()).filter(Boolean) : []
    };
  }

  function bindBulkNaModalEvents() {
    if (bulkNaModalBound) return;
    bulkNaModalBound = true;
    bindStackEscapeHandler();
    bulkNaModalEl = resolveBulkNaOverlayEl();

    bulkNaModalEl?.addEventListener('click', (event) => {
      if (event.target.closest('#btn_sessionEnrollmentBulkNaStage')) {
        event.preventDefault();
        stageBulkNaChanges();
        return;
      }
      const actionBtn = event.target.closest('[data-bulk-na-action]');
      if (actionBtn) {
        event.preventDefault();
        const nextAction = String(actionBtn.getAttribute('data-bulk-na-action') || 'mark_na').trim().toLowerCase();
        bulkNaAction = nextAction === 'unmark' ? 'unmark' : 'mark_na';
        syncBulkNaActionButtons(bulkNaAction);
        refreshBulkNaPreview();
        return;
      }
      if (event.target.closest('[data-bulk-na-dismiss]')) {
        hideBulkNaModalLayer();
      }
    });

    qs('sessionEnrollmentBulkNaStart')?.addEventListener('input', () => {
      if (!isBulkNaOverlayOpen()) return;
      refreshBulkNaPreview();
    });
    qs('sessionEnrollmentBulkNaStart')?.addEventListener('change', () => {
      if (!isBulkNaOverlayOpen()) return;
      clampBulkNaDateInputs();
      refreshBulkNaPreview();
    });
    qs('sessionEnrollmentBulkNaEnd')?.addEventListener('input', () => {
      if (!isBulkNaOverlayOpen()) return;
      refreshBulkNaPreview();
    });
    qs('sessionEnrollmentBulkNaEnd')?.addEventListener('change', () => {
      if (!isBulkNaOverlayOpen()) return;
      clampBulkNaDateInputs();
      refreshBulkNaPreview();
    });
    qs('sessionEnrollmentBulkNaNote')?.addEventListener('input', () => {
      if (!isBulkNaOverlayOpen()) return;
      refreshBulkNaPreview();
    });
  }

  let markModalEl = null;
  let markContext = null;
  let markModalBound = false;
  let bulkNaModalEl = null;
  let bulkNaAction = 'mark_na';
  let bulkNaModalBound = false;
  let timeSlotModalEl = null;
  let timeSlotAction = 'mark_na';
  let timeSlotModalBound = false;
  let timeSlotContext = null;
  let timeSlotCountTouched = false;
  let contextMenuEl = null;
  let contextMenuSessionId = '';
  let manageSummaryMeta = null;
  const STAGE_COUNT_MIN = 1;
  const STAGE_COUNT_MAX = 72;

  function getExistingSessionsForStaging() {
    if (!state) return [];
    const persisted = Array.isArray(state.persistedSessions) ? state.persistedSessions : [];
    const client = Array.isArray(state.sessions) ? state.sessions : [];
    const fromEvents = allEvents.filter((row) => row?.isStaged !== true);
    return [...persisted, ...client, ...fromEvents];
  }

  function stagedRowToEvent(row) {
    const sessionId = String(row?.sessionId || '').trim();
    const date = core.normalizeDateOnly(row?.date);
    const start = String(row?.startTime || '').trim();
    const end = String(row?.endTime || '').trim();
    return {
      sessionId,
      classId: state.classId,
      date,
      start,
      end,
      durationHours: Number(row?.durationHours || 0),
      teacherName: String(row?.teacherName || '').trim() || 'Teacher',
      manageable: false,
      manageSessionUrl: '',
      selectable: false,
      excludeReason: '',
      isStaged: true,
      selected: false
    };
  }

  function scrollHostToStagedDate(dateStr) {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || !dateStr) return false;
    const date = core.normalizeDateOnly(dateStr);
    const cell = hostEl.querySelector(`[data-cal-date="${date}"]`);
    const scrollEl = hostEl.querySelector('.session-cal-vertical-scroll');
    const weekRow = cell?.closest('.session-cal-week-row');
    if (!scrollEl || !weekRow) return false;
    const scrollRect = scrollEl.getBoundingClientRect();
    const rowRect = weekRow.getBoundingClientRect();
    const delta = rowRect.top - scrollRect.top - (scrollRect.height / 2) + (rowRect.height / 2);
    scrollEl.scrollTop += delta;
    return true;
  }

  function ensureViewRangeCoversStagedDates(rows = []) {
    if (!state || !Array.isArray(rows) || !rows.length) return;
    const dates = rows
      .map((row) => core.normalizeDateOnly(row?.date))
      .filter(Boolean)
      .sort();
    if (!dates.length) return;
    const maxDate = dates[dates.length - 1];
    const minDate = dates[0];
    const rangeStart = core.normalizeDateOnly(state.viewRange?.startDate);
    const rangeEnd = core.normalizeDateOnly(state.viewRange?.endDate);
    if (!rangeStart || !rangeEnd) return;
    const enrollmentStart = core.normalizeDateOnly(state.startDate || '');
    const nextStart = minDate < rangeStart ? minDate : rangeStart;
    const nextEnd = maxDate > rangeEnd ? maxDate : rangeEnd;
    const clampedStart = enrollmentStart && nextStart < enrollmentStart ? enrollmentStart : nextStart;
    if (clampedStart === rangeStart && nextEnd === rangeEnd) return;
    state.viewRange = {
      ...state.viewRange,
      startDate: clampedStart,
      endDate: nextEnd
    };
  }

  function commitQuickStagedSessions(rows = [], clickedDate = '') {
    if (!state || !Array.isArray(rows) || !rows.length) return;
    const existingKeys = new Set(
      (Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate : []).map((row) => core.sessionScheduleKey(row))
    );
    const newRows = [];
    rows.forEach((row) => {
      const key = core.sessionScheduleKey(row);
      if (!key || existingKeys.has(key)) return;
      existingKeys.add(key);
      newRows.push({ ...row });
    });
    if (!newRows.length) return;

    state.sessionsToCreate = [...(state.sessionsToCreate || []), ...newRows];
    newRows.forEach((row) => {
      const id = String(row?.sessionId || '').trim();
      if (id) state.selectedSet.add(id);
      const eventRow = stagedRowToEvent(row);
      const existingIdx = allEvents.findIndex((ev) => String(ev?.sessionId || '').trim() === eventRow.sessionId);
      if (existingIdx >= 0) allEvents[existingIdx] = eventRow;
      else allEvents.push(eventRow);
    });

    const scrollSnapshot = captureScrollPositions();
    const scrollTargetDate = core.normalizeDateOnly(
      clickedDate || stageContext?.date || newRows[0]?.date
    );
    ensureViewRangeCoversStagedDates(newRows);
    renderCalendar();
    const scrolledToDate = scrollTargetDate ? scrollHostToStagedDate(scrollTargetDate) : false;
    if (!scrolledToDate) restoreScrollPositions(scrollSnapshot);
    updateSummary();
  }

  let stageOverlayLockActive = false;
  let calendarKeyboardEnabledBeforeStage = true;

  function isStageOverlayOpen() {
    const el = resolveStageOverlayEl();
    return Boolean(el && el.classList.contains('show') && !el.classList.contains('d-none'));
  }

  function setStageOverlayLock(locked) {
    const calendarModalEl = qs('sessionEnrollmentCalendarModal');
    const dialog = calendarModalEl?.querySelector('.modal-dialog');
    const content = calendarModalEl?.querySelector('.modal-content');
    stageOverlayLockActive = locked === true;
    if (content) content.inert = locked;
    if (dialog) dialog.classList.toggle('session-cal-stage-open', locked);
    const calInst = getModal();
    if (calInst) {
      if (locked) {
        calendarKeyboardEnabledBeforeStage = calInst._config.keyboard !== false;
        calInst._config.keyboard = false;
        if (calInst._focustrap) calInst._focustrap.deactivate();
      } else {
        calInst._config.keyboard = calendarKeyboardEnabledBeforeStage;
        if (calendarModalEl?.classList.contains('show') && calInst._focustrap) {
          calInst._focustrap.activate();
          const focusTarget = calendarModalEl.querySelector('.modal-header .btn-close');
          if (focusTarget && typeof focusTarget.focus === 'function') {
            try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus(); }
          }
        }
      }
    }
  }

  let stackEscapeBound = false;

  function isMarkOverlayOpen() {
    const el = resolveMarkOverlayEl();
    return Boolean(el && el.classList.contains('show') && !el.classList.contains('d-none'));
  }

  function handleEnrollmentModalStackEscape(event) {
    if (event.key !== 'Escape') return;
    if (!contextMenuEl?.classList.contains('d-none')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      hideContextMenu();
      return;
    }
    if (stageOverlayLockActive || isBulkNaOverlayOpen() || isTimeSlotOverlayOpen() || isStageOverlayOpen() || isMarkOverlayOpen()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isBulkNaOverlayOpen()) hideBulkNaModalLayer();
      else if (isTimeSlotOverlayOpen()) hideTimeSlotModalLayer();
      else if (isMarkOverlayOpen()) hideMarkModalLayer();
      else hideStageQuickModalLayer();
      return;
    }
    const calendarEl = qs('sessionEnrollmentCalendarModal');
    if (calendarEl?.classList.contains('show')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      getModal()?.hide();
    }
  }

  function bindStackEscapeHandler() {
    if (stackEscapeBound) return;
    stackEscapeBound = true;
    document.addEventListener('keydown', handleEnrollmentModalStackEscape, true);
  }

  function showStageFormError(message) {
    const warningEl = qs('sessionEnrollmentStageCapacityWarning');
    if (!warningEl) return;
    warningEl.textContent = String(message || '').trim();
    warningEl.classList.toggle('d-none', !warningEl.textContent);
  }

  async function collectHolidayDatesForRange(startDate, endDate) {
    const start = core.normalizeDateOnly(startDate || '');
    const end = core.normalizeDateOnly(endDate || '');
    if (!start || !end) return [];
    try {
      const resp = await fetch(
        `/school/holidays/api/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await resp.json().catch(() => ({}));
      const holidays = Array.isArray(data?.holidays) ? data.holidays : [];
      return holidays
        .map((row) => core.normalizeDateOnly(row?.date))
        .filter(Boolean);
    } catch (err) {
      console.warn('Session enrollment stage holiday lookup failed', err);
      return [];
    }
  }

  function readStageSkipHolidays() {
    const el = stageModalEl?.querySelector('#sessionEnrollmentStageSkipHolidays')
      || qs('sessionEnrollmentStageSkipHolidays');
    return Boolean(el?.checked);
  }

  function estimateStageGenerationEndDate() {
    const count = readStageSessionCount();
    const anchorDate = core.normalizeDateOnly(stageContext?.date || state?.startDate || '');
    const weeksSpan = Math.max(2, Math.ceil(count / 2) + 1);
    const projected = core.addDaysIso(anchorDate, weeksSpan * 7 + 14);
    const enrollmentEnd = core.normalizeDateOnly(state?.endDate || '');
    if (enrollmentEnd && projected > enrollmentEnd) return enrollmentEnd;
    return projected;
  }

  async function buildStageBlockedDatesForRange(startDate, endDate) {
    if (!readStageSkipHolidays()) return [];
    const start = core.normalizeDateOnly(startDate || stageContext?.date || '');
    let end = core.normalizeDateOnly(endDate || '');
    if (!end) end = estimateStageGenerationEndDate();
    return collectHolidayDatesForRange(start, end);
  }

  async function syncStageHolidayHint(startDate, endDate) {
    const hintEl = qs('sessionEnrollmentStageHolidayHint');
    if (!hintEl) return;
    if (!readStageSkipHolidays()) {
      hintEl.classList.add('d-none');
      hintEl.textContent = '';
      return;
    }
    const holidays = await buildStageBlockedDatesForRange(startDate, endDate);
    hintEl.classList.remove('d-none');
    hintEl.textContent = holidays.length
      ? `Holidays in range: ${holidays.length}`
      : 'No holidays found in range.';
  }

  async function buildStageGenerationOptions() {
    const weekdays = readStageWeekdays();
    const durationHours = readStageDurationHours();
    const count = readStageSessionCount();
    const enrollmentStart = isPartialMode()
      ? core.normalizeDateOnly(stageContext?.date || state?.startDate || '')
      : state.startDate;
    const enrollmentEnd = isPartialMode()
      ? estimateStageGenerationEndDate()
      : state.endDate;
    const blockedDates = await buildStageBlockedDatesForRange(enrollmentStart, enrollmentEnd);
    return {
      anchorDate: stageContext.date,
      startTime: stageContext.startTime24,
      durationHours,
      weekdays,
      count,
      enrollmentStart,
      enrollmentEnd,
      existingSessions: getPartialBlockingScheduleEvents(),
      alreadyStaged: state.sessionsToCreate || [],
      scheduleDefaults: state.scheduleDefaults || {},
      blockedDates
    };
  }

  async function commitQuickStagedSessionsFromForm() {
    stageModalEl = resolveStageOverlayEl();
    if (!stageContext || !state) {
      showStageFormError('Unable to stage sessions. Close and try again.');
      return;
    }
    const weekdays = readStageWeekdays();
    if (!weekdays.length) {
      showStageFormError('Select at least one weekday.');
      return;
    }
    const createBtn = qs('btn_sessionEnrollmentStageCreate');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
    }
    try {
      const result = core.generateRotatingWeekdaySessions(await buildStageGenerationOptions());
      if (!result.sessions.length) {
        showStageFormError('No sessions fit in the enrollment window. Adjust weekdays, count, or enrollment dates.');
        return;
      }
      const clickedDate = stageContext.date;
      hideStageQuickModalLayer();
      if (isPartialMode()) {
        const editAttemptId = String(state.pendingEditAttemptId || '').trim();
        if (editAttemptId) removePartialStagedAttempt(editAttemptId);
        const attemptId = editAttemptId || createPartialStagingAttemptId();
        const sessionsWithAttempt = result.sessions.map((row) => ({ ...row, stagingAttemptId: attemptId }));
        const stageParams = {
          durationHours: readStageDurationHours(),
          weekdays: readStageWeekdays(),
          count: readStageSessionCount(),
          skipHolidays: Boolean(qs('sessionEnrollmentStageSkipHolidays')?.checked),
          anchorDate: stageContext.date,
          startTime: stageContext.startTime24
        };
        state.stagingAttempts = [
          ...(state.stagingAttempts || []).filter((batch) => String(batch?.attemptId || '') !== attemptId),
          createPartialDraftBatch({
            attemptId,
            classId: state.classId,
            classLabel: state.classLabel,
            stageParams,
            sessionIds: sessionsWithAttempt.map((row) => row.sessionId)
          })
        ];
        state.pendingEditAttemptId = '';
        commitQuickStagedSessions(sessionsWithAttempt, clickedDate);
        notifyPartialStagedSessionsChange();
      } else {
        commitQuickStagedSessions(result.sessions, clickedDate);
      }
    } finally {
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create staged sessions';
      }
    }
  }

  function resolveStageOverlayEl() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    return calendarModal?.querySelector('#sessionEnrollmentStageModal')
      || qs('sessionEnrollmentStageModal');
  }

  function hideStageQuickModalLayer() {
    stageModalEl = resolveStageOverlayEl();
    if (!stageModalEl) {
      setStageOverlayLock(false);
      stageContext = null;
      return;
    }
    stageModalEl.classList.add('d-none');
    stageModalEl.classList.remove('show');
    stageModalEl.style.display = 'none';
    stageModalEl.setAttribute('aria-hidden', 'true');
    setStageOverlayLock(false);
    stageContext = null;
  }

  function showStageQuickModalLayer() {
    const calendarModal = qs('sessionEnrollmentCalendarModal');
    stageModalEl = resolveStageOverlayEl();
    if (!stageModalEl) return;
    const dialog = calendarModal?.querySelector('.modal-dialog');
    if (dialog && stageModalEl.parentElement !== dialog) {
      dialog.appendChild(stageModalEl);
    }
    stageModalEl.classList.remove('d-none');
    stageModalEl.classList.add('show');
    stageModalEl.style.display = 'flex';
    stageModalEl.setAttribute('aria-hidden', 'false');
    setStageOverlayLock(true);
    const focusTarget = stageModalEl.querySelector(
      '.session-enrollment-stage-panel button, .session-enrollment-stage-panel [tabindex]:not([tabindex="-1"])'
    );
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function readStageDurationHours() {
    const active = stageModalEl?.querySelector('[data-stage-duration].active');
    const value = Number(active?.getAttribute('data-stage-duration') || stageDurationHours || 1);
    return value > 0 ? value : 1;
  }

  function readStageWeekdays() {
    const selected = [];
    stageModalEl?.querySelectorAll('[data-stage-weekday].active').forEach((btn) => {
      const n = Number(btn.getAttribute('data-stage-weekday'));
      if (Number.isFinite(n)) selected.push(n);
    });
    return core.normalizeWeekdays(selected);
  }

  function readStageSessionCount() {
    const display = qs('sessionEnrollmentStageCountDisplay');
    const raw = display && 'value' in display ? display.value : display?.textContent;
    const value = Number(raw || stageSessionCount || 1);
    if (!Number.isFinite(value)) return STAGE_COUNT_MIN;
    return Math.max(STAGE_COUNT_MIN, Math.min(STAGE_COUNT_MAX, Math.round(value)));
  }

  function syncStageCountDisplay(count) {
    stageSessionCount = Math.max(STAGE_COUNT_MIN, Math.min(STAGE_COUNT_MAX, Math.round(Number(count) || 1)));
    const display = qs('sessionEnrollmentStageCountDisplay');
    if (display) {
      if ('value' in display) display.value = String(stageSessionCount);
      else display.textContent = String(stageSessionCount);
    }
    stageModalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
      const chip = Number(btn.getAttribute('data-stage-count'));
      btn.classList.toggle('active', chip === stageSessionCount);
    });
  }

  let stageCapacityPreviewToken = 0;

  async function updateStageCapacityWarning() {
    const warningEl = qs('sessionEnrollmentStageCapacityWarning');
    if (!warningEl || !stageContext || !state) {
      if (warningEl) warningEl.classList.add('d-none');
      return;
    }
    const token = ++stageCapacityPreviewToken;
    const preview = core.generateRotatingWeekdaySessions(await buildStageGenerationOptions());
    if (token !== stageCapacityPreviewToken) return;
    const requested = readStageSessionCount();
    if (preview.capacity < requested) {
      warningEl.textContent = `Only ${preview.capacity} of ${requested} can fit in the enrollment window.`;
      warningEl.classList.remove('d-none');
    } else {
      warningEl.classList.add('d-none');
      warningEl.textContent = '';
    }
    syncStageHolidayHint(
      isPartialMode() ? stageContext?.date : state.startDate,
      isPartialMode() ? estimateStageGenerationEndDate() : state.endDate
    ).catch(() => {});
  }

  function openStageQuickModal(context) {
    if (!context || !state) return;
    stageContext = context;
    showStageQuickModalLayer();
    bindStageModalEvents();
    stageDurationHours = 1;
    stageSessionCount = 4;
    const anchorDow = new Date(`${context.date}T12:00:00`).getDay();
    stageWeekdays = new Set([anchorDow]);

    const contextEl = qs('sessionEnrollmentStageContext');
    if (contextEl) {
      const dateLabel = core.formatDayHeaderLong(context.date);
      const timeLabel = String(context.startTimeLabel || context.startTime24 || '').trim();
      contextEl.textContent = `${dateLabel} · Start ${timeLabel}`;
    }

    stageModalEl = resolveStageOverlayEl();
    if (stageModalEl) {
      stageModalEl.querySelectorAll('[data-stage-duration]').forEach((btn) => {
        const hours = Number(btn.getAttribute('data-stage-duration'));
        btn.classList.toggle('active', hours === 1);
      });
      stageModalEl.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
        const dow = Number(btn.getAttribute('data-stage-weekday'));
        btn.classList.toggle('active', stageWeekdays.has(dow));
      });
    }
    syncStageCountDisplay(4);
    const skipEl = stageModalEl?.querySelector('#sessionEnrollmentStageSkipHolidays');
    if (skipEl) skipEl.checked = false;
    const holidayHint = qs('sessionEnrollmentStageHolidayHint');
    if (holidayHint) {
      holidayHint.classList.add('d-none');
      holidayHint.textContent = '';
    }
    updateStageCapacityWarning();
  }

  function bindStageModalEvents() {
    if (stageModalBound) return;
    stageModalBound = true;
    bindStackEscapeHandler();
    stageModalEl = resolveStageOverlayEl();

    stageModalEl?.addEventListener('click', (event) => {
      if (event.target.closest('#btn_sessionEnrollmentStageCreate')) {
        event.preventDefault();
        commitQuickStagedSessionsFromForm().catch((err) => {
          console.error(err);
          showStageFormError(err?.message || 'Unable to stage sessions.');
        });
        return;
      }
      if (event.target.closest('[data-stage-dismiss]')) {
        hideStageQuickModalLayer();
        return;
      }
      if (!event.target.closest('.session-enrollment-stage-panel')) {
        event.stopPropagation();
      }
    });

    stageModalEl?.querySelectorAll('[data-stage-duration]').forEach((btn) => {
      btn.addEventListener('click', () => {
        stageModalEl?.querySelectorAll('[data-stage-duration]').forEach((row) => row.classList.remove('active'));
        btn.classList.add('active');
        stageDurationHours = Number(btn.getAttribute('data-stage-duration') || 1);
        updateStageCapacityWarning().catch(() => {});
      });
    });

    stageModalEl?.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        if (!readStageWeekdays().length) btn.classList.add('active');
        updateStageCapacityWarning().catch(() => {});
      });
    });

    qs('btn_sessionEnrollmentStageCountDown')?.addEventListener('click', () => {
      syncStageCountDisplay(readStageSessionCount() - 1);
      updateStageCapacityWarning().catch(() => {});
    });

    qs('btn_sessionEnrollmentStageCountUp')?.addEventListener('click', () => {
      syncStageCountDisplay(readStageSessionCount() + 1);
      updateStageCapacityWarning().catch(() => {});
    });

    stageModalEl?.querySelector('#sessionEnrollmentStageSkipHolidays')?.addEventListener('change', () => {
      updateStageCapacityWarning().catch(() => {});
    });

    stageModalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncStageCountDisplay(Number(btn.getAttribute('data-stage-count') || 1));
        updateStageCapacityWarning().catch(() => {});
      });
    });

    qs('sessionEnrollmentStageCountDisplay')?.addEventListener('change', () => {
      syncStageCountDisplay(readStageSessionCount());
      updateStageCapacityWarning().catch(() => {});
    });
    qs('sessionEnrollmentStageCountDisplay')?.addEventListener('input', () => {
      const display = qs('sessionEnrollmentStageCountDisplay');
      if (!display || !('value' in display)) return;
      const parsed = Number(display.value);
      if (!Number.isFinite(parsed)) return;
      stageModalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
        const chip = Number(btn.getAttribute('data-stage-count'));
        btn.classList.toggle('active', chip === Math.round(parsed));
      });
    });

  }

  function collectCalendarYears() {
    if (!state) return [];
    const years = new Set();
    const addYear = (value) => {
      const y = String(value || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    };
    addYear(state.anchorDate);
    addYear(state.startDate);
    addYear(state.endDate);
    addYear(state.viewRange?.startDate);
    addYear(state.viewRange?.endDate);
    if (!years.size) addYear(String(new Date().getFullYear()));
    return Array.from(years);
  }

  async function fetchHolidaysForYear(year) {
    const y = String(year || '').trim();
    if (!/^\d{4}$/.test(y)) return new Set();
    if (holidayCacheByYear[y]) return holidayCacheByYear[y];
    const start = `${y}-01-01`;
    const end = `${y}-12-31`;
    try {
      const resp = await fetch(
        `/school/holidays/api/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await resp.json().catch(() => ({}));
      const holidays = Array.isArray(data?.holidays) ? data.holidays : [];
      const set = new Set(
        holidays.map((row) => core.normalizeDateOnly(row?.date)).filter(Boolean)
      );
      holidayCacheByYear[y] = set;
      return set;
    } catch (err) {
      console.warn('Session enrollment calendar holiday lookup failed', err);
      holidayCacheByYear[y] = new Set();
      return holidayCacheByYear[y];
    }
  }

  async function ensureHolidaysLoaded() {
    if (!state) return;
    const merged = new Set(state.holidayDates || []);
    const years = collectCalendarYears();
    for (const year of years) {
      const set = await fetchHolidaysForYear(year);
      set.forEach((date) => merged.add(date));
    }
    state.holidayDates = merged;
  }

  function getVisibleDayCountForState() {
    if (!state) return 7;
    if (state.viewMode === 'singleDay' || state.viewPreset === 'day') return 1;
    const viewRange = state.viewRange || core.computeViewRange(state.viewPreset, state.anchorDate);
    const blocks = core.buildWeekBlocks(viewRange, { displayStartDate: state.startDate || '' });
    if (!blocks.length) return 7;
    return blocks.reduce((max, week) => Math.max(max, week.days.length), 0);
  }

  function shouldAutoFitDayColumns() {
    if (!state) return false;
    return !state.dayWidthUserAdjusted
      && state.viewMode === 'vertical'
      && core.isWeekRowPreset(state.viewPreset);
  }

  function syncAutoDayWidthMode() {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || !state) return;
    hostEl.classList.toggle('session-cal-auto-day-width', shouldAutoFitDayColumns());
  }

  function applyAutoDayWidthIfNeeded(options = {}) {
    if (!state || !hostEl) return;
    if (!shouldAutoFitDayColumns()) return;
    const dayCount = Number(options.dayCount || getVisibleDayCountForState() || 7);
    const auto = core.computeAutoDayWidth(hostEl, { gutterWidth: 64, dayCount, min: 72, max: 280, fallback: 140 });
    state.dayWidth = auto;
    const dayWidthInput = qs('sessionEnrollmentDayWidth');
    if (dayWidthInput) dayWidthInput.value = String(auto);
  }

  function scheduleCalendarAutoFit() {
    if (!state || state.dayWidthUserAdjusted) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!state || state.dayWidthUserAdjusted) return;
        syncAutoDayWidthMode();
      });
    });
  }

  function syncDayWidthControlVisibility() {
    const wrap = qs('sessionEnrollmentDayWidthWrap');
    if (!wrap || !state) return;
    const show = state.viewMode === 'vertical' && core.isWeekRowPreset(state.viewPreset);
    wrap.classList.toggle('d-none', !show);
  }

  function bindHostResizeObserver() {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || hostResizeObserver) return;
    hostResizeObserver = new ResizeObserver(() => {
      if (!state || state.dayWidthUserAdjusted || !shouldAutoFitDayColumns()) return;
      scheduleCalendarAutoFit();
    });
    hostResizeObserver.observe(hostEl);
  }

  function applyPickerData(data = {}, options = {}) {
    const preserveViewRange = options.preserveViewRange === true;
    allEvents = Array.isArray(data.allEvents) ? data.allEvents : [];
    if (!allEvents.length && Array.isArray(data.events)) allEvents = data.events.slice();

    if (preserveViewRange && data.viewRange) {
      state.viewRange = { ...data.viewRange };
      state.viewPreset = String(data.viewRange.preset || state.viewPreset || 'custom').trim();
      state.anchorDate = core.clampAnchorDate(
        data.viewRange.anchorDate || data.viewRange.startDate || state.anchorDate,
        state.startDate
      );
    } else if (!preserveViewRange) {
      initDefaultViewRange();
    } else {
      const clientAnchor = core.clampAnchorDate(
        state.anchorDate || state.viewRange?.anchorDate || state.startDate || '',
        state.startDate
      );
      state.viewRange = core.computeViewRange(state.viewPreset, clientAnchor);
      state.anchorDate = core.clampAnchorDate(state.viewRange.anchorDate || clientAnchor, state.startDate);
    }
    state.enrollmentAlignment = data.enrollmentAlignment || null;
    if (Array.isArray(data.selectableSessionIds)) state.selectableSessionIds = data.selectableSessionIds;
    syncPresetButtons();
    syncViewModeButtons();
    renderCalendar();
    updateSummary(data.summary);
  }

  async function refreshPickerViewLocally() {
    await ensureHolidaysLoaded();
    const scrollSnapshot = captureScrollPositions();
    state.viewRange = core.computeViewRange(
      state.viewPreset,
      core.clampAnchorDate(state.anchorDate || state.viewRange?.anchorDate || state.startDate, state.startDate)
    );
    state.anchorDate = core.clampAnchorDate(state.viewRange.anchorDate, state.startDate);
    syncPresetButtons();
    renderCalendar();
    restoreScrollPositions(scrollSnapshot);
    updateSummary();
  }

  function qs(id) {
    return document.getElementById(id);
  }

  function getModal() {
    if (!modalEl) modalEl = qs('sessionEnrollmentCalendarModal');
    if (!modalEl) return null;
    if (!modalInstance && global.bootstrap?.Modal) {
      modalInstance = global.bootstrap.Modal.getOrCreateInstance(modalEl);
    }
    return modalInstance;
  }

  function defaultRequestJson(url, method, body) {
    return fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || `Request failed (${res.status})`);
      return payload;
    });
  }

  function buildRequestBody() {
    if (!state) return {};
    const body = {
      classId: state.classId,
      studentId: state.studentId || '',
      startDate: state.startDate,
      endDate: state.endDate,
      viewPreset: state.viewPreset,
      anchorDate: state.anchorDate || state.viewRange?.anchorDate || state.startDate,
      selectedSessionIds: Array.from(state.selectedSet)
    };
    if (state.targetSessionCount) body.targetSessionCount = state.targetSessionCount;
    if (state.targetHours) body.targetHours = state.targetHours;
    if (Array.isArray(state.sessionsToCreate) && state.sessionsToCreate.length) {
      body.pendingStagedSessions = state.sessionsToCreate;
    }
    if (Array.isArray(state.sessions) && state.sessions.length) body.sessions = state.sessions;
    if (Array.isArray(state.persistedSessions) && state.persistedSessions.length) {
      body.persistedSessions = state.persistedSessions;
    }
    if (state.statusMap && typeof state.statusMap === 'object') {
      body.statusMap = state.statusMap;
    }
    return body;
  }

  function getVisibleEvents() {
    const inRange = core.filterEventsByViewRange(allEvents, state.viewRange);
    const enrollStart = core.normalizeDateOnly(state?.startDate || '');
    const visibleIds = new Set(
      inRange.map((row) => String(row?.sessionId || '').trim()).filter(Boolean)
    );
    allEvents.forEach((row) => {
      const id = String(row?.sessionId || '').trim();
      if (!id || visibleIds.has(id)) return;
      if (row?.isStaged === true) {
        inRange.push(row);
        visibleIds.add(id);
      }
    });
    if (enrollStart) {
      return inRange.filter((row) => !row?.date || row.date >= enrollStart);
    }
    return inRange;
  }

  function captureScrollPositions() {
    if (!hostEl) return null;
    const vertical = hostEl.querySelector('.session-cal-vertical-scroll');
    const horizontal = hostEl.querySelector('.session-cal-horizontal-scroll');
    return {
      verticalTop: vertical ? vertical.scrollTop : 0,
      horizontalLeft: horizontal ? horizontal.scrollLeft : 0
    };
  }

  function restoreScrollPositions(saved) {
    if (!hostEl || !saved) return;
    const vertical = hostEl.querySelector('.session-cal-vertical-scroll');
    const horizontal = hostEl.querySelector('.session-cal-horizontal-scroll');
    if (vertical) vertical.scrollTop = saved.verticalTop || 0;
    if (horizontal) horizontal.scrollLeft = saved.horizontalLeft || 0;
  }

  async function fetchPickerData({ remote = false } = {}) {
    if (isManageMode()) {
      await fetchSessionWindowData({ reload: remote });
      return;
    }
    if (isPartialMode()) {
      if (!remote && allEvents.length) {
        await refreshPickerViewLocally();
        return;
      }
      await ensureHolidaysLoaded();
      return;
    }
    if (state?.localPickerMode && !remote && allEvents.length) {
      await refreshPickerViewLocally();
      return;
    }
    await ensureHolidaysLoaded();
    const requestJson = state.requestJson || defaultRequestJson;
    const url = `/school/classes/api/${encodeURIComponent(state.classId)}/enrollment-session-picker`;
    const scrollSnapshot = captureScrollPositions();
    const result = await requestJson(url, 'POST', buildRequestBody());
    applyPickerData(result?.data || {});
    restoreScrollPositions(scrollSnapshot);
  }

  function syncPresetButtons() {
    const activePreset = String(state?.viewPreset || '').trim();
    document.querySelectorAll('[data-session-picker-preset]').forEach((btn) => {
      const preset = String(btn.getAttribute('data-session-picker-preset') || '').trim();
      btn.classList.toggle('active', preset === activePreset && activePreset !== 'custom');
    });
    const rangeLabel = qs('sessionEnrollmentCalendarRangeLabel');
    if (rangeLabel && state.viewRange) {
      rangeLabel.textContent = `${state.viewRange.startDate} – ${state.viewRange.endDate}`;
    }
  }

  function syncViewModeButtons() {
    document.querySelectorAll('[data-session-picker-view]').forEach((btn) => {
      const mode = String(btn.getAttribute('data-session-picker-view') || '').trim();
      btn.classList.toggle('active', mode === state.viewMode);
    });
  }

  function buildPartialEnrollmentBlockHtml(ev) {
    const sessionId = String(ev?.sessionId || '').trim();
    const isStaged = ev?.isStaged === true;
    const timeLabel = `${String(ev?.start || '').trim()} – ${String(ev?.end || '').trim()}`;
    if (isStaged) {
      const menu = global.ScheduleDraftSessionMenu;
      const draftEvent = { ...ev, isDraft: true };
      const draftSelect = menu?.buildDraftSelectHtml ? menu.buildDraftSelectHtml(draftEvent) : '';
      const draftSelected = menu?.isDraftSelected?.(draftEvent) ? ' is-session-selected is-draft-selected' : '';
      const classes = [
        'session-enrollment-block',
        'is-staged',
        draftSelected.trim()
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}"
             data-session-id="${core.escapeHtml(sessionId)}"
             data-selectable="0"
             data-session-kind="staged"
             role="button"
             tabindex="0">
          ${draftSelect}
          <span class="session-cal-draft-resize-handle session-cal-draft-resize-handle-top" data-resize-edge="top" aria-hidden="true"></span>
          <span class="session-cal-draft-resize-handle session-cal-draft-resize-handle-bottom" data-resize-edge="bottom" aria-hidden="true"></span>
          <div class="session-block-status">Staged</div>
          <div class="session-block-teacher">${core.escapeHtml(ev?.teacherName || 'Teacher')}</div>
          <div class="session-block-hours">${core.escapeHtml(core.formatHours(ev?.durationHours))}</div>
          <div class="session-block-time small text-muted">${core.escapeHtml(timeLabel)}</div>
        </div>
      `;
    }
    const classes = 'session-enrollment-block is-scheduled is-unselectable';
    return `
      <div class="${classes}"
           data-session-id="${core.escapeHtml(sessionId)}"
           data-selectable="0"
           data-session-kind="scheduled"
           tabindex="0">
        <div class="session-block-status">Scheduled</div>
        <div class="session-block-teacher">${core.escapeHtml(ev?.teacherName || 'Teacher')}</div>
        <div class="session-block-hours">${core.escapeHtml(core.formatHours(ev?.durationHours))}</div>
        <div class="session-block-time small text-muted">${core.escapeHtml(timeLabel)}</div>
      </div>
    `;
  }

  function buildPartialListDayCardHtml(ev) {
    const sessionId = String(ev?.sessionId || '').trim();
    const isStaged = ev?.isStaged === true;
    const timeLabel = `${String(ev?.start || '').trim()} – ${String(ev?.end || '').trim()}`;
    if (isStaged) {
      const menu = global.ScheduleDraftSessionMenu;
      const draftEvent = { ...ev, isDraft: true };
      const draftSelect = menu?.buildDraftSelectHtml ? menu.buildDraftSelectHtml(draftEvent) : '';
      const draftSelected = menu?.isDraftSelected?.(draftEvent) ? ' is-session-selected is-draft-selected' : '';
      const classes = [
        'session-day-card',
        'is-staged',
        draftSelected.trim()
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}" data-session-id="${core.escapeHtml(sessionId)}" data-selectable="0" data-session-kind="staged" role="button" tabindex="0">
          <div class="d-flex align-items-start gap-2">
            ${draftSelect}
            <div class="flex-grow-1">
              <div class="fw-semibold">Staged · ${core.escapeHtml(timeLabel)}</div>
              <div class="small text-muted">${core.escapeHtml(ev?.teacherName || 'Teacher')}</div>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="session-day-card is-scheduled is-unselectable" data-session-id="${core.escapeHtml(sessionId)}" data-selectable="0" data-session-kind="scheduled" tabindex="0">
        <div class="fw-semibold">Scheduled · ${core.escapeHtml(timeLabel)}</div>
        <div class="small text-muted">${core.escapeHtml(ev?.teacherName || 'Teacher')}</div>
      </div>
    `;
  }

  function deleteSelectedStagedSessions(sessionIds = []) {
    if (!state || !isPartialMode()) return;
    (Array.isArray(sessionIds) ? sessionIds : []).forEach((sessionId) => {
      deleteStagedSession(sessionId);
    });
    renderCalendar();
  }

  function applyBulkStagedSessionTimes(sessionIds = [], values = {}) {
    if (!state || !isPartialMode()) return false;
    const ids = (Array.isArray(sessionIds) ? sessionIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) return false;
    const startTime = String(values.startTime || '').trim();
    const endTime = String(values.endTime || '').trim();
    const durationHours = Number(values.durationHours || 0);
    if (!startTime || !endTime) return false;
    const excludeIds = new Set(ids);
    const conflictSessions = getPartialConflictSessions('').filter((row) => {
      const rowId = String(row?.sessionId || row?.id || '').trim();
      return !excludeIds.has(rowId);
    });
    const selectedRows = (state.sessionsToCreate || []).filter((row) => excludeIds.has(String(row?.sessionId || '').trim()));
    for (const row of selectedRows) {
      const sessionId = String(row?.sessionId || '').trim();
      const hasConflict = core.checkScheduleTimeConflict?.({
        date: row.date,
        startTime,
        endTime,
        sessions: conflictSessions,
        excludeSessionId: sessionId
      });
      if (hasConflict) return false;
    }
    state.sessionsToCreate = (state.sessionsToCreate || []).map((row) => {
      const id = String(row?.sessionId || '').trim();
      if (!excludeIds.has(id)) return row;
      return {
        ...row,
        startTime,
        endTime,
        durationHours
      };
    });
    allEvents = allEvents.map((row) => {
      const id = String(row?.sessionId || '').trim();
      if (!excludeIds.has(id)) return row;
      return {
        ...row,
        start: startTime,
        end: endTime,
        durationHours
      };
    });
    refreshPartialPickerFromState();
    notifyPartialStagedSessionsChange();
    renderCalendar();
    return true;
  }

  function renderCalendar() {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || !state) return;
    syncAutoDayWidthMode();
    applyAutoDayWidthIfNeeded({ dayCount: getVisibleDayCountForState() });
    syncDayWidthControlVisibility();
    const calendarOptions = {
      viewMode: state.viewMode,
      viewPreset: state.viewPreset,
      viewRange: state.viewRange,
      anchorDate: state.anchorDate,
      selectedSet: state.selectedSet,
      dayWidth: state.dayWidth || 140,
      holidayDates: state.holidayDates || null,
      enrollmentStartDate: state.startDate || ''
    };
    if (isManageMode()) {
      calendarOptions.buildPositionedBlockHtml = (ev) => buildManageEnrollmentBlockHtml(ev);
      calendarOptions.buildListDayCardHtml = (ev) => buildManageListDayCardHtml(ev);
    } else if (isPartialMode()) {
      calendarOptions.buildPositionedBlockHtml = (ev) => buildPartialEnrollmentBlockHtml(ev);
      calendarOptions.buildListDayCardHtml = (ev) => buildPartialListDayCardHtml(ev);
    }
    core.renderEnrollmentCalendar(hostEl, getVisibleEvents(), calendarOptions);
    syncAutoDayWidthMode();
    if (shouldAutoFitDayColumns()) {
      scheduleCalendarAutoFit();
    }
  }

  function updateSummary(serverSummary) {
    if (isManageMode()) {
      updateManageSummary();
      return;
    }
    summaryEl = qs('sessionEnrollmentCalendarSummary');
    if (!summaryEl) return;
    const summary = serverSummary || core.summarizeSelectionFromEvents(allEvents, state.selectedSet);
    const count = Number(summary?.selectedCount || 0);
    const hours = Number(summary?.selectedHours || 0);
    const start = String(summary?.selectionStartDate || '').trim();
    const end = String(summary?.selectionEndDate || '').trim();
    const span = start && end ? `${start} – ${end}` : (start || end || '—');
    summaryEl.classList.add('is-plain');
    summaryEl.textContent = `Selected: ${count} session(s), ${core.formatHours(hours)} | Span: ${span}`;
    if (state.onSelectionChange) {
      state.onSelectionChange({
        selectedSessionIds: Array.from(state.selectedSet),
        sessionsToCreate: Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate.slice() : [],
        summary
      });
    }
  }

  function applySelectionClassToBlock(block, selected) {
    const inner = block.querySelector('.session-enrollment-block') || block;
    inner.classList.toggle('is-selected', selected);
    inner.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (block !== inner) {
      block.classList.toggle('is-selected', selected);
      block.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }

  function toggleSession(sessionId, clickedBlock) {
    const id = String(sessionId || '').trim();
    if (!id) return;
    const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === id);
    if (eventRow && eventRow.selectable !== true) return;

    const willSelect = !state.selectedSet.has(id);
    if (willSelect) state.selectedSet.add(id);
    else state.selectedSet.delete(id);

    if (clickedBlock) {
      applySelectionClassToBlock(clickedBlock, willSelect);
    } else if (hostEl) {
      hostEl.querySelectorAll(`[data-session-id="${id}"]`).forEach((block) => {
        applySelectionClassToBlock(block, willSelect);
      });
    }
    updateSummary();
  }

  function handleHostClick(event) {
    if (event.target.closest('[data-session-manage]')) {
      event.stopPropagation();
      return;
    }
    if (isPartialMode()) {
      const draftInput = event.target.closest('[data-schedule-draft-select]');
      const draftLabel = event.target.closest('.schedule-draft-select');
      if (draftInput || draftLabel) {
        event.preventDefault();
        event.stopPropagation();
        const checkbox = draftInput || draftLabel?.querySelector('[data-schedule-draft-select]');
        const sessionId = String(checkbox?.getAttribute('data-draft-session-id') || '').trim();
        if (sessionId && global.ScheduleDraftSessionMenu?.toggleDraftSelection) {
          global.ScheduleDraftSessionMenu.toggleDraftSelection(sessionId);
          renderCalendar();
        }
        return;
      }
    }
    const block = event.target.closest('[data-session-id]');
    if (block) {
      if (isPartialMode() && String(block.getAttribute('data-session-kind') || '') === 'staged') {
        return;
      }
      if (isManageMode()) {
        const sessionId = String(block.getAttribute('data-session-id') || '').trim();
        const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === sessionId);
        if (eventRow) openMarkModalForEvent(eventRow);
        return;
      }
      if (String(block.getAttribute('data-selectable') || '') !== '1') return;
      toggleSession(block.getAttribute('data-session-id'), block);
      return;
    }

    if (isManageMode()) return;

    hostEl = qs('sessionEnrollmentCalendarHost');
    const gridContext = hostEl
      ? core.resolveGridClickContext(hostEl, event.clientX, event.clientY, event.target)
      : null;
    if (gridContext) {
      event.preventDefault();
      event.stopPropagation();
      openStageQuickModal(gridContext);
      return;
    }

    const monthDay = event.target.closest('.session-cal-day[data-cal-date]');
    if (monthDay) {
      const dateStr = String(monthDay.getAttribute('data-cal-date') || '').trim();
      if (dateStr) {
        state.viewPreset = 'day';
        state.dayWidthUserAdjusted = false;
        state.anchorDate = dateStr;
        state.viewMode = 'singleDay';
        state.viewRange = core.computeViewRange('day', dateStr);
        fetchPickerData({ remote: false }).catch((err) => console.error(err));
      }
    }
  }

  function bindModalEvents() {
    if (bound) return;
    bound = true;
    bindStackEscapeHandler();
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (hostEl) {
      hostEl.addEventListener('click', handleHostClick);
      hostEl.addEventListener('contextmenu', handleHostContextMenu);
      bindPartialDraftDragMove();
    }
    bindContextMenuEvents();

    qs('sessionEnrollmentCalendarSummary')?.addEventListener('click', (event) => {
      if (event.target.closest('#btn_stageAllEnrollmentNaUnmarks')) {
        event.preventDefault();
        stageAllSavedNaUnmarks();
      }
    });

    qs('btn_sessionEnrollmentCalendarLegend')?.addEventListener('click', () => {
      openEnrollmentSessionsLegendModal();
    });

    qs('btn_sessionEnrollmentBulkNa')?.addEventListener('click', () => {
      openBulkNaModal();
    });

    document.querySelectorAll('[data-session-picker-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = String(btn.getAttribute('data-session-picker-preset') || '').trim();
        if (!preset || !state) return;
        state.viewPreset = preset;
        state.viewMode = core.suggestViewModeForPreset(preset);
        if (preset !== 'day' && state.viewMode === 'singleDay') {
          state.viewMode = 'vertical';
        }
        state.dayWidthUserAdjusted = false;
        applyViewRange(computePresetViewRange(preset));
        syncViewModeButtons();
        fetchPickerData({ remote: false }).catch((err) => console.error(err));
      });
    });

    document.querySelectorAll('[data-session-picker-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = String(btn.getAttribute('data-session-picker-view') || '').trim();
        if (!mode || !state) return;
        const scrollSnapshot = captureScrollPositions();
        if (mode === 'vertical') {
          state.dayWidthUserAdjusted = false;
        }
        state.viewMode = mode;
        syncViewModeButtons();
        renderCalendar();
        restoreScrollPositions(scrollSnapshot);
      });
    });

    qs('btn_sessionEnrollmentCalendarPrev')?.addEventListener('click', () => {
      if (!state) return;
      state.dayWidthUserAdjusted = false;
      const bounds = resolveEnrollmentWindowBounds();
      const shifted = core.shiftViewRange(state.viewRange, -1, bounds);
      if (isManageMode()) {
        applyViewRange(shifted);
      } else {
        state.viewRange = core.clampViewRangeToEnrollmentStart(shifted, state.startDate);
        state.anchorDate = state.viewRange.anchorDate;
      }
      fetchPickerData({ remote: false }).catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarNext')?.addEventListener('click', () => {
      if (!state) return;
      state.dayWidthUserAdjusted = false;
      const bounds = resolveEnrollmentWindowBounds();
      const shifted = core.shiftViewRange(state.viewRange, 1, bounds);
      if (isManageMode()) {
        applyViewRange(shifted);
      } else {
        state.viewRange = shifted;
        state.anchorDate = state.viewRange.anchorDate;
      }
      fetchPickerData({ remote: false }).catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarToday')?.addEventListener('click', () => {
      if (!state) return;
      state.dayWidthUserAdjusted = false;
      state.anchorDate = core.clampAnchorDate(core.parseAnchorDate(''), state.startDate);
      if (isManageMode()) {
        applyViewRange(computePresetViewRange(state.viewPreset));
      } else {
        state.viewRange = core.computeViewRange(state.viewPreset, state.anchorDate);
      }
      fetchPickerData({ remote: false }).catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarClear')?.addEventListener('click', () => {
      if (!state) return;
      state.selectedSet.clear();
      renderCalendar();
      updateSummary();
    });

    qs('btn_sessionEnrollmentCalendarSave')?.addEventListener('click', () => {
      if (!state) return;
      const summary = core.summarizeSelectionFromEvents(allEvents, state.selectedSet);
      let sessionsToCreate = Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate.slice() : [];
      if (isPartialMode()) {
        const stagedFromEvents = allEvents
          .filter((ev) => ev?.isStaged === true)
            .map((ev) => ({
            sessionId: String(ev?.sessionId || '').trim(),
            date: core.normalizeDateOnly(ev?.date),
            startTime: String(ev?.start || ev?.startTime || '').trim(),
            endTime: String(ev?.end || ev?.endTime || '').trim(),
            durationHours: Number(ev?.durationHours || 0),
            stagingAttemptId: String(ev?.stagingAttemptId || '').trim(),
            isStaged: true
          }))
          .filter((row) => row.sessionId && row.date);
        if (stagedFromEvents.length) sessionsToCreate = stagedFromEvents;
      }
      const payload = {
        selectedSessionIds: Array.from(state.selectedSet),
        sessionsToCreate,
        stagingAttempts: Array.isArray(state.stagingAttempts) ? state.stagingAttempts.slice() : [],
        summary,
        viewRange: state.viewRange ? { ...state.viewRange } : null
      };
      if (state.onSave) state.onSave(payload);
      getModal()?.hide();
    });

    qs('btn_sessionEnrollmentCalendarDone')?.addEventListener('click', async () => {
      if (!state || state.markSaveInFlight) return;
      const doneBtn = qs('btn_sessionEnrollmentCalendarDone');
      const summaryEl = qs('sessionEnrollmentCalendarSummary');
      const onMarksChanged = state.onMarksChanged;
      if (!hasPendingMarkChanges()) {
        getModal()?.hide();
        return;
      }
      const balance = getManageCapBalance();
      if (!canSavePendingMarks()) {
        updateManageSummary();
        return;
      }
      state.markSaveInFlight = true;
      if (doneBtn) doneBtn.disabled = true;
      syncDoneButtonLabel();
      let saveResult = null;
      try {
        saveResult = await flushPendingMarks();
        await fetchSessionWindowData({ reload: true });
        if (typeof onMarksChanged === 'function') {
          await onMarksChanged(saveResult);
        }
        getModal()?.hide();
      } catch (err) {
        if (summaryEl) {
          summaryEl.classList.remove('d-none', 'is-plain');
          summaryEl.innerHTML = `<div class="alert alert-warning py-2 mb-0 small">${core.escapeHtml(formatManageSaveError(err?.message))}</div>`;
        }
      } finally {
        state.markSaveInFlight = false;
        syncDoneButtonLabel();
      }
    });

    qs('sessionEnrollmentDayWidth')?.addEventListener('input', (event) => {
      if (!state) return;
      const scrollSnapshot = captureScrollPositions();
      state.dayWidthUserAdjusted = true;
      state.dayWidth = Number(event.target?.value || 140);
      renderCalendar();
      restoreScrollPositions(scrollSnapshot);
    });

    bindHostResizeObserver();

    modalEl?.addEventListener('shown.bs.modal', () => {
      scheduleCalendarAutoFit();
    });

    modalEl?.addEventListener('hidden.bs.modal', () => {
      hideStageQuickModalLayer();
      hideMarkModalLayer();
      hideBulkNaModalLayer();
      setStageOverlayLock(false);
      state = null;
      allEvents = [];
      manageSummaryMeta = null;
    });
  }

  function mapStagedRowToPartialEvent(row, classId, classLabel, selectedSet) {
    const sessionId = String(row?.sessionId || '').trim();
    const date = core.normalizeDateOnly(row?.date);
    const start = String(row?.startTime || row?.start || '').trim();
    const end = String(row?.endTime || row?.end || '').trim();
    return {
      sessionId,
      classId: String(classId || '').trim(),
      date,
      start,
      end,
      durationHours: Number(row?.durationHours || 0),
      teacherName: String(row?.teacherName || '').trim() || 'Teacher',
      title: String(classLabel || '').trim(),
      manageable: false,
      manageSessionUrl: '',
      selectable: false,
      excludeReason: '',
      isStaged: true,
      stagingAttemptId: String(row?.stagingAttemptId || '').trim(),
      selected: false
    };
  }

  function buildPartialPickerData(options = {}) {
    const classId = String(options.classId || '').trim();
    const classLabel = String(options.classLabel || '').trim();
    const sessionsToCreate = Array.isArray(options.sessionsToCreate) ? options.sessionsToCreate : [];
    const existingEvents = Array.isArray(options.existingEvents) ? options.existingEvents : [];
    const dates = sessionsToCreate
      .map((row) => core.normalizeDateOnly(row?.date))
      .filter(Boolean)
      .sort();
    const startDate = core.normalizeDateOnly(options.startDate || dates[0] || '');
    const endDate = core.normalizeDateOnly(options.endDate || dates[dates.length - 1] || startDate);
    const selectedSet = new Set(
      sessionsToCreate.map((row) => String(row?.sessionId || '').trim()).filter(Boolean)
    );
    const stagedEvents = sessionsToCreate.map((row) => mapStagedRowToPartialEvent(row, classId, classLabel, selectedSet));
    const persistedEvents = existingEvents
      .filter((ev) => String(ev?.classId || '').trim() === classId)
      .filter((ev) => {
        const date = core.normalizeDateOnly(ev?.date);
        return date && (!startDate || date >= startDate) && (!endDate || date <= endDate);
      })
      .map((ev) => ({
        sessionId: String(ev?.sessionId || ev?.id || '').trim(),
        classId,
        date: core.normalizeDateOnly(ev?.date),
        start: String(ev?.start || ev?.startTime || '').trim(),
        end: String(ev?.end || ev?.endTime || '').trim(),
        durationHours: Number(ev?.duration || ev?.durationHours || 0),
        teacherName: String(ev?.teacherName || '').trim() || 'Teacher',
        title: String(ev?.className || classLabel || '').trim(),
        manageable: false,
        selectable: false,
        isStaged: false
      }));
    const allPickerEvents = [...persistedEvents, ...stagedEvents];
    const viewRange = {
      startDate,
      endDate,
      preset: 'custom',
      anchorDate: startDate
    };
    return {
      events: stagedEvents,
      allEvents: allPickerEvents,
      viewRange,
      summary: core.summarizeSelectionFromEvents(allPickerEvents, selectedSet),
      selectableSessionIds: stagedEvents.map((row) => row.sessionId).filter(Boolean)
    };
  }

  function open(options = {}) {
    const classId = String(options.classId || '').trim();
    const mode = String(options.mode || 'picker').trim();
    const periodId = String(options.periodId || '').trim();
    if (!classId) {
      console.error('SessionEnrollmentCalendarModal.open requires classId');
      return;
    }
    if (mode === 'manageEnrollmentSessions' && !periodId) {
      console.error('SessionEnrollmentCalendarModal.open manage mode requires periodId');
      return;
    }
    bindModalEvents();
    modalEl = qs('sessionEnrollmentCalendarModal');
    allEvents = [];
    manageSummaryMeta = null;
    syncStudentBanner({
      mode,
      studentLabel: options.studentLabel,
      studentName: options.studentName,
      studentId: options.studentId,
      classLabel: options.classLabel,
      classId,
      startDate: options.startDate,
      endDate: options.endDate
    });

    const viewPreset = mode === 'manageEnrollmentSessions'
      ? 'thirtyDays'
      : (mode === 'partial'
        ? 'custom'
        : String(options.viewPreset || 'thirtyDays').trim());
    const anchorDate = mode === 'manageEnrollmentSessions'
      ? core.parseAnchorDate('')
      : core.clampAnchorDate(
        core.parseAnchorDate(options.anchorDate || options.startDate || ''),
        options.startDate || ''
      );
    state = {
      mode,
      periodId,
      classId,
      studentId: String(options.studentId || '').trim(),
      studentLabel: String(options.studentLabel || options.studentName || options.studentId || '').trim(),
      classLabel: String(options.classLabel || '').trim(),
      startDate: String(options.startDate || '').trim(),
      endDate: String(options.endDate || '').trim(),
      cycleEndDate: String(options.cycleEndDate || '').trim(),
      targetSessionCount: Number(options.targetSessionCount || 0),
      targetHours: Number(options.targetHours || 0),
      sessionsToCreate: Array.isArray(options.sessionsToCreate) ? options.sessionsToCreate : [],
      stagingAttempts: Array.isArray(options.stagingAttempts) ? options.stagingAttempts.slice() : [],
      conflictScheduleEvents: Array.isArray(options.conflictScheduleEvents) ? options.conflictScheduleEvents : [],
      pendingEditAttemptId: '',
      sessions: Array.isArray(options.sessions) ? options.sessions : [],
      persistedSessions: Array.isArray(options.persistedSessions) ? options.persistedSessions : [],
      statusMap: (options.statusMap && typeof options.statusMap === 'object') ? options.statusMap : null,
      localPickerMode: options.localPickerMode === true || Boolean(options.prefetchedPickerData),
      viewPreset,
      viewMode: String(options.viewMode || core.suggestViewModeForPreset(viewPreset)).trim(),
      anchorDate,
      viewRange: core.computeViewRange(viewPreset, anchorDate),
      holidayDates: new Set(),
      selectedSet: new Set(
        (Array.isArray(options.selectedSessionIds) ? options.selectedSessionIds : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      ),
      dayWidth: Number(options.dayWidth || 140),
      dayWidthUserAdjusted: false,
      scheduleDefaults: (options.scheduleDefaults && typeof options.scheduleDefaults === 'object')
        ? options.scheduleDefaults
        : {},
      onSave: options.onSave,
      onSelectionChange: options.onSelectionChange,
      onStagedSessionsChange: options.onStagedSessionsChange,
      onMarksChanged: options.onMarksChanged,
      requestJson: options.requestJson,
      pendingMarkChanges: new Map(),
      sessionWindowLoaded: false,
      markSaveInFlight: false
    };

    if (mode === 'partial') {
      state.localPickerMode = true;
      initPartialModeViewRange();
      (Array.isArray(options.sessionsToCreate) ? options.sessionsToCreate : []).forEach((row) => {
        const id = String(row?.sessionId || '').trim();
        if (id) state.selectedSet.add(id);
      });
    }

    syncModalChromeForMode();

    const dayWidth = Number(options.dayWidth || 140);
    state.dayWidth = dayWidth;
    const dayWidthInput = qs('sessionEnrollmentDayWidth');
    if (dayWidthInput) dayWidthInput.value = String(dayWidth);

    hostEl = qs('sessionEnrollmentCalendarHost');
    if (mode === 'partial' || (options.prefetchedPickerData && mode !== 'manageEnrollmentSessions')) {
      const pickerData = options.prefetchedPickerData || buildPartialPickerData({
        classId,
        classLabel: options.classLabel,
        sessionsToCreate: options.sessionsToCreate,
        existingEvents: options.existingEvents,
        startDate: options.startDate,
        endDate: options.endDate
      });
      getModal()?.show();
      ensureHolidaysLoaded()
        .then(() => applyPickerData(pickerData, { preserveViewRange: mode === 'partial' }))
        .catch((err) => console.error(err));
      return;
    }

    if (hostEl) {
      hostEl.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><div class="mt-2 text-muted small">Loading sessions...</div></div>';
    }

    getModal()?.show();
    if (mode === 'manageEnrollmentSessions') {
      fetchSessionWindowData({ reload: true }).catch((err) => {
        if (hostEl) {
          hostEl.innerHTML = `<div class="alert alert-warning">${core.escapeHtml(err.message || 'Unable to load sessions.')}</div>`;
        }
      });
      return;
    }
    fetchPickerData().catch((err) => {
      if (hostEl) {
        hostEl.innerHTML = `<div class="alert alert-warning">${core.escapeHtml(err.message || 'Unable to load sessions.')}</div>`;
      }
    });
  }

  global.SessionEnrollmentCalendarModal = {
    open,
    isOpen: isModalOpen,
    buildPartialPickerData,
    collectHolidayDatesForRange,
    syncFromParentDrafts,
    getStagingAttempts,
    deleteStagedSession,
    deleteSelectedStagedSessions,
    deleteStagedAttempt,
    editStagedSession,
    editStagedAttempt,
    moveStagedSession,
    applyBulkStagedSessionTimes,
    PRESET_LABELS
  };
})(typeof window !== 'undefined' ? window : global);
