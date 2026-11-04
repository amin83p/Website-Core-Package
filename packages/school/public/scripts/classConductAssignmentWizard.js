(function (global) {
  'use strict';

  const STEPS = [
    { id: 'scope', label: 'Programs' },
    { id: 'date', label: 'Date' },
    { id: 'classes', label: 'Classes' },
    { id: 'run', label: 'Summary' }
  ];

  const state = {
    step: 'scope',
    programs: [],
    preview: null,
    classEnabled: new Map(),
    result: null,
    operationRunning: false
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

  async function showWizardMessage(title, message, icon = 'warning') {
    const body = clean(message) || 'Unable to continue.';
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title: clean(title) || 'Class Conduct Assignment',
        message: body,
        icon,
        buttons: [{ text: 'OK', class: icon === 'error' ? 'btn-danger' : 'btn-primary' }]
      });
      return;
    }
    alert(body);
  }

  function setWizardNavigationLocked(locked) {
    const next = qs('btn_ccaNext');
    const back = qs('btn_ccaBack');
    if (next) next.disabled = locked || Boolean(state.result);
    if (back && !back.classList.contains('d-none')) back.disabled = locked;
    qs('btn_ccaAddProgram')?.toggleAttribute('disabled', locked);
  }

  function openStepWait(options = {}) {
    if (typeof global.showLoading !== 'function') return '';
    return global.showLoading(options);
  }

  function closeStepWait(token) {
    if (token && typeof global.hideLoading === 'function') global.hideLoading(token);
  }

  function buildOperationWaitModalHtml(rowCount) {
    const total = Math.max(0, Number(rowCount) || 0);
    return `<p class="mb-2">Updating class conduct visibility for <strong>${total}</strong> class row(s). Please wait&hellip;</p>
      <p class="small text-muted mb-2">This may take a moment while sessions are updated.</p>
      <div class="progress" style="height: 1rem;">
        <div class="progress-bar progress-bar-striped progress-bar-animated" id="ccaOperationModalBar" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
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

  function openWizardOperationWaitModal(rowCount) {
    if (typeof global.showMessageModal !== 'function') return;
    lockMessageModalWhileBusy();
    void global.showMessageModal({
      title: 'Performing operation',
      icon: 'info',
      message: buildOperationWaitModalHtml(rowCount),
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

  function updateOperationModalProgress(pct, label) {
    const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const text = clean(label) || `${safePct}%`;
    const modalBar = document.getElementById('ccaOperationModalBar');
    if (modalBar) {
      modalBar.style.width = `${safePct}%`;
      modalBar.textContent = text;
      modalBar.setAttribute('aria-valuenow', String(safePct));
    }
  }

  function sessionPreviewLoadingNotes() {
    return [
      'Checking sessions on the anchor date…',
      'Checking sessions one day before the anchor date…',
      'Checking sessions two days before the anchor date…',
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

  function classCapacityTarget() {
    const token = clean(qs('ccaClassCapacityTarget')?.value).toLowerCase();
    if (token === 'group' || token === 'one_on_one') return token;
    return 'all';
  }

  function scopePayload() {
    return { classCapacityTarget: classCapacityTarget() };
  }

  function showStep(step) {
    state.step = step;
    const index = STEPS.findIndex((item) => item.id === step);
    const progress = ((index + 1) / STEPS.length) * 100;
    document.querySelectorAll('[data-cca-step]').forEach((el) => {
      el.classList.toggle('d-none', el.getAttribute('data-cca-step') !== step);
    });
    qs('ccaWizardStepBadge').textContent = `Step ${index + 1} of ${STEPS.length}`;
    qs('ccaWizardProgressPct').textContent = `${Math.round(progress)}%`;
    qs('ccaWizardProgressBar').style.width = `${progress.toFixed(2)}%`;
    document.querySelectorAll('[data-cca-pill]').forEach((el) => {
      const pillId = el.getAttribute('data-cca-pill');
      const pillIndex = STEPS.findIndex((item) => item.id === pillId);
      el.classList.toggle('active', pillId === step);
      el.classList.toggle('completed', pillIndex > -1 && pillIndex < index);
    });
    if (global.WizardStepRail) global.WizardStepRail.sync(qs('ccaWizardStepPills'));
    qs('btn_ccaBack')?.classList.toggle('d-none', step === 'scope');
    const next = qs('btn_ccaNext');
    if (next) {
      next.innerHTML = step === 'run' && !state.result
        ? 'Perform operation<i class="bi bi-check2-circle ms-1"></i>'
        : 'Next<i class="bi bi-arrow-right ms-1"></i>';
      next.disabled = Boolean(state.result) || Boolean(state.operationRunning);
    }
  }

  function renderPrograms() {
    const tbody = qs('ccaProgramTbody');
    if (!tbody) return;
    if (!state.programs.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No programs added.</td></tr>';
      return;
    }
    tbody.innerHTML = state.programs.map((row) => `
      <tr>
        <td>${escapeHtml(row.title)}</td>
        <td>${Number(row.classCount || 0)}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-cca-remove-program="${escapeHtml(row.id)}">Remove</button></td>
      </tr>
    `).join('');
  }

  async function mergeProgramsFromPicker(items) {
    const picked = (Array.isArray(items) ? items : [items]).filter(Boolean);
    const seen = new Set();
    const next = [];
    const loadingToken = openStepWait({
      title: 'Please wait',
      note: 'Counting classes for selected programs…',
      operation: 'program_count'
    });
    setWizardNavigationLocked(true);
    try {
      for (const item of picked) {
        const id = clean(item?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const existing = state.programs.find((row) => row.id === id);
        if (existing) {
          next.push(existing);
          continue;
        }
        const title = clean(item?.title || item?.name || item?.label || id);
        const counted = await postJson('/school/conduct-matrix/assignment-wizard/program-count', {
          ...scopePayload(),
          programId: id
        });
        next.push({ id, title, classCount: Number(counted.classCount || 0) });
      }
      state.programs = next;
      renderPrograms();
    } finally {
      closeStepWait(loadingToken);
      setWizardNavigationLocked(false);
    }
  }

  function addProgram() {
    if (!global.GenericPicker || !global.GenericPickerPresets?.program) {
      void showWizardMessage('Program Picker', 'Program picker is unavailable.', 'warning');
      return;
    }
    global.GenericPicker.open(global.GenericPickerPresets.program({
      title: 'Select programs',
      placeholder: 'Search programs, select one or more...',
      multiselect: true,
      selectedItems: state.programs.map((row) => ({
        id: row.id,
        title: row.title
      })),
      onSelect: (items) => {
        void mergeProgramsFromPicker(items).catch((error) => {
          void showWizardMessage('Program Count', error.message || 'Unable to count classes.', 'error');
        });
      }
    }));
  }

  function syncClassSelectionDefaults(preview) {
    state.classEnabled = new Map();
    (preview?.classes || []).forEach((row) => {
      if (row.blocked || row.frozen) return;
      state.classEnabled.set(String(row.classId), row.defaultChecked === true);
    });
  }

  function renderClasses(preview) {
    const tbody = qs('ccaClassTbody');
    const message = qs('ccaPreviewMessage');
    if (message) {
      message.textContent = preview?.message || '';
    }
    if (!tbody) return;
    const rows = Array.isArray(preview?.classes) ? preview.classes : [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">No classes found for the selected programs.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const key = String(row.classId);
      const checked = row.frozen || row.blocked
        ? Boolean(row.defaultChecked)
        : state.classEnabled.get(key) === true;
      const disabled = row.blocked || row.frozen || row.checkboxDisabled;
      const rowClass = row.frozen ? 'cca-row-frozen' : (row.blocked ? 'cca-row-blocked' : '');
      const sessionLabel = row.blocked
        ? '—'
        : `${escapeHtml(row.sessionDate || '')} ${escapeHtml(row.startTime || '')}–${escapeHtml(row.endTime || '')}`.trim();
      return `
        <tr class="${rowClass}" data-cca-class-id="${escapeHtml(key)}">
          <td>
            <input type="checkbox" class="form-check-input" data-cca-class-toggle="${escapeHtml(key)}"
              ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
              aria-label="Enable class conduct for ${escapeHtml(row.title)}">
          </td>
          <td><div class="fw-semibold">${escapeHtml(row.title)}</div><div class="small text-muted">${escapeHtml(key)}</div></td>
          <td class="small">${sessionLabel}${row.href ? `<div><a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">Open session</a></div>` : ''}</td>
          <td class="small">${escapeHtml(row.statusLabel || '')}</td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('[data-cca-class-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const classId = clean(input.getAttribute('data-cca-class-toggle'));
        state.classEnabled.set(classId, input.checked);
      });
    });
  }

  function buildSelections(preview) {
    return (preview?.classes || []).map((row) => {
      if (row.blocked || !row.sessionId) return null;
      const enabled = row.frozen
        ? true
        : state.classEnabled.get(String(row.classId)) === true;
      return {
        classId: row.classId,
        sessionId: row.sessionId,
        enabled
      };
    }).filter(Boolean);
  }

  function renderSummaryIntro(preview) {
    const host = qs('ccaSummaryIntro');
    if (!host || !preview) return;
    const selections = buildSelections(preview);
    const enableCount = selections.filter((row) => row.enabled).length;
    const disableCount = selections.filter((row) => !row.enabled).length;
    host.innerHTML = `
      <p class="mb-1">Anchor date <strong>${escapeHtml(preview.anchorDate)}</strong> · lookback ${Number(preview.sessionLookbackDays || 3)} day(s).</p>
      <p class="mb-0">${selections.length} class row(s) will be processed: <strong>${enableCount}</strong> enable, <strong>${disableCount}</strong> disable. Frozen report-required rows stay enabled.</p>
    `;
  }

  function renderOperationResults(summary) {
    const rows = Array.isArray(summary?.results) ? summary.results : [];
    const body = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.title || row.classId)}</td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(row.outcome || '')}</span></td>
        <td class="small">${escapeHtml(row.message || '')}</td>
      </tr>
    `).join('');
    return `
      <div class="border rounded p-3 mb-3">
        <div class="d-flex flex-wrap gap-2 mb-2">
          <span class="badge bg-success-subtle text-success border border-success-subtle">${Number(summary.enabled || 0)} enabled</span>
          <span class="badge bg-secondary-subtle text-secondary border">${Number(summary.disabled || 0)} disabled</span>
          <span class="badge bg-light text-dark border">${Number(summary.unchanged || 0)} unchanged</span>
          <span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">${Number(summary.skippedFrozen || 0)} frozen</span>
          <span class="badge bg-danger-subtle text-danger border border-danger-subtle">${Number(summary.failed || 0)} failed</span>
        </div>
      </div>
      <div class="table-responsive border rounded">
        <table class="table table-sm align-middle mb-0">
          <thead class="table-light"><tr><th>Class</th><th>Outcome</th><th>Details</th></tr></thead>
          <tbody>${body || '<tr><td colspan="3" class="text-muted small text-center py-3">No results.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  async function runOperation() {
    if (!state.preview || state.operationRunning) return;
    const selections = buildSelections(state.preview);
    state.operationRunning = true;
    setWizardNavigationLocked(true);
    updateOperationModalProgress(0, 'Starting…');
    openWizardOperationWaitModal(selections.length);
    try {
      updateOperationModalProgress(35, 'Applying changes…');
      const summary = await postJson('/school/conduct-matrix/assignment-wizard/apply', {
        selections
      });
      updateOperationModalProgress(100, 'Complete');
      state.result = summary;
      const resultHost = qs('ccaResult');
      if (resultHost) {
        resultHost.classList.remove('d-none');
        resultHost.innerHTML = renderOperationResults(summary);
      }
      qs('btn_ccaNext').innerHTML = 'Done';
    } catch (error) {
      await showWizardMessage('Class Conduct Assignment', error.message || 'Operation failed.', 'error');
    } finally {
      state.operationRunning = false;
      closeWizardOperationWaitModal();
      setWizardNavigationLocked(Boolean(state.result));
      qs('btn_ccaNext').disabled = Boolean(state.result);
    }
  }

  async function goNext() {
    try {
      if (state.step === 'scope') {
        if (!state.programs.length) throw new Error('Add at least one program.');
        showStep('date');
        return;
      }
      if (state.step === 'date') {
        const anchorDate = clean(qs('ccaAnchorDate')?.value);
        if (!anchorDate) throw new Error('Choose an anchor date.');
        const loadingToken = openStepWait({
          title: 'Please wait',
          note: sessionPreviewLoadingNotes()[0],
          operation: 'session_preview'
        });
        const progressTimer = loadingToken ? startSessionPreviewLoadingProgress(loadingToken) : null;
        setWizardNavigationLocked(true);
        try {
          const preview = await postJson('/school/conduct-matrix/assignment-wizard/preview', {
            ...scopePayload(),
            programIds: state.programs.map((row) => row.id),
            anchorDate
          });
          state.preview = preview;
          syncClassSelectionDefaults(preview);
          renderClasses(preview);
          showStep('classes');
        } finally {
          if (progressTimer) window.clearInterval(progressTimer);
          closeStepWait(loadingToken);
          setWizardNavigationLocked(false);
        }
        return;
      }
      if (state.step === 'classes') {
        renderSummaryIntro(state.preview);
        showStep('run');
        return;
      }
      if (state.step === 'run' && !state.result) {
        await runOperation();
      }
    } catch (error) {
      await showWizardMessage('Class Conduct Assignment', error.message || 'Unable to continue.', 'warning');
    }
  }

  function goBack() {
    const index = STEPS.findIndex((item) => item.id === state.step);
    if (index <= 0) return;
    showStep(STEPS[index - 1].id);
  }

  document.addEventListener('DOMContentLoaded', () => {
    showStep('scope');
    qs('btn_ccaAddProgram')?.addEventListener('click', addProgram);
    qs('ccaProgramTbody')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cca-remove-program]');
      if (!btn) return;
      const id = clean(btn.getAttribute('data-cca-remove-program'));
      state.programs = state.programs.filter((row) => row.id !== id);
      renderPrograms();
    });
    qs('btn_ccaSelectSelectable')?.addEventListener('click', () => {
      (state.preview?.classes || []).forEach((row) => {
        if (!row.selectable) return;
        state.classEnabled.set(String(row.classId), true);
      });
      renderClasses(state.preview);
    });
    qs('btn_ccaDeselectAll')?.addEventListener('click', () => {
      (state.preview?.classes || []).forEach((row) => {
        if (!row.selectable) return;
        state.classEnabled.set(String(row.classId), false);
      });
      renderClasses(state.preview);
    });
    qs('ccaClassCapacityTarget')?.addEventListener('change', () => {
      if (!state.programs.length) return;
      void (async () => {
        const loadingToken = openStepWait({
          title: 'Please wait',
          note: 'Updating class counts for the selected capacity filter…',
          operation: 'program_recount'
        });
        setWizardNavigationLocked(true);
        try {
          const next = [];
          for (const row of state.programs) {
            const counted = await postJson('/school/conduct-matrix/assignment-wizard/program-count', {
              ...scopePayload(),
              programId: row.id
            });
            next.push({ ...row, classCount: Number(counted.classCount || 0) });
          }
          state.programs = next;
          state.preview = null;
          renderPrograms();
        } catch (error) {
          void showWizardMessage('Program Count', error.message || 'Unable to recount classes.', 'error');
        } finally {
          closeStepWait(loadingToken);
          setWizardNavigationLocked(false);
        }
      })();
    });
    qs('btn_ccaNext')?.addEventListener('click', () => { void goNext(); });
    qs('btn_ccaBack')?.addEventListener('click', goBack);
  });
}(window));
