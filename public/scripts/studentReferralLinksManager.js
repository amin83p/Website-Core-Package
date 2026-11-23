(function (global) {
  'use strict';

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
    createModalController: null
  };

  let referralLinks = [];
  let pickerOptions = { referrals: [], programs: [], referringOrganizations: [] };
  let selectedReferralOption = null;
  let editingId = '';
  let context = { studentId: '', studentLabel: '', onSaved: null, persistMode: 'api' };
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

  function findReferralOption(referralId) {
    const id = String(referralId || '').trim();
    return (Array.isArray(pickerOptions.referrals) ? pickerOptions.referrals : [])
      .find((row) => String(row?.id || '').trim() === id) || null;
  }

  function findProgramLabel(programId) {
    const id = String(programId || '').trim();
    const row = (Array.isArray(pickerOptions.programs) ? pickerOptions.programs : [])
      .find((p) => String(p?.id || '').trim() === id);
    return row ? String(row.label || id).trim() : id;
  }

  function resolveRowDisplay(entry) {
    const referralLabel = String(entry?.referralLabel || '').trim()
      || (findReferralOption(entry?.referralId)?.label || entry?.referralId || '—');
    const organizationLabel = String(entry?.organizationLabel || '').trim()
      || entry?.organizationId || '—';
    const programLabel = String(entry?.programLabel || '').trim()
      || findProgramLabel(entry?.programId);
  return {
      referralLabel,
      organizationLabel,
      programLabel,
      linkDate: String(entry?.linkDate || '').trim(),
      comment: String(entry?.comment || '').trim()
    };
  }

  function setRollingRefLinkAlert(text) {
    const alertEl = qs('rollingRefLink_alert');
    if (!alertEl) return;
    if (!text) {
      alertEl.textContent = '';
      alertEl.classList.add('d-none');
      return;
    }
    alertEl.textContent = text;
    alertEl.classList.remove('d-none');
  }

  function mapReferralFromPickerItem(item) {
    const id = String(item?.id || '').trim();
    if (!id) return null;
    if (item.organizationOptions && item.label) {
      return {
        id,
        label: String(item.label).trim(),
        organizationIds: Array.isArray(item.organizationIds) ? item.organizationIds.map(String) : [],
        organizationOptions: item.organizationOptions
      };
    }
    const first = String(item?.firstName || item?.name?.first || '').trim();
    const last = String(item?.lastName || item?.name?.last || '').trim();
    const label = `${first} ${last}`.trim() || String(item?.displayName || id).trim();
    const orgIds = Array.isArray(item?.organizationIds)
      ? item.organizationIds.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    const orgCatalog = Array.isArray(pickerOptions.referringOrganizations) ? pickerOptions.referringOrganizations : [];
    const orgOptionById = new Map(orgCatalog.map((row) => [String(row.id), row]));
    const organizationOptions = orgIds.map((oid) => orgOptionById.get(oid) || { id: oid, label: oid });
    return { id, label, organizationIds: orgIds, organizationOptions };
  }

  function upsertReferralOption(opt) {
    if (!opt || !opt.id) return;
    const list = Array.isArray(pickerOptions.referrals) ? pickerOptions.referrals : [];
    const idx = list.findIndex((row) => String(row?.id) === String(opt.id));
    if (idx >= 0) list[idx] = { ...list[idx], ...opt };
    else list.push(opt);
    pickerOptions.referrals = list;
  }

  function setSelectedReferral(opt) {
    selectedReferralOption = opt && opt.id ? opt : null;
    if (qs('rollingRefLink_referralId')) qs('rollingRefLink_referralId').value = selectedReferralOption?.id || '';
    if (qs('rollingRefLink_referralLabel')) qs('rollingRefLink_referralLabel').value = selectedReferralOption?.label || '';
  }

  function renderProgramSelect(selectedProgramId = '') {
    const select = qs('rollingRefLink_programId');
    if (!select) return;
    const programs = Array.isArray(pickerOptions.programs) ? pickerOptions.programs : [];
    const selected = String(selectedProgramId || '').trim();
    const opts = ['<option value="">— Select —</option>'];
    programs.forEach((row) => {
      const id = String(row?.id || '').trim();
      if (!id) return;
      opts.push(`<option value="${htmlEscape(id)}"${selected === id ? ' selected' : ''}>${htmlEscape(String(row.label || id))}</option>`);
    });
    select.innerHTML = opts.join('');
    if (selected && !programs.some((row) => String(row?.id || '').trim() === selected)) {
      const label = findProgramLabel(selected) || selected;
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${htmlEscape(selected)}" selected>${htmlEscape(label)}</option>`
      );
    }
    if (selected) select.value = selected;
  }

  function setSelectedProgram(programId) {
    renderProgramSelect(programId);
  }

  function openReferralPicker() {
    if (!global.GenericPicker || !global.GenericPickerPresets) {
      if (deps.showMsg) void deps.showMsg('Picker', 'warning', 'Referral picker is not available on this page.');
      return;
    }
    global.GenericPicker.open(global.GenericPickerPresets.referral({
      title: 'Select Referral Contact',
      onSelect: (item) => {
        const opt = mapReferralFromPickerItem(item);
        if (!opt) return;
        upsertReferralOption(opt);
        setSelectedReferral(opt);
        syncOrganizationFieldForReferral(opt.id, '');
      }
    }));
  }

  function openQuickCreateReferral() {
    if (!global.SchoolReferralQuickCreate) {
      if (deps.showMsg) void deps.showMsg('Referrals', 'warning', 'Quick create is not available on this page.');
      return;
    }
    global.SchoolReferralQuickCreate.open({
      onCreated: async (referral) => {
        const opt = mapReferralFromPickerItem(referral);
        if (!opt) return;
        upsertReferralOption(opt);
        setSelectedReferral(opt);
        syncOrganizationFieldForReferral(opt.id, '');
      }
    });
  }

  function syncOrganizationFieldForReferral(referralId, selectedOrgId) {
    const orgCol = qs('rollingRefLink_orgCol');
    const orgSelect = qs('rollingRefLink_organizationId');
    if (!orgCol || !orgSelect) return { orgRequired: false, orgCount: 0 };
    const refOpt = findReferralOption(referralId);
    const orgOptions = refOpt && Array.isArray(refOpt.organizationOptions) ? refOpt.organizationOptions : [];
    const orgCount = orgOptions.length;
    if (!referralId || orgCount === 0) {
      orgCol.classList.add('d-none');
      orgSelect.innerHTML = '<option value="">—</option>';
      orgSelect.value = '';
      return { orgRequired: false, orgCount: 0 };
    }
    if (orgCount === 1) {
      orgCol.classList.add('d-none');
      orgSelect.innerHTML = `<option value="${htmlEscape(orgOptions[0].id)}" selected>${htmlEscape(orgOptions[0].label)}</option>`;
      orgSelect.value = String(orgOptions[0].id);
      return { orgRequired: false, orgCount: 1 };
    }
    orgCol.classList.remove('d-none');
    const selected = String(selectedOrgId || '').trim();
    const opts = ['<option value="">— Select —</option>'];
    orgOptions.forEach((row) => {
      const id = String(row?.id || '').trim();
      opts.push(`<option value="${htmlEscape(id)}"${selected === id ? ' selected' : ''}>${htmlEscape(String(row.label || id))}</option>`);
    });
    orgSelect.innerHTML = opts.join('');
    return { orgRequired: true, orgCount };
  }

  function hideEditor() {
    editingId = '';
    qs('rollingRefLink_editorPanel')?.classList.add('d-none');
    setRollingRefLinkAlert('');
  }

  function showEditor(entry = null) {
    const panel = qs('rollingRefLink_editorPanel');
    if (!panel) return;
    editingId = String(entry?.id || '').trim();
    const titleEl = qs('rollingRefLink_editorTitle');
    if (titleEl) titleEl.textContent = editingId ? 'Edit Referral Link' : 'New Referral Link';
    const referralId = String(entry?.referralId || '').trim();
    const refOpt = findReferralOption(referralId) || (entry?.referralId ? {
      id: referralId,
      label: entry.referralLabel || referralId,
      organizationIds: entry.organizationId ? [entry.organizationId] : [],
      organizationOptions: entry.organizationId
        ? [{ id: entry.organizationId, label: entry.organizationLabel || entry.organizationId }]
        : []
    } : null);
    if (refOpt) upsertReferralOption(refOpt);
    setSelectedReferral(refOpt);
    syncOrganizationFieldForReferral(referralId, entry?.organizationId);
    if (qs('rollingRefLink_linkDate')) qs('rollingRefLink_linkDate').value = String(entry?.linkDate || '').trim();
    setSelectedProgram(entry?.programId);
    if (qs('rollingRefLink_comment')) qs('rollingRefLink_comment').value = String(entry?.comment || '').trim();
    panel.classList.remove('d-none');
    qs('btn_rollingRefLinkPickReferral')?.focus();
  }

  function renderReferralLinkList() {
    const emptyEl = qs('rollingRefLink_empty');
    const wrapEl = qs('rollingRefLink_listWrap');
    const tbody = qs('rollingRefLink_tbody');
    if (!tbody || !emptyEl || !wrapEl) return;
    if (!referralLinks.length) {
      emptyEl.classList.remove('d-none');
      wrapEl.classList.add('d-none');
      tbody.innerHTML = '';
      return;
    }
    emptyEl.classList.add('d-none');
    wrapEl.classList.remove('d-none');
    tbody.innerHTML = referralLinks.map((entry) => {
      const id = String(entry?.id || '').trim();
      const display = resolveRowDisplay(entry);
      const commentHint = display.comment
        ? `<span class="d-block small text-muted text-truncate" style="max-width: 12rem;" title="${htmlEscape(display.comment)}">${htmlEscape(display.comment)}</span>`
        : '';
      return `
        <tr data-reflink-id="${htmlEscape(id)}">
          <td>
            <div class="fw-semibold">${htmlEscape(display.referralLabel)}</div>
            ${commentHint}
          </td>
          <td>${htmlEscape(display.organizationLabel)}</td>
          <td class="text-nowrap">${htmlEscape(display.linkDate || '—')}</td>
          <td>${htmlEscape(display.programLabel)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-secondary btn-rolling-reflink-edit" data-reflink-id="${htmlEscape(id)}" title="Edit"><i class="bi bi-pencil"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-rolling-reflink-delete" data-reflink-id="${htmlEscape(id)}" title="Delete"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadPickerOptions() {
    if (!deps.requestJson) return;
    const result = await deps.requestJson('/school/students/api/referral-link-options');
    pickerOptions = result?.data && typeof result.data === 'object'
      ? result.data
      : { referrals: [], programs: [] };
    if (!Array.isArray(pickerOptions.referrals)) pickerOptions.referrals = [];
    if (!Array.isArray(pickerOptions.programs)) pickerOptions.programs = [];
    if (!Array.isArray(pickerOptions.referringOrganizations)) pickerOptions.referringOrganizations = [];
    renderProgramSelect(qs('rollingRefLink_programId')?.value);
  }

  async function fetchStudentReferralLinks(studentId) {
    const sid = String(studentId || '').trim();
    if (!sid || !deps.requestJson) return [];
    const result = await deps.requestJson(`/school/students/api/${encodeURIComponent(sid)}/referral-links`);
    return Array.isArray(result?.data?.referralLinks) ? result.data.referralLinks : [];
  }

  async function putReferralLinks() {
    const studentId = String(context.studentId || '').trim();
    if (!studentId) return null;
    const url = `/school/students/api/${encodeURIComponent(studentId)}/referral-links`;
    if (deps.requestJson) {
      return deps.requestJson(url, 'PUT', { referralLinks });
    }
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-AJAX-Request': 'true' },
      body: JSON.stringify({ referralLinks })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || String(result.status || '').toLowerCase() === 'error') {
      throw new Error(result?.message || 'Unable to save referral links.');
    }
    return result;
  }

  async function saveReferralLinks() {
    const persistMode = String(context.persistMode || 'api').trim().toLowerCase() === 'local' ? 'local' : 'api';
    const studentId = String(context.studentId || '').trim();
    if (persistMode === 'api' && !studentId) return null;
    try {
      if (deps.showBusy) {
        deps.showBusy(persistMode === 'local' ? 'Updating referral links...' : 'Saving referral links...');
      }
      if (persistMode === 'local') {
        renderReferralLinkList();
        if (typeof context.onSaved === 'function') {
          await context.onSaved(referralLinks);
        }
        return true;
      }
      const result = await putReferralLinks();
      if (!result) return null;
      referralLinks = Array.isArray(result.data?.referralLinks) ? result.data.referralLinks : referralLinks;
      renderReferralLinkList();
      if (typeof context.onSaved === 'function') {
        await context.onSaved(referralLinks);
      }
      return true;
    } catch (error) {
      if (deps.showMsg) {
        await deps.showMsg('Referrals', 'error', error.message || 'Unable to save referral links.');
      }
      return null;
    } finally {
      if (deps.hideBusy) deps.hideBusy();
    }
  }

  async function applyEditor() {
    const referralId = String(qs('rollingRefLink_referralId')?.value || selectedReferralOption?.id || '').trim();
    const linkDate = String(qs('rollingRefLink_linkDate')?.value || '').trim();
    const programId = String(qs('rollingRefLink_programId')?.value || '').trim();
    const comment = String(qs('rollingRefLink_comment')?.value || '').trim();
    if (!referralId) {
      setRollingRefLinkAlert('Select a referral contact.');
      return;
    }
    const refOpt = findReferralOption(referralId);
    const orgMeta = syncOrganizationFieldForReferral(referralId, qs('rollingRefLink_organizationId')?.value);
    if (!refOpt || orgMeta.orgCount === 0) {
      setRollingRefLinkAlert('This referral has no organizations; update the referral contact first.');
      return;
    }
  let organizationId = String(qs('rollingRefLink_organizationId')?.value || '').trim();
    if (orgMeta.orgCount === 1) {
      organizationId = String(refOpt.organizationOptions[0]?.id || '').trim();
    } else if (!organizationId) {
      setRollingRefLinkAlert('Select an organization for this referral.');
      return;
    }
    if (!linkDate) {
      setRollingRefLinkAlert('Date is required.');
      return;
    }
    if (!programId) {
      setRollingRefLinkAlert('Select a program.');
      return;
    }
    setRollingRefLinkAlert('');
    const display = {
      referralLabel: refOpt.label,
      organizationLabel: (refOpt.organizationOptions || []).find((o) => String(o.id) === organizationId)?.label || organizationId,
      programLabel: findProgramLabel(programId)
    };
    const entry = {
      id: editingId || `reflink_${Date.now()}`,
      referralId,
      organizationId,
      linkDate,
      programId,
      comment,
      ...display
    };
    if (editingId) {
      referralLinks = referralLinks.map((row) => (
        String(row.id) === String(editingId) ? { ...row, ...entry } : row
      ));
    } else {
      referralLinks.push(entry);
    }
    hideEditor();
    renderReferralLinkList();
    await saveReferralLinks();
  }

  function wireEventsOnce() {
    if (wired) return;
    wired = true;
    qs('btn_rollingRefLinkAdd')?.addEventListener('click', () => showEditor(null));
    qs('btn_rollingRefLinkCancelEditor')?.addEventListener('click', hideEditor);
    qs('btn_rollingRefLinkApplyEditor')?.addEventListener('click', () => { applyEditor(); });
    qs('btn_rollingRefLinkPickReferral')?.addEventListener('click', openReferralPicker);
    qs('btn_rollingRefLinkAddReferral')?.addEventListener('click', openQuickCreateReferral);
    qs('rollingRefLink_tbody')?.addEventListener('click', async (event) => {
      const editBtn = event.target.closest('.btn-rolling-reflink-edit');
      const deleteBtn = event.target.closest('.btn-rolling-reflink-delete');
      if (editBtn) {
        const id = String(editBtn.dataset.reflinkId || '').trim();
        const entry = referralLinks.find((row) => String(row.id) === id);
        if (entry) showEditor(entry);
        return;
      }
      if (deleteBtn) {
        const id = String(deleteBtn.dataset.reflinkId || '').trim();
        const entry = referralLinks.find((row) => String(row.id) === id);
        const label = resolveRowDisplay(entry).referralLabel || 'this link';
        let confirmed = true;
        if (deps.showConfirm) {
          confirmed = await deps.showConfirm(`Remove referral link for "${label}"?`, 'Remove Referral Link', { confirmClass: 'btn-danger' });
        }
        if (!confirmed) return;
        referralLinks = referralLinks.filter((row) => String(row.id) !== id);
        hideEditor();
        renderReferralLinkList();
        await saveReferralLinks();
      }
    });
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentReferralLinksModal');
    modalEl?.addEventListener('hidden.bs.modal', () => {
      referralLinks = [];
      editingId = '';
      context = { studentId: '', studentLabel: '', onSaved: null, persistMode: 'api' };
      hideEditor();
      setRollingRefLinkAlert('');
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
      if (deps.showMsg) await deps.showMsg('Permission', 'warning', 'You do not have permission to manage referrals.');
      return;
    }
    const studentLabel = String(options.studentLabel || studentId || 'New student').trim();
    context = {
      studentId,
      studentLabel,
      persistMode,
      onSaved: typeof options.onSaved === 'function' ? options.onSaved : null
    };
    referralLinks = [];
    editingId = '';
    hideEditor();
    setRollingRefLinkAlert('');
    if (qs('rollingRefLink_studentLabel')) qs('rollingRefLink_studentLabel').value = studentLabel;
    if (qs('rollingRefLink_studentId')) {
      qs('rollingRefLink_studentId').value = persistMode === 'local'
        ? 'New student (unsaved)'
        : studentId;
    }
    const modalEl = typeof deps.getModalEl === 'function' ? deps.getModalEl() : qs('rollingStudentReferralLinksModal');
    try {
      if (deps.showBusy) {
        deps.showBusy(persistMode === 'local' ? 'Preparing referrals...' : 'Loading referrals...');
      }
      await loadPickerOptions();
      if (persistMode === 'local') {
        referralLinks = Array.isArray(options.referralLinks) ? options.referralLinks.slice() : [];
      } else {
        referralLinks = await fetchStudentReferralLinks(studentId);
      }
      renderReferralLinkList();
      if (deps.mountModal) deps.mountModal(modalEl);
      if (typeof deps.showModal === 'function') {
        deps.showModal();
      } else if (!modalController && deps.createModalController && modalEl) {
        modalController = deps.createModalController(modalEl);
      }
      if (!deps.showModal) modalController?.show?.();
      if (options.openEditorOnShow) showEditor(null);
    } catch (error) {
      if (deps.showMsg) await deps.showMsg('Referrals', 'error', error.message || 'Unable to load referral links.');
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

  function configure(nextDeps = {}) {
    deps = { ...deps, ...nextDeps };
    applyDefaultMessaging();
    wireEventsOnce();
    if (global.SchoolReferralQuickCreate) {
      const quickReferralEl = qs('referralQuickCreateModal');
      global.SchoolReferralQuickCreate.configure({
        requestJson: deps.requestJson,
        showMsg: deps.showMsg,
        mountModal: deps.mountModal,
        getModalEl: () => quickReferralEl
      });
    }
  }

  function renderSummaryTable(containerEl, rows = []) {
    const el = typeof containerEl === 'string' ? qs(containerEl) : containerEl;
    if (!el) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      el.innerHTML = '<p class="text-muted small mb-0">No referral links on file.</p>';
      return;
    }
    const body = list.map((entry) => {
      const display = resolveRowDisplay(entry);
      return `<tr>
        <td>${htmlEscape(display.referralLabel)}</td>
        <td>${htmlEscape(display.organizationLabel)}</td>
        <td class="text-nowrap">${htmlEscape(display.linkDate || '—')}</td>
        <td>${htmlEscape(display.programLabel)}</td>
        <td>${display.comment ? htmlEscape(display.comment) : '<span class="text-muted">—</span>'}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0"><thead class="table-light"><tr><th>Referral</th><th>Organization</th><th>Date</th><th>Program</th><th>Comment</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  global.StudentReferralLinksManager = {
    configure,
    open,
    saveReferralLinks,
    renderSummaryTable,
    fetchStudentReferralLinks
  };
})(typeof window !== 'undefined' ? window : global);