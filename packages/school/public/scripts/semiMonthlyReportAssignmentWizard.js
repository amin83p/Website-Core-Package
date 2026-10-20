(function (global) {
  'use strict';

  const state = {
    step: 'scope',
    programs: [],
    verifiedEndDate: '',
    dateMessage: '',
    preview: null,
    selectedClassIds: new Set(),
    classSearchQuery: '',
    classSort: 'title-asc',
    selectedStudents: {},
    result: null
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || '').trim();
  }

  function resolveActionStateId() {
    const fromInput = clean(document.querySelector('input[name="actionStateId"]')?.value);
    if (fromInput) return fromInput;
    const ref = document.getElementById('actionStateIdRef');
    return clean(ref?.dataset?.id || ref?.getAttribute('data-id'));
  }

  function rememberActionStateId(id) {
    const token = clean(id);
    if (!token) return;
    let input = document.querySelector('input[name="actionStateId"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'actionStateId';
      document.body.appendChild(input);
    }
    input.value = token;
    const ref = document.getElementById('actionStateIdRef');
    if (ref) ref.dataset.id = token;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function postJson(url, body) {
    const actionStateId = resolveActionStateId();
    const payload = { ...(body || {}), ...(actionStateId ? { actionStateId } : {}) };
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
    const nextActionStateId = res.headers.get('x-action-state-id');
    if (nextActionStateId) rememberActionStateId(nextActionStateId);
    const data = await res.json().catch(() => ({}));
    if (data.actionStateId) rememberActionStateId(data.actionStateId);
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.message || `Request failed (${res.status}).`);
    }
    return data.data || {};
  }

  function scope() {
    return clean(qs('smmrReportScope')?.value) || 'class';
  }

  const STEPS = [
    { id: 'scope', label: 'Scope and programs' },
    { id: 'dates', label: 'Dates' },
    { id: 'task', label: 'Task settings' },
    { id: 'tiles', label: 'Classes' },
    { id: 'run', label: 'Summary' }
  ];

  function showStep(step) {
    state.step = step;
    document.querySelectorAll('[data-smmr-step]').forEach((el) => {
      el.classList.toggle('d-none', el.getAttribute('data-smmr-step') !== step);
    });
    const index = Math.max(0, STEPS.findIndex((item) => item.id === step));
    const progress = ((index + 1) / STEPS.length) * 100;
    const badge = qs('smmrWizardStepBadge');
    const pct = qs('smmrWizardProgressPct');
    const bar = qs('smmrWizardProgressBar');
    if (badge) badge.textContent = `Step ${index + 1} of ${STEPS.length}`;
    if (pct) pct.textContent = `${Math.round(progress)}%`;
    if (bar) bar.style.width = `${progress.toFixed(2)}%`;
    document.querySelectorAll('[data-smmr-pill]').forEach((el) => {
      const pillId = el.getAttribute('data-smmr-pill');
      const pillIndex = STEPS.findIndex((item) => item.id === pillId);
      el.classList.toggle('active', pillId === step);
      el.classList.toggle('completed', pillIndex > -1 && pillIndex < index);
    });
    if (global.WizardStepRail) global.WizardStepRail.sync(qs('smmrWizardStepPills'));
    qs('btn_smmrBack')?.classList.toggle('d-none', step === 'scope');
    const next = qs('btn_smmrNext');
    if (next) {
      next.innerHTML = step === 'run'
        ? 'Perform operation<i class="bi bi-check2-circle ms-1"></i>'
        : 'Next<i class="bi bi-arrow-right ms-1"></i>';
      next.disabled = Boolean(state.result);
    }
  }

  function renderPrograms() {
    const tbody = qs('smmrProgramTbody');
    if (!tbody) return;
    if (!state.programs.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No programs added.</td></tr>';
      return;
    }
    tbody.innerHTML = state.programs.map((row) => `
      <tr>
        <td>${escapeHtml(row.title)}</td>
        <td>${Number(row.classCount || 0)}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-smmr-remove-program="${escapeHtml(row.id)}">Remove</button></td>
      </tr>
    `).join('');
  }

  function addProgram() {
    if (!global.GenericPicker || !global.GenericPickerPresets?.program) {
      window.alert('Program picker is unavailable.');
      return;
    }
    global.GenericPicker.open(global.GenericPickerPresets.program({
      title: 'Select program',
      onSelect: (item) => {
        const id = clean(item?.id);
        if (!id || state.programs.some((row) => row.id === id)) return;
        const title = clean(item?.title || item?.name || item?.label || id);
        void (async () => {
          const counted = await postJson('/school/reports/assignments/semi-monthly-wizard/program-count', {
            reportScope: scope(),
            programId: id
          });
          state.programs.push({
            id,
            title,
            classCount: Number(counted.classCount || 0)
          });
          renderPrograms();
        })().catch((error) => window.alert(error.message || 'Unable to count classes.'));
      }
    }));
  }

  async function recountPrograms() {
    const next = [];
    for (const row of state.programs) {
      const counted = await postJson('/school/reports/assignments/semi-monthly-wizard/program-count', {
        reportScope: scope(),
        programId: row.id
      });
      next.push({ ...row, classCount: Number(counted.classCount || 0) });
    }
    state.programs = next;
    renderPrograms();
  }

  function taskPayload() {
    return {
      hoursBeforeEnd: Number(qs('smmrHoursBeforeEnd')?.value || 0),
      allocatedHours: Number(qs('smmrAllocatedHours')?.value || 0),
      conflictPermitted: qs('smmrConflictPermitted')?.checked === true,
      timesheetReflection: qs('smmrTimesheetReflection')?.checked === true,
      conductRequiredBeforeFill: qs('smmrConductRequired')?.checked === true
    };
  }

  function allPreviewClasses() {
    return Array.isArray(state.preview?.classes) ? state.preview.classes : [];
  }

  function classMatchesSearch(row, query) {
    const token = clean(query).toLowerCase();
    if (!token) return true;
    const haystack = [
      row.title,
      row.classId,
      row.sessionDate,
      row.startTime,
      row.endTime,
      row.taskStartTime,
      row.taskEndTime,
      row.taskWindowMessage
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(token);
  }

  function sortPreviewClasses(rows) {
    const list = [...rows];
    const sortKey = state.classSort || 'title-asc';
    list.sort((left, right) => {
      if (sortKey === 'title-desc') {
        return String(right.title || '').localeCompare(String(left.title || ''));
      }
      if (sortKey === 'session-asc' || sortKey === 'session-desc') {
        const leftDate = `${left.sessionDate || ''} ${left.startTime || ''}`;
        const rightDate = `${right.sessionDate || ''} ${right.startTime || ''}`;
        const cmp = leftDate.localeCompare(rightDate);
        return sortKey === 'session-desc' ? -cmp : cmp;
      }
      if (sortKey === 'status-asc') {
        const leftOk = left.taskWindowOk === true ? 0 : 1;
        const rightOk = right.taskWindowOk === true ? 0 : 1;
        if (leftOk !== rightOk) return leftOk - rightOk;
      }
      return String(left.title || '').localeCompare(String(right.title || ''));
    });
    return list;
  }

  function visiblePreviewClasses() {
    const filtered = allPreviewClasses().filter((row) => classMatchesSearch(row, state.classSearchQuery));
    return sortPreviewClasses(filtered);
  }

  function selectedPreviewClasses() {
    return allPreviewClasses().filter((row) => state.selectedClassIds.has(row.classId));
  }

  function syncClassSelectionDefaults(preview) {
    const ids = (preview?.classes || []).map((row) => row.classId).filter(Boolean);
    state.selectedClassIds = new Set(ids);
  }

  function updateClassSelectionCount() {
    const el = qs('smmrClassSelectionCount');
    if (!el) return;
    const total = allPreviewClasses().length;
    const selected = state.selectedClassIds.size;
    const visible = visiblePreviewClasses().length;
    const query = clean(state.classSearchQuery);
    el.textContent = query
      ? `${selected} of ${total} selected · ${visible} shown`
      : `${selected} of ${total} selected`;
  }

  function renderTiles(preview) {
    const host = qs('smmrClassTiles');
    const range = qs('smmrTileRange');
    const emptyFilter = qs('smmrClassEmptyFilter');
    if (range) {
      range.textContent = `Report period ${preview.startDate} to ${preview.verifiedEndDate}. Assignment date ${preview.verifiedEndDate}. Choose which classes to include.`;
    }
    if (!host) return;
    const studentScope = preview.reportScope !== 'class';
    const rows = visiblePreviewClasses();
    if (emptyFilter) emptyFilter.classList.toggle('d-none', rows.length > 0);
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="7" class="text-muted small py-3 text-center">No classes match your search.</td></tr>';
      updateClassSelectionCount();
      return;
    }
    host.innerHTML = rows.map((row) => {
      const checked = state.selectedClassIds.has(row.classId);
      const time = row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : 'No session';
      const task = row.taskWindowOk
        ? `${row.taskStartTime}–${row.taskEndTime}`
        : escapeHtml(row.taskWindowMessage || 'Unavailable');
      const sessionCell = row.href
        ? `<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener" class="text-decoration-none">${escapeHtml(row.sessionDate || '—')}<br><span class="text-muted">${escapeHtml(time)}</span></a>`
        : `<span class="text-muted">${escapeHtml(row.sessionDate || '—')} ${escapeHtml(time)}</span>`;
      const statusBadge = row.taskWindowOk
        ? '<span class="badge bg-success-subtle text-success border border-success-subtle">Ready</span>'
        : '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">Blocked</span>';
      const studentCount = studentScope ? (state.selectedStudents[row.classId] || []).length : 0;
      const manage = studentScope
        ? `<button type="button" class="btn btn-sm btn-outline-primary" data-smmr-manage-students="${escapeHtml(row.classId)}">Students${studentCount ? ` (${studentCount})` : ''}</button>`
        : '';
      const assignmentBadge = row.hasReportAssignment
        ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Available</span>'
        : '<span class="badge bg-secondary-subtle text-secondary border">Will create</span>';
      const rowClass = [
        checked ? 'smmr-class-row-selected' : '',
        row.taskWindowOk === false ? 'smmr-class-row-blocked' : ''
      ].filter(Boolean).join(' ');
      return `<tr class="${rowClass}" data-smmr-class-row="${escapeHtml(row.classId)}">
        <td><input class="form-check-input" type="checkbox" data-smmr-class-select="${escapeHtml(row.classId)}" ${checked ? 'checked' : ''} aria-label="Include ${escapeHtml(row.title)}"></td>
        <td><span class="smmr-class-title">${escapeHtml(row.title)}</span></td>
        <td class="small">${assignmentBadge}</td>
        <td class="small">${sessionCell}</td>
        <td class="small">${row.taskWindowOk ? escapeHtml(task) : task}</td>
        <td>${statusBadge}</td>
        <td class="text-end">${manage}</td>
      </tr>`;
    }).join('');
    updateClassSelectionCount();
  }

  function setAllClassesSelected(selected) {
    const ids = selected
      ? allPreviewClasses().map((row) => row.classId)
      : [];
    state.selectedClassIds = new Set(ids.filter(Boolean));
    if (state.preview) renderTiles(state.preview);
  }

  function setVisibleClassesSelected(selected) {
    const visibleIds = visiblePreviewClasses().map((row) => row.classId);
    const next = new Set(state.selectedClassIds);
    visibleIds.forEach((id) => {
      if (selected) next.add(id);
      else next.delete(id);
    });
    state.selectedClassIds = next;
    if (state.preview) renderTiles(state.preview);
  }

  function openStudents(classId) {
    const preview = state.preview;
    const row = (preview?.classes || []).find((item) => item.classId === classId);
    if (!row) return;
    const selected = new Set(state.selectedStudents[classId] || []);
    qs('smmrStudentModalTitle').textContent = row.title;
    const body = qs('smmrStudentModalBody');
    const students = Array.isArray(row.students) ? row.students : [];
    body.innerHTML = students.length
      ? `<table class="table table-sm align-middle mb-0">
          <thead class="table-light"><tr><th></th><th>Student</th><th class="text-end">Eligible Sessions</th></tr></thead>
          <tbody>
            ${students.map((student) => `
              <tr>
                <td style="width:2rem;"><input class="form-check-input" type="checkbox" data-smmr-student="${escapeHtml(classId)}" value="${escapeHtml(student.personId)}" ${selected.has(student.personId) ? 'checked' : ''}></td>
                <td>${escapeHtml(student.name || student.personId)}</td>
                <td class="text-end">${Number(student.eligibleSessionCount || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p class="text-muted mb-0">No students are enrolled for this session.</p>';
    body.querySelectorAll('[data-smmr-student]').forEach((input) => {
      input.addEventListener('change', () => {
        const ids = [...body.querySelectorAll(`[data-smmr-student="${classId}"]:checked`)].map((el) => el.value);
        state.selectedStudents[classId] = ids;
        if (state.preview) renderTiles(state.preview);
      });
    });
    window.bootstrap?.Modal?.getOrCreateInstance(qs('smmrStudentModal'))?.show();
  }

  function renderSummary(preview) {
    const host = qs('smmrSummary');
    if (!host || !preview) return;
    const task = taskPayload();
    const programs = state.programs.map((row) => row.title).join(', ');
    const selected = selectedPreviewClasses();
    const studentScope = preview.reportScope !== 'class';
    const studentSummary = studentScope
      ? selected.map((row) => {
        const count = (state.selectedStudents[row.classId] || []).length;
        return `${row.title}: ${count} student(s)`;
      }).join('; ')
      : '';
    host.innerHTML = `
      <div class="small">
        <div><strong>Scope:</strong> ${escapeHtml(preview.reportScope)}</div>
        <div><strong>Programs:</strong> ${escapeHtml(programs)}</div>
        <div><strong>Period:</strong> ${escapeHtml(preview.startDate)} to ${escapeHtml(preview.verifiedEndDate)}</div>
        <div><strong>Task:</strong> last ${escapeHtml(String(task.hoursBeforeEnd))} hour(s) of the session</div>
        <div><strong>Classes selected:</strong> ${selected.length} of ${(preview.classes || []).length}</div>
        ${studentSummary ? `<div><strong>Students:</strong> ${escapeHtml(studentSummary)}</div>` : ''}
        <div class="text-muted mt-1">One report target row will be added per selected class (not per template).</div>
      </div>
    `;
  }

  async function renderAssignmentAudit(preview) {
    const host = qs('smmrAssignmentAudit');
    if (!host || !preview) return;
    const classIds = selectedPreviewClasses().map((row) => row.classId);
    host.innerHTML = '<div class="small text-muted">Checking report assignment items…</div>';
    try {
      const audit = await postJson('/school/reports/assignments/semi-monthly-wizard/assignment-status', {
        classIds,
        reportScope: preview.reportScope
      });
      const withRows = Array.isArray(audit.withAssignment) ? audit.withAssignment : [];
      const withoutRows = Array.isArray(audit.withoutAssignment) ? audit.withoutAssignment : [];
      const list = (rows) => (rows.length
        ? `<ul class="small mb-0 ps-3">${rows.map((row) => `<li>${escapeHtml(row.title)}</li>`).join('')}</ul>`
        : '<p class="small text-muted mb-0">None</p>');
      host.innerHTML = `
        <div class="row g-3">
          <div class="col-md-6">
            <div class="border rounded p-3 h-100 bg-white">
              <div class="fw-semibold text-primary mb-2">Has report assignment item (${withRows.length})</div>
              <p class="small text-muted">A target row will be added to the existing assignment.</p>
              ${list(withRows)}
            </div>
          </div>
          <div class="col-md-6">
            <div class="border rounded p-3 h-100 bg-white">
              <div class="fw-semibold text-secondary mb-2">No report assignment item (${withoutRows.length})</div>
              <p class="small text-muted">The operation will create the assignment, then add a report target row.</p>
              ${list(withoutRows)}
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      host.innerHTML = `<div class="alert alert-warning py-2 small mb-0">${escapeHtml(error.message || 'Unable to check report assignments.')}</div>`;
    }
  }

  function studentsReady(preview) {
    if (!preview || preview.reportScope === 'class') return true;
    return selectedPreviewClasses().every((row) => (state.selectedStudents[row.classId] || []).length > 0);
  }

  async function runOperation() {
    const preview = state.preview;
    if (!preview) return;
    const jobs = selectedPreviewClasses().map((classRow) => ({ classRow }));
    const barWrap = qs('smmrProgressWrap');
    const bar = qs('smmrProgressBar');
    const resultHost = qs('smmrResult');
    barWrap?.classList.remove('d-none');
    const created = [];
    const failed = [];
    const task = taskPayload();
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const pct = Math.round((index / jobs.length) * 100);
      if (bar) {
        bar.style.width = `${pct}%`;
        bar.textContent = `${pct}%`;
      }
      try {
        const result = await postJson('/school/reports/assignments/semi-monthly-wizard/apply', {
          classId: job.classRow.classId,
          reportScope: preview.reportScope,
          reportStartDate: preview.startDate,
          verifiedEndDate: preview.verifiedEndDate,
          hoursBeforeEnd: task.hoursBeforeEnd,
          conflictPermitted: task.conflictPermitted,
          timesheetReflection: task.timesheetReflection,
          conductRequiredBeforeFill: task.conductRequiredBeforeFill,
          allocatedHours: task.allocatedHours,
          targetStudentIds: state.selectedStudents[job.classRow.classId] || []
        });
        const actionLabel = result.createdAssignment ? 'assignment created' : 'target row added';
        created.push(`${job.classRow.title} (${actionLabel})`);
      } catch (error) {
        failed.push(`${job.classRow.title}: ${error.message}`);
      }
    }
    if (bar) {
      bar.style.width = '100%';
      bar.textContent = '100%';
    }
    state.result = { created, failed };
    if (resultHost) {
      resultHost.classList.remove('d-none');
      resultHost.innerHTML = `
        <div class="alert alert-success py-2 small">${created.length} assignment(s) created.</div>
        ${failed.length ? `<div class="alert alert-warning py-2 small">${failed.map((row) => `<div>${escapeHtml(row)}</div>`).join('')}</div>` : ''}
      `;
    }
    const next = qs('btn_smmrNext');
    if (next) next.disabled = true;
  }

  async function goNext() {
    try {
      if (state.step === 'scope') {
        if (!state.programs.length) throw new Error('Add at least one program.');
        const total = state.programs.reduce((sum, row) => sum + Number(row.classCount || 0), 0);
        if (!total) throw new Error('None of the selected programs have matching classes.');
        showStep('dates');
        return;
      }
      if (state.step === 'dates') {
        const resolved = await postJson('/school/reports/assignments/semi-monthly-wizard/resolve-dates', {
          reportScope: scope(),
          programIds: state.programs.map((row) => row.id),
          startDate: clean(qs('smmrStartDate')?.value),
          endDate: clean(qs('smmrEndDate')?.value)
        });
        const notice = qs('smmrDateNotice');
        if (!resolved.ok) {
          if (notice) {
            notice.textContent = resolved.message || 'Choose a different date range.';
            notice.classList.remove('d-none');
          }
          return;
        }
        state.verifiedEndDate = resolved.verifiedEndDate;
        state.dateMessage = resolved.message || '';
        if (notice) {
          notice.textContent = state.dateMessage;
          notice.classList.remove('d-none');
        }
        showStep('task');
        return;
      }
      if (state.step === 'task') {
        const loadingToken = typeof global.showLoading === 'function'
          ? global.showLoading({
            title: 'Please wait',
            note: 'Preparing class sessions for the verified date...'
          })
          : '';
        const next = qs('btn_smmrNext');
        if (next) next.disabled = true;
        try {
          const preview = await postJson('/school/reports/assignments/semi-monthly-wizard/preview', {
            reportScope: scope(),
            programIds: state.programs.map((row) => row.id),
            startDate: clean(qs('smmrStartDate')?.value),
            verifiedEndDate: state.verifiedEndDate,
            hoursBeforeEnd: taskPayload().hoursBeforeEnd
          });
          state.preview = preview;
          state.classSearchQuery = clean(qs('smmrClassSearch')?.value);
          state.classSort = clean(qs('smmrClassSort')?.value) || 'title-asc';
          syncClassSelectionDefaults(preview);
          (preview.classes || []).forEach((row) => {
            if (preview.reportScope === 'each_student') {
              state.selectedStudents[row.classId] = (row.students || []).map((student) => student.personId);
            } else if (!state.selectedStudents[row.classId]) {
              state.selectedStudents[row.classId] = [];
            }
          });
          renderTiles(preview);
          showStep('tiles');
        } finally {
          if (next) next.disabled = false;
          if (loadingToken && typeof global.hideLoading === 'function') global.hideLoading(loadingToken);
        }
        return;
      }
      if (state.step === 'tiles') {
        if (!state.selectedClassIds.size) {
          throw new Error('Select at least one class to continue.');
        }
        if (!studentsReady(state.preview)) {
          throw new Error('Select at least one student for every selected class.');
        }
        const blocked = selectedPreviewClasses().filter((row) => row.taskWindowOk === false);
        if (blocked.length) {
          throw new Error(blocked[0].taskWindowMessage || 'A selected class session cannot hold the task window.');
        }
        renderSummary(state.preview);
        showStep('run');
        void renderAssignmentAudit(state.preview);
        return;
      }
      if (state.step === 'run' && !state.result) {
        await runOperation();
      }
    } catch (error) {
      window.alert(error.message || 'Unable to continue.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    qs('btn_smmrAddProgram')?.addEventListener('click', () => addProgram());
    qs('smmrReportScope')?.addEventListener('change', () => {
      void recountPrograms().catch((error) => window.alert(error.message || 'Unable to recount classes.'));
    });
    qs('smmrProgramTbody')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-smmr-remove-program]');
      if (!button) return;
      const id = button.getAttribute('data-smmr-remove-program');
      state.programs = state.programs.filter((row) => row.id !== id);
      renderPrograms();
    });
    qs('smmrClassSearch')?.addEventListener('input', (event) => {
      state.classSearchQuery = clean(event.target?.value);
      if (state.preview) renderTiles(state.preview);
    });
    qs('smmrClassSort')?.addEventListener('change', (event) => {
      state.classSort = clean(event.target?.value) || 'title-asc';
      if (state.preview) renderTiles(state.preview);
    });
    qs('btn_smmrSelectAllClasses')?.addEventListener('click', () => {
      if (clean(state.classSearchQuery)) setVisibleClassesSelected(true);
      else setAllClassesSelected(true);
    });
    qs('btn_smmrDeselectAllClasses')?.addEventListener('click', () => {
      if (clean(state.classSearchQuery)) setVisibleClassesSelected(false);
      else setAllClassesSelected(false);
    });
    qs('smmrClassTiles')?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-smmr-class-select]');
      if (!checkbox) return;
      const classId = checkbox.getAttribute('data-smmr-class-select');
      if (!classId) return;
      if (checkbox.checked) state.selectedClassIds.add(classId);
      else state.selectedClassIds.delete(classId);
      if (state.preview) renderTiles(state.preview);
    });
    qs('smmrClassTiles')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-smmr-manage-students]');
      if (!button) return;
      event.stopPropagation();
      openStudents(button.getAttribute('data-smmr-manage-students'));
    });
    qs('btn_smmrNext')?.addEventListener('click', () => { void goNext(); });
    qs('btn_smmrBack')?.addEventListener('click', () => {
      const order = ['scope', 'dates', 'task', 'tiles', 'run'];
      const index = order.indexOf(state.step);
      if (index > 0 && !state.result) showStep(order[index - 1]);
    });
    showStep('scope');
  });
})(window);
