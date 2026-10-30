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
    selectedTemplateByClassId: {},
    result: null,
    operationRunning: false
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || '').trim();
  }

  async function showWizardMessage(title, message, icon = 'warning') {
    const body = clean(message) || 'Unable to continue.';
    const heading = clean(title) || 'Semi-Monthly Report Wizard';
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title: heading,
        message: body,
        icon,
        buttons: [{ text: 'OK', class: icon === 'error' ? 'btn-danger' : 'btn-primary' }]
      });
      return;
    }
    console.error(`${heading}: ${body}`);
  }

  function setWizardNavigationLocked(locked) {
    const next = qs('btn_smmrNext');
    const back = qs('btn_smmrBack');
    if (next) next.disabled = locked || Boolean(state.result);
    if (back && !back.classList.contains('d-none')) back.disabled = locked;
  }

  function buildOperationWaitModalHtml(jobCount) {
    const total = Math.max(0, Number(jobCount) || 0);
    return `<p class="mb-2">Assigning semi-monthly report rows for <strong>${total}</strong> class(es). Please wait&hellip;</p>
      <p class="small text-muted mb-2">Overall progress is shown here and on the summary step below.</p>
      <div class="progress" style="height: 1rem;">
        <div class="progress-bar progress-bar-striped progress-bar-animated" id="smmrOperationModalBar" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
      </div>`;
  }

  function lockMessageModalWhileBusy() {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl) return;
    const apply = () => {
      const closeBtn = modalEl.querySelector('.btn-close');
      if (closeBtn) closeBtn.classList.add('d-none');
      modalEl.querySelectorAll('#messageModalButtons button').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.setAttribute('aria-disabled', 'true');
      });
    };
    if (modalEl.classList.contains('show')) apply();
    else modalEl.addEventListener('shown.bs.modal', apply, { once: true });
  }

  function unlockMessageModalChrome() {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl) return;
    const closeBtn = modalEl.querySelector('.btn-close');
    if (closeBtn) closeBtn.classList.remove('d-none');
  }

  function openWizardOperationWaitModal(jobCount) {
    if (typeof global.showMessageModal !== 'function') return;
    lockMessageModalWhileBusy();
    void global.showMessageModal({
      title: 'Performing operation',
      icon: 'info',
      message: buildOperationWaitModalHtml(jobCount),
      buttons: [{ text: 'Please wait…', class: 'btn-outline-secondary' }]
    });
    lockMessageModalWhileBusy();
  }

  function closeWizardOperationWaitModal() {
    const modalEl = document.getElementById('messageModal');
    unlockMessageModalChrome();
    if (!modalEl || !global.bootstrap?.Modal) return;
    const inst = global.bootstrap.Modal.getInstance(modalEl);
    if (inst && modalEl.classList.contains('show')) {
      modalEl.dataset.resolveValue = 'done';
      inst.hide();
    }
  }

  function updateOperationProgress(pct, label) {
    const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const text = clean(label) || `${safePct}%`;
    const wrap = qs('smmrProgressWrap');
    const bar = qs('smmrProgressBar');
    wrap?.classList.remove('d-none');
    if (bar) {
      bar.style.width = `${safePct}%`;
      bar.textContent = text;
      bar.setAttribute('aria-valuenow', String(safePct));
    }
    const modalBar = document.getElementById('smmrOperationModalBar');
    if (modalBar) {
      modalBar.style.width = `${safePct}%`;
      modalBar.textContent = text;
      modalBar.setAttribute('aria-valuenow', String(safePct));
    }
  }

  function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function defaultSemiMonthlyPeriodDates(now = new Date()) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    if (day <= 15) {
      return {
        startDate: toDateInputValue(new Date(year, month, 1)),
        endDate: toDateInputValue(new Date(year, month, 15))
      };
    }
    return {
      startDate: toDateInputValue(new Date(year, month, 16)),
      endDate: toDateInputValue(new Date(year, month + 1, 0))
    };
  }

  function applyDefaultPeriodDatesIfEmpty() {
    const startEl = qs('smmrStartDate');
    const endEl = qs('smmrEndDate');
    if (!startEl || !endEl) return;
    if (clean(startEl.value) || clean(endEl.value)) return;
    const defaults = defaultSemiMonthlyPeriodDates();
    startEl.value = defaults.startDate;
    endEl.value = defaults.endDate;
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

  function classCapacityTarget() {
    const token = clean(qs('smmrClassCapacityTarget')?.value).toLowerCase();
    if (token === 'group' || token === 'one_on_one') return token;
    return 'all';
  }

  function classCapacityTargetLabel(value) {
    const token = clean(value).toLowerCase();
    if (token === 'group') return 'Group classes (max capacity more than 1)';
    if (token === 'one_on_one') return 'One-on-one (max capacity 1)';
    return 'All classes';
  }

  function wizardScopePayload() {
    return {
      reportScope: scope(),
      classCapacityTarget: classCapacityTarget()
    };
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
      next.disabled = Boolean(state.result) || Boolean(state.operationRunning);
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
      void showWizardMessage('Program Picker', 'Program picker is unavailable.', 'warning');
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
            ...wizardScopePayload(),
            programId: id
          });
          state.programs.push({
            id,
            title,
            classCount: Number(counted.classCount || 0)
          });
          renderPrograms();
        })().catch((error) => {
          void showWizardMessage('Program Count', error.message || 'Unable to count classes.', 'error');
        });
      }
    }));
  }

  async function recountPrograms() {
    const next = [];
    for (const row of state.programs) {
      const counted = await postJson('/school/reports/assignments/semi-monthly-wizard/program-count', {
        ...wizardScopePayload(),
        programId: row.id
      });
      next.push({ ...row, classCount: Number(counted.classCount || 0) });
    }
    state.programs = next;
    renderPrograms();
  }

  function taskPayload() {
    return {
      allocatedHours: Number(qs('smmrAllocatedHours')?.value || 0),
      conflictPermitted: qs('smmrConflictPermitted')?.checked !== false,
      timesheetReflection: qs('smmrTimesheetReflection')?.checked !== false,
      conductRequiredBeforeFill: qs('smmrConductRequired')?.checked !== false,
      reopenCompletedSession: qs('smmrReopenCompletedSession')?.checked !== false
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

  const CLASS_SORT_BY_COLUMN = {
    title: { asc: 'title-asc', desc: 'title-desc' },
    assignment: { asc: 'assignment-asc', desc: 'assignment-desc' },
    session: { asc: 'session-asc', desc: 'session-desc' },
    task: { asc: 'task-asc', desc: 'task-desc' },
    status: { asc: 'status-asc', desc: 'status-desc' }
  };

  function parseClassSort(sortKey) {
    const token = clean(sortKey) || 'title-asc';
    const idx = token.lastIndexOf('-');
    if (idx <= 0) return { column: 'title', dir: 'asc' };
    return {
      column: token.slice(0, idx),
      dir: token.slice(idx + 1) === 'desc' ? 'desc' : 'asc'
    };
  }

  function syncClassSortSelect() {
    const select = qs('smmrClassSort');
    if (!select) return;
    if ([...select.options].some((opt) => opt.value === state.classSort)) {
      select.value = state.classSort;
    }
  }

  function toggleClassSortForColumn(column) {
    const token = CLASS_SORT_BY_COLUMN[column];
    if (!token) return;
    const { column: activeColumn, dir } = parseClassSort(state.classSort);
    const nextDir = activeColumn === column && dir === 'asc' ? 'desc' : 'asc';
    state.classSort = token[nextDir];
    syncClassSortSelect();
  }

  function updateClassSortHeaderState() {
    const { column, dir } = parseClassSort(state.classSort);
    document.querySelectorAll('#smmrClassTableWrap [data-smmr-sort-key]').forEach((th) => {
      const key = th.getAttribute('data-smmr-sort-key');
      const active = key === column;
      th.classList.toggle('smmr-sort-active', active);
      th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const icon = th.querySelector('.smmr-sort-icon');
      if (!icon) return;
      icon.classList.remove('bi-arrow-down-up', 'bi-sort-down-alt', 'bi-sort-up');
      if (active) {
        icon.classList.add(dir === 'asc' ? 'bi-sort-down-alt' : 'bi-sort-up');
      } else {
        icon.classList.add('bi-arrow-down-up');
      }
    });
  }

  function handleClassSortHeaderActivate(th) {
    const column = th?.getAttribute?.('data-smmr-sort-key');
    if (!column || !state.preview) return;
    toggleClassSortForColumn(column);
    renderTiles(state.preview);
  }

  function comparePreviewClassesByTitle(left, right) {
    return String(left.title || '').localeCompare(String(right.title || ''));
  }

  function sortPreviewClasses(rows) {
    const list = [...rows];
    const sortKey = state.classSort || 'title-asc';
    list.sort((left, right) => {
      if (sortKey === 'title-desc') {
        return comparePreviewClassesByTitle(right, left);
      }
      if (sortKey === 'session-asc' || sortKey === 'session-desc') {
        const leftDate = `${left.sessionDate || ''} ${left.startTime || ''}`;
        const rightDate = `${right.sessionDate || ''} ${right.startTime || ''}`;
        const cmp = leftDate.localeCompare(rightDate);
        if (cmp !== 0) return sortKey === 'session-desc' ? -cmp : cmp;
        return comparePreviewClassesByTitle(left, right);
      }
      if (sortKey === 'task-asc' || sortKey === 'task-desc') {
        const leftTask = `${left.sessionDate || ''} ${left.taskStartTime || ''}`;
        const rightTask = `${right.sessionDate || ''} ${right.taskStartTime || ''}`;
        const cmp = leftTask.localeCompare(rightTask);
        if (cmp !== 0) return sortKey === 'task-desc' ? -cmp : cmp;
        return comparePreviewClassesByTitle(left, right);
      }
      if (sortKey === 'assignment-asc' || sortKey === 'assignment-desc') {
        const leftHas = left.hasReportAssignment ? 1 : 0;
        const rightHas = right.hasReportAssignment ? 1 : 0;
        if (leftHas !== rightHas) {
          return sortKey === 'assignment-desc' ? leftHas - rightHas : rightHas - leftHas;
        }
        return comparePreviewClassesByTitle(left, right);
      }
      if (sortKey === 'status-asc' || sortKey === 'status-desc') {
        const leftOk = left.taskWindowOk === true ? 0 : 1;
        const rightOk = right.taskWindowOk === true ? 0 : 1;
        if (leftOk !== rightOk) {
          return sortKey === 'status-desc' ? rightOk - leftOk : leftOk - rightOk;
        }
        return comparePreviewClassesByTitle(left, right);
      }
      return comparePreviewClassesByTitle(left, right);
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

  function studentPersonIdsForRow(row) {
    return (Array.isArray(row?.students) ? row.students : [])
      .map((student) => clean(student.personId || student.id))
      .filter(Boolean);
  }

  function usesPerStudentSelection(preview) {
    return Boolean(preview && preview.reportScope !== 'class');
  }

  function assignDefaultStudentsForClass(classId) {
    if (!usesPerStudentSelection(state.preview)) return;
    const row = allPreviewClasses().find((item) => item.classId === classId);
    if (!row) return;
    state.selectedStudents[classId] = studentPersonIdsForRow(row);
  }

  function ensureDefaultStudentsForSelectedClasses(preview) {
    if (!usesPerStudentSelection(preview)) return;
    selectedPreviewClasses().forEach((row) => {
      const defaults = studentPersonIdsForRow(row);
      if (!defaults.length) {
        state.selectedStudents[row.classId] = [];
        return;
      }
      const current = state.selectedStudents[row.classId];
      if (!Array.isArray(current) || !current.length) {
        state.selectedStudents[row.classId] = defaults;
      }
    });
  }

  function syncStudentsForSelectedClasses(preview) {
    if (!usesPerStudentSelection(preview)) {
      (preview?.classes || []).forEach((row) => {
        state.selectedStudents[row.classId] = [];
      });
      return;
    }
    (preview?.classes || []).forEach((row) => {
      if (state.selectedClassIds.has(row.classId)) {
        state.selectedStudents[row.classId] = studentPersonIdsForRow(row);
      } else if (!state.selectedStudents[row.classId]) {
        state.selectedStudents[row.classId] = [];
      }
    });
  }

  function policyTemplateOptions(row, preview) {
    if (Array.isArray(preview?.templates) && preview.templates.length) {
      return preview.templates;
    }
    return Array.isArray(row?.templateOptions) ? row.templateOptions : [];
  }

  function resolveClassTemplateId(row) {
    const picked = clean(state.selectedTemplateByClassId[row?.classId]);
    if (picked) return picked;
    return clean(row?.defaultTemplateId);
  }

  function templateTitleForClassRow(row) {
    const id = resolveClassTemplateId(row);
    const options = Array.isArray(row?.templateOptions) ? row.templateOptions : [];
    const match = options.find((item) => clean(item.id) === id);
    if (match) return clean(match.title) || id;
    return clean(row?.templateTitle) || id || '—';
  }

  function syncTemplateDefaultForClass(row) {
    if (!row?.classId) return;
    const defaultId = clean(row.defaultTemplateId);
    if (row.templateLocked && defaultId) {
      state.selectedTemplateByClassId[row.classId] = defaultId;
      return;
    }
    const current = clean(state.selectedTemplateByClassId[row.classId]);
    const allowed = policyTemplateOptions(row, state.preview).map((item) => clean(item.id)).filter(Boolean);
    if (current && allowed.includes(current)) return;
    state.selectedTemplateByClassId[row.classId] = defaultId || allowed[0] || '';
  }

  function syncTemplatesForSelectedClasses(preview) {
    selectedPreviewClasses().forEach((row) => syncTemplateDefaultForClass(row));
  }

  function renderTemplateCell(row, preview) {
    if (row.templateLocked) {
      return `<span class="small d-inline-block" title="This class already has a report assignment for the selected scope. The wizard adds a session target row and keeps the existing template.">
        <span>${escapeHtml(templateTitleForClassRow(row))}</span>
        <span class="d-block text-muted" style="font-size:0.75rem">Existing assignment</span>
      </span>`;
    }
    const options = policyTemplateOptions(row, preview);
    if (!options.length) {
      return '<span class="text-muted small">—</span>';
    }
    const selectedId = resolveClassTemplateId(row);
    const optionHtml = options.map((item) => {
      const id = clean(item.id);
      const selected = id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(item.title || id)}</option>`;
    }).join('');
    return `<select class="form-select form-select-sm" data-smmr-class-template="${escapeHtml(row.classId)}" aria-label="Report template for ${escapeHtml(row.title)}">${optionHtml}</select>`;
  }

  function syncClassSelectionDefaults(preview) {
    const readyIds = (preview?.classes || [])
      .filter((row) => row.taskWindowOk !== false)
      .map((row) => row.classId)
      .filter(Boolean);
    const fallbackIds = (preview?.classes || []).map((row) => row.classId).filter(Boolean);
    state.selectedClassIds = new Set(readyIds.length ? readyIds : fallbackIds);
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

  function sessionPreviewLoadingNotes() {
    return [
      'Checking sessions on the period end date…',
      'Checking sessions one day before the end date…',
      'Checking sessions two days before the end date…',
      'Checking sessions three days before the end date…',
      'Checking sessions four days before the end date…',
      'Building class preview…'
    ];
  }

  function startSessionPreviewLoadingProgress(loadingToken) {
    const notes = sessionPreviewLoadingNotes();
    let index = 0;
    if (typeof global.updateLoading === 'function') {
      global.updateLoading({ title: 'Please wait', note: notes[index] });
    }
    return window.setInterval(() => {
      index = Math.min(index + 1, notes.length - 1);
      if (typeof global.updateLoading === 'function') {
        global.updateLoading({ title: 'Please wait', note: notes[index] });
      }
    }, 650);
  }

  function renderTiles(preview) {
    const host = qs('smmrClassTiles');
    const range = qs('smmrTileRange');
    const emptyFilter = qs('smmrClassEmptyFilter');
    const lookback = Number(preview.sessionLookbackDays || 5);
    if (range) {
      range.textContent = `Report period ${preview.startDate} to ${preview.verifiedEndDate}. Each class uses the nearest session within ${lookback} days of ${preview.verifiedEndDate}. Choose which classes to include.`;
    }
    if (!host) return;
    const studentScope = preview.reportScope !== 'class';
    const rows = visiblePreviewClasses();
    if (emptyFilter) emptyFilter.classList.toggle('d-none', rows.length > 0);
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="8" class="text-muted small py-3 text-center">No classes match your search.</td></tr>';
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
        <td class="small">${renderTemplateCell(row, preview)}</td>
        <td class="small">${assignmentBadge}</td>
        <td class="small">${sessionCell}</td>
        <td class="small">${row.taskWindowOk ? escapeHtml(task) : task}</td>
        <td>${statusBadge}</td>
        <td class="text-end">${manage}</td>
      </tr>`;
    }).join('');
    updateClassSelectionCount();
    updateClassSortHeaderState();
  }

  function setAllClassesSelected(selected) {
    const ids = selected
      ? allPreviewClasses().map((row) => row.classId)
      : [];
    state.selectedClassIds = new Set(ids.filter(Boolean));
    if (selected && state.preview) {
      selectedPreviewClasses().forEach((row) => {
        assignDefaultStudentsForClass(row.classId);
        syncTemplateDefaultForClass(row);
      });
    }
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
    if (selected && state.preview) {
      visiblePreviewClasses().forEach((row) => {
        if (state.selectedClassIds.has(row.classId)) {
          assignDefaultStudentsForClass(row.classId);
          syncTemplateDefaultForClass(row);
        }
      });
    }
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

  function reportScopeLabel(scopeValue) {
    const select = qs('smmrReportScope');
    const value = clean(scopeValue);
    if (select && value) {
      const option = [...select.options].find((row) => row.value === value);
      if (option) return clean(option.textContent) || value;
    }
    return value || 'Whole Class';
  }

  function formatSessionSummary(row) {
    const time = row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : '';
    if (!row.sessionDate && !time) return '—';
    if (!time) return escapeHtml(row.sessionDate || '—');
    return `${escapeHtml(row.sessionDate || '—')}<br><span class="text-muted">${escapeHtml(time)}</span>`;
  }

  function formatTaskSummary(row) {
    if (row.taskWindowOk && row.taskStartTime && row.taskEndTime) {
      return escapeHtml(`${row.taskStartTime}–${row.taskEndTime}`);
    }
    return `<span class="text-muted">${escapeHtml(row.taskWindowMessage || 'Unavailable')}</span>`;
  }

  function assignmentSummaryBadge(row) {
    return row.hasReportAssignment
      ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Existing</span>'
      : '<span class="badge bg-secondary-subtle text-secondary border">Will create</span>';
  }

  function buildTaskOptionsList(task) {
    const lines = ['Report task covers the entire scheduled session'];
    lines.push(task.conflictPermitted ? 'Conflict overlap permitted' : 'Conflict overlap not permitted');
    if (task.timesheetReflection) {
      lines.push(`Reflect on timesheet (${task.allocatedHours || 0} allocated hour(s))`);
    } else {
      lines.push('Do not reflect on timesheet');
    }
    lines.push(task.conductRequiredBeforeFill ? 'Class conduct required before filling' : 'Class conduct not required before filling');
    lines.push(task.reopenCompletedSession
      ? 'Completed sessions reopen as scheduled before assigning'
      : 'Session status left unchanged when completed');
    return lines;
  }

  function renderSummary(preview) {
    const host = qs('smmrSummary');
    if (!host || !preview) return;
    const task = taskPayload();
    const selected = sortPreviewClasses(selectedPreviewClasses());
    const studentScope = preview.reportScope !== 'class';
    const totalClasses = (preview.classes || []).length;
    const notSelected = Math.max(0, totalClasses - selected.length);
    const totalStudents = studentScope
      ? selected.reduce((sum, row) => sum + (state.selectedStudents[row.classId] || []).length, 0)
      : 0;
    const programList = state.programs.length
      ? `<ul class="mb-0 ps-3">${state.programs.map((row) => `<li>${escapeHtml(row.title)}</li>`).join('')}</ul>`
      : '<p class="text-muted mb-0">None</p>';
    const scopeTemplateList = (preview.templates || []).length
      ? `<ul class="mb-0 ps-3 small">${preview.templates.map((row) => `<li>${escapeHtml(row.title)}</li>`).join('')}</ul>`
      : '<p class="text-muted mb-0 small">None configured for this scope</p>';
    const taskList = `<ul class="mb-0 ps-3 small">${buildTaskOptionsList(task).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
    const summaryRows = selected.length
      ? selected.map((row) => {
        const studentCell = studentScope
          ? String((state.selectedStudents[row.classId] || []).length)
          : '—';
        const actionNote = row.hasReportAssignment
          ? 'Add session target row'
          : 'Create assignment + row';
        return `<tr>
          <td class="smmr-summary-class-name">${escapeHtml(row.title)}</td>
          <td class="small">${escapeHtml(templateTitleForClassRow(row))}<br><span class="text-muted">${escapeHtml(actionNote)}</span></td>
          <td class="small">${formatSessionSummary(row)}</td>
          <td class="small">${formatTaskSummary(row)}</td>
          <td class="text-end">${escapeHtml(studentCell)}</td>
          <td>${assignmentSummaryBadge(row)}</td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="6" class="text-muted small py-3 text-center">No classes selected.</td></tr>';
    host.innerHTML = `
      <div class="smmr-summary-overview mb-3">
        <div class="row g-3">
          <div class="col-md-6">
            <div class="smmr-summary-label">Report scope</div>
            <div class="fw-semibold">${escapeHtml(reportScopeLabel(preview.reportScope))}</div>
          </div>
          <div class="col-md-6">
            <div class="smmr-summary-label">Class capacity</div>
            <div class="fw-semibold">${escapeHtml(preview.classCapacityLabel || classCapacityTargetLabel(classCapacityTarget()))}</div>
          </div>
          <div class="col-md-6">
            <div class="smmr-summary-label">Report period</div>
            <div class="fw-semibold">${escapeHtml(preview.startDate)} – ${escapeHtml(preview.verifiedEndDate)}</div>
          </div>
          <div class="col-md-6">
            <div class="smmr-summary-label">Programs</div>
            ${programList}
          </div>
          <div class="col-md-6">
            <div class="smmr-summary-label">Report templates for this scope</div>
            ${scopeTemplateList}
          </div>
          <div class="col-12">
            <div class="smmr-summary-label">Task settings</div>
            ${taskList}
          </div>
        </div>
      </div>
      <div class="smmr-summary-totals d-flex flex-wrap align-items-center gap-2 mb-3">
        <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${selected.length} class(es) selected</span>
        <span class="badge bg-light text-dark border">${notSelected} not selected</span>
        ${studentScope ? `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle">${totalStudents} student(s) total</span>` : ''}
      </div>
      <div class="smmr-summary-label mb-2">Selected classes</div>
      <div class="table-responsive" id="smmrSummaryClasses">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Report template</th>
              <th scope="col">Session</th>
              <th scope="col">Task window</th>
              <th scope="col" class="text-end" style="width:5rem;">Students</th>
              <th scope="col" style="width:7rem;">Assignment</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
      </div>
      <p class="text-muted small mt-2 mb-0">One session target row will be added per selected class. Classes with an existing report assignment keep that assignment’s template; others use the template you chose in the class list.</p>
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
              <div class="fw-semibold text-primary mb-2">Has report assignment (${withRows.length})</div>
              <p class="small text-muted">A new session target row will be added to the existing report assignment (same template).</p>
              ${list(withRows)}
            </div>
          </div>
          <div class="col-md-6">
            <div class="border rounded p-3 h-100 bg-white">
              <div class="fw-semibold text-secondary mb-2">No report assignment (${withoutRows.length})</div>
              <p class="small text-muted">The operation will create a report assignment with your chosen template, then add a session target row.</p>
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
    if (!usesPerStudentSelection(preview)) return true;
    ensureDefaultStudentsForSelectedClasses(preview);
    return selectedPreviewClasses().every((row) => {
      const eligible = studentPersonIdsForRow(row);
      if (!eligible.length) return true;
      return (state.selectedStudents[row.classId] || []).length > 0;
    });
  }

  async function runOperation() {
    const preview = state.preview;
    if (!preview || state.operationRunning) return;
    const jobs = selectedPreviewClasses().map((classRow) => ({ classRow }));
    const resultHost = qs('smmrResult');
    state.operationRunning = true;
    setWizardNavigationLocked(true);
    updateOperationProgress(0, '0%');
    openWizardOperationWaitModal(jobs.length);
    const created = [];
    const failed = [];
    const task = taskPayload();
    try {
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const pct = jobs.length ? Math.round((index / jobs.length) * 100) : 0;
        const progressLabel = jobs.length
          ? `${pct}% · ${index} of ${jobs.length} processed`
          : '0%';
        updateOperationProgress(pct, progressLabel);
        try {
          const result = await postJson('/school/reports/assignments/semi-monthly-wizard/apply', {
            classId: job.classRow.classId,
            templateId: resolveClassTemplateId(job.classRow),
            reportScope: preview.reportScope,
            reportStartDate: preview.startDate,
            verifiedEndDate: preview.verifiedEndDate,
            conflictPermitted: task.conflictPermitted,
            timesheetReflection: task.timesheetReflection,
            conductRequiredBeforeFill: task.conductRequiredBeforeFill,
            allocatedHours: task.allocatedHours,
            reopenCompletedSession: task.reopenCompletedSession,
            targetStudentIds: state.selectedStudents[job.classRow.classId] || []
          });
          const actionLabel = result.createdAssignment ? 'assignment created' : 'target row added';
          created.push(`${job.classRow.title} (${actionLabel})`);
        } catch (error) {
          failed.push(`${job.classRow.title}: ${error.message}`);
        }
      }
      updateOperationProgress(100, '100% · complete');
      state.result = { created, failed };
      if (resultHost) {
        resultHost.classList.remove('d-none');
        resultHost.innerHTML = `
          <div class="alert alert-success py-2 small">${created.length} assignment(s) created.</div>
          ${failed.length ? `<div class="alert alert-warning py-2 small">${failed.map((row) => `<div>${escapeHtml(row)}</div>`).join('')}</div>` : ''}
        `;
      }
    } finally {
      state.operationRunning = false;
      closeWizardOperationWaitModal();
      setWizardNavigationLocked(true);
    }
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
        const loadingToken = typeof global.showLoading === 'function'
          ? global.showLoading({
            title: 'Please wait',
            note: 'Loading class sessions for the selected period…'
          })
          : '';
        try {
          const resolved = await postJson('/school/reports/assignments/semi-monthly-wizard/resolve-dates', {
            ...wizardScopePayload(),
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
        } finally {
          if (loadingToken && typeof global.hideLoading === 'function') global.hideLoading(loadingToken);
        }
        return;
      }
      if (state.step === 'task') {
        const loadingToken = typeof global.showLoading === 'function'
          ? global.showLoading({
            title: 'Please wait',
            note: sessionPreviewLoadingNotes()[0]
          })
          : '';
        const progressTimer = loadingToken ? startSessionPreviewLoadingProgress(loadingToken) : null;
        const next = qs('btn_smmrNext');
        if (next) next.disabled = true;
        try {
          const endDate = clean(qs('smmrEndDate')?.value);
          const preview = await postJson('/school/reports/assignments/semi-monthly-wizard/preview', {
            ...wizardScopePayload(),
            programIds: state.programs.map((row) => row.id),
            startDate: clean(qs('smmrStartDate')?.value),
            endDate,
            verifiedEndDate: state.verifiedEndDate || endDate
          });
          state.preview = preview;
          state.classSearchQuery = clean(qs('smmrClassSearch')?.value);
          state.classSort = clean(qs('smmrClassSort')?.value) || 'title-asc';
          syncClassSelectionDefaults(preview);
          syncStudentsForSelectedClasses(preview);
          syncTemplatesForSelectedClasses(preview);
          renderTiles(preview);
          showStep('tiles');
        } finally {
          if (progressTimer) window.clearInterval(progressTimer);
          if (next) next.disabled = false;
          if (loadingToken && typeof global.hideLoading === 'function') global.hideLoading(loadingToken);
        }
        return;
      }
      if (state.step === 'tiles') {
        ensureDefaultStudentsForSelectedClasses(state.preview);
        if (!state.selectedClassIds.size) {
          throw new Error('Select at least one class to continue.');
        }
        if (!studentsReady(state.preview)) {
          throw new Error('Select at least one student for every selected class that has eligible students.');
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
        if (state.operationRunning) return;
        await runOperation();
      }
    } catch (error) {
      await showWizardMessage('Semi-Monthly Report Wizard', error.message || 'Unable to continue.', 'warning');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    qs('btn_smmrAddProgram')?.addEventListener('click', () => addProgram());
    qs('smmrReportScope')?.addEventListener('change', () => {
      state.selectedTemplateByClassId = {};
      void recountPrograms().catch((error) => {
        void showWizardMessage('Program Count', error.message || 'Unable to recount classes.', 'error');
      });
    });
    qs('smmrClassCapacityTarget')?.addEventListener('change', () => {
      state.selectedTemplateByClassId = {};
      state.preview = null;
      void recountPrograms().catch((error) => {
        void showWizardMessage('Program Count', error.message || 'Unable to recount classes.', 'error');
      });
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
    qs('smmrClassTableWrap')?.addEventListener('click', (event) => {
      const th = event.target.closest('[data-smmr-sort-key]');
      if (!th) return;
      handleClassSortHeaderActivate(th);
    });
    qs('smmrClassTableWrap')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const th = event.target.closest('[data-smmr-sort-key]');
      if (!th) return;
      event.preventDefault();
      handleClassSortHeaderActivate(th);
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
      const templateSelect = event.target.closest('[data-smmr-class-template]');
      if (templateSelect) {
        const classId = templateSelect.getAttribute('data-smmr-class-template');
        if (classId) state.selectedTemplateByClassId[classId] = clean(templateSelect.value);
        return;
      }
      const checkbox = event.target.closest('[data-smmr-class-select]');
      if (!checkbox) return;
      const classId = checkbox.getAttribute('data-smmr-class-select');
      if (!classId) return;
      if (checkbox.checked) {
        state.selectedClassIds.add(classId);
        assignDefaultStudentsForClass(classId);
        syncTemplateDefaultForClass(allPreviewClasses().find((row) => row.classId === classId));
      } else {
        state.selectedClassIds.delete(classId);
      }
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
    applyDefaultPeriodDatesIfEmpty();
  });
})(window);
