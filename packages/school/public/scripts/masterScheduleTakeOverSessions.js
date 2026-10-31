(function (global) {
  'use strict';

  function installMasterScheduleTakeOverSessions(deps) {
    if (!deps || typeof deps !== 'object') return;
    const state = {
      step: 'teacher',
      sessions: [],
      teacherId: '',
      teacherName: '',
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

    async function refreshScheduleAfterApply(applyData) {
      const upsertRefs = Array.isArray(applyData?.upsertedSessions) ? applyData.upsertedSessions : [];
      let refreshPromise = Promise.resolve();
      if (upsertRefs.length && typeof deps.applyScheduleSessionChangesInView === 'function') {
        refreshPromise = deps.applyScheduleSessionChangesInView({
          upsertRefs,
          affectedPersonIds: Array.isArray(applyData?.affectedPersonIds) ? applyData.affectedPersonIds : [],
          showProgress: true
        }).catch(async () => {
          if (typeof deps.reloadLoadedSchedulePersons === 'function') {
            await deps.reloadLoadedSchedulePersons({ silent: true });
          } else {
            deps.refreshScheduleViewWithHolidays?.();
          }
        });
      } else if (typeof deps.reloadLoadedSchedulePersons === 'function') {
        refreshPromise = deps.reloadLoadedSchedulePersons({ silent: true });
      } else {
        deps.refreshScheduleViewWithHolidays?.();
      }
      await refreshPromise;
    }

    function isMergedScheduleEvent(event) {
      return event?.merged?.isMergedSession === true;
    }

    function canUndoTakeOverScheduleEvent(event) {
      if (!event || isMergedScheduleEvent(event)) return false;
      const classId = clean(event?.classId);
      const sessionId = clean(event?.sessionId || event?.id);
      if (!classId || !sessionId) return false;
      const coTeachers = Array.isArray(event?.coTeachers) ? event.coTeachers : [];
      const previousTeachers = coTeachers.filter((row) => clean(row?.roleLabel) === 'Previous Teacher');
      return previousTeachers.length === 1;
    }

    function classifySelectedUndoEligibility(events) {
      const list = Array.isArray(events) ? events.filter(Boolean) : [];
      let undoableCount = 0;
      list.forEach((event) => {
        if (canUndoTakeOverScheduleEvent(event)) undoableCount += 1;
      });
      const total = list.length;
      return {
        events: list,
        allUndoable: total > 0 && undoableCount === total,
        anyUndoable: undoableCount > 0
      };
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
      const start = clean(session?.startTime || session?.start).slice(0, 5);
      const end = clean(session?.endTime || session?.end).slice(0, 5);
      if (date && start && end) return `${date} · ${start}–${end}`;
      if (date && start) return `${date} · ${start}`;
      return date || clean(session?.sessionId);
    }

    function setAlert(id, rows) {
      const el = document.getElementById(id);
      if (!el) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        el.classList.add('d-none');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('d-none');
      el.innerHTML = list.map((row, index) => {
        const message = escapeHtml(typeof row === 'string' ? row : (row.message || ''));
        const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
        const gap = index < list.length - 1 ? ' class="mb-2"' : '';
        if (!sessions.length) return `<div${gap}>${message}</div>`;
        const items = sessions.map((session) => {
          const label = formatSessionListItem(session);
          const detail = clean(session?.detail);
          return `<li>${escapeHtml(detail ? `${label} (${detail})` : label)}</li>`;
        }).join('');
        return `<div${gap}>${message}<ul class="mb-0 mt-1 ps-3">${items}</ul></div>`;
      }).join('');
    }

    function showStep(step) {
      state.step = step;
      document.querySelectorAll('[data-takeover-step]').forEach((el) => {
        el.classList.toggle('d-none', el.getAttribute('data-takeover-step') !== step);
      });
      document.querySelectorAll('[data-takeover-step-pill]').forEach((el) => {
        const active = el.getAttribute('data-takeover-step-pill') === step;
        el.classList.toggle('text-bg-primary', active);
        el.classList.toggle('text-bg-light', !active);
        el.classList.toggle('border', !active);
      });
      const back = document.getElementById('btn_scheduleTakeOverBack');
      const next = document.getElementById('btn_scheduleTakeOverNext');
      if (back) back.classList.toggle('d-none', step === 'teacher');
      if (next) next.textContent = step === 'review' ? 'Take Over' : 'Next';
    }

    function sessionSelectionKey(classId, sessionId) {
      return `${clean(classId)}::${clean(sessionId)}`;
    }

    function normalizeAllowPreviousTeacherEdit(value) {
      if (value === undefined || value === null || value === '') return true;
      if (value === true) return true;
      if (value === false) return false;
      const token = clean(value).toLowerCase();
      if (['false', '0', 'no', 'off'].includes(token)) return false;
      return true;
    }

    function syncStateSessionsEditFlags() {
      state.sessions = (Array.isArray(state.sessions) ? state.sessions : []).map((row) => ({
        ...row,
        allowPreviousTeacherEdit: normalizeAllowPreviousTeacherEdit(row?.allowPreviousTeacherEdit)
      }));
    }

    function updateStateSessionEditFlag(classId, sessionId, allowEdit) {
      const key = sessionSelectionKey(classId, sessionId);
      state.sessions = state.sessions.map((row) => (
        sessionSelectionKey(row.classId, row.sessionId) === key
          ? { ...row, allowPreviousTeacherEdit: allowEdit === true }
          : row
      ));
    }

    function resolveRowAllowPreviousTeacherEdit(previewRow) {
      const key = sessionSelectionKey(previewRow?.classId, previewRow?.sessionId);
      const stateRow = state.sessions.find((row) => sessionSelectionKey(row.classId, row.sessionId) === key);
      if (stateRow) return normalizeAllowPreviousTeacherEdit(stateRow.allowPreviousTeacherEdit);
      return normalizeAllowPreviousTeacherEdit(previewRow?.allowPreviousTeacherEdit);
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
      const sessions = events.map((ev) => ({
        classId: clean(ev?.classId),
        sessionId: clean(ev?.sessionId || ev?.id),
        date: clean(ev?.date),
        start: clean(ev?.start),
        end: clean(ev?.end),
        allowPreviousTeacherEdit: true
      })).filter((row) => row.classId && row.sessionId);
      if (!sessions.length) return { error: 'insufficient' };
      return { sessions };
    }

    async function refreshPreview() {
      const data = await postJson('/school/schedules/api/take-over-sessions/preview', {
        teacherId: state.teacherId,
        sessions: state.sessions
      });
      state.preview = data.data || null;
      return state.preview;
    }

    function renderTeacherStep(preview) {
      const label = document.getElementById('scheduleTakeOverTeacherLabel');
      if (label) label.textContent = state.teacherName || 'No teacher selected';
      setAlert('scheduleTakeOverTeacherBlockers', preview?.blockers || []);
    }

    function renderReviewStep(preview) {
      const tbody = document.getElementById('scheduleTakeOverReviewTbody');
      const rows = Array.isArray(preview?.sessions) ? preview.sessions : [];
      if (tbody) {
        tbody.innerHTML = rows.length
          ? rows.map((row) => {
            const when = formatSessionListItem(row);
            const classId = clean(row.classId);
            const sessionId = clean(row.sessionId);
            const allowEdit = resolveRowAllowPreviousTeacherEdit(row);
            const switchId = `takeover_prev_edit_${classId}_${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            return `<tr>`
              + `<td>${escapeHtml(when)}</td>`
              + `<td>${escapeHtml(row.previousTeacherName || row.previousTeacherId || '')}</td>`
              + `<td>${escapeHtml(row.teacherName || preview?.teacherName || '')}</td>`
              + `<td class="text-center">`
              + `<div class="form-check form-switch d-inline-flex justify-content-center mb-0">`
              + `<input class="form-check-input" type="checkbox" role="switch" id="${escapeHtml(switchId)}"`
              + ` data-takeover-previous-edit="1" data-class-id="${escapeHtml(classId)}" data-session-id="${escapeHtml(sessionId)}"`
              + `${allowEdit ? ' checked' : ''} aria-label="Allow previous teacher to edit this session">`
              + `</div></td></tr>`;
          }).join('')
          : '<tr><td colspan="4" class="text-muted">No sessions to take over.</td></tr>';
      }
      setAlert('scheduleTakeOverReviewBlockers', preview?.blockers || []);
    }

    async function handlePreviousEditSwitchChange(input) {
      if (!input || state.step !== 'review') return;
      const classId = clean(input.getAttribute('data-class-id'));
      const sessionId = clean(input.getAttribute('data-session-id'));
      if (!classId || !sessionId) return;
      updateStateSessionEditFlag(classId, sessionId, input.checked === true);
      const next = document.getElementById('btn_scheduleTakeOverNext');
      if (next) next.disabled = true;
      try {
        const preview = await refreshPreview();
        renderReviewStep(preview);
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to refresh take over preview.', 'Take Over', { icon: 'warning' });
      } finally {
        if (next) next.disabled = false;
      }
    }

    document.getElementById('scheduleTakeOverReviewTbody')?.addEventListener('change', (changeEvent) => {
      const target = changeEvent.target;
      if (!target || !target.matches('[data-takeover-previous-edit]')) return;
      void handlePreviousEditSwitchChange(target);
    });

    function openTeacherPicker() {
      if (!global.GenericPicker || typeof global.GenericPicker.open !== 'function' || !global.GenericPickerPresets?.teacher) {
        void deps.uiAlert?.('Teacher picker is unavailable.', 'Take Over', { icon: 'warning' });
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
      global.GenericPicker.open(global.GenericPickerPresets.teacher({
        title: 'Select teacher',
        icon: 'bi-person-check',
        placeholder: 'Search teachers...',
        context: (global.GenericPickerContexts && typeof global.GenericPickerContexts.activeOrganizationScope === 'function')
          ? global.GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' })
          : undefined,
        onSelect: (item) => {
          const id = clean(item?.personId || item?.id || item?.value);
          if (!id) return;
          state.teacherId = id;
          state.teacherName = clean(item?.displayName || item?.name || item?.label || [item?.firstName, item?.lastName].filter(Boolean).join(' ') || id);
          void (async () => {
            try {
              const preview = await refreshPreview();
              renderTeacherStep(preview);
            } catch (error) {
              await deps.uiAlert?.(error.message || 'Unable to check this teacher.', 'Take Over', { icon: 'warning' });
            }
          })();
        }
      }));
    }

    async function goNext() {
      try {
        if (state.step === 'teacher') {
          if (!state.teacherId) {
            await deps.uiAlert?.('Choose a teacher.', 'Take Over', { icon: 'info' });
            return;
          }
          syncStateSessionsEditFlags();
          const preview = await refreshPreview();
          renderTeacherStep(preview);
          if (preview?.blockers?.length) return;
          renderReviewStep(preview);
          showStep('review');
          return;
        }
        const preview = state.preview;
        if (!preview?.previewHash || preview.blockers?.length) return;
        const next = document.getElementById('btn_scheduleTakeOverNext');
        if (next) next.disabled = true;
        try {
          const applyRes = await postJson('/school/schedules/api/take-over-sessions/apply', {
            teacherId: state.teacherId,
            sessions: state.sessions,
            previewHash: preview.previewHash
          });
          deps.hideBootstrapModal?.(document.getElementById('scheduleTakeOverSessionsModal'));
          await refreshScheduleAfterApply(applyRes?.data || {});
          await deps.uiAlert?.('Sessions were taken over.', 'Take Over', { icon: 'success' });
        } finally {
          if (next) next.disabled = false;
        }
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to take over sessions.', 'Take Over', { icon: 'warning' });
      }
    }

    function openWizard() {
      const ctx = selectionContext();
      if (ctx.error === 'mixed') {
        void deps.uiAlert?.('Clear staged session selections before taking over saved sessions.', 'Take Over', { icon: 'info' });
        return;
      }
      if (ctx.error === 'staged') {
        void deps.uiAlert?.('Save staged sessions before taking them over.', 'Take Over', { icon: 'info' });
        return;
      }
      if (ctx.error) {
        void deps.uiAlert?.('Select at least one saved class session.', 'Take Over', { icon: 'info' });
        return;
      }
      const selectedEvents = typeof deps.getSelectedSavedClassSessionEvents === 'function'
        ? deps.getSelectedSavedClassSessionEvents()
        : [];
      const eligibility = classifySelectedUndoEligibility(selectedEvents);
      if (eligibility.allUndoable) {
        void undoTakeOverForSessions(ctx.sessions, { sessionCount: eligibility.events.length }).catch(async (error) => {
          await deps.uiAlert?.(error.message || 'Unable to undo take over.', 'Undo Take Over', { icon: 'warning' });
        });
        return;
      }
      if (eligibility.anyUndoable) {
        void deps.uiAlert?.(
          'Selected sessions are not all in the same take-over state. Undo take over only works when every selected session has been taken over. Clear the selection or choose matching sessions.',
          'Take Over',
          { icon: 'info' }
        );
        return;
      }
      state.sessions = (ctx.sessions || []).map((row) => ({
        ...row,
        allowPreviousTeacherEdit: true
      }));
      state.teacherId = '';
      state.teacherName = '';
      state.preview = null;
      renderTeacherStep(null);
      setAlert('scheduleTakeOverReviewBlockers', []);
      showStep('teacher');
      deps.showBootstrapModal?.(document.getElementById('scheduleTakeOverSessionsModal'));
    }

    document.getElementById('btn_scheduleTakeOverPickTeacher')?.addEventListener('click', () => openTeacherPicker());
    document.getElementById('btn_scheduleTakeOverNext')?.addEventListener('click', () => { void goNext(); });
    document.getElementById('btn_scheduleTakeOverBack')?.addEventListener('click', () => {
      if (state.step === 'review') showStep('teacher');
    });
    deps.bindTakeOverSessionsRail?.(openWizard);

    async function undoTakeOverForSessions(sessions, { sessionCount = 0 } = {}) {
      const refs = (Array.isArray(sessions) ? sessions : [])
        .map((row) => ({
          classId: clean(row?.classId),
          sessionId: clean(row?.sessionId || row?.id)
        }))
        .filter((row) => row.classId && row.sessionId);
      if (!refs.length) {
        throw new Error('Select at least one saved class session.');
      }
      const previewRes = await postJson('/school/schedules/api/take-over-sessions/undo-preview', { sessions: refs });
      const preview = previewRes.data || {};
      if (preview.blockers?.length) {
        throw new Error(preview.blockers[0]?.message || 'Unable to undo take over.');
      }
      const count = Number(sessionCount) > 0 ? Number(sessionCount) : refs.length;
      const countLabel = count === 1 ? 'this session' : `${count} selected sessions`;
      const confirmed = await deps.uiConfirm?.(
        `<p>Undo take over for ${escapeHtml(countLabel)}?</p>`
        + '<p>This restores the previous main teacher and removes the take-over co-teacher row on each session.</p>'
        + '<p class="mb-0 text-muted small">Timesheet entries are not automatically adjusted. Chained take-overs may require undoing more than once.</p>',
        'Undo Take Over',
        { icon: 'warning', confirmText: 'Undo', cancelText: 'Cancel', html: true }
      );
      if (confirmed !== true) return;
      const applyRes = await postJson('/school/schedules/api/take-over-sessions/undo-apply', {
        sessions: refs,
        previewHash: preview.previewHash
      });
      await refreshScheduleAfterApply(applyRes?.data || {});
      const successMessage = count === 1
        ? 'Take over was undone.'
        : `Take over was undone for ${count} sessions.`;
      await deps.uiAlert?.(successMessage, 'Undo Take Over', { icon: 'success' });
    }

    async function undoTakeOverForEvent(event) {
      return undoTakeOverForSessions([{
        classId: clean(event?.classId),
        sessionId: clean(event?.sessionId || event?.id)
      }], { sessionCount: 1 });
    }

    document.getElementById('btn_scheduleSessionContextUndoTakeOver')?.addEventListener('click', (clickEvent) => {
      clickEvent.preventDefault();
      const event = typeof deps.getScheduleSessionContextEvent === 'function'
        ? deps.getScheduleSessionContextEvent()
        : null;
      deps.hideScheduleSessionContextMenu?.();
      if (!event) return;
      void undoTakeOverForEvent(event).catch(async (error) => {
        await deps.uiAlert?.(error.message || 'Unable to undo take over.', 'Undo Take Over', { icon: 'warning' });
      });
    });

    global.canUndoTakeOverScheduleEvent = canUndoTakeOverScheduleEvent;
  }

  global.installMasterScheduleTakeOverSessions = installMasterScheduleTakeOverSessions;
})(typeof window !== 'undefined' ? window : global);
