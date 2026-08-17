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
    month: 'Month',
    twoMonths: '2 Months',
    threeMonths: '3 Months'
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
  const STAGE_COUNT_MIN = 1;
  const STAGE_COUNT_MAX = 52;

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
      selectable: true,
      excludeReason: '',
      isStaged: true,
      selected: state.selectedSet.has(sessionId)
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

  function handleEnrollmentModalStackEscape(event) {
    if (event.key !== 'Escape') return;
    if (stageOverlayLockActive || isStageOverlayOpen()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      hideStageQuickModalLayer();
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

  function commitQuickStagedSessionsFromForm() {
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
    const durationHours = readStageDurationHours();
    const count = readStageSessionCount();
    const result = core.generateRotatingWeekdaySessions({
      anchorDate: stageContext.date,
      startTime: stageContext.startTime24,
      durationHours,
      weekdays,
      count,
      enrollmentStart: state.startDate,
      enrollmentEnd: state.endDate,
      existingSessions: getExistingSessionsForStaging(),
      alreadyStaged: state.sessionsToCreate || [],
      scheduleDefaults: state.scheduleDefaults || {}
    });
    if (!result.sessions.length) {
      showStageFormError('No sessions fit in the enrollment window. Adjust weekdays, count, or enrollment dates.');
      return;
    }
    const clickedDate = stageContext.date;
    hideStageQuickModalLayer();
    commitQuickStagedSessions(result.sessions, clickedDate);
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
    const value = Number(display?.textContent || stageSessionCount || 1);
    if (!Number.isFinite(value)) return STAGE_COUNT_MIN;
    return Math.max(STAGE_COUNT_MIN, Math.min(STAGE_COUNT_MAX, Math.round(value)));
  }

  function syncStageCountDisplay(count) {
    stageSessionCount = Math.max(STAGE_COUNT_MIN, Math.min(STAGE_COUNT_MAX, Math.round(Number(count) || 1)));
    const display = qs('sessionEnrollmentStageCountDisplay');
    if (display) display.textContent = String(stageSessionCount);
    stageModalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
      const chip = Number(btn.getAttribute('data-stage-count'));
      btn.classList.toggle('active', chip === stageSessionCount);
    });
  }

  function updateStageCapacityWarning() {
    const warningEl = qs('sessionEnrollmentStageCapacityWarning');
    if (!warningEl || !stageContext || !state) {
      if (warningEl) warningEl.classList.add('d-none');
      return;
    }
    const preview = core.generateRotatingWeekdaySessions({
      anchorDate: stageContext.date,
      startTime: stageContext.startTime24,
      durationHours: readStageDurationHours(),
      weekdays: readStageWeekdays(),
      count: readStageSessionCount(),
      enrollmentStart: state.startDate,
      enrollmentEnd: state.endDate,
      existingSessions: getExistingSessionsForStaging(),
      alreadyStaged: state.sessionsToCreate || [],
      scheduleDefaults: state.scheduleDefaults || {}
    });
    const requested = readStageSessionCount();
    if (preview.capacity < requested) {
      warningEl.textContent = `Only ${preview.capacity} of ${requested} can fit in the enrollment window.`;
      warningEl.classList.remove('d-none');
    } else {
      warningEl.classList.add('d-none');
      warningEl.textContent = '';
    }
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
        commitQuickStagedSessionsFromForm();
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
        updateStageCapacityWarning();
      });
    });

    stageModalEl?.querySelectorAll('[data-stage-weekday]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        if (!readStageWeekdays().length) btn.classList.add('active');
        updateStageCapacityWarning();
      });
    });

    qs('btn_sessionEnrollmentStageCountDown')?.addEventListener('click', () => {
      syncStageCountDisplay(readStageSessionCount() - 1);
      updateStageCapacityWarning();
    });

    qs('btn_sessionEnrollmentStageCountUp')?.addEventListener('click', () => {
      syncStageCountDisplay(readStageSessionCount() + 1);
      updateStageCapacityWarning();
    });

    stageModalEl?.querySelectorAll('[data-stage-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncStageCountDisplay(Number(btn.getAttribute('data-stage-count') || 1));
        updateStageCapacityWarning();
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

  function applyPickerData(data = {}) {
    allEvents = Array.isArray(data.allEvents) ? data.allEvents : [];
    if (!allEvents.length && Array.isArray(data.events)) allEvents = data.events.slice();

    const clientAnchor = core.clampAnchorDate(
      state.anchorDate || state.viewRange?.anchorDate || state.startDate || '',
      state.startDate
    );
    state.viewRange = core.computeViewRange(state.viewPreset, clientAnchor);
    state.anchorDate = core.clampAnchorDate(state.viewRange.anchorDate || clientAnchor, state.startDate);
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
    document.querySelectorAll('[data-session-picker-preset]').forEach((btn) => {
      const preset = String(btn.getAttribute('data-session-picker-preset') || '').trim();
      btn.classList.toggle('active', preset === state.viewPreset);
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

  function renderCalendar() {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl || !state) return;
    syncAutoDayWidthMode();
    applyAutoDayWidthIfNeeded({ dayCount: getVisibleDayCountForState() });
    syncDayWidthControlVisibility();
    core.renderEnrollmentCalendar(hostEl, getVisibleEvents(), {
      viewMode: state.viewMode,
      viewPreset: state.viewPreset,
      viewRange: state.viewRange,
      anchorDate: state.anchorDate,
      selectedSet: state.selectedSet,
      dayWidth: state.dayWidth || 140,
      holidayDates: state.holidayDates || null,
      enrollmentStartDate: state.startDate || ''
    });
    syncAutoDayWidthMode();
    if (shouldAutoFitDayColumns()) {
      scheduleCalendarAutoFit();
    }
  }

  function updateSummary(serverSummary) {
    summaryEl = qs('sessionEnrollmentCalendarSummary');
    if (!summaryEl) return;
    const summary = serverSummary || core.summarizeSelectionFromEvents(allEvents, state.selectedSet);
    const count = Number(summary?.selectedCount || 0);
    const hours = Number(summary?.selectedHours || 0);
    const start = String(summary?.selectionStartDate || '').trim();
    const end = String(summary?.selectionEndDate || '').trim();
    const span = start && end ? `${start} – ${end}` : (start || end || '—');
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
    const block = event.target.closest('[data-session-id]');
    if (block) {
      if (String(block.getAttribute('data-selectable') || '') !== '1') return;
      toggleSession(block.getAttribute('data-session-id'), block);
      return;
    }

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
    if (hostEl) hostEl.addEventListener('click', handleHostClick);

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
        state.viewRange = core.computeViewRange(preset, state.viewRange?.anchorDate || state.anchorDate);
        state.anchorDate = state.viewRange.anchorDate;
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
      state.viewRange = core.clampViewRangeToEnrollmentStart(
        core.shiftViewRange(state.viewRange, -1),
        state.startDate
      );
      state.anchorDate = state.viewRange.anchorDate;
      fetchPickerData({ remote: false }).catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarNext')?.addEventListener('click', () => {
      if (!state) return;
      state.dayWidthUserAdjusted = false;
      state.viewRange = core.shiftViewRange(state.viewRange, 1);
      state.anchorDate = state.viewRange.anchorDate;
      fetchPickerData({ remote: false }).catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarToday')?.addEventListener('click', () => {
      if (!state) return;
      state.dayWidthUserAdjusted = false;
      state.anchorDate = core.clampAnchorDate(core.parseAnchorDate(''), state.startDate);
      state.viewRange = core.computeViewRange(state.viewPreset, state.anchorDate);
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
      const payload = {
        selectedSessionIds: Array.from(state.selectedSet),
        sessionsToCreate: Array.isArray(state.sessionsToCreate) ? state.sessionsToCreate.slice() : [],
        summary
      };
      if (state.onSave) state.onSave(payload);
      getModal()?.hide();
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
      setStageOverlayLock(false);
      state = null;
      allEvents = [];
    });
  }

  function open(options = {}) {
    const classId = String(options.classId || '').trim();
    if (!classId) {
      console.error('SessionEnrollmentCalendarModal.open requires classId');
      return;
    }
    bindModalEvents();
    contextLabelEl = qs('sessionEnrollmentCalendarContext');
    if (contextLabelEl) {
      const student = String(options.studentLabel || options.studentName || options.studentId || '').trim();
      const classLabel = String(options.classLabel || '').trim();
      contextLabelEl.textContent = [student, classLabel].filter(Boolean).join(' · ') || classId;
    }

    const viewPreset = String(options.viewPreset || 'week').trim();
    const anchorDate = core.clampAnchorDate(
      core.parseAnchorDate(options.anchorDate || options.startDate || ''),
      options.startDate || ''
    );
    state = {
      classId,
      studentId: String(options.studentId || '').trim(),
      startDate: String(options.startDate || '').trim(),
      endDate: String(options.endDate || '').trim(),
      targetSessionCount: Number(options.targetSessionCount || 0),
      targetHours: Number(options.targetHours || 0),
      sessionsToCreate: Array.isArray(options.sessionsToCreate) ? options.sessionsToCreate : [],
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
      requestJson: options.requestJson
    };

    const dayWidth = Number(options.dayWidth || 140);
    state.dayWidth = dayWidth;
    const dayWidthInput = qs('sessionEnrollmentDayWidth');
    if (dayWidthInput) dayWidthInput.value = String(dayWidth);

    hostEl = qs('sessionEnrollmentCalendarHost');
    if (options.prefetchedPickerData) {
      getModal()?.show();
      ensureHolidaysLoaded()
        .then(() => applyPickerData(options.prefetchedPickerData))
        .catch((err) => console.error(err));
      return;
    }

    if (hostEl) {
      hostEl.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><div class="mt-2 text-muted small">Loading sessions...</div></div>';
    }

    getModal()?.show();
    fetchPickerData().catch((err) => {
      if (hostEl) {
        hostEl.innerHTML = `<div class="alert alert-warning">${core.escapeHtml(err.message || 'Unable to load sessions.')}</div>`;
      }
    });
  }

  global.SessionEnrollmentCalendarModal = {
    open,
    PRESET_LABELS
  };
})(typeof window !== 'undefined' ? window : global);
