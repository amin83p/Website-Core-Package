(function (global) {
  'use strict';

  const CLAIM_NUMBER_ADD_NEW = '__add_new__';

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
    formatRichHtml: null,
    getModalEl: null,
    createModalController: null
  };

  let claimNumbers = [];
  let editingId = '';
  let context = { studentId: '', studentLabel: '', onSaved: null, selectAfterSave: '', persistMode: 'api' };
  let modalController = null;
  let wired = false;

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

  function formatClaimNumberOptionLabel(entry) {
    const number = String(entry?.number || '').trim();
    const label = String(entry?.label || '').trim();
    if (!number) return '';
    return label ? `${label} (${number})` : number;
  }

  function resolveSelectedClaimToken(rows, selectedToken) {
    const token = String(selectedToken || '').trim();
    if (!token) return '';
    const byId = (Array.isArray(rows) ? rows : []).find((row) => String(row?.id || '').trim() === token);
    if (byId) return String(byId.id).trim();
    const byNumber = (Array.isArray(rows) ? rows : []).find((row) => String(row?.number || '').trim() === token);
    if (byNumber) return String(byNumber.id).trim();
    return token;
  }

  function populateClaimNumberSelectOptions(selectEl, claimRows, selectedToken) {
    if (!selectEl) return;
    const rows = Array.isArray(claimRows) ? claimRows : [];
    const selectedId = resolveSelectedClaimToken(rows, selectedToken);
    const ids = rows.map((row) => String(row?.id || '').trim()).filter(Boolean);
    const selectedInList = !selectedId || ids.includes(selectedId);
    const options = ['<option value="">— None —</option>'];
    rows.forEach((entry) => {
      const id = String(entry?.id || '').trim();
      const number = String(entry?.number || '').trim();
      if (!id || !number) return;
      const label = formatClaimNumberOptionLabel(entry);
      options.push(`<option value="${htmlEscape(id)}"${selectedId === id ? ' selected' : ''}>${htmlEscape(label)}</option>`);
    });
    if (selectedId && !selectedInList) {
      options.push(`<option value="${htmlEscape(selectedId)}" selected>${htmlEscape(selectedId)} (not in profile)</option>`);
    }
    options.push(`<option value="${CLAIM_NUMBER_ADD_NEW}">+ Add New...</option>`);
    selectEl.innerHTML = options.join('');
    selectEl.dataset.previousValue = selectedId;
  }

  async function fetchStudentClaimNumbers(studentId) {
    const sid = String(studentId || '').trim();
    if (!sid || !deps.requestJson) return [];
    const result = await deps.requestJson(`/school/students/api/${encodeURIComponent(sid)}/claim-numbers`);
    return Array.isArray(result?.data?.claimNumbers) ? result.data.claimNumbers : [];
  }

  async function refreshClaimNumberSelect(selectElOrId, studentId, selectedToken) {
    const selectEl = typeof selectElOrId === 'string' ? qs(selectElOrId) : selectElOrId;
    if (!selectEl) return [];
    const sid = String(studentId || '').trim();
    if (!sid) {
      populateClaimNumberSelectOptions(selectEl, [], selectedToken);
      return [];
    }
    try {
      const rows = await fetchStudentClaimNumbers(sid);
      populateClaimNumberSelectOptions(selectEl, rows, selectedToken);
      return rows;
    } catch (_) {
      populateClaimNumberSelectOptions(selectEl, [], selectedToken);
      return [];
    }
  }

  function readClaimNumberSelectValue(selectElOrId) {
    const selectEl = typeof selectElOrId === 'string' ? qs(selectElOrId) : selectElOrId;
    const value = String(selectEl?.value || '').trim();
    if (!value || value === CLAIM_NUMBER_ADD_NEW) return '';
    return value;
  }

  function setRollingClaimAlert(text) {
    const alertEl = qs('rollingClaim_alert');
    if (!alertEl) return;
    if (!text) {
      alertEl.textContent = '';
      alertEl.classList.add('d-none');
      return;
    }
    alertEl.textContent = text;
    alertEl.classList.remove('d-none');
  }

  function setBlockersPanel(blockers) {
    const panel = qs('rollingClaim_blockers');
    if (!panel) return;
    const rows = Array.isArray(blockers) ? blockers : [];
    if (!rows.length) {
      panel.innerHTML = '';
      panel.classList.add('d-none');
      return;
    }
    const formatHtml = typeof deps.formatRichHtml === 'function' ? deps.formatRichHtml : htmlEscape;
    const sections = rows.map((blocker) => {
      const header = `${String(blocker.claimNumber || '').trim() || blocker.claimId || 'Claim'}${blocker.label ? ` — ${blocker.label}` : ''}`;
      const usages = Array.isArray(blocker.usages) ? blocker.usages : [];
      const list = usages.map((usage) => {
        const title = String(usage.classTitle || usage.classId || 'Class').trim();
        const dates = [usage.startDate, usage.endDate].filter(Boolean).join(' – ');
        const status = String(usage.status || '').trim();
        return `<li><strong>${htmlEscape(title)}</strong>${status ? ` <span class="text-muted">(${htmlEscape(status)})</span>` : ''}${dates ? `<br><span class="text-muted small">${htmlEscape(dates)}</span>` : ''}</li>`;
      }).join('');
      return `<div class="mb-2"><div class="fw-semibold">${htmlEscape(header)}</div>${list ? `<ul class="mb-0 ps-3">${list}</ul>` : ''}</div>`;
    }).join('');
    panel.innerHTML = `<div class="fw-semibold mb-1">${formatHtml('One or more claim numbers cannot be removed because they are used on enrollments.')}</div>${sections}`;
    panel.classList.remove('d-none');
  }

  function hideEditor() {
    editingId = '';
    qs('rollingClaim_editorPanel')?.classList.add('d-none');
    setRollingClaimAlert('');
  }

  function showEditor(entry = null) {
    const panel = qs('rollingClaim_editorPanel');
    if (!panel) return;
    editingId = String(entry?.id || '').trim();
    const titleEl = qs('rollingClaim_editorTitle');
    if (titleEl) titleEl.textContent = editingId ? 'Edit Claim Number' : 'New Claim Number';
    if (qs('rollingClaim_number')) qs('rollingClaim_number').value = String(entry?.number || '').trim();
    if (qs('rollingClaim_label')) qs('rollingClaim_label').value = String(entry?.label || '').trim();
    if (qs('rollingClaim_notes')) qs('rollingClaim_notes').value = String(entry?.notes || '').trim();
    if (qs('rollingClaim_isPrimary')) {
      qs('rollingClaim_isPrimary').checked = entry
        ? entry.isPrimary === true
        : !claimNumbers.some((row) => row.isPrimary);
    }
    panel.classList.remove('d-none');
    qs('rollingClaim_number')?.focus();
  }

  function renderClaimList() {
    const emptyEl = qs('rollingClaim_empty');
    const wrapEl = qs('rollingClaim_listWrap');
    const tbody = qs('rollingClaim_tbody');
    if (!tbody || !emptyEl || !wrapEl) return;
    if (!claimNumbers.length) {
      emptyEl.classList.remove('d-none');
      wrapEl.classList.add('d-none');
      tbody.innerHTML = '';
      return;
    }
    emptyEl.classList.add('d-none');
    wrapEl.classList.remove('d-none');
    tbody.innerHTML = claimNumbers.map((entry) => {
      const id = String(entry?.id || '').trim();
      const number = String(entry?.number || '').trim();
      const label = String(entry?.label || '').trim();
      const primaryBadge = entry?.isPrimary
        ? '<span class="badge text-bg-primary-subtle text-primary-emphasis border">Primary</span>'
        : '<span class="text-muted">—</span>';
      return `
        <tr data-claim-id="${htmlEscape(id)}">
          <td class="font-monospace">${htmlEscape(number)}</td>
          <td>${label ? htmlEscape(label) : '<span class="text-muted">—</span>'}</td>
          <td class="text-center">${primaryBadge}</td>
          <td class="text-end rolling-claim-actions-col">
            <div class="rolling-claim-actions">
              <button type="button" class="btn btn-sm btn-outline-secondary btn-rolling-claim-edit" data-claim-id="${htmlEscape(id)}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-rolling-claim-delete" data-claim-id="${htmlEscape(id)}" title="Delete"><i class="bi bi-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function putClaimNumbers() {
    const studentId = String(context.studentId || '').trim();
    if (!studentId) return null;
    const url = `/school/students/api/${encodeURIComponent(studentId)}/claim-numbers`;
    const headers = { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' };
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ claimNumbers })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409 && Array.isArray(result.blockers) && result.blockers.length) {
      const err = new Error(result.message || 'Unable to save claim numbers.');
      err.blockers = result.blockers;
      err.status = 'blocked';
      throw err;
    }
    if (!response.ok || String(result.status || '').toLowerCase() === 'error') {
      throw new Error(result?.message || 'Unable to save claim numbers.');
    }
    return result;
  }

  async function saveClaimNumbers(preferredClaimId = '') {
    const persistMode = String(context.persistMode || 'api').trim().toLowerCase() === 'local' ? 'local' : 'api';
    const studentId = String(context.studentId || '').trim();
    if (persistMode === 'api' && !studentId) return null;
    try {
      if (deps.showBusy) deps.showBusy(persistMode === 'local' ? 'Updating claim numbers...' : 'Saving claim numbers...');
      setBlockersPanel([]);
      if (persistMode === 'local') {
        renderClaimList();
        const chosen = String(preferredClaimId || context.selectAfterSave || '').trim()
          || String(claimNumbers.find((row) => row.isPrimary)?.id || claimNumbers[0]?.id || '').trim();
        if (typeof context.onSaved === 'function') {
          await context.onSaved(claimNumbers, chosen);
        }
        return chosen;
      }
      const result = await putClaimNumbers();
      if (!result) return null;
      claimNumbers = Array.isArray(result.data?.claimNumbers) ? result.data.claimNumbers : claimNumbers;
      renderClaimList();
      const chosen = String(preferredClaimId || context.selectAfterSave || '').trim()
        || String(claimNumbers.find((row) => row.isPrimary)?.id || claimNumbers[0]?.id || '').trim();
      if (typeof context.onSaved === 'function') {
        await context.onSaved(claimNumbers, chosen);
      }
      return chosen;
    } catch (error) {
      if (Array.isArray(error.blockers) && error.blockers.length) {
        setBlockersPanel(error.blockers);
        setRollingClaimAlert(error.message || 'Unable to save claim numbers.');
      } else if (deps.showMsg) {
        await deps.showMsg('Claim Numbers', 'error', error.message || 'Unable to save claim numbers.');
      }
      return null;
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  async function applyEditor() {
    const number = String(qs('rollingClaim_number')?.value || '').trim();
    if (!number) {
      setRollingClaimAlert('Claim number is required.');
      return;
    }
    setRollingClaimAlert('');
    const label = String(qs('rollingClaim_label')?.value || '').trim();
    const notes = String(qs('rollingClaim_notes')?.value || '').trim();
    const isPrimary = qs('rollingClaim_isPrimary')?.checked === true;
    const entry = {
      id: editingId || `claim_${Date.now()}`,
      number,
      label,
      notes,
      isPrimary
    };
    if (editingId) {
      claimNumbers = claimNumbers.map((row) => (
        String(row.id) === String(editingId) ? { ...row, ...entry } : row
      ));
    } else {
      claimNumbers.push(entry);
    }
    if (isPrimary) {
      claimNumbers = claimNumbers.map((row) => ({
        ...row,
        isPrimary: String(row.id) === String(entry.id)
      }));
    }
    hideEditor();
    renderClaimList();
    await saveClaimNumbers(String(entry.id));
  }

  function wireEventsOnce() {
    if (wired) return;
    wired = true;
    qs('btn_rollingClaimAdd')?.addEventListener('click', () => showEditor(null));
    qs('btn_rollingClaimCancelEditor')?.addEventListener('click', hideEditor);
    qs('btn_rollingClaimApplyEditor')?.addEventListener('click', () => { applyEditor(); });
    qs('rollingClaim_tbody')?.addEventListener('click', async (event) => {
      const editBtn = event.target.closest('.btn-rolling-claim-edit');
      const deleteBtn = event.target.closest('.btn-rolling-claim-delete');
      if (editBtn) {
        const id = String(editBtn.dataset.claimId || '').trim();
        const entry = claimNumbers.find((row) => String(row.id) === id);
        if (entry) showEditor(entry);
        return;
      }
      if (deleteBtn) {
        const id = String(deleteBtn.dataset.claimId || '').trim();
        const entry = claimNumbers.find((row) => String(row.id) === id);
        const label = String(entry?.number || 'this claim number').trim();
        let confirmed = true;
        if (deps.showConfirm) {
          confirmed = await deps.showConfirm(`Remove claim number "${label}"?`, 'Remove Claim Number', { confirmClass: 'btn-danger' });
        }
        if (!confirmed) return;
        claimNumbers = claimNumbers.filter((row) => String(row.id) !== id);
        if (claimNumbers.length && !claimNumbers.some((row) => row.isPrimary)) {
          claimNumbers[0].isPrimary = true;
        }
        hideEditor();
        renderClaimList();
        await saveClaimNumbers();
      }
    });
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentClaimNumbersModal');
    modalEl?.addEventListener('hidden.bs.modal', () => {
      claimNumbers = [];
      editingId = '';
      context = { studentId: '', studentLabel: '', onSaved: null, selectAfterSave: '' };
      hideEditor();
      setRollingClaimAlert('');
      setBlockersPanel([]);
      if (deps.clearModalStack) deps.clearModalStack(modalEl);
    });
    modalEl?.addEventListener('shown.bs.modal', () => {
      if (deps.raiseModal) deps.raiseModal(modalEl);
    });
  }

  async function open(options = {}) {
    wireEventsOnce();
    const persistMode = String(options.persistMode || 'api').trim().toLowerCase() === 'local' ? 'local' : 'api';
    const studentId = String(options.studentId || '').trim();
    if (persistMode === 'api' && !studentId) return;
    if (!deps.canEdit) {
      if (deps.showMsg) await deps.showMsg('Permission', 'warning', 'You do not have permission to manage claim numbers.');
      return;
    }
    const studentLabel = String(options.studentLabel || studentId || 'New student').trim();
    context = {
      studentId,
      studentLabel,
      persistMode,
      onSaved: typeof options.onSaved === 'function' ? options.onSaved : null,
      selectAfterSave: String(options.selectAfterSave || '').trim()
    };
    claimNumbers = [];
    editingId = '';
    hideEditor();
    setRollingClaimAlert('');
    setBlockersPanel([]);
    if (qs('rollingClaim_studentLabel')) qs('rollingClaim_studentLabel').value = studentLabel;
    if (qs('rollingClaim_studentId')) {
      qs('rollingClaim_studentId').value = persistMode === 'local'
        ? 'New student (unsaved)'
        : studentId;
    }
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentClaimNumbersModal');
    try {
      if (deps.showBusy) deps.showBusy(persistMode === 'local' ? 'Preparing claim numbers...' : 'Loading claim numbers...');
      if (persistMode === 'local') {
        claimNumbers = Array.isArray(options.claimNumbers) ? options.claimNumbers.slice() : [];
      } else {
        const rows = await fetchStudentClaimNumbers(studentId);
        claimNumbers = rows;
      }
      renderClaimList();
      if (deps.mountModal) deps.mountModal(modalEl);
      if (typeof deps.showModal === 'function') {
        deps.showModal();
      } else if (!modalController && deps.createModalController && modalEl) {
        modalController = deps.createModalController(modalEl);
      }
      if (!deps.showModal) modalController?.show?.();
      if (options.openEditorOnShow) showEditor(null);
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('Claim Numbers', 'error', error.message || 'Unable to load claim numbers.');
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  async function handleClaimNumberSelectChange(selectElOrId, studentId, studentLabel) {
    const selectEl = typeof selectElOrId === 'string' ? qs(selectElOrId) : selectElOrId;
    if (!selectEl) return;
    const value = String(selectEl.value || '').trim();
    if (value !== CLAIM_NUMBER_ADD_NEW) {
      selectEl.dataset.previousValue = value;
      return;
    }
    const previous = String(selectEl.dataset.previousValue || '').trim();
    selectEl.value = previous;
    const sid = String(studentId || '').trim();
    if (!sid) {
      if (deps.showMsg) await deps.showMsg('Claim Number', 'warning', 'Select a student first.');
      return;
    }
    await open({
      studentId: sid,
      studentLabel,
      openEditorOnShow: true,
      onSaved: async (_rows, preferredId) => {
        await refreshClaimNumberSelect(selectEl, sid, preferredId || previous);
      }
    });
  }

  function applyDefaultMessaging() {
    const ui = global.SchoolMessageUi;
    if (!ui || typeof ui.createClaimManagerMessaging !== 'function') return;
    const built = ui.createClaimManagerMessaging();
    if (!deps.showMsg) deps.showMsg = built.showMsg;
    if (!deps.showConfirm) deps.showConfirm = built.showConfirm;
  }

  function configure(nextDeps = {}) {
    deps = { ...deps, ...nextDeps };
    applyDefaultMessaging();
    wireEventsOnce();
  }

  function renderSummaryTable(containerEl, rows = []) {
    const el = typeof containerEl === 'string' ? qs(containerEl) : containerEl;
    if (!el) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      el.innerHTML = '<p class="text-muted small mb-0">No claim numbers on file.</p>';
      return;
    }
    const body = list.map((entry) => {
      const number = htmlEscape(String(entry?.number || '').trim());
      const label = String(entry?.label || '').trim();
      const primary = entry?.isPrimary ? '<span class="badge text-bg-primary-subtle text-primary-emphasis border ms-1">Primary</span>' : '';
      return `<tr><td class="font-monospace">${number}${primary}</td><td>${label ? htmlEscape(label) : '<span class="text-muted">—</span>'}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0"><thead class="table-light"><tr><th>Claim Number</th><th>Label</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  global.StudentClaimNumbersManager = {
    CLAIM_NUMBER_ADD_NEW,
    configure,
    open,
    saveClaimNumbers,
    populateClaimNumberSelectOptions,
    refreshClaimNumberSelect,
    readClaimNumberSelectValue,
    handleClaimNumberSelectChange,
    renderSummaryTable,
    fetchStudentClaimNumbers
  };
})(typeof window !== 'undefined' ? window : global);
