(function (global) {
  'use strict';

  const state = {
    step: 'scope',
    programs: [],
    verifiedEndDate: '',
    dateMessage: '',
    preview: null,
    selectedStudents: {},
    result: null
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function renderTiles(preview) {
    const host = qs('smmrClassTiles');
    const range = qs('smmrTileRange');
    if (range) {
      range.textContent = `Report period ${preview.startDate} to ${preview.verifiedEndDate}. Assignment date ${preview.verifiedEndDate}.`;
    }
    if (!host) return;
    const studentScope = preview.reportScope !== 'class';
    host.innerHTML = (preview.classes || []).map((row) => {
      const time = row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : 'No session';
      const task = row.taskWindowOk ? `Task ${row.taskStartTime}–${row.taskEndTime}` : row.taskWindowMessage;
      const sessionLink = row.href
        ? `<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">${escapeHtml(row.sessionDate)} ${escapeHtml(time)}</a>`
        : escapeHtml(time);
      const manage = studentScope
        ? `<button type="button" class="btn btn-sm btn-outline-primary mt-2" data-smmr-manage-students="${escapeHtml(row.classId)}">Students</button>`
        : '';
      return `<div class="col-md-6 col-xl-4"><div class="border rounded p-3 h-100">
        <div class="fw-semibold">${escapeHtml(row.title)}</div>
        <div class="small mt-1">${sessionLink}</div>
        <div class="small text-muted">${escapeHtml(task)}</div>
        ${manage}
      </div></div>`;
    }).join('');
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
      });
    });
    window.bootstrap?.Modal?.getOrCreateInstance(qs('smmrStudentModal'))?.show();
  }

  function renderSummary(preview) {
    const host = qs('smmrSummary');
    if (!host || !preview) return;
    const task = taskPayload();
    const programs = state.programs.map((row) => row.title).join(', ');
    const templateTitles = (preview.templates || []).map((row) => row.title).join(', ');
    host.innerHTML = `
      <div class="small">
        <div><strong>Scope:</strong> ${escapeHtml(preview.reportScope)}</div>
        <div><strong>Programs:</strong> ${escapeHtml(programs)}</div>
        <div><strong>Period:</strong> ${escapeHtml(preview.startDate)} to ${escapeHtml(preview.verifiedEndDate)}</div>
        <div><strong>Task:</strong> last ${escapeHtml(String(task.hoursBeforeEnd))} hour(s) of the session</div>
        <div><strong>Classes:</strong> ${(preview.classes || []).length}</div>
        <div><strong>Templates:</strong> ${escapeHtml(templateTitles)}</div>
      </div>
    `;
  }

  function studentsReady(preview) {
    if (!preview || preview.reportScope === 'class') return true;
    return (preview.classes || []).every((row) => (state.selectedStudents[row.classId] || []).length > 0);
  }

  async function runOperation() {
    const preview = state.preview;
    if (!preview) return;
    const jobs = [];
    (preview.classes || []).forEach((classRow) => {
      (preview.templates || []).forEach((template) => {
        jobs.push({ classRow, template });
      });
    });
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
          templateId: job.template.id,
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
        created.push(`${job.classRow.title} · ${job.template.title}`);
        void result;
      } catch (error) {
        failed.push(`${job.classRow.title} · ${job.template.title}: ${error.message}`);
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
        if (!studentsReady(state.preview)) {
          throw new Error('Select at least one student for every class.');
        }
        const blocked = (state.preview?.classes || []).filter((row) => row.taskWindowOk === false);
        if (blocked.length) {
          throw new Error(blocked[0].taskWindowMessage || 'A class session cannot hold the task window.');
        }
        renderSummary(state.preview);
        showStep('run');
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
    qs('smmrClassTiles')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-smmr-manage-students]');
      if (!button) return;
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
