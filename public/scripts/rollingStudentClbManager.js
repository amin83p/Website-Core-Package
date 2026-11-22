(function (global) {
  'use strict';

  const ROLLING_CLB_SKILLS = ['listening', 'speaking', 'reading', 'writing'];
  const ROLLING_CLB_VALUE_GROUPS = ['goal', 'current', 'result'];

  let deps = {
    requestJson: null,
    showBusy: null,
    hideBusy: null,
    showMsg: null,
    showConfirm: null,
    canEdit: true,
    mountModal: null,
    showModal: null,
    raiseModal: null,
    clearModalStack: null,
    getModalEl: null,
    formatRichHtml: null,
    orgToday: ''
  };

  let wired = false;
  let clbHistory = [];
  let editingEntryId = '';
  let context = { studentId: '', studentLabel: '', onSaved: null };

  function qs(id) {
    return document.getElementById(id);
  }

  function htmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRich(value) {
    const fn = deps.formatRichHtml;
    return typeof fn === 'function' ? fn(value) : htmlEscape(value);
  }

  function sortClbHistory(entries) {
    return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
      const dateCmp = String(b?.recordedAt || '').localeCompare(String(a?.recordedAt || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });
  }

  function createEntryId(index = 0) {
    return `clb_${Date.now()}_${Number(index) || 0}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getEditorInput(group, skill) {
    return qs(`inp_rolling_clb_${group}_${skill}`);
  }

  function getLatestEntry(history = clbHistory) {
    return sortClbHistory(history)[0] || null;
  }

  function entryHasValues(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return ROLLING_CLB_VALUE_GROUPS.some((group) =>
      ROLLING_CLB_SKILLS.some((skill) => {
        const text = String(entry?.[group]?.[skill] || '').trim();
        return text && text !== '-';
      })
    );
  }

  function renderSkillCell(value) {
    const text = String(value || '').trim();
    if (!text || text === '-') return '<span class="text-muted">—</span>';
    return `<span class="clb-history-skill d-inline-block">${htmlEscape(text)}</span>`;
  }

  function formatDateLabel(value) {
    const text = String(value || '').trim();
    return text || '—';
  }

  function renderDateCell(value) {
    const text = formatDateLabel(value);
    return (text && text !== '—')
      ? `<span class="clb-history-date fw-semibold">${htmlEscape(text)}</span>`
      : '<span class="text-muted">—</span>';
  }

  function renderDatesCell(entry) {
    const goalCurrent = renderDateCell(entry?.recordedAt);
    const result = renderDateCell(entry?.resultRecordedAt);
    return `
      <div class="clb-history-dates">
        <div class="clb-history-date-line">
          <span class="clb-history-date-label">Goal / Current</span>
          ${goalCurrent}
        </div>
        <div class="clb-history-date-line">
          <span class="clb-history-date-label">Result</span>
          ${result}
        </div>
      </div>
    `;
  }

  function syncEvaluationTypeOptions() {
    const opt = qs('opt_rolling_clb_eval_previous_enrollments');
    const selectEl = qs('inp_rolling_clb_evaluationType');
    if (!opt || !selectEl) return;
    opt.hidden = false;
    opt.disabled = false;
  }

  function syncTeacherPickRow() {
    const isTeacher = String(qs('inp_rolling_clb_evaluationType')?.value || '').trim() === 'teacher';
    qs('rollingClbTeacherPickCol')?.classList.toggle('d-none', !isTeacher);
    if (!isTeacher) {
      if (qs('inp_rolling_clb_evaluationTeacherId')) qs('inp_rolling_clb_evaluationTeacherId').value = '';
      if (qs('inp_rolling_clb_evaluationTeacherLabel')) qs('inp_rolling_clb_evaluationTeacherLabel').value = '';
    }
  }

  function pickEvaluationTeacher() {
    if (!global.GenericPicker || !global.GenericPickerPresets) {
      if (deps.showMsg) {
        deps.showMsg('Picker Unavailable', 'warning', 'Teacher picker is not loaded on this page.');
      }
      return;
    }
    GenericPicker.open(GenericPickerPresets.teacher({
      title: 'Select Teacher',
      multiselect: false,
      context: (global.GenericPickerContexts && typeof global.GenericPickerContexts.activeOrganizationScope === 'function')
        ? global.GenericPickerContexts.activeOrganizationScope({ label: 'Active Organization' })
        : undefined,
      onSelect: (selected) => {
        const item = Array.isArray(selected) ? selected[0] : selected;
        if (!item) return;
        const teacherId = String(item.personId || item.id || '').trim();
        const teacherName = String(item.displayName || item.name || item.label || teacherId).trim();
        if (qs('inp_rolling_clb_evaluationTeacherId')) qs('inp_rolling_clb_evaluationTeacherId').value = teacherId;
        if (qs('inp_rolling_clb_evaluationTeacherLabel')) qs('inp_rolling_clb_evaluationTeacherLabel').value = teacherName;
      }
    }));
  }

  function syncEditPermissions() {
    const editable = deps.canEdit === true;
    qs('btn_rollingClbAddEntry')?.classList.toggle('d-none', !editable);
    qs('btn_rollingClbSaveEntry')?.classList.toggle('d-none', !editable);
    document.querySelectorAll('.rolling-clb-editor-input').forEach((input) => {
      input.readOnly = !editable;
      if (input.type === 'date') input.disabled = !editable;
    });
  }

  function showListPanel() {
    qs('rollingClb_listPanel')?.classList.remove('d-none');
    qs('rollingClb_editorPanel')?.classList.add('d-none');
    editingEntryId = '';
    renderPreviousEntryHeadsUp();
  }

  function showEditorPanel() {
    qs('rollingClb_listPanel')?.classList.add('d-none');
    qs('rollingClb_editorPanel')?.classList.remove('d-none');
    syncEditPermissions();
  }

  function defaultOrgToday() {
    if (global.AppOrgDateTime && global.AppOrgDateTime.today) return String(global.AppOrgDateTime.today);
    if (deps.orgToday) return String(deps.orgToday);
    return new Date().toISOString().slice(0, 10);
  }

  function clearEditor() {
    const recordedAt = qs('inp_rolling_clbRecordedAt');
    if (recordedAt) recordedAt.value = defaultOrgToday();
    if (qs('inp_rolling_clbResultRecordedAt')) qs('inp_rolling_clbResultRecordedAt').value = '';
    if (qs('inp_rolling_clb_note')) qs('inp_rolling_clb_note').value = '';
    if (qs('inp_rolling_clb_evaluationType')) qs('inp_rolling_clb_evaluationType').value = 'referral';
    if (qs('inp_rolling_clb_evaluationTeacherId')) qs('inp_rolling_clb_evaluationTeacherId').value = '';
    if (qs('inp_rolling_clb_evaluationTeacherLabel')) qs('inp_rolling_clb_evaluationTeacherLabel').value = '';
    syncEvaluationTypeOptions();
    syncTeacherPickRow();
    ROLLING_CLB_VALUE_GROUPS.forEach((group) => {
      ROLLING_CLB_SKILLS.forEach((skill) => {
        const input = getEditorInput(group, skill);
        if (input) input.value = '';
      });
      const firstSkillInput = getEditorInput(group, ROLLING_CLB_SKILLS[0]);
      if (firstSkillInput) firstSkillInput.value = '-';
    });
  }

  function prefillCurrentFromLatest() {
    const latest = getLatestEntry();
    if (!latest) return;
    ROLLING_CLB_SKILLS.forEach((skill) => {
      const input = getEditorInput('current', skill);
      const value = String(latest?.result?.[skill] || '').trim();
      if (input && value) input.value = value;
    });
  }

  function applyDefaultEvaluationTypeForNew() {
    const selectEl = qs('inp_rolling_clb_evaluationType');
    if (!selectEl || editingEntryId) return;
    selectEl.value = clbHistory.length >= 1 ? 'previous_enrollments' : 'referral';
    syncTeacherPickRow();
  }

  function collectEditorGroups() {
    const values = { goal: {}, current: {}, result: {} };
    ROLLING_CLB_VALUE_GROUPS.forEach((group) => {
      ROLLING_CLB_SKILLS.forEach((skill) => {
        values[group][skill] = String(getEditorInput(group, skill)?.value || '').trim();
      });
    });
    return values;
  }

  function refreshEditorWarnings() {
    const parser = global.ClbLevelValueParser;
    const alertEl = qs('rollingClb_entryWarnings');
    document.querySelectorAll('.rolling-clb-editor-input').forEach((input) => {
      input.classList.remove('clb-level-value-warning');
    });
    if (!parser || !alertEl) return;
    const warnContext = {
      mode: editingEntryId ? 'edit' : 'new',
      previousEntry: editingEntryId ? null : getLatestEntry()
    };
    const warnings = parser.evaluateClbEditorWarnings(collectEditorGroups(), warnContext);
    const list = Object.values(warnings);
    if (!list.length) {
      alertEl.classList.add('d-none');
      alertEl.innerHTML = '';
      return;
    }
    alertEl.classList.remove('d-none');
    alertEl.innerHTML = list.map((warning) => `<div>${formatRich(warning.message)}</div>`).join('');
    list.forEach((warning) => {
      const input = document.getElementById(parser.resolveClbEditorInputId(warning, 'rolling'));
      if (input) input.classList.add('clb-level-value-warning');
    });
  }

  function renderPreviousEntryHeadsUp() {
    const panel = qs('rollingClb_previousEntryHeadsUp');
    if (!panel) return;
    const isNewEntry = !String(editingEntryId || '').trim();
    const latest = isNewEntry ? getLatestEntry() : null;
    if (!isNewEntry || !latest || !entryHasValues(latest)) {
      panel.classList.add('d-none');
      panel.innerHTML = '';
      return;
    }
    const skillHeaders = ROLLING_CLB_SKILLS.map((skill) => {
      const label = skill.charAt(0).toUpperCase() + skill.slice(1);
      return `<th class="text-center">${htmlEscape(label)}</th>`;
    }).join('');
    const rowLabels = { goal: 'CLB Goal', current: 'Current CLB Level', result: 'CLB Result' };
    const rowsHtml = ROLLING_CLB_VALUE_GROUPS.map((group) => `
      <tr>
        <td class="rolling-clb-heads-up-row-label">${htmlEscape(rowLabels[group] || group)}</td>
        ${ROLLING_CLB_SKILLS.map((skill) => `
          <td class="text-center font-monospace">${renderSkillCell(latest?.[group]?.[skill])}</td>
        `).join('')}
      </tr>
    `).join('');
    panel.classList.remove('d-none');
    panel.innerHTML = `
      <div class="rolling-clb-heads-up">
        <div class="rolling-clb-heads-up__header">
          <i class="bi bi-clock-history" aria-hidden="true"></i>
          <div>
            <div class="rolling-clb-heads-up__title">Previous CLB entry</div>
            <div class="rolling-clb-heads-up__subtitle">Use this as a reference when entering the new goal, current, and result levels.</div>
          </div>
        </div>
        <div class="rolling-clb-heads-up__dates">
          <span><strong>Goal / Current date:</strong> ${htmlEscape(formatDateLabel(latest.recordedAt))}</span>
          <span><strong>Result date:</strong> ${htmlEscape(formatDateLabel(latest.resultRecordedAt))}</span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-bordered rolling-clb-heads-up__table mb-0">
            <thead class="table-light">
              <tr><th>Row</th>${skillHeaders}</tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="rolling-clb-heads-up__note">Current CLB level fields below are prefilled from the previous result where available.</div>
      </div>
    `;
  }

  function resetEditorMode() {
    editingEntryId = '';
    const title = qs('rollingClb_editorTitle');
    const saveBtn = qs('btn_rollingClbSaveEntry');
    const removeBtn = qs('btn_rollingClbRemoveEntry');
    if (title) title.textContent = 'New CLB Entry';
    if (saveBtn) saveBtn.textContent = 'Save CLB Entry';
    if (removeBtn) removeBtn.classList.add('d-none');
  }

  function openEditorForNew() {
    resetEditorMode();
    clearEditor();
    prefillCurrentFromLatest();
    syncEvaluationTypeOptions();
    applyDefaultEvaluationTypeForNew();
    showEditorPanel();
    renderPreviousEntryHeadsUp();
    refreshEditorWarnings();
  }

  function openEditorForEntry(entryId) {
    const entry = clbHistory.find((row) => String(row?.id || '') === String(entryId || ''));
    if (!entry) return;
    editingEntryId = String(entry.id || '');
    clearEditor();
    if (qs('inp_rolling_clbRecordedAt')) qs('inp_rolling_clbRecordedAt').value = String(entry.recordedAt || '');
    if (qs('inp_rolling_clbResultRecordedAt')) qs('inp_rolling_clbResultRecordedAt').value = String(entry.resultRecordedAt || '');
    if (qs('inp_rolling_clb_note')) qs('inp_rolling_clb_note').value = String(entry.note || '');
    if (qs('inp_rolling_clb_evaluationType')) qs('inp_rolling_clb_evaluationType').value = String(entry.evaluationType || 'referral');
    if (qs('inp_rolling_clb_evaluationTeacherId')) qs('inp_rolling_clb_evaluationTeacherId').value = String(entry.evaluationTeacherId || '');
    if (qs('inp_rolling_clb_evaluationTeacherLabel')) qs('inp_rolling_clb_evaluationTeacherLabel').value = String(entry.evaluationTeacherLabel || '');
    syncEvaluationTypeOptions();
    syncTeacherPickRow();
    ROLLING_CLB_VALUE_GROUPS.forEach((group) => {
      ROLLING_CLB_SKILLS.forEach((skill) => {
        const input = getEditorInput(group, skill);
        if (input) input.value = String(entry?.[group]?.[skill] || '');
      });
    });
    const title = qs('rollingClb_editorTitle');
    const saveBtn = qs('btn_rollingClbSaveEntry');
    const removeBtn = qs('btn_rollingClbRemoveEntry');
    if (title) title.textContent = 'Edit CLB Entry';
    if (saveBtn) saveBtn.textContent = 'Update CLB Entry';
    if (removeBtn) removeBtn.classList.toggle('d-none', !deps.canEdit);
    showEditorPanel();
    renderPreviousEntryHeadsUp();
    refreshEditorWarnings();
  }

  function collectEditorEntry() {
    const recordedAt = String(qs('inp_rolling_clbRecordedAt')?.value || '').trim();
    if (!recordedAt) throw new Error('Goal / Current date is required for a CLB entry.');
    const resultRecordedAt = String(qs('inp_rolling_clbResultRecordedAt')?.value || '').trim();
    const values = collectEditorGroups();
    const labels = { goal: 'CLB Goal', current: 'Current CLB Level', result: 'CLB Result' };
    ROLLING_CLB_VALUE_GROUPS.forEach((group) => {
      if (!ROLLING_CLB_SKILLS.some((skill) => values[group][skill])) {
        throw new Error(`Enter at least one value for ${labels[group]}.`);
      }
    });
    const evaluationType = String(qs('inp_rolling_clb_evaluationType')?.value || 'referral').trim() || 'referral';
    const note = String(qs('inp_rolling_clb_note')?.value || '').trim();
    const evaluationTeacherId = String(qs('inp_rolling_clb_evaluationTeacherId')?.value || '').trim();
    const evaluationTeacherLabel = String(qs('inp_rolling_clb_evaluationTeacherLabel')?.value || '').trim();
    if (evaluationType === 'teacher' && !evaluationTeacherId) {
      throw new Error('Select a teacher for Teacher evaluation.');
    }
    return {
      id: editingEntryId || createEntryId(clbHistory.length),
      recordedAt,
      resultRecordedAt,
      note,
      evaluationType,
      evaluationTeacherId: evaluationType === 'teacher' ? evaluationTeacherId : '',
      evaluationTeacherLabel: evaluationType === 'teacher' ? evaluationTeacherLabel : '',
      goal: values.goal,
      current: values.current,
      result: values.result
    };
  }

  async function persistHistory() {
    const studentId = String(context.studentId || '').trim();
    if (!studentId || !deps.requestJson) throw new Error('Student id is missing.');
    const result = await deps.requestJson(
      `/school/students/api/${encodeURIComponent(studentId)}/clb-level-history`,
      'PUT',
      { clbLevelHistory: sortClbHistory(clbHistory) }
    );
    if (!result) return false;
    clbHistory = Array.isArray(result.data?.clbLevelHistory) ? result.data.clbLevelHistory : clbHistory;
    if (result.data?.studentLabel) {
      context.studentLabel = String(result.data.studentLabel || '').trim();
      if (qs('rollingClb_studentLabel')) qs('rollingClb_studentLabel').value = context.studentLabel;
    }
    return true;
  }

  function renderList() {
    const emptyEl = qs('rollingClb_historyEmpty');
    const wrapEl = qs('rollingClb_historyWrap');
    const tbody = qs('rollingClb_historyTbody');
    clbHistory = sortClbHistory(clbHistory);
    syncEditPermissions();
    if (!emptyEl || !wrapEl || !tbody) return;
    if (!clbHistory.length) {
      emptyEl.classList.remove('d-none');
      wrapEl.classList.add('d-none');
      tbody.innerHTML = '';
      syncEvaluationTypeOptions();
      return;
    }
    emptyEl.classList.add('d-none');
    wrapEl.classList.remove('d-none');
    const blocks = [];
    clbHistory.forEach((entry, entryIndex) => {
      const entryId = htmlEscape(String(entry?.id || ''));
      const rowAttrs = `class="rolling-clb-history-row rolling-clb-history-entry-block" data-entry-id="${entryId}" role="button" tabindex="0"`;
      const goalCells = ROLLING_CLB_SKILLS.map((skill) => `<td class="align-middle">${renderSkillCell(entry?.goal?.[skill])}</td>`).join('');
      const currentCells = ROLLING_CLB_SKILLS.map((skill) => `<td class="align-middle">${renderSkillCell(entry?.current?.[skill])}</td>`).join('');
      const resultCells = ROLLING_CLB_SKILLS.map((skill) => `<td class="align-middle">${renderSkillCell(entry?.result?.[skill])}</td>`).join('');
      if (entryIndex > 0) blocks.push('<tr class="rolling-clb-history-spacer"><td colspan="6"></td></tr>');
      blocks.push(`
        <tr ${rowAttrs}>
          <td rowspan="3" class="align-middle">${renderDatesCell(entry)}</td>
          <td class="clb-history-row-label fw-semibold">CLB Goal</td>
          ${goalCells}
        </tr>
        <tr ${rowAttrs}>
          <td class="clb-history-row-label fw-semibold">Current CLB Level</td>
          ${currentCells}
        </tr>
        <tr ${rowAttrs}>
          <td class="clb-history-row-label fw-semibold">CLB Result</td>
          ${resultCells}
        </tr>
      `);
    });
    tbody.innerHTML = blocks.join('');
    syncEvaluationTypeOptions();
  }

  async function saveFromEditor() {
    if (!deps.canEdit) {
      if (deps.showMsg) await deps.showMsg('CLB Entries', 'warning', 'You do not have permission to edit CLB entries.');
      return;
    }
    try {
      const entry = collectEditorEntry();
      const wasEditing = Boolean(editingEntryId);
      if (editingEntryId) {
        const index = clbHistory.findIndex((row) => String(row?.id || '') === editingEntryId);
        if (index < 0) throw new Error('The CLB entry being edited is no longer available.');
        clbHistory[index] = entry;
      } else {
        clbHistory.push(entry);
      }
      if (deps.showBusy) deps.showBusy('Saving CLB entry...');
      const saved = await persistHistory();
      if (!saved) return;
      showListPanel();
      renderList();
      if (typeof context.onSaved === 'function') await context.onSaved(clbHistory);
      if (deps.showMsg) await deps.showMsg('Success', 'success', wasEditing ? 'CLB entry updated.' : 'CLB entry added.');
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('CLB Entry', 'warning', error.message || 'Unable to save CLB entry.');
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  async function removeFromEditor() {
    if (!deps.canEdit || !editingEntryId) return;
    let confirmed = true;
    if (deps.showConfirm) {
      confirmed = await deps.showConfirm(
        'Remove this CLB entry from the student profile?',
        'Remove CLB Entry',
        { icon: 'warning', confirmText: 'Remove', confirmClass: 'btn-danger' }
      );
    }
    if (!confirmed) return;
    clbHistory = clbHistory.filter((row) => String(row?.id || '') !== editingEntryId);
    try {
      if (deps.showBusy) deps.showBusy('Removing CLB entry...');
      const saved = await persistHistory();
      if (!saved) return;
      showListPanel();
      renderList();
      if (typeof context.onSaved === 'function') await context.onSaved(clbHistory);
      if (deps.showMsg) await deps.showMsg('Success', 'success', 'CLB entry removed.');
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('CLB Entry', 'error', error.message || 'Unable to remove CLB entry.');
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  function applyDefaultMessaging() {
    const ui = global.SchoolMessageUi;
    if (!ui || typeof ui.createClaimManagerMessaging !== 'function') return;
    const built = ui.createClaimManagerMessaging();
    if (!deps.showMsg) deps.showMsg = built.showMsg;
    if (!deps.showConfirm) deps.showConfirm = built.showConfirm;
  }

  function wireEventsOnce() {
    if (wired) return;
    wired = true;
    qs('rollingClb_editorPanel')?.addEventListener('input', (event) => {
      if (event.target?.closest('.rolling-clb-editor-input')) refreshEditorWarnings();
    });
    qs('inp_rolling_clb_evaluationType')?.addEventListener('change', syncTeacherPickRow);
    qs('btnPickRollingClbEvaluationTeacher')?.addEventListener('click', pickEvaluationTeacher);
    qs('btn_rollingClbAddEntry')?.addEventListener('click', (event) => {
      event.stopPropagation();
      openEditorForNew();
    });
    qs('btn_rollingClbCancelEditor')?.addEventListener('click', () => {
      showListPanel();
      renderList();
    });
    qs('btn_rollingClbSaveEntry')?.addEventListener('click', () => { saveFromEditor(); });
    qs('btn_rollingClbRemoveEntry')?.addEventListener('click', () => { removeFromEditor(); });
    qs('rollingClb_historyTbody')?.addEventListener('click', (event) => {
      if (!deps.canEdit) return;
      const row = event.target.closest('.rolling-clb-history-row');
      if (!row) return;
      openEditorForEntry(row.getAttribute('data-entry-id') || '');
    });
    qs('rollingClb_historyTbody')?.addEventListener('keydown', (event) => {
      if (!deps.canEdit) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.rolling-clb-history-row');
      if (!row) return;
      event.preventDefault();
      openEditorForEntry(row.getAttribute('data-entry-id') || '');
    });
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentClbModal');
    modalEl?.addEventListener('hidden.bs.modal', () => {
      showListPanel();
      clbHistory = [];
      editingEntryId = '';
      context = { studentId: '', studentLabel: '', onSaved: null };
      if (deps.clearModalStack) deps.clearModalStack(modalEl);
    });
    modalEl?.addEventListener('shown.bs.modal', () => {
      if (deps.raiseModal) deps.raiseModal(modalEl);
    });
  }

  function configure(nextDeps = {}) {
    deps = { ...deps, ...nextDeps };
    applyDefaultMessaging();
    wireEventsOnce();
  }

  async function open(options = {}) {
    wireEventsOnce();
    const studentId = String(options.studentId || '').trim();
    if (!studentId) return;
    context = {
      studentId,
      studentLabel: String(options.studentLabel || studentId).trim(),
      onSaved: typeof options.onSaved === 'function' ? options.onSaved : null
    };
    clbHistory = [];
    editingEntryId = '';
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentClbModal');
    try {
      if (deps.showBusy) deps.showBusy('Loading CLB entries...');
      const result = await deps.requestJson(`/school/students/api/${encodeURIComponent(studentId)}/clb-level-history`);
      if (!result) return;
      clbHistory = Array.isArray(result.data?.clbLevelHistory) ? result.data.clbLevelHistory : [];
      context.studentLabel = String(result.data?.studentLabel || context.studentLabel || studentId).trim();
      if (qs('rollingClb_studentLabel')) qs('rollingClb_studentLabel').value = context.studentLabel;
      if (qs('rollingClb_studentId')) qs('rollingClb_studentId').value = studentId;
      showListPanel();
      renderList();
      if (deps.mountModal) deps.mountModal(modalEl);
      if (typeof deps.showModal === 'function') deps.showModal();
      else if (modalEl && global.bootstrap?.Modal) global.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      if (options.openEditorOnShow) openEditorForNew();
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('CLB Entries', 'error', error.message || 'Unable to load CLB entries.');
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  global.RollingStudentClbManager = {
    configure,
    open
  };
})(typeof window !== 'undefined' ? window : global);