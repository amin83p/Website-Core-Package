(function (global) {
  'use strict';

  function installMasterScheduleManageEnrollment(deps) {
    if (!deps || typeof deps !== 'object') return;

    const state = {
      sessions: [],
      enrollments: [],
      actionStateId: '',
      editRow: null,
      approvedCloseStatusPayload: null,
      approvedEditCloseStatusPayload: null,
      funderOptionsByClassId: new Map(),
      bound: false
    };

    function clean(value) {
      return String(value || '').trim();
    }

    function escapeHtml(value) {
      return typeof deps.escapeHtml === 'function'
        ? deps.escapeHtml(value)
        : String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
    }

    function qs(id) {
      return document.getElementById(id);
    }

    function todayIso() {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${now.getFullYear()}-${month}-${day}`;
    }

    function formatStatusLabel(status) {
      const key = clean(status).toLowerCase();
      if (key === 'to_be_confirmed') return 'To be Confirmed';
      if (key === 'waiting_list') return 'Waiting list';
      if (!key) return '—';
      return key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    function formatEnrollmentDateLabel(value) {
      const token = clean(value);
      if (!token) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        const parsed = new Date(`${token}T12:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
      }
      return token;
    }

    function renderEnrollmentDatesCell(row) {
      const start = formatEnrollmentDateLabel(row.startDate) || '—';
      const closingRaw = clean(row.closingDate) || clean(row.endDate);
      const closing = closingRaw ? formatEnrollmentDateLabel(closingRaw) : 'Open';
      const closedOn = formatEnrollmentDateLabel(row.closedOnDate);
      const rangeLine = closingRaw
        ? `${escapeHtml(start)} → <span class="fw-semibold">${escapeHtml(closing)}</span>`
        : `${escapeHtml(start)} → Open`;
      const closedOnLine = closedOn
        ? `<div class="small text-muted">Closed on ${escapeHtml(closedOn)}</div>`
        : '';
      return `<div class="small">${rangeLine}</div>${closedOnLine}`;
    }

    function isOpenEditableEnrollmentStatus(status) {
      return ['active', 'to_be_confirmed', 'waiting_list'].includes(clean(status).toLowerCase());
    }

    function rememberActionStateId(value) {
      const id = clean(value);
      if (id) state.actionStateId = id;
    }

    async function postJson(url, body = {}) {
      const payload = { ...(body || {}) };
      if (state.actionStateId && !payload.actionStateId) {
        payload.actionStateId = state.actionStateId;
      }
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(state.actionStateId ? { 'X-Action-State-Id': state.actionStateId } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      rememberActionStateId(data.actionStateId || res.headers.get('x-action-state-id'));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
    }

    async function getJson(url) {
      const sep = url.includes('?') ? '&' : '?';
      const withToken = state.actionStateId
        ? `${url}${sep}actionStateId=${encodeURIComponent(state.actionStateId)}`
        : url;
      const res = await fetch(withToken, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(state.actionStateId ? { 'X-Action-State-Id': state.actionStateId } : {})
        },
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      rememberActionStateId(data.actionStateId || res.headers.get('x-action-state-id'));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
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
      return {
        sessions: events.map((ev) => ({
          sessionId: clean(ev?.sessionId || ev?.id),
          classId: clean(ev?.classId),
          date: clean(ev?.date)
        })).filter((row) => row.sessionId && row.classId)
      };
    }

    function mountModalToBody(el) {
      if (!el || el.parentElement === document.body) return el;
      document.body.appendChild(el);
      return el;
    }

    function raiseModalAboveStack(el) {
      if (!el) return;
      mountModalToBody(el);
      let maxZ = 1050;
      document.querySelectorAll('.modal.show').forEach((openModal) => {
        if (openModal === el) return;
        const z = Number.parseInt(window.getComputedStyle(openModal).zIndex, 10);
        if (Number.isFinite(z) && z > maxZ) maxZ = z;
      });
      const modalZ = Math.max(maxZ + 10, 1060);
      el.style.setProperty('z-index', String(modalZ), 'important');
      const backdrops = document.querySelectorAll('.modal-backdrop.show');
      const backdrop = backdrops[backdrops.length - 1];
      if (backdrop) backdrop.style.setProperty('z-index', String(modalZ - 5), 'important');
    }

    function showModal(el) {
      if (!el || !window.bootstrap?.Modal) return null;
      mountModalToBody(el);
      const instance = window.bootstrap.Modal.getOrCreateInstance(el);
      el.addEventListener('shown.bs.modal', () => raiseModalAboveStack(el), { once: true });
      instance.show();
      return instance;
    }

    function hideModal(el) {
      if (!el) return;
      const instance = window.bootstrap?.Modal?.getInstance(el);
      instance?.hide();
      el.style.removeProperty('z-index');
    }

    function renderEnrollmentRows(rows) {
      const tbody = qs('scheduleManageEnrollmentTbody');
      if (!tbody) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted p-4 text-center">No active enrollments cover the selected sessions.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map((row) => {
        const periodId = escapeHtml(row.periodId);
        const typeLabel = escapeHtml(row.enrollmentTypeLabel || '—');
        const typeDetail = escapeHtml(row.enrollmentTypeDetail || '');
        return `<tr data-period-id="${periodId}" data-class-id="${escapeHtml(row.classId)}">
          <td>
            <div class="fw-semibold">${escapeHtml(row.studentLabel || row.studentId || '—')}</div>
            <div class="small text-muted">${escapeHtml(row.studentId || '')}</div>
          </td>
          <td><span class="small">${escapeHtml(row.className || row.classId || '—')}</span></td>
          <td>
            <div class="small fw-semibold">${typeLabel}</div>
            <div class="small text-muted">${typeDetail}</div>
          </td>
          <td><span class="badge text-bg-light border">${escapeHtml(row.statusLabel || formatStatusLabel(row.status))}</span></td>
          <td>${renderEnrollmentDatesCell(row)}</td>
          <td class="text-end text-nowrap">
            <div class="d-inline-flex gap-1" role="group" aria-label="Enrollment actions">
              <button type="button" class="btn btn-outline-primary btn-sm py-0 px-1" data-manage-enroll-action="edit" data-period-id="${periodId}" title="Edit enrollment" aria-label="Edit enrollment"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>
              <button type="button" class="btn btn-outline-warning btn-sm py-0 px-1" data-manage-enroll-action="close" data-period-id="${periodId}" title="Close enrollment" aria-label="Close enrollment"><i class="bi bi-x-circle" aria-hidden="true"></i></button>
              <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1" data-manage-enroll-action="delete" data-period-id="${periodId}" title="Delete enrollment" aria-label="Delete enrollment"><i class="bi bi-trash" aria-hidden="true"></i></button>
            </div>
          </td>
        </tr>`;
      }).join('');
    }

    async function loadEnrollmentList() {
      const subtitle = qs('scheduleManageEnrollmentModalSubtitle');
      const tbody = qs('scheduleManageEnrollmentTbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted p-4 text-center"><span class="spinner-border spinner-border-sm me-2"></span>Loading enrollments...</td></tr>';
      }
      const data = await postJson('/school/schedules/api/manage-enrollments/list', {
        sessions: state.sessions
      });
      const payload = data.data || {};
      state.enrollments = Array.isArray(payload.enrollments) ? payload.enrollments : [];
      if (subtitle) {
        const sessionCount = Number(payload.selectedSessionCount || state.sessions.length) || 0;
        const enrollCount = state.enrollments.length;
        subtitle.textContent = `${enrollCount} active enrollment${enrollCount === 1 ? '' : 's'} across ${sessionCount} selected session${sessionCount === 1 ? '' : 's'}`;
      }
      renderEnrollmentRows(state.enrollments);
    }

    function findEnrollmentRow(periodId) {
      const want = clean(periodId);
      return state.enrollments.find((row) => clean(row.periodId) === want) || null;
    }

    async function loadPeriodDetail(classId, periodId) {
      const data = await getJson(`/school/classes/api/${encodeURIComponent(classId)}/enrollment-periods`);
      const items = Array.isArray(data.items) ? data.items : [];
      const row = items.find((item) => clean(item?.id) === clean(periodId));
      if (!row) throw new Error('Enrollment period not found.');
      return row;
    }

    async function loadFunderOptionsForClass(classId) {
      const id = clean(classId);
      if (!id) return [];
      if (state.funderOptionsByClassId.has(id)) {
        return state.funderOptionsByClassId.get(id);
      }
      const data = await getJson(
        `/school/schedules/api/manage-enrollments/funder-options?classId=${encodeURIComponent(id)}`
      );
      const options = Array.isArray(data.data?.funderOptions) ? data.data.funderOptions : [];
      state.funderOptionsByClassId.set(id, options);
      return options;
    }

    function populateEditFunderSelect(funderOptions, periodRow) {
      const select = qs('edit_funder');
      if (!select) return;
      const selectedId = clean(periodRow?.funderId);
      const selectedType = clean(periodRow?.funderType).toLowerCase();
      const isSelf = !selectedId || selectedId.toLowerCase() === 'self' || selectedType === 'self';
      const parts = ['<option value="self">Self Fund</option>'];
      const seen = new Set(['self']);
      (Array.isArray(funderOptions) ? funderOptions : []).forEach((row) => {
        const funderId = clean(row?.id);
        if (!funderId || seen.has(funderId)) return;
        seen.add(funderId);
        parts.push(
          `<option value="${escapeHtml(funderId)}">${escapeHtml(clean(row?.label) || funderId)}</option>`
        );
      });
      if (!isSelf && selectedId && !seen.has(selectedId)) {
        parts.push(
          `<option value="${escapeHtml(selectedId)}">${escapeHtml(clean(periodRow?.funderLabel) || selectedId)}</option>`
        );
        seen.add(selectedId);
      }
      select.innerHTML = parts.join('');
      if (isSelf) {
        select.value = 'self';
        return;
      }
      select.value = seen.has(selectedId) ? selectedId : 'self';
    }

    function setFunderLocked(locked) {
      const select = qs('edit_funder');
      const help = qs('edit_funder_help');
      if (select) select.disabled = locked === true;
      if (help) {
        help.textContent = locked === true
          ? 'Funder is locked because finance transactions are attached to this enrollment.'
          : 'Self Fund posts to the student account. Other funders post to the funder account with student detail.';
      }
    }

    function syncEditStatusUi(row) {
      const currentStatus = clean(row?.status).toLowerCase() || 'active';
      const editable = isOpenEditableEnrollmentStatus(currentStatus);
      const statusWrap = qs('wrap_edit_status');
      const readonlyWrap = qs('wrap_edit_statusReadonly');
      const closeReasonWrap = qs('wrap_edit_closeReason');
      const closeFieldsWrap = qs('wrap_edit_closeFields');
      const attendanceHelp = qs('edit_statusAttendanceHelp');
      const statusSelect = qs('edit_status');
      const hasAttendanceBlock = row?.hasNonNaAttendanceMarkings === true;

      statusWrap?.classList.toggle('d-none', !editable);
      readonlyWrap?.classList.toggle('d-none', editable);
      if (!editable) {
        if (qs('edit_statusReadonly')) qs('edit_statusReadonly').value = formatStatusLabel(currentStatus);
        const helpEl = qs('edit_statusReadonlyHelp');
        if (helpEl) {
          helpEl.textContent = ['draft', 'planned', 'error'].includes(currentStatus)
            ? 'Use Review Draft or the dedicated workflow to change this status.'
            : 'Status changes for ended enrollments use the Close action or re-entry workflow.';
        }
        closeReasonWrap?.classList.add('d-none');
        closeFieldsWrap?.classList.add('d-none');
        return;
      }

      const selectedStatus = clean(statusSelect?.value || 'active').toLowerCase();
      const isClose = selectedStatus === 'close';
      closeReasonWrap?.classList.toggle('d-none', !isClose);
      closeFieldsWrap?.classList.toggle('d-none', !isClose);

      if (statusSelect) {
        const tbcOption = statusSelect.querySelector('option[value="to_be_confirmed"]');
        const wlOption = statusSelect.querySelector('option[value="waiting_list"]');
        if (tbcOption) tbcOption.disabled = hasAttendanceBlock;
        if (wlOption) wlOption.disabled = hasAttendanceBlock;
      }
      if (attendanceHelp) {
        attendanceHelp.classList.toggle('d-none', !hasAttendanceBlock);
        attendanceHelp.textContent = hasAttendanceBlock
          ? 'Waiting List and To Be Confirmed are unavailable because attendance has been recorded for non-N/A sessions.'
          : '';
      }

      if (isClose) {
        state.approvedEditCloseStatusPayload = null;
        const closeReason = clean(qs('edit_closeReason')?.value || 'completed').toLowerCase();
        const isWithdrawn = closeReason === 'withdrawn';
        qs('btn_previewEditClosePeriod')?.classList.toggle('d-none', isWithdrawn);
        qs('edit_closeStatusPreview')?.classList.toggle('d-none', isWithdrawn);
        if (!isWithdrawn && qs('edit_closeStatusPreview')) {
          qs('edit_closeStatusPreview').className = 'alert alert-light border mb-0';
          qs('edit_closeStatusPreview').textContent = 'Preview the financial effect before applying cancellation, completion, or archival.';
        }
      }
    }

    function readEditStatusPayload() {
      const row = state.editRow || {};
      const currentStatus = clean(row?.status).toLowerCase() || 'active';
      if (!isOpenEditableEnrollmentStatus(currentStatus)) {
        return { mode: 'readonly', status: currentStatus };
      }
      const selectedStatus = clean(qs('edit_status')?.value || 'active').toLowerCase();
      if (selectedStatus === 'close') {
        return {
          mode: 'close',
          closeReason: clean(qs('edit_closeReason')?.value || 'completed').toLowerCase(),
          effectiveDate: clean(qs('edit_closeEndDate')?.value),
          reason: clean(qs('edit_closeReasonEnd')?.value)
        };
      }
      return { mode: 'open', status: selectedStatus };
    }

    function resolveFunderSelection() {
      const value = clean(qs('edit_funder')?.value) || 'self';
      if (value === 'self') return { funderId: 'self', funderType: 'self' };
      return { funderId: value, funderType: 'funder' };
    }

    function readClaimPayload() {
      const select = qs('edit_claimNumber');
      const mgr = global.StudentClaimNumbersManager;
      if (mgr && typeof mgr.readClaimNumberSelectValue === 'function') {
        const value = clean(mgr.readClaimNumberSelectValue(select));
        return value ? { claimNumberId: value, claimNumber: '' } : { claimNumberId: '', claimNumber: '' };
      }
      const value = clean(select?.value);
      if (!value || value === '__add_new__') return { claimNumberId: '', claimNumber: '' };
      return { claimNumberId: value, claimNumber: '' };
    }

    async function refreshEditClaimSelect(studentId, token) {
      const select = qs('edit_claimNumber');
      const mgr = global.StudentClaimNumbersManager;
      if (!select || !mgr || typeof mgr.refreshClaimNumberSelect !== 'function' || !studentId) {
        if (select) {
          select.innerHTML = '<option value="">— None —</option><option value="__add_new__">+ Add New...</option>';
        }
        return;
      }
      await mgr.refreshClaimNumberSelect(select, studentId, token || '');
      if (select.dataset.manageEnrollClaimBound === '1') return;
      select.dataset.manageEnrollClaimBound = '1';
      select.addEventListener('change', () => {
        if (typeof mgr.handleClaimNumberSelectChange === 'function') {
          void mgr.handleClaimNumberSelectChange(select, studentId, state.editRow?.studentLabel || studentId);
        }
      });
    }

    async function openEditModal(periodId) {
      const listRow = findEnrollmentRow(periodId);
      if (!listRow) {
        await deps.uiAlert?.('Enrollment not found in the current list.', 'Manage Enrollment', { icon: 'warning' });
        return;
      }
      const detail = await loadPeriodDetail(listRow.classId, periodId);
      state.editRow = {
        ...listRow,
        ...detail,
        id: clean(detail.id || periodId),
        status: clean(detail.status || listRow.status),
        hasNonNaAttendanceMarkings: detail.hasNonNaAttendanceMarkings === true
          || listRow.hasNonNaAttendanceMarkings === true
      };
      state.approvedEditCloseStatusPayload = null;

      qs('edit_periodId').value = clean(state.editRow.id);
      qs('edit_startDate').value = clean(state.editRow.startDate);
      qs('edit_endDate').value = clean(state.editRow.endDate);
      const currentStatus = clean(state.editRow.status).toLowerCase() || 'active';
      if (isOpenEditableEnrollmentStatus(currentStatus) && qs('edit_status')) {
        qs('edit_status').value = currentStatus;
      }
      if (qs('edit_closeReason')) qs('edit_closeReason').value = 'completed';
      if (qs('edit_closeEndDate')) qs('edit_closeEndDate').value = clean(state.editRow.endDate) || todayIso();
      if (qs('edit_closeReasonEnd')) qs('edit_closeReasonEnd').value = '';
      if (qs('edit_sessionCapacityType')) {
        qs('edit_sessionCapacityType').value = clean(state.editRow.sessionCapacityType) === 'one_on_one'
          ? 'one_on_one'
          : 'group';
      }
      const funderOptions = await loadFunderOptionsForClass(listRow.classId);
      populateEditFunderSelect(funderOptions, state.editRow);
      const postedCount = Array.isArray(state.editRow?.transactionSummary?.postedTransactionIds)
        ? state.editRow.transactionSummary.postedTransactionIds.length
        : (listRow.hasPostedTransactions ? 1 : 0);
      setFunderLocked(postedCount > 0);
      if (qs('edit_reasonStart')) qs('edit_reasonStart').value = clean(state.editRow.reasonStart);
      if (qs('edit_targetSessionCount')) {
        qs('edit_targetSessionCount').value = state.editRow.targetSessionCount
          ? String(state.editRow.targetSessionCount)
          : '';
      }
      if (qs('edit_targetHours')) {
        qs('edit_targetHours').value = state.editRow.targetHours ? String(state.editRow.targetHours) : '';
      }
      syncEditStatusUi(state.editRow);
      await refreshEditClaimSelect(
        clean(state.editRow.studentId || listRow.studentId),
        clean(state.editRow.claimNumberId || state.editRow.claimNumber || listRow.claimNumber)
      );
      showModal(qs('editPeriodModal'));
    }

    function syncCloseModalUi() {
      const targetStatus = clean(qs('close_status')?.value || 'completed').toLowerCase();
      const isWithdrawn = targetStatus === 'withdrawn';
      const previewBtn = qs('btn_previewClosePeriod');
      const previewPanel = qs('close_statusPreview');
      previewBtn?.classList.toggle('d-none', isWithdrawn);
      previewPanel?.classList.toggle('d-none', isWithdrawn);
      state.approvedCloseStatusPayload = null;
      if (isWithdrawn) {
        syncCloseModalWithdrawnConfirmState();
      } else if (qs('btn_confirmClosePeriod')) {
        qs('btn_confirmClosePeriod').disabled = true;
        if (previewPanel) {
          previewPanel.className = 'alert alert-light border mt-3 mb-0';
          previewPanel.textContent = 'Preview the financial effect before applying the status change.';
        }
      }
    }

    function syncCloseModalWithdrawnConfirmState() {
      const periodId = clean(qs('close_periodId')?.value);
      const effectiveDate = clean(qs('close_endDate')?.value);
      const reason = clean(qs('close_reasonEnd')?.value);
      const confirmBtn = qs('btn_confirmClosePeriod');
      if (!confirmBtn) return;
      confirmBtn.disabled = !(periodId && effectiveDate && reason);
    }

    function readCloseStatusPayload() {
      return {
        targetStatus: clean(qs('close_status')?.value || 'completed').toLowerCase(),
        effectiveDate: clean(qs('close_endDate')?.value),
        reason: clean(qs('close_reasonEnd')?.value)
      };
    }

    function openCloseModal(periodId) {
      const row = findEnrollmentRow(periodId);
      if (!row) {
        void deps.uiAlert?.('Enrollment not found in the current list.', 'Manage Enrollment', { icon: 'warning' });
        return;
      }
      state.approvedCloseStatusPayload = null;
      qs('close_periodId').value = clean(row.periodId);
      qs('close_endDate').value = clean(row.endDate) || todayIso();
      qs('close_status').value = 'completed';
      qs('close_reasonEnd').value = '';
      syncCloseModalUi();
      showModal(qs('closePeriodModal'));
    }

    async function previewClosePeriod() {
      const periodId = clean(qs('close_periodId')?.value);
      const payload = readCloseStatusPayload();
      if (!periodId || !payload.effectiveDate || !payload.reason) {
        await deps.uiAlert?.('Period, effective date, and reason are required.', 'Close Enrollment', { icon: 'warning' });
        return;
      }
      try {
        const result = await postJson(
          `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/preview`,
          payload
        );
        state.approvedCloseStatusPayload = payload;
        qs('btn_confirmClosePeriod').disabled = false;
        const preview = result.preview || {};
        const panel = qs('close_statusPreview');
        if (panel) {
          panel.className = 'alert alert-info mt-3 mb-0';
          panel.textContent = payload.targetStatus === 'cancelled'
            ? `Cancellation will reverse ${(preview.sourceTransactions || []).length} charge transaction(s), total ${Number(preview.adjustmentTotal || 0).toFixed(2)}. Payments will remain unchanged.`
            : (payload.targetStatus === 'archived'
              ? 'Archival will leave financial transactions unchanged.'
              : 'Completion will leave financial transactions unchanged.');
        }
      } catch (error) {
        state.approvedCloseStatusPayload = null;
        qs('btn_confirmClosePeriod').disabled = true;
        await deps.uiAlert?.(error.message || 'Unable to prepare status preview.', 'Close Enrollment', { icon: 'warning' });
      }
    }

    async function submitClosePeriod() {
      const periodId = clean(qs('close_periodId')?.value);
      const payload = readCloseStatusPayload();
      try {
        if (payload.targetStatus === 'withdrawn') {
          if (!periodId || !payload.effectiveDate || !payload.reason) {
            await deps.uiAlert?.('Period, effective date, and reason are required.', 'Close Enrollment', { icon: 'warning' });
            return;
          }
          await postJson(`/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/close`, {
            status: 'withdrawn',
            endDate: payload.effectiveDate,
            reasonEnd: payload.reason
          });
        } else {
          if (!state.approvedCloseStatusPayload
            || JSON.stringify(payload) !== JSON.stringify(state.approvedCloseStatusPayload)) {
            await deps.uiAlert?.('Preview the current status, date, and reason before applying.', 'Close Enrollment', { icon: 'warning' });
            qs('btn_confirmClosePeriod').disabled = true;
            return;
          }
          await postJson(
            `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/apply`,
            payload
          );
        }
        hideModal(qs('closePeriodModal'));
        await deps.uiAlert?.('Enrollment status updated.', 'Close Enrollment', { icon: 'success' });
        await loadEnrollmentList();
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to update enrollment status.', 'Close Enrollment', { icon: 'warning' });
      }
    }

    async function previewEditClosePeriod() {
      const periodId = clean(qs('edit_periodId')?.value);
      const statusPayload = readEditStatusPayload();
      if (statusPayload.mode !== 'close' || statusPayload.closeReason === 'withdrawn') return;
      if (!periodId || !statusPayload.effectiveDate || !statusPayload.reason) {
        await deps.uiAlert?.('Period, end date, and reason are required.', 'Edit Enrollment', { icon: 'warning' });
        return;
      }
      const payload = {
        targetStatus: statusPayload.closeReason,
        effectiveDate: statusPayload.effectiveDate,
        reason: statusPayload.reason
      };
      try {
        const result = await postJson(
          `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/preview`,
          payload
        );
        state.approvedEditCloseStatusPayload = payload;
        const preview = result.preview || {};
        const previewEl = qs('edit_closeStatusPreview');
        if (previewEl) {
          previewEl.className = 'alert alert-info mb-0';
          previewEl.textContent = payload.targetStatus === 'cancelled'
            ? `Cancellation will reverse ${(preview.sourceTransactions || []).length} charge transaction(s), total ${Number(preview.adjustmentTotal || 0).toFixed(2)}. Payments will remain unchanged.`
            : (payload.targetStatus === 'archived'
              ? 'Archival will leave financial transactions unchanged.'
              : 'Completion will leave financial transactions unchanged.');
        }
      } catch (error) {
        state.approvedEditCloseStatusPayload = null;
        await deps.uiAlert?.(error.message || 'Unable to prepare status preview.', 'Edit Enrollment', { icon: 'warning' });
      }
    }

    async function submitEditPeriod() {
      const periodId = clean(qs('edit_periodId')?.value);
      const startDate = clean(qs('edit_startDate')?.value);
      const endDate = clean(qs('edit_endDate')?.value);
      if (!periodId || !startDate) {
        await deps.uiAlert?.('Period and Start Date are required.', 'Edit Enrollment', { icon: 'warning' });
        return;
      }
      const row = state.editRow || {};
      const priorStatus = clean(row.status).toLowerCase() || 'active';
      const statusPayload = readEditStatusPayload();
      const nextOpenStatus = statusPayload.mode === 'open' ? statusPayload.status : priorStatus;
      const sessionCount = clean(qs('edit_targetSessionCount')?.value);
      const hours = clean(qs('edit_targetHours')?.value);
      if (sessionCount && hours) {
        await deps.uiAlert?.('Set either a session target or an hour target, not both.', 'Edit Enrollment', { icon: 'warning' });
        return;
      }
      if (statusPayload.mode === 'close') {
        if (!statusPayload.effectiveDate || !statusPayload.reason) {
          await deps.uiAlert?.('End date and reason are required to close the enrollment.', 'Edit Enrollment', { icon: 'warning' });
          return;
        }
        if (statusPayload.closeReason !== 'withdrawn') {
          const approved = state.approvedEditCloseStatusPayload;
          if (!approved
            || approved.targetStatus !== statusPayload.closeReason
            || approved.effectiveDate !== statusPayload.effectiveDate
            || approved.reason !== statusPayload.reason) {
            await deps.uiAlert?.('Preview the close reason, date, and reason before applying.', 'Edit Enrollment', { icon: 'warning' });
            return;
          }
        }
      }

      try {
        const funderLocked = qs('edit_funder')?.disabled === true;
        const funder = funderLocked
          ? {
              funderId: clean(row.funderId) || 'self',
              funderType: (!row.funderId || clean(row.funderId).toLowerCase() === 'self')
                ? 'self'
                : (clean(row.funderType) || 'funder')
            }
          : resolveFunderSelection();
        const editPayload = {
          startDate,
          endDate,
          status: priorStatus,
          funderType: funder.funderType,
          funderId: funder.funderId,
          ...readClaimPayload(),
          reasonStart: clean(qs('edit_reasonStart')?.value),
          sessionCountPolicy: 'all_non_na',
          sessionCapacityType: clean(qs('edit_sessionCapacityType')?.value) === 'one_on_one'
            ? 'one_on_one'
            : 'group',
          targetSessionCount: sessionCount,
          targetHours: hours
        };
        if (statusPayload.mode === 'open') {
          editPayload.status = nextOpenStatus;
        }
        await postJson(
          `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/edit`,
          editPayload
        );

        if (statusPayload.mode === 'close') {
          if (statusPayload.closeReason === 'withdrawn') {
            await postJson(`/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/close`, {
              status: 'withdrawn',
              endDate: statusPayload.effectiveDate,
              reasonEnd: statusPayload.reason
            });
          } else {
            await postJson(
              `/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/status/apply`,
              state.approvedEditCloseStatusPayload
            );
          }
        }

        hideModal(qs('editPeriodModal'));
        await deps.uiAlert?.('Enrollment period saved.', 'Edit Enrollment', { icon: 'success' });
        await loadEnrollmentList();
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to save enrollment changes.', 'Edit Enrollment', { icon: 'warning' });
      }
    }

    async function removeOrRollbackPeriod(periodId) {
      const row = findEnrollmentRow(periodId);
      if (!row) {
        await deps.uiAlert?.('Enrollment not found in the current list.', 'Manage Enrollment', { icon: 'warning' });
        return;
      }
      const status = clean(row.status).toLowerCase();
      const isRollback = status !== 'draft' && row.hasPostedTransactions === true;
      const actionLabel = isRollback ? 'Rollback Posted Enrollment' : 'Delete Draft Enrollment';
      const personLabel = escapeHtml(row.studentLabel || row.studentId || periodId);
      const confirmText = isRollback ? 'Rollback' : 'Delete';
      const confirmed = typeof deps.uiConfirm === 'function'
        ? await deps.uiConfirm(
          isRollback
            ? `Rollback posted transactions for <b>${personLabel}</b>?`
            : `Delete draft enrollment for <b>${personLabel}</b> before posting?`,
          actionLabel,
          {
            html: true,
            icon: isRollback ? 'warning' : 'question',
            confirmText,
            cancelText: 'Cancel',
            confirmClass: 'btn-danger'
          }
        )
        : false;
      if (confirmed !== true) return;

      try {
        await postJson(`/school/classes/api/enrollment-periods/${encodeURIComponent(periodId)}/remove`, {});
        await deps.uiAlert?.(
          isRollback ? 'Posted enrollment rolled back.' : 'Draft enrollment deleted.',
          actionLabel,
          { icon: 'success' }
        );
        await loadEnrollmentList();
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to complete the operation.', actionLabel, { icon: 'warning' });
      }
    }

    async function openManageFlow() {
      const ctx = selectionContext();
      if (ctx.error === 'mixed') {
        await deps.uiAlert?.('Clear staged session selections before managing saved enrollments.', 'Manage Enrollment', { icon: 'info' });
        return;
      }
      if (ctx.error === 'staged') {
        await deps.uiAlert?.('Save staged sessions before managing enrollments.', 'Manage Enrollment', { icon: 'info' });
        return;
      }
      if (ctx.error || !ctx.sessions?.length) {
        await deps.uiAlert?.('Select at least one saved class session.', 'Manage Enrollment', { icon: 'info' });
        return;
      }
      state.sessions = ctx.sessions;
      deps.showBootstrapModal?.(qs('scheduleManageEnrollmentModal'));
      try {
        await loadEnrollmentList();
      } catch (error) {
        const tbody = qs('scheduleManageEnrollmentTbody');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-danger p-4 text-center">${escapeHtml(error.message || 'Unable to load enrollments.')}</td></tr>`;
        }
        await deps.uiAlert?.(error.message || 'Unable to load enrollments.', 'Manage Enrollment', { icon: 'warning' });
      }
    }

    function bindOnce() {
      if (state.bound) return;
      state.bound = true;

      qs('btn_scheduleManageEnrollmentRefresh')?.addEventListener('click', () => {
        void loadEnrollmentList().catch(async (error) => {
          await deps.uiAlert?.(error.message || 'Unable to refresh enrollments.', 'Manage Enrollment', { icon: 'warning' });
        });
      });

      qs('scheduleManageEnrollmentTbody')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-manage-enroll-action]');
        if (!btn) return;
        const action = clean(btn.getAttribute('data-manage-enroll-action'));
        const periodId = clean(btn.getAttribute('data-period-id'));
        if (!periodId) return;
        if (action === 'edit') void openEditModal(periodId).catch(async (error) => {
          await deps.uiAlert?.(error.message || 'Unable to open edit enrollment.', 'Edit Enrollment', { icon: 'warning' });
        });
        if (action === 'close') openCloseModal(periodId);
        if (action === 'delete') void removeOrRollbackPeriod(periodId);
      });

      qs('btn_previewClosePeriod')?.addEventListener('click', () => { void previewClosePeriod(); });
      qs('btn_confirmClosePeriod')?.addEventListener('click', () => { void submitClosePeriod(); });
      qs('close_status')?.addEventListener('change', () => syncCloseModalUi());
      qs('close_endDate')?.addEventListener('input', () => {
        if (clean(qs('close_status')?.value).toLowerCase() === 'withdrawn') syncCloseModalWithdrawnConfirmState();
        else {
          state.approvedCloseStatusPayload = null;
          if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
        }
      });
      qs('close_reasonEnd')?.addEventListener('input', () => {
        if (clean(qs('close_status')?.value).toLowerCase() === 'withdrawn') syncCloseModalWithdrawnConfirmState();
        else {
          state.approvedCloseStatusPayload = null;
          if (qs('btn_confirmClosePeriod')) qs('btn_confirmClosePeriod').disabled = true;
        }
      });

      qs('btn_previewEditClosePeriod')?.addEventListener('click', () => { void previewEditClosePeriod(); });
      qs('btn_confirmEditPeriod')?.addEventListener('click', () => { void submitEditPeriod(); });
      qs('edit_status')?.addEventListener('change', () => syncEditStatusUi(state.editRow));
      qs('edit_closeReason')?.addEventListener('change', () => syncEditStatusUi(state.editRow));
    }

    bindOnce();
    deps.bindManageEnrollmentRail?.(openManageFlow);
  }

  global.installMasterScheduleManageEnrollment = installMasterScheduleManageEnrollment;
})(typeof window !== 'undefined' ? window : global);
