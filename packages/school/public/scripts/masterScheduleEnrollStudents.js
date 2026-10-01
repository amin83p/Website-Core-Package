(function (global) {
  'use strict';

  function installMasterScheduleEnrollStudents(deps) {
    if (!deps || typeof deps !== 'object') return;
    const groupClient = global.RollingEnrollmentGroupClient || {};
    const escapeHtml = typeof deps.escapeHtml === 'function'
      ? deps.escapeHtml
      : (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    let claimNumbersConfigured = false;
    const flowState = {
      prepare: null,
      students: [],
      queue: [],
      programRegActionStateId: ''
    };

    function clean(value) {
      return String(value || '').trim();
    }

    function formatStudentDisplay(name, studentId) {
      const id = clean(studentId);
      let label = clean(name);
      if (label && id && label === id) label = '';
      if (label && id) {
        return `<div class="fw-semibold">${escapeHtml(label)}</div><div class="small text-muted font-monospace">${escapeHtml(id)}</div>`;
      }
      const lone = label || id || '—';
      return `<div class="fw-semibold">${escapeHtml(lone)}</div>`;
    }

    async function requestJson(url, options = {}) {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(options.headers || {})
        },
        ...options
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data?.status || '').toLowerCase() === 'error') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
    }

    function configureStudentClaimNumbersManager() {
      if (claimNumbersConfigured) return;
      const mgr = global.StudentClaimNumbersManager;
      if (!mgr || typeof mgr.configure !== 'function') return;
      claimNumbersConfigured = true;
      const modalEl = document.getElementById('rollingStudentClaimNumbersModal');

      function mountScheduleModalToBody(el) {
        if (!el || el.parentElement === document.body) return el;
        document.body.appendChild(el);
        return el;
      }

      function raiseScheduleModalAboveStack(el) {
        if (!el) return;
        mountScheduleModalToBody(el);
        let maxZ = 1050;
        document.querySelectorAll('.modal.show').forEach((openModal) => {
          if (openModal === el) return;
          const z = Number.parseInt(window.getComputedStyle(openModal).zIndex, 10);
          if (Number.isFinite(z) && z > maxZ) maxZ = z;
        });
        const loadingEl = document.getElementById('globalLoadingModal');
        if (loadingEl?.classList.contains('is-visible')) {
          const loadingZ = Number.parseInt(window.getComputedStyle(loadingEl).zIndex, 10);
          if (Number.isFinite(loadingZ) && loadingZ > maxZ) maxZ = loadingZ;
        }
        const modalZ = Math.max(maxZ + 10, 1055);
        el.style.setProperty('z-index', String(modalZ), 'important');
        const backdrops = document.querySelectorAll('.modal-backdrop.show');
        const backdrop = backdrops[backdrops.length - 1];
        if (backdrop) backdrop.style.setProperty('z-index', String(modalZ - 5), 'important');
      }

      function clearScheduleModalStackZIndex(el) {
        el?.style.removeProperty('z-index');
      }

      mgr.configure({
        requestJson,
        canEdit: true,
        showMsg: async (title, icon, message) => {
          await deps.uiAlert?.(message, title, { icon: icon === 'error' ? 'error' : (icon === 'warning' ? 'warning' : 'info') });
        },
        mountModal: mountScheduleModalToBody,
        raiseModal: raiseScheduleModalAboveStack,
        clearModalStack: clearScheduleModalStackZIndex,
        showModal: () => {
          if (!modalEl || !window.bootstrap?.Modal) return;
          mountScheduleModalToBody(modalEl);
          window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },
        getModalEl: () => modalEl
      });
    }

    function buildFunderSelectHtml(funderOptions, selectedFunderId) {
      const selected = clean(selectedFunderId) || 'self';
      const options = ['<option value="self"' + (selected === 'self' ? ' selected' : '') + '>Self Fund</option>'];
      (Array.isArray(funderOptions) ? funderOptions : []).forEach((f) => {
        const id = clean(f?.id);
        if (!id) return;
        const label = clean(f?.label) || id;
        options.push(`<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`);
      });
      return options.join('');
    }

    async function postJson(url, body) {
      const actionStateId = clean(body?.actionStateId || flowState.programRegActionStateId);
      const payload = { ...(body || {}) };
      if (actionStateId && !payload.actionStateId) payload.actionStateId = actionStateId;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(actionStateId ? { 'X-Action-State-Id': actionStateId } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
    }

    function resolveSelectionContext() {
      const savedCount = typeof deps.countActiveScheduleSelectedSessions === 'function'
        ? deps.countActiveScheduleSelectedSessions()
        : 0;
      const stagedCount = typeof deps.countActiveDraftSelectedSessions === 'function'
        ? deps.countActiveDraftSelectedSessions()
        : 0;
      if (savedCount > 0 && stagedCount > 0) {
        return { error: 'mixed' };
      }
      if (savedCount >= 2) {
        const events = typeof deps.getSelectedSavedClassSessionEvents === 'function'
          ? deps.getSelectedSavedClassSessionEvents()
          : [];
        return { sessionMode: 'saved', events };
      }
      if (stagedCount >= 2) {
        const events = typeof deps.getSelectedDraftEvents === 'function' ? deps.getSelectedDraftEvents() : [];
        return { sessionMode: 'staged', events };
      }
      return { error: 'insufficient' };
    }

    function mapSessionsForApi(events) {
      return (Array.isArray(events) ? events : []).map((ev) => ({
        classId: clean(ev?.classId),
        sessionId: clean(ev?.sessionId || ev?.id),
        date: clean(ev?.date),
        start: clean(ev?.start),
        end: clean(ev?.end)
      })).filter((row) => row.classId && row.sessionId && row.date);
    }

    function showCapacityBlockModal(conflicts) {
      const modalEl = document.getElementById('scheduleEnrollCapacityBlockModal');
      const bodyEl = document.getElementById('scheduleEnrollCapacityBlockBody');
      if (!modalEl || !bodyEl) return;
      const rows = (Array.isArray(conflicts) ? conflicts : []).map((row) => {
        const names = (row.students || []).map((s) => clean(s.name)).filter(Boolean).join(', ');
        return `<div class="border rounded p-2 mb-2"><div class="fw-semibold">${clean(row.date)} ${clean(row.start)}–${clean(row.end)}</div><div class="small text-muted">${names || 'Student enrolled'}</div></div>`;
      }).join('');
      bodyEl.innerHTML = rows || '<div class="text-muted small">No details available.</div>';
      deps.showBootstrapModal?.(modalEl);
    }

    function allProgramRowsRegistered(rows) {
      return (Array.isArray(rows) ? rows : []).length > 0
        && rows.every((row) => clean(row.status) === 'registered');
    }

    function renderProgramRegRows(rows) {
      const tbody = document.getElementById('scheduleEnrollProgramRegTbody');
      const nextBtn = document.getElementById('btn_scheduleEnrollProgramRegNext');
      if (!tbody) return;
      tbody.innerHTML = (Array.isArray(rows) ? rows : []).map((row, index) => {
        const dateVal = clean(row.registrationDate || row.suggestedRegistrationDate);
        const maxDate = clean(flowState.prepare?.startDate);
        const statusBadge = clean(row.status) === 'registered'
          ? '<span class="badge bg-success-subtle text-success border">Registered</span>'
          : '<span class="badge bg-warning-subtle text-warning-emphasis border">Required</span>';
        return `<tr data-prog-row="${index}">
          <td>${formatStudentDisplay(row.studentLabel, row.studentId)}</td>
          <td>
            <div class="small text-muted">${clean(row.programLabel || row.programId)}</div>
            <input type="date" class="form-control form-control-sm mt-1 js-schedule-enroll-reg-date" value="${dateVal}" max="${maxDate}" ${clean(row.status) === 'registered' ? 'disabled' : ''}>
          </td>
          <td>${statusBadge}<div class="small text-muted mt-1">${clean(row.message || '')}</div></td>
          <td class="text-end">
            <div class="d-inline-flex gap-1">
              <button type="button" class="btn btn-sm btn-success js-schedule-enroll-reg-play" data-index="${index}" title="Register" ${clean(row.status) === 'registered' ? 'disabled' : ''}><i class="bi bi-play-fill"></i></button>
              <button type="button" class="btn btn-sm btn-outline-danger js-schedule-enroll-reg-remove" data-index="${index}" title="Remove"><i class="bi bi-x-lg"></i></button>
            </div>
          </td>
        </tr>`;
      }).join('');
      if (nextBtn) nextBtn.disabled = !allProgramRowsRegistered(rows);
      tbody.querySelectorAll('.js-schedule-enroll-reg-play').forEach((btn) => {
        btn.addEventListener('click', () => void finalizeProgramRow(Number(btn.getAttribute('data-index'))));
      });
      tbody.querySelectorAll('.js-schedule-enroll-reg-remove').forEach((btn) => {
        btn.addEventListener('click', () => removeProgramRow(Number(btn.getAttribute('data-index'))));
      });
    }

    async function finalizeProgramRow(index) {
      const row = flowState.students[index];
      if (!row || clean(row.status) === 'registered') return;
      const tr = document.querySelector(`tr[data-prog-row="${index}"]`);
      const dateInput = tr?.querySelector('.js-schedule-enroll-reg-date');
      const registrationDate = clean(dateInput?.value || row.registrationDate);
      if (!clean(flowState.programRegActionStateId)) {
        await deps.uiAlert?.('Registration token is missing. Close this dialog and open Enroll Students again.', 'Program registration', { icon: 'warning' });
        return;
      }
      try {
        const result = await postJson('/school/schedules/api/enroll-students/program-registrations/finalize', {
          classId: flowState.prepare?.classId,
          studentId: row.studentId,
          programId: row.programId,
          registrationDate,
          firstSessionDate: flowState.prepare?.startDate,
          note: 'Master Schedule Enroll Students'
        });
        row.status = 'registered';
        row.registrationDate = registrationDate;
        row.registrationId = result?.data?.registrationId || '';
        row.message = result?.data?.message || result.message || 'Registered';
        renderProgramRegRows(flowState.students);
      } catch (error) {
        row.message = error.message || 'Registration failed.';
        renderProgramRegRows(flowState.students);
        await deps.uiAlert?.(row.message, 'Program registration', { icon: 'warning' });
      }
    }

    function removeProgramRow(index) {
      flowState.students.splice(index, 1);
      if (!flowState.students.length) {
        deps.hideBootstrapModal?.(document.getElementById('scheduleEnrollProgramRegModal'));
        return;
      }
      renderProgramRegRows(flowState.students);
    }

    async function openProgramRegistrationStep() {
      const response = await postJson('/school/schedules/api/enroll-students/program-registrations', {
        classId: flowState.prepare?.classId,
        studentIds: flowState.students.map((s) => s.studentId),
        firstSessionDate: flowState.prepare?.startDate
      });
      const rows = Array.isArray(response?.data?.rows) ? response.data.rows : [];
      flowState.students = rows.map((row) => {
        const prior = flowState.students.find((s) => clean(s.studentId) === clean(row.studentId));
        const id = clean(row.studentId);
        let studentLabel = clean(row.studentLabel);
        if ((!studentLabel || studentLabel === id) && prior?.studentLabel && clean(prior.studentLabel) !== id) {
          studentLabel = clean(prior.studentLabel);
        }
        return { ...row, studentLabel: studentLabel || id };
      });
      flowState.programRegActionStateId = clean(response.actionStateId);
      renderProgramRegRows(flowState.students);
      deps.showBootstrapModal?.(document.getElementById('scheduleEnrollProgramRegModal'));
    }

    function buildQueueFromStudents() {
      const prep = flowState.prepare || {};
      flowState.queue = flowState.students.map((student) => ({
        studentId: student.studentId,
        label: (() => {
          const id = clean(student.studentId);
          const name = clean(student.studentLabel);
          return (name && name !== id) ? name : name || id;
        })(),
        startDate: prep.startDate,
        endDate: prep.endDate,
        targetSessionCount: String(prep.sessionCount || ''),
        sessionCapacityType: prep.sessionCapacityType || 'group',
        status: 'active',
        funderType: 'self',
        funderId: 'self',
        claimNumberId: '',
        claimNumber: '',
        reasonStart: '',
        enrollmentStatus: 'pending'
      }));
    }

    const manageState = {
      classId: '',
      queue: [],
      meta: null
    };

    function enrollmentMetaFromPrepare(prep) {
      const p = prep && typeof prep === 'object' ? prep : {};
      return {
        startDate: clean(p.startDate),
        endDate: clean(p.endDate),
        sessionCount: p.sessionCount,
        sessionCapacityType: p.sessionCapacityType || 'group',
        funderOptions: Array.isArray(p.funderOptions) ? p.funderOptions : [],
        classId: clean(p.classId)
      };
    }

    function setEnrollmentSummaryHeader(prefix, meta) {
      const m = meta && typeof meta === 'object' ? meta : {};
      const setText = (suffix, value) => {
        const el = document.getElementById(`${prefix}${suffix}`);
        if (el) el.textContent = value;
      };
      setText('StartDate', clean(m.startDate) || '—');
      setText('EndDate', clean(m.endDate) || '—');
      setText('SessionCount', String(m.sessionCount ?? '—'));
      setText('Capacity', m.sessionCapacityType === 'one_on_one' ? '1 On 1' : 'Group');
    }

    function pendingEntryToQueueRow(entry) {
      const studentId = clean(entry?.students?.[0]?.studentId);
      const cap = entry?.students?.[0]?.sessionCapacityType || entry?.sessionCapacityType;
      const settings = groupClient.groupEnrollmentSettingsFromEntry({
        startDate: entry?.startDate,
        endDate: entry?.endDate,
        status: entry?.status,
        funderType: entry?.funderType,
        funderId: entry?.funderId,
        claimNumberId: entry?.claimNumberId,
        claimNumber: entry?.claimNumber,
        reasonStart: entry?.reasonStart,
        targetSessionCount: entry?.targetSessionCount != null ? String(entry.targetSessionCount) : '',
        sessionCapacityType: cap
      });
      return {
        studentId,
        label: clean(entry?.studentLabel) || studentId,
        ...settings,
        selectedSessionIds: Array.isArray(entry?.selectedSessionIds)
          ? entry.selectedSessionIds.map((sid) => clean(sid)).filter(Boolean)
          : [],
        enrollmentStatus: 'draft'
      };
    }

    function buildQueueRowHtml(row, index, options = {}) {
      const mode = options.mode === 'manage' ? 'manage' : 'flow';
      const funderOptions = Array.isArray(options.funderOptions) ? options.funderOptions : [];
      const funderSelect = buildFunderSelectHtml(funderOptions, row.funderId);
      const reasonVal = escapeHtml(clean(row.reasonStart));
      const tbodyId = clean(options.tbodyId) || 'scheduleEnrollQueueTbody';
      if (mode === 'manage') {
        return `<tr data-queue-row="${index}" data-queue-tbody="${escapeHtml(tbodyId)}">
          <td>${formatStudentDisplay(row.label, row.studentId)}</td>
          <td><select class="form-select form-select-sm js-schedule-enroll-funder">${funderSelect}</select></td>
          <td><select class="form-select form-select-sm js-schedule-enroll-claim"><option value="">—</option></select></td>
          <td><textarea class="form-control form-control-sm js-schedule-enroll-reason" rows="2" placeholder="Optional start note">${reasonVal}</textarea></td>
          <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger js-schedule-enroll-manage-remove" data-index="${index}"><i class="bi bi-trash"></i></button></td>
        </tr>`;
      }
      const statusLabel = clean(row.enrollmentStatus) === 'completed'
        ? '<span class="badge bg-success-subtle text-success border">Enrolled</span>'
        : (clean(row.enrollmentStatus) === 'draft' ? '<span class="badge bg-info-subtle text-info border">Queued (draft)</span>' : '<span class="badge bg-light text-dark border">Pending</span>');
      const enrollLocked = clean(row.enrollmentStatus) === 'completed' || clean(row.enrollmentStatus) === 'draft';
      return `<tr data-queue-row="${index}" data-queue-tbody="${escapeHtml(tbodyId)}">
          <td>${formatStudentDisplay(row.label, row.studentId)}</td>
          <td><select class="form-select form-select-sm js-schedule-enroll-funder">${funderSelect}</select></td>
          <td><select class="form-select form-select-sm js-schedule-enroll-claim"><option value="">—</option></select></td>
          <td><textarea class="form-control form-control-sm js-schedule-enroll-reason" rows="2" placeholder="Optional start note">${reasonVal}</textarea></td>
          <td>${statusLabel}</td>
          <td class="text-end"><button type="button" class="btn btn-sm btn-success js-schedule-enroll-play" data-index="${index}" ${enrollLocked ? 'disabled' : ''}><i class="bi bi-play-fill"></i></button></td>
        </tr>`;
    }

    async function hydrateQueueClaimSelects(tbodyId, rows) {
      const mgr = global.StudentClaimNumbersManager;
      if (!mgr || typeof mgr.refreshClaimNumberSelect !== 'function') return;
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return;
      const queueRows = Array.isArray(rows) ? rows : [];
      for (let index = 0; index < queueRows.length; index += 1) {
        const row = queueRows[index];
        const tr = tbody.querySelector(`tr[data-queue-row="${index}"]`);
        const select = tr?.querySelector('.js-schedule-enroll-claim');
        if (!select || !row?.studentId) continue;
        const token = clean(row.claimNumberId || row.claimNumber);
        await mgr.refreshClaimNumberSelect(select, row.studentId, token);
        if (select.dataset.scheduleEnrollClaimBound === '1') continue;
        select.dataset.scheduleEnrollClaimBound = '1';
        select.addEventListener('change', () => {
          if (typeof mgr.handleClaimNumberSelectChange === 'function') {
            void mgr.handleClaimNumberSelectChange(select, row.studentId, row.label);
          }
        });
      }
    }

    function readQueueRowFromDom(index, queueRef, tbodyId = 'scheduleEnrollQueueTbody') {
      const tbody = document.getElementById(tbodyId);
      const tr = tbody?.querySelector(`tr[data-queue-row="${index}"]`);
      const row = queueRef[index];
      if (!tr || !row) return row;
      const funderId = clean(tr.querySelector('.js-schedule-enroll-funder')?.value) || 'self';
      row.funderId = funderId;
      row.funderType = funderId === 'self' ? 'self' : 'funder';
      const claimSelect = tr.querySelector('.js-schedule-enroll-claim');
      const mgr = global.StudentClaimNumbersManager;
      row.claimNumberId = mgr && typeof mgr.readClaimNumberSelectValue === 'function'
        ? clean(mgr.readClaimNumberSelectValue(claimSelect))
        : clean(claimSelect?.value);
      row.claimNumber = '';
      row.reasonStart = clean(tr.querySelector('.js-schedule-enroll-reason')?.value);
      return row;
    }

    function renderEnrollmentQueueTable({ tbodyId, rows, meta, mode }) {
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return;
      const funderOptions = Array.isArray(meta?.funderOptions) ? meta.funderOptions : [];
      tbody.innerHTML = (Array.isArray(rows) ? rows : []).map((row, index) => buildQueueRowHtml(row, index, {
        mode,
        funderOptions,
        tbodyId
      })).join('');
      if (mode === 'flow') {
        tbody.querySelectorAll('.js-schedule-enroll-play').forEach((btn) => {
          btn.addEventListener('click', () => void runEnrollmentForRow(Number(btn.getAttribute('data-index'))));
        });
      } else if (mode === 'manage') {
        tbody.querySelectorAll('.js-schedule-enroll-manage-remove').forEach((btn) => {
          btn.addEventListener('click', () => removeManageQueueRow(Number(btn.getAttribute('data-index'))));
        });
      }
      void hydrateQueueClaimSelects(tbodyId, rows);
    }

    function renderQueueModal() {
      const prep = flowState.prepare || {};
      setEnrollmentSummaryHeader('scheduleEnrollQueue', enrollmentMetaFromPrepare(prep));
      renderEnrollmentQueueTable({
        tbodyId: 'scheduleEnrollQueueTbody',
        rows: flowState.queue,
        meta: prep,
        mode: 'flow'
      });
      deps.showBootstrapModal?.(document.getElementById('scheduleEnrollQueueModal'));
    }

    function storePendingEnrollmentDraft(payload, row) {
      const classId = clean(flowState.prepare?.classId);
      if (!classId || typeof deps.setPendingEnrollStudentsForClass !== 'function') return;
      const selectedSessionIds = (Array.isArray(flowState.prepare?.sessions) ? flowState.prepare.sessions : [])
        .map((sessionRow) => clean(sessionRow?.sessionId))
        .filter(Boolean);
      deps.setPendingEnrollStudentsForClass(classId, {
        ...(payload || {}),
        studentLabel: clean(row?.label || row?.studentLabel),
        selectedSessionIds
      });
      if (typeof deps.setPendingEnrollMetaForClass === 'function') {
        deps.setPendingEnrollMetaForClass(classId, enrollmentMetaFromPrepare(flowState.prepare));
      }
      deps.refreshScheduleViewWithHolidays?.();
      deps.syncPartialModalFromTimelineDrafts?.();
    }

    async function runEnrollmentForRow(index) {
      const row = readQueueRowFromDom(index, flowState.queue, 'scheduleEnrollQueueTbody');
      const status = clean(row?.enrollmentStatus);
      if (!row || status === 'completed' || status === 'draft') return;
      if (row._enrollmentInFlight === true) return;
      row._enrollmentInFlight = true;
      const settings = groupClient.groupEnrollmentSettingsFromEntry?.(row) || row;
      const payload = groupClient.buildGroupEnginePayload?.(flowState.prepare?.classId, row.studentId, settings) || {};
      if (flowState.prepare?.sessionMode === 'staged') {
        row.enrollmentStatus = 'draft';
        storePendingEnrollmentDraft(payload, row);
        row._enrollmentInFlight = false;
        renderQueueModal();
        await deps.uiAlert?.('Enrollment queued as draft. It will be saved when you save staged sessions.', 'Enroll students', { icon: 'info' });
        return;
      }
      try {
        const res = await fetch(`/school/classes/api/${encodeURIComponent(flowState.prepare.classId)}/rolling-enrollment/execute`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-AJAX-Request': 'true'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Enrollment failed.');
        row.enrollmentStatus = 'completed';
        renderQueueModal();
        await deps.uiAlert?.(data.message || 'Enrollment completed.', 'Enroll students', { icon: 'success' });
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Enrollment failed.', 'Enroll students', { icon: 'warning' });
      } finally {
        row._enrollmentInFlight = false;
      }
    }

    function studentLabelFromPickerItem(item) {
      if (!item || typeof item !== 'object') return '';
      const displayName = clean(item.displayName);
      if (displayName) return displayName;
      const name = item.name;
      if (typeof name === 'string' && clean(name)) return clean(name);
      if (name && typeof name === 'object') {
        const full = `${clean(name.first)} ${clean(name.last)}`.trim();
        if (full) return full;
      }
      return clean(item.label || item.id);
    }

    async function openStudentPicker(prepareData, excludeStudentIds) {
      if (!global.GenericPicker || typeof global.GenericPicker.open !== 'function') {
        await deps.uiAlert?.('Student picker is unavailable.', 'Enroll students', { icon: 'warning' });
        return;
      }
      const excludeSet = new Set((Array.isArray(excludeStudentIds) ? excludeStudentIds : []).map((id) => clean(id)));
      const multiselect = prepareData.multiselectStudents === true;
      const base = global.GenericPickerPresets?.student?.({
        title: multiselect ? 'Select students' : 'Select student',
        multiselect,
        onSelect: (item) => {
          if (!item) return;
          const selected = multiselect && Array.isArray(item) ? item : [item];
          flowState.students = selected.map((row) => ({
            studentId: clean(row.id),
            studentLabel: studentLabelFromPickerItem(row)
          })).filter((row) => row.studentId);
          void openProgramRegistrationStep();
        },
        itemFilter: (item) => !excludeSet.has(clean(item?.id))
      }) || {
        title: 'Select students',
        multiselect,
        apiEndpoint: '/school/students/api/data',
        onSelect: () => {}
      };
      global.GenericPicker.open(global.GenericPickerPresets?.normalizeConfig?.(base) || base);
    }

    async function startClaimNumbersFlow() {
      configureStudentClaimNumbersManager();
      const mgr = global.StudentClaimNumbersManager;
      if (!mgr || typeof mgr.open !== 'function') {
        await deps.uiAlert?.('Claim number management is unavailable.', 'Manage Claim Numbers', { icon: 'warning' });
        return;
      }
      if (!global.GenericPicker || typeof global.GenericPicker.open !== 'function') {
        await deps.uiAlert?.('Student picker is unavailable.', 'Manage Claim Numbers', { icon: 'warning' });
        return;
      }
      const base = global.GenericPickerPresets?.student?.({
        title: 'Select student',
        multiselect: false,
        onSelect: (item) => {
          if (!item) return;
          const studentId = clean(item.id);
          if (!studentId) return;
          void mgr.open({
            studentId,
            studentLabel: studentLabelFromPickerItem(item) || studentId
          });
        }
      }) || {
        title: 'Select student',
        multiselect: false,
        apiEndpoint: '/school/students/api/data',
        onSelect: () => {}
      };
      global.GenericPicker.open(global.GenericPickerPresets?.normalizeConfig?.(base) || base);
    }

    function renderPendingManageModal() {
      setEnrollmentSummaryHeader('scheduleEnrollPendingManage', manageState.meta || {});
      renderEnrollmentQueueTable({
        tbodyId: 'scheduleEnrollPendingManageTbody',
        rows: manageState.queue,
        meta: manageState.meta,
        mode: 'manage'
      });
      const removeAllBtn = document.getElementById('btn_scheduleEnrollPendingManageRemoveAll');
      if (removeAllBtn) removeAllBtn.classList.toggle('d-none', !manageState.queue.length);
    }

    function removeManageQueueRow(index) {
      manageState.queue.splice(index, 1);
      if (!manageState.queue.length) {
        if (typeof deps.clearPendingEnrollStudentsForClass === 'function') {
          deps.clearPendingEnrollStudentsForClass(manageState.classId);
        }
        deps.refreshScheduleViewWithHolidays?.();
        deps.syncPartialModalFromTimelineDrafts?.();
        deps.hideBootstrapModal?.(document.getElementById('scheduleEnrollPendingManageModal'));
        return;
      }
      renderPendingManageModal();
    }

    function savePendingManageModal() {
      const classId = clean(manageState.classId);
      if (!classId) return;
      manageState.queue.forEach((row, index) => {
        readQueueRowFromDom(index, manageState.queue, 'scheduleEnrollPendingManageTbody');
      });
      const entries = manageState.queue.map((row) => ({
        ...groupClient.buildGroupEnginePayload(classId, row.studentId, groupClient.groupEnrollmentSettingsFromEntry(row)),
        studentLabel: row.label,
        selectedSessionIds: Array.isArray(row.selectedSessionIds) ? row.selectedSessionIds.slice() : []
      }));
      if (typeof deps.replacePendingEnrollStudentsForClass === 'function') {
        deps.replacePendingEnrollStudentsForClass(classId, entries);
      }
      deps.refreshScheduleViewWithHolidays?.();
      deps.syncPartialModalFromTimelineDrafts?.();
      deps.hideBootstrapModal?.(document.getElementById('scheduleEnrollPendingManageModal'));
    }

    function openPendingEnrollmentManageModal(classId) {
      const cid = clean(classId);
      if (!cid || typeof deps.getPendingEnrollStudentsForClass !== 'function') return;
      const entries = deps.getPendingEnrollStudentsForClass(cid);
      if (!entries.length) return;
      const meta = typeof deps.getPendingEnrollMetaForClass === 'function'
        ? deps.getPendingEnrollMetaForClass(cid)
        : null;
      manageState.classId = cid;
      manageState.meta = meta || enrollmentMetaFromPrepare({ classId: cid });
      manageState.queue = entries.map((entry) => pendingEntryToQueueRow(entry));
      renderPendingManageModal();
      deps.showBootstrapModal?.(document.getElementById('scheduleEnrollPendingManageModal'));
    }

    async function startEnrollStudentsFlow() {
      const ctx = resolveSelectionContext();
      if (ctx.error === 'mixed') {
        await deps.uiAlert?.(
          'Selected sessions include both saved and staged sessions. Save staged sessions first, or clear one selection type before enrolling.',
          'Enroll students',
          { icon: 'info' }
        );
        return;
      }
      if (ctx.error === 'insufficient') {
        await deps.uiAlert?.('Select at least two class sessions in the same rolling class.', 'Enroll students', { icon: 'info' });
        return;
      }
      const sessions = mapSessionsForApi(ctx.events);
      if (sessions.length < 2) {
        await deps.uiAlert?.('Select at least two valid class sessions.', 'Enroll students', { icon: 'info' });
        return;
      }
      try {
        const prepareRes = await postJson('/school/schedules/api/enroll-students/prepare', {
          classId: sessions[0].classId,
          sessionMode: ctx.sessionMode,
          sessions
        });
        flowState.prepare = prepareRes.data;
        const capRes = await postJson('/school/schedules/api/enroll-students/session-capacity-check', {
          classId: flowState.prepare.classId,
          sessions
        });
        if (capRes?.data?.blocked) {
          showCapacityBlockModal(capRes.data.conflicts);
          return;
        }
        const exRes = await postJson('/school/schedules/api/enroll-students/student-picker-exclusions', {
          classId: flowState.prepare.classId,
          startDate: flowState.prepare.startDate,
          endDate: flowState.prepare.endDate
        });
        await openStudentPicker(flowState.prepare, exRes.excludeStudentIds);
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to start Enroll Students.', 'Enroll students', { icon: 'warning' });
      }
    }

    document.getElementById('btn_scheduleEnrollProgramRegNext')?.addEventListener('click', () => {
      if (!allProgramRowsRegistered(flowState.students)) return;
      buildQueueFromStudents();
      deps.hideBootstrapModal?.(document.getElementById('scheduleEnrollProgramRegModal'));
      renderQueueModal();
    });

    document.getElementById('btn_scheduleEnrollPendingManageSave')?.addEventListener('click', () => {
      savePendingManageModal();
    });

    document.getElementById('btn_scheduleEnrollPendingManageRemoveAll')?.addEventListener('click', async () => {
      if (!manageState.queue.length) return;
      let ok = false;
      if (typeof deps.uiConfirm === 'function') {
        ok = await deps.uiConfirm(
          'Remove all drafted enrollments for this class?',
          'Remove all',
          { icon: 'warning', cancelText: 'Cancel', confirmText: 'Remove all', confirmClass: 'btn-danger btn-md' }
        );
      } else {
        ok = window.confirm('Remove all drafted enrollments for this class?');
      }
      if (!ok) return;
      if (typeof deps.clearPendingEnrollStudentsForClass === 'function') {
        deps.clearPendingEnrollStudentsForClass(manageState.classId);
      }
      manageState.queue = [];
      deps.refreshScheduleViewWithHolidays?.();
      deps.syncPartialModalFromTimelineDrafts?.();
      deps.hideBootstrapModal?.(document.getElementById('scheduleEnrollPendingManageModal'));
    });

    configureStudentClaimNumbersManager();
    deps.bindEnrollStudentsRail?.(startEnrollStudentsFlow);
    deps.bindClaimNumbersRail?.(startClaimNumbersFlow);

    global.MasterScheduleEnrollStudents = {
      openPendingEnrollmentManageModal
    };
  }

  global.installMasterScheduleEnrollStudents = installMasterScheduleEnrollStudents;
})(typeof window !== 'undefined' ? window : global);
