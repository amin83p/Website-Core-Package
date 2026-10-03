(function (global) {
  'use strict';

  function installMasterScheduleMoveSessions(deps) {
    if (!deps || typeof deps !== 'object') return;
    const state = {
      step: 'class',
      classId: '',
      sessions: [],
      targetClassId: '',
      targetClassTitle: '',
      preview: null
    };

    function clean(value) {
      return String(value || '').trim();
    }

    function escapeHtml(value) {
      return typeof deps.escapeHtml === 'function'
        ? deps.escapeHtml(value)
        : String(value ?? '');
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
    }

    function formatSessionDate(value) {
      const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return clean(value);
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }

    function formatSessionListItem(session) {
      const date = formatSessionDate(session?.date);
      const start = clean(session?.startTime).slice(0, 5);
      const end = clean(session?.endTime).slice(0, 5);
      if (date && start && end) return `${date} · ${start}–${end}`;
      if (date && start) return `${date} · ${start}`;
      return date || clean(session?.sessionId);
    }

    function setAlert(id, rows, kind) {
      const el = document.getElementById(id);
      if (!el) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        el.classList.add('d-none');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('d-none', 'alert-warning', 'alert-info', 'alert-danger');
      el.classList.add(kind === 'info' ? 'alert-info' : 'alert-warning');
      el.innerHTML = list.map((row, index) => {
        const message = escapeHtml(typeof row === 'string' ? row : (row.message || ''));
        const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
        const gap = index < list.length - 1 ? ' class="mb-2"' : '';
        if (!sessions.length) return `<div${gap}>${message}</div>`;
        const items = sessions.map((session) => `<li>${escapeHtml(formatSessionListItem(session))}</li>`).join('');
        return `<div${gap}>${message}<ul class="mb-0 mt-1 ps-3">${items}</ul></div>`;
      }).join('');
    }

    function showStep(step) {
      state.step = step;
      document.querySelectorAll('[data-move-step]').forEach((el) => {
        el.classList.toggle('d-none', el.getAttribute('data-move-step') !== step);
      });
      document.querySelectorAll('[data-move-step-pill]').forEach((el) => {
        const active = el.getAttribute('data-move-step-pill') === step;
        el.classList.toggle('text-bg-primary', active);
        el.classList.toggle('text-bg-light', !active);
        el.classList.toggle('border', !active);
      });
      const back = document.getElementById('btn_scheduleMoveBack');
      const next = document.getElementById('btn_scheduleMoveNext');
      if (back) back.classList.toggle('d-none', step === 'class');
      if (next) next.textContent = step === 'enrollments' ? 'Move' : 'Next';
    }

    function selectionContext() {
      const savedCount = typeof deps.countActiveScheduleSelectedSessions === 'function'
        ? deps.countActiveScheduleSelectedSessions()
        : 0;
      const stagedCount = typeof deps.countActiveDraftSelectedSessions === 'function'
        ? deps.countActiveDraftSelectedSessions()
        : 0;
      if (savedCount > 0 && stagedCount > 0) return { error: 'mixed' };
      if (stagedCount > 0 && savedCount < 1) return { error: 'staged' };
      const events = typeof deps.getSelectedSavedClassSessionEvents === 'function'
        ? deps.getSelectedSavedClassSessionEvents()
        : [];
      if (!Array.isArray(events) || events.length < 1) return { error: 'insufficient' };
      const classIds = new Set(events.map((ev) => clean(ev?.classId)).filter(Boolean));
      if (classIds.size !== 1) return { error: 'mixed-class' };
      return {
        classId: Array.from(classIds)[0],
        sessions: events.map((ev) => ({
          sessionId: clean(ev?.sessionId || ev?.id),
          date: clean(ev?.date),
          start: clean(ev?.start),
          end: clean(ev?.end)
        })).filter((row) => row.sessionId)
      };
    }

    async function refreshPreview(options = {}) {
      const startTime = options.ignoreStartTime
        ? ''
        : clean(document.getElementById('scheduleMoveStartTime')?.value);
      const data = await postJson('/school/schedules/api/move-sessions/preview', {
        classId: state.classId,
        targetClassId: state.targetClassId,
        startTime,
        sessions: state.sessions
      });
      state.preview = data.data || null;
      return state.preview;
    }

    function renderClassStep(preview) {
      const summary = document.getElementById('scheduleMoveClassSummary');
      const label = document.getElementById('scheduleMoveTargetClassLabel');
      if (label) label.textContent = state.targetClassTitle || 'No class selected';
      if (summary && preview) {
        summary.textContent = `Source capacity ${preview.sourceCapacity}. Target capacity ${preview.targetCapacity}.`;
      } else if (summary) {
        summary.textContent = '';
      }
      setAlert('scheduleMoveClassBlockers', preview?.blockers || [], 'warning');
    }

    function renderTimeStep(preview) {
      setAlert('scheduleMoveTimeBlockers', preview?.blockers || [], 'warning');
      setAlert('scheduleMoveTimeNotices', preview?.notices || [], 'info');
    }

    function renderEnrollmentStep(preview) {
      const tbody = document.getElementById('scheduleMoveEnrollmentTbody');
      const rows = Array.isArray(preview?.enrollments) ? preview.enrollments : [];
      if (tbody) {
        tbody.innerHTML = rows.length
          ? rows.map((row) => {
            const action = row.action === 'close_and_open'
              ? 'Close original and open on target'
              : 'Update onto target class';
            const dates = row.action === 'close_and_open'
              ? `Close ${row.closeDate || '—'} · Start ${row.newStartDate || '—'}`
              : `Starts ${row.startDate || '—'}`;
            return `<tr><td>${escapeHtml(row.studentLabel || row.studentId)}</td><td>${escapeHtml(action)}</td><td>${escapeHtml(dates)}</td></tr>`;
          }).join('')
          : '<tr><td colspan="3" class="text-muted">No open enrollments cover the selected sessions. The sessions will still be moved.</td></tr>';
      }
      setAlert('scheduleMoveApplyNotices', preview?.notices || [], 'info');
    }

    function openClassPicker() {
      if (!global.GenericPicker || typeof global.GenericPicker.open !== 'function' || !global.GenericPickerPresets?.class) {
        void deps.uiAlert?.('Class picker is unavailable.', 'Move Sessions/Enrollments', { icon: 'warning' });
        return;
      }
      const pickerEl = document.getElementById('genericPickerModal');
      pickerEl?.addEventListener('shown.bs.modal', () => {
        const pickerZ = 12010;
        pickerEl.style.setProperty('z-index', String(pickerZ), 'important');
        const backdrops = document.querySelectorAll('.modal-backdrop.show');
        const lastBackdrop = backdrops[backdrops.length - 1];
        if (lastBackdrop) lastBackdrop.style.setProperty('z-index', String(pickerZ - 5), 'important');
      }, { once: true });
      global.GenericPicker.open(global.GenericPickerPresets.class({
        title: 'Select target class',
        icon: 'bi-book',
        placeholder: 'Search rolling classes...',
        searchFields: 'id,title,status,registrationMode,deliveryDepartmentName',
        context: (global.GenericPickerContexts && typeof global.GenericPickerContexts.activeOrganizationScope === 'function')
          ? global.GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' })
          : undefined,
        itemFilter: (item) => {
          const itemId = clean(item?.id);
          if (!itemId || itemId === state.classId) return false;
          return clean(item?.registrationMode).toLowerCase() === 'rolling';
        },
        onSelect: (item) => {
          const id = clean(item?.id);
          if (!id || id === state.classId) return;
          state.targetClassId = id;
          state.targetClassTitle = clean(item?.title || item?.label || id);
          void (async () => {
            try {
              const preview = await refreshPreview({ ignoreStartTime: true });
              renderClassStep(preview);
            } catch (error) {
              await deps.uiAlert?.(error.message || 'Unable to check the target class.', 'Move Sessions/Enrollments', { icon: 'warning' });
            }
          })();
        }
      }));
    }

    async function goNext() {
      try {
        if (state.step === 'class') {
          if (!state.targetClassId) {
            await deps.uiAlert?.('Choose a target class.', 'Move Sessions/Enrollments', { icon: 'info' });
            return;
          }
          const preview = await refreshPreview({ ignoreStartTime: true });
          renderClassStep(preview);
          if (preview?.blockers?.length) return;
          showStep('time');
          return;
        }
        if (state.step === 'time') {
          const startTime = clean(document.getElementById('scheduleMoveStartTime')?.value);
          if (!startTime) {
            await deps.uiAlert?.('Enter a start time.', 'Move Sessions/Enrollments', { icon: 'info' });
            return;
          }
          const preview = await refreshPreview();
          renderTimeStep(preview);
          if (preview?.blockers?.length) return;
          renderEnrollmentStep(preview);
          showStep('enrollments');
          return;
        }
        const preview = state.preview;
        if (!preview?.previewHash) return;
        const next = document.getElementById('btn_scheduleMoveNext');
        if (next) next.disabled = true;
        try {
          await postJson('/school/schedules/api/move-sessions/apply', {
            classId: state.classId,
            targetClassId: state.targetClassId,
            startTime: clean(document.getElementById('scheduleMoveStartTime')?.value),
            sessions: state.sessions,
            previewHash: preview.previewHash
          });
          deps.hideBootstrapModal?.(document.getElementById('scheduleMoveSessionsModal'));
          deps.refreshScheduleViewWithHolidays?.();
          await deps.uiAlert?.('Sessions and enrollments were moved.', 'Move Sessions/Enrollments', { icon: 'success' });
        } finally {
          if (next) next.disabled = false;
        }
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to move sessions.', 'Move Sessions/Enrollments', { icon: 'warning' });
      }
    }

    function openWizard() {
      const ctx = selectionContext();
      if (ctx.error === 'mixed') {
        void deps.uiAlert?.('Clear staged session selections before moving saved sessions.', 'Move Sessions/Enrollments', { icon: 'info' });
        return;
      }
      if (ctx.error === 'staged') {
        void deps.uiAlert?.('Save staged sessions before moving them.', 'Move Sessions/Enrollments', { icon: 'info' });
        return;
      }
      if (ctx.error === 'mixed-class') {
        void deps.uiAlert?.('Select sessions from a single class.', 'Move Sessions/Enrollments', { icon: 'info' });
        return;
      }
      if (ctx.error) {
        void deps.uiAlert?.('Select at least one saved class session.', 'Move Sessions/Enrollments', { icon: 'info' });
        return;
      }
      state.classId = ctx.classId;
      state.sessions = ctx.sessions;
      state.targetClassId = '';
      state.targetClassTitle = '';
      state.preview = null;
      const timeInput = document.getElementById('scheduleMoveStartTime');
      if (timeInput) timeInput.value = '';
      renderClassStep(null);
      setAlert('scheduleMoveTimeBlockers', [], 'warning');
      setAlert('scheduleMoveTimeNotices', [], 'info');
      showStep('class');
      deps.showBootstrapModal?.(document.getElementById('scheduleMoveSessionsModal'));
    }

    document.getElementById('btn_scheduleMovePickClass')?.addEventListener('click', () => openClassPicker());
    document.getElementById('btn_scheduleMoveNext')?.addEventListener('click', () => { void goNext(); });
    document.getElementById('btn_scheduleMoveBack')?.addEventListener('click', () => {
      if (state.step === 'enrollments') showStep('time');
      else if (state.step === 'time') showStep('class');
    });
    deps.bindMoveSessionsRail?.(openWizard);
  }

  global.installMasterScheduleMoveSessions = installMasterScheduleMoveSessions;
})(typeof window !== 'undefined' ? window : global);
