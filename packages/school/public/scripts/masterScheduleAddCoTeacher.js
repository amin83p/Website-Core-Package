(function (global) {
  'use strict';

  function installMasterScheduleAddCoTeacher(deps) {
    if (!deps || typeof deps !== 'object') return;
    const state = {
      step: 'teacher',
      sessions: [],
      teacherId: '',
      teacherName: '',
      action: 'upsert',
      existing: [],
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
      const start = clean(session?.startTime || session?.start).slice(0, 5);
      const end = clean(session?.endTime || session?.end).slice(0, 5);
      if (date && start && end) return `${date} · ${start}–${end}`;
      if (date && start) return `${date} · ${start}`;
      return date || clean(session?.sessionId);
    }

    function paymentPayload() {
      const paid = document.getElementById('scheduleAddCoTeacherPaid')?.value !== 'unpaid';
      const raw = clean(document.getElementById('scheduleAddCoTeacherPaidHours')?.value);
      return {
        paid,
        paidHours: paid && raw !== '' ? Number(raw) : null
      };
    }

    function paymentLabel(row, preview) {
      if ((row?.change || preview?.change) === 'remove') return 'Removed';
      const paid = row?.paid != null ? row.paid : preview?.paid;
      if (!paid) return 'Unpaid';
      const hours = Number(row?.paidHours != null ? row.paidHours : preview?.paidHours);
      return Number.isFinite(hours) ? `Paid ${hours}h` : 'Paid';
    }

    function existingPaymentLabel(row) {
      if (row?.mixedPayment) return 'Mixed';
      if (!row?.paid) return 'Unpaid';
      const hours = Number(row.paidHours);
      return Number.isFinite(hours) ? `Paid ${hours}h` : 'Paid';
    }

    function changeLabel(value) {
      if (value === 'remove') return 'Remove';
      if (value === 'update') return 'Update';
      return 'Add';
    }

    function syncFormMode() {
      const removing = state.action === 'remove';
      document.getElementById('scheduleAddCoTeacherPaymentFields')?.classList.toggle('d-none', removing);
      document.getElementById('scheduleAddCoTeacherRemoveNote')?.classList.toggle('d-none', !removing);
      const paid = document.getElementById('scheduleAddCoTeacherPaid')?.value !== 'unpaid';
      document.getElementById('scheduleAddCoTeacherHoursWrap')?.classList.toggle('d-none', !paid);
      const title = document.getElementById('scheduleAddCoTeacherFormTitle');
      if (title) {
        title.textContent = removing ? 'Remove co-teacher' : (state.teacherId ? 'Add or edit' : 'Add or edit');
      }
      const label = document.getElementById('scheduleAddCoTeacherLabel');
      if (label) label.textContent = state.teacherName || 'No teacher selected';
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
      document.querySelectorAll('[data-co-teacher-step]').forEach((el) => {
        el.classList.toggle('d-none', el.getAttribute('data-co-teacher-step') !== step);
      });
      document.querySelectorAll('[data-co-teacher-step-pill]').forEach((el) => {
        const active = el.getAttribute('data-co-teacher-step-pill') === step;
        el.classList.toggle('text-bg-primary', active);
        el.classList.toggle('text-bg-light', !active);
        el.classList.toggle('border', !active);
      });
      const back = document.getElementById('btn_scheduleAddCoTeacherBack');
      const next = document.getElementById('btn_scheduleAddCoTeacherNext');
      if (back) back.classList.toggle('d-none', step === 'teacher');
      if (next) {
        if (step !== 'review') next.textContent = 'Next';
        else if (state.action === 'remove') next.textContent = 'Remove';
        else if (state.preview?.change === 'update') next.textContent = 'Save';
        else next.textContent = 'Add Co-Teacher';
      }
    }

    function renderExisting() {
      const host = document.getElementById('scheduleAddCoTeacherExisting');
      if (!host) return;
      const rows = Array.isArray(state.existing) ? state.existing : [];
      if (!rows.length) {
        host.className = 'small text-muted p-3';
        host.innerHTML = 'No co-teachers on the selected sessions.';
        return;
      }
      host.className = '';
      host.innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
        <thead class="table-light"><tr><th>Teacher</th><th>Payment</th><th>Sessions</th><th class="text-end">Actions</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${escapeHtml(row.name || row.personId)}</td>
          <td>${escapeHtml(existingPaymentLabel(row))}</td>
          <td>${escapeHtml(String(row.sessionCount || (row.sessions || []).length || 0))}</td>
          <td class="text-end text-nowrap">
            <button type="button" class="btn btn-outline-primary btn-sm" data-co-teacher-edit="${escapeHtml(row.personId)}">Edit</button>
            <button type="button" class="btn btn-outline-danger btn-sm" data-co-teacher-remove="${escapeHtml(row.personId)}">Remove</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function fillPayment(row) {
      const paidSelect = document.getElementById('scheduleAddCoTeacherPaid');
      const hoursInput = document.getElementById('scheduleAddCoTeacherPaidHours');
      if (!row || row.mixedPayment || row.paid == null) {
        if (paidSelect) paidSelect.value = 'paid';
        if (hoursInput) hoursInput.value = '';
        return;
      }
      if (paidSelect) paidSelect.value = row.paid ? 'paid' : 'unpaid';
      if (hoursInput) hoursInput.value = row.paid && Number.isFinite(Number(row.paidHours)) ? String(row.paidHours) : '';
    }

    function selectExisting(personId, action) {
      const row = (state.existing || []).find((entry) => clean(entry.personId) === clean(personId));
      if (!row) return;
      state.teacherId = clean(row.personId);
      state.teacherName = clean(row.name) || state.teacherId;
      state.action = action === 'remove' ? 'remove' : 'upsert';
      state.preview = null;
      fillPayment(state.action === 'remove' ? null : row);
      syncFormMode();
      setAlert('scheduleAddCoTeacherBlockers', []);
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
        end: clean(ev?.end)
      })).filter((row) => row.classId && row.sessionId);
      if (!sessions.length) return { error: 'insufficient' };
      return { sessions };
    }

    async function refreshPreview() {
      const payment = paymentPayload();
      const data = await postJson('/school/schedules/api/add-co-teacher/preview', {
        teacherId: state.teacherId,
        sessions: state.sessions,
        paid: state.action === 'remove' ? false : payment.paid,
        paidHours: state.action === 'remove' ? null : payment.paidHours,
        action: state.action
      });
      state.preview = data.data || null;
      if (Array.isArray(state.preview?.existingCoTeachers)) state.existing = state.preview.existingCoTeachers;
      return state.preview;
    }

    function renderTeacherStep(preview) {
      syncFormMode();
      renderExisting();
      setAlert('scheduleAddCoTeacherBlockers', preview?.blockers || []);
    }

    function renderReviewStep(preview) {
      const tbody = document.getElementById('scheduleAddCoTeacherReviewTbody');
      const rows = Array.isArray(preview?.sessions) ? preview.sessions : [];
      const lead = document.getElementById('scheduleAddCoTeacherReviewLead');
      if (lead) {
        lead.textContent = preview?.change === 'remove'
          ? 'The co-teacher will be removed from each selected session.'
          : 'The main teacher and the other co-teachers stay as they are.';
      }
      if (tbody) {
        tbody.innerHTML = rows.length
          ? rows.map((row) => {
            const when = formatSessionListItem(row);
            return `<tr><td>${escapeHtml(when)}</td><td>${escapeHtml(changeLabel(row.change))}</td><td>${escapeHtml(row.teacherName || preview?.teacherName || '')}</td><td>${escapeHtml(paymentLabel(row, preview))}</td></tr>`;
          }).join('')
          : '<tr><td colspan="4" class="text-muted">No sessions selected.</td></tr>';
      }
      setAlert('scheduleAddCoTeacherReviewBlockers', preview?.blockers || []);
    }

    function openTeacherPicker() {
      if (!global.GenericPicker || typeof global.GenericPicker.open !== 'function' || !global.GenericPickerPresets?.teacher) {
        void deps.uiAlert?.('Teacher picker is unavailable.', 'Co-Teacher', { icon: 'warning' });
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
        title: 'Select co-teacher',
        icon: 'bi-people',
        placeholder: 'Search teachers...',
        context: (global.GenericPickerContexts && typeof global.GenericPickerContexts.activeOrganizationScope === 'function')
          ? global.GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' })
          : undefined,
        onSelect: (item) => {
          const id = clean(item?.personId || item?.id || item?.value);
          if (!id) return;
          const existing = (state.existing || []).find((row) => clean(row.personId) === id);
          state.teacherId = id;
          state.teacherName = clean(item?.displayName || item?.name || item?.label || existing?.name || [item?.firstName, item?.lastName].filter(Boolean).join(' ') || id);
          state.action = 'upsert';
          state.preview = null;
          fillPayment(existing || null);
          renderTeacherStep(null);
        }
      }));
    }

    function successMessage(preview) {
      if (preview?.change === 'remove') return 'Co-teacher was removed.';
      if (preview?.change === 'update') return 'Co-teacher was updated.';
      return 'Co-teacher was added.';
    }

    async function goNext() {
      try {
        if (state.step === 'teacher') {
          if (!state.teacherId) {
            await deps.uiAlert?.('Choose a teacher.', 'Co-Teacher', { icon: 'info' });
            return;
          }
          const preview = await refreshPreview();
          renderTeacherStep(preview);
          if (preview?.blockers?.length) return;
          renderReviewStep(preview);
          showStep('review');
          return;
        }
        const preview = state.preview;
        if (!preview?.previewHash || preview.blockers?.length) return;
        const next = document.getElementById('btn_scheduleAddCoTeacherNext');
        if (next) next.disabled = true;
        try {
          const payment = paymentPayload();
          await postJson('/school/schedules/api/add-co-teacher/apply', {
            teacherId: state.teacherId,
            sessions: state.sessions,
            paid: state.action === 'remove' ? false : payment.paid,
            paidHours: state.action === 'remove' ? null : payment.paidHours,
            action: state.action,
            previewHash: preview.previewHash
          });
          deps.hideBootstrapModal?.(document.getElementById('scheduleAddCoTeacherModal'));
          deps.refreshScheduleViewWithHolidays?.();
          await deps.uiAlert?.(successMessage(preview), 'Co-Teacher', { icon: 'success' });
        } finally {
          if (next) next.disabled = false;
        }
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to update the co-teacher.', 'Co-Teacher', { icon: 'warning' });
      }
    }

    async function openWizard() {
      const ctx = selectionContext();
      if (ctx.error === 'mixed') {
        void deps.uiAlert?.('Clear staged session selections before changing a co-teacher on saved sessions.', 'Co-Teacher', { icon: 'info' });
        return;
      }
      if (ctx.error === 'staged') {
        void deps.uiAlert?.('Save staged sessions before changing a co-teacher.', 'Co-Teacher', { icon: 'info' });
        return;
      }
      if (ctx.error) {
        void deps.uiAlert?.('Select at least one saved class session.', 'Co-Teacher', { icon: 'info' });
        return;
      }
      state.sessions = ctx.sessions;
      state.teacherId = '';
      state.teacherName = '';
      state.action = 'upsert';
      state.existing = [];
      state.preview = null;
      fillPayment(null);
      renderTeacherStep(null);
      setAlert('scheduleAddCoTeacherReviewBlockers', []);
      showStep('teacher');
      deps.showBootstrapModal?.(document.getElementById('scheduleAddCoTeacherModal'));
      try {
        const data = await postJson('/school/schedules/api/add-co-teacher/preview', {
          sessions: state.sessions
        });
        state.existing = data.data?.existingCoTeachers || [];
        renderTeacherStep(data.data || null);
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to load co-teachers.', 'Co-Teacher', { icon: 'warning' });
      }
    }

    document.getElementById('btn_scheduleAddCoTeacherPick')?.addEventListener('click', () => openTeacherPicker());
    document.getElementById('scheduleAddCoTeacherPaid')?.addEventListener('change', () => syncFormMode());
    document.getElementById('scheduleAddCoTeacherExisting')?.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-co-teacher-edit]');
      const remove = event.target.closest('[data-co-teacher-remove]');
      if (edit) selectExisting(edit.getAttribute('data-co-teacher-edit'), 'upsert');
      if (remove) selectExisting(remove.getAttribute('data-co-teacher-remove'), 'remove');
    });
    document.getElementById('btn_scheduleAddCoTeacherNext')?.addEventListener('click', () => { void goNext(); });
    document.getElementById('btn_scheduleAddCoTeacherBack')?.addEventListener('click', () => {
      if (state.step === 'review') showStep('teacher');
    });
    deps.bindAddCoTeacherRail?.(openWizard);
  }

  global.installMasterScheduleAddCoTeacher = installMasterScheduleAddCoTeacher;
})(typeof window !== 'undefined' ? window : global);
