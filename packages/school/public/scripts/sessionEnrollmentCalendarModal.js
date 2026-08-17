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
      anchorDate: state.viewRange?.anchorDate || state.anchorDate || state.startDate,
      selectedSessionIds: Array.from(state.selectedSet)
    };
    if (state.targetSessionCount) body.targetSessionCount = state.targetSessionCount;
    if (state.targetHours) body.targetHours = state.targetHours;
    if (Array.isArray(state.sessionsToCreate) && state.sessionsToCreate.length) {
      body.pendingStagedSessions = state.sessionsToCreate;
    }
  if (Array.isArray(state.sessions) && state.sessions.length) body.sessions = state.sessions;
    return body;
  }

  async function fetchPickerData() {
    const requestJson = state.requestJson || defaultRequestJson;
    const url = `/school/classes/api/${encodeURIComponent(state.classId)}/enrollment-session-picker`;
    const result = await requestJson(url, 'POST', buildRequestBody());
    const data = result?.data || {};
    allEvents = Array.isArray(data.allEvents) ? data.allEvents : [];
    if (!allEvents.length && Array.isArray(data.events)) allEvents = data.events.slice();
    state.viewRange = data.viewRange || core.computeViewRange(state.viewPreset, state.anchorDate);
    state.enrollmentAlignment = data.enrollmentAlignment || null;
    if (Array.isArray(data.selectableSessionIds)) state.selectableSessionIds = data.selectableSessionIds;
    syncPresetButtons();
    syncViewModeButtons();
    renderCalendar(data.events || []);
    updateSummary(data.summary);
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

  function renderCalendar(visibleEvents) {
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (!hostEl) return;
    const events = Array.isArray(visibleEvents) ? visibleEvents : allEvents;
    core.renderEnrollmentCalendar(hostEl, events, {
      viewMode: state.viewMode,
      viewPreset: state.viewPreset,
      viewRange: state.viewRange,
      anchorDate: state.anchorDate,
      selectedSet: state.selectedSet,
      dayWidth: state.dayWidth || 140
    });
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
        summary
      });
    }
  }

  function toggleSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return;
    const eventRow = allEvents.find((row) => String(row?.sessionId || '').trim() === id);
    if (eventRow && eventRow.selectable !== true) return;
    if (state.selectedSet.has(id)) state.selectedSet.delete(id);
    else state.selectedSet.add(id);
    renderCalendar();
    updateSummary();
  }

  function handleHostClick(event) {
    if (event.target.closest('[data-session-manage]')) {
      event.stopPropagation();
      return;
    }
    const block = event.target.closest('[data-session-id]');
    if (!block) {
      const dayCell = event.target.closest('[data-cal-date]');
      if (dayCell) {
        const dateStr = String(dayCell.getAttribute('data-cal-date') || '').trim();
        if (dateStr) {
          state.viewPreset = 'day';
          state.anchorDate = dateStr;
          state.viewMode = 'singleDay';
          state.viewRange = core.computeViewRange('day', dateStr);
          fetchPickerData().catch((err) => console.error(err));
        }
      }
      return;
    }
    if (String(block.getAttribute('data-selectable') || '') !== '1') return;
    toggleSession(block.getAttribute('data-session-id'));
  }

  function bindModalEvents() {
    if (bound) return;
    bound = true;
    hostEl = qs('sessionEnrollmentCalendarHost');
    if (hostEl) hostEl.addEventListener('click', handleHostClick);

    document.querySelectorAll('[data-session-picker-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = String(btn.getAttribute('data-session-picker-preset') || '').trim();
        if (!preset || !state) return;
        state.viewPreset = preset;
        state.viewMode = core.suggestViewModeForPreset(preset);
        state.viewRange = core.computeViewRange(preset, state.viewRange?.anchorDate || state.anchorDate);
        fetchPickerData().catch((err) => console.error(err));
      });
    });

    document.querySelectorAll('[data-session-picker-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = String(btn.getAttribute('data-session-picker-view') || '').trim();
        if (!mode || !state) return;
        state.viewMode = mode;
        syncViewModeButtons();
        renderCalendar();
      });
    });

    qs('btn_sessionEnrollmentCalendarPrev')?.addEventListener('click', () => {
      if (!state) return;
      state.viewRange = core.shiftViewRange(state.viewRange, -1);
      state.anchorDate = state.viewRange.anchorDate;
      fetchPickerData().catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarNext')?.addEventListener('click', () => {
      if (!state) return;
      state.viewRange = core.shiftViewRange(state.viewRange, 1);
      state.anchorDate = state.viewRange.anchorDate;
      fetchPickerData().catch((err) => console.error(err));
    });

    qs('btn_sessionEnrollmentCalendarToday')?.addEventListener('click', () => {
      if (!state) return;
      state.anchorDate = core.parseAnchorDate('');
      state.viewRange = core.computeViewRange(state.viewPreset, state.anchorDate);
      fetchPickerData().catch((err) => console.error(err));
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
        summary
      };
      if (state.onSave) state.onSave(payload);
      getModal()?.hide();
    });

    qs('sessionEnrollmentDayWidth')?.addEventListener('input', (event) => {
      if (!state) return;
      state.dayWidth = Number(event.target?.value || 140);
      renderCalendar();
    });

    modalEl?.addEventListener('hidden.bs.modal', () => {
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
    const anchorDate = core.parseAnchorDate(options.anchorDate || options.startDate || '');
    state = {
      classId,
      studentId: String(options.studentId || '').trim(),
      startDate: String(options.startDate || '').trim(),
      endDate: String(options.endDate || '').trim(),
      targetSessionCount: Number(options.targetSessionCount || 0),
      targetHours: Number(options.targetHours || 0),
      sessionsToCreate: Array.isArray(options.sessionsToCreate) ? options.sessionsToCreate : [],
      sessions: Array.isArray(options.sessions) ? options.sessions : [],
      viewPreset,
      viewMode: String(options.viewMode || core.suggestViewModeForPreset(viewPreset)).trim(),
      anchorDate,
      viewRange: core.computeViewRange(viewPreset, anchorDate),
      selectedSet: new Set(
        (Array.isArray(options.selectedSessionIds) ? options.selectedSessionIds : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      ),
      dayWidth: Number(options.dayWidth || 140),
      onSave: options.onSave,
      onSelectionChange: options.onSelectionChange,
      requestJson: options.requestJson
    };

    hostEl = qs('sessionEnrollmentCalendarHost');
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
