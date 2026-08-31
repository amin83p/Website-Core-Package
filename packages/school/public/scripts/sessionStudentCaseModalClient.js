(function initSessionStudentCaseModal(global) {
  'use strict';

  let config = null;
  let modalInstance = null;
  let roster = [];
  let selectedPersonIds = new Set();
  let readOnly = false;
  let allowCreate = false;
  let canUpdate = false;
  let canEditCase = false;
  let canDelete = false;
  let canResolve = false;
  let showResolveButton = true;
  let canViewResultNote = false;
  let resolveMode = false;
  let classTitle = '';
  let sessionLabel = '';
  let classId = '';
  let sessionId = '';
  let manageSessionHref = '';
  let busyToken = null;
  let wired = false;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function getPresetConfig() {
    return config?.detailPresets || global.__studentCaseDetailPresets || { labels: {}, presets: {} };
  }

  function showMessage(title, message, icon = 'info') {
    if (typeof config?.messageBox === 'function') {
      return config.messageBox({ title, message, icon });
    }
    if (typeof global.showMessageModal === 'function') {
      return global.showMessageModal({
        title: title || 'Student Case',
        message: message || '',
        icon,
        buttons: [{ text: 'OK', class: icon === 'error' ? 'btn-danger' : 'btn-primary' }]
      });
    }
    global.alert(message || title || 'Student Case');
    return Promise.resolve();
  }

  function confirmDelete(studentName) {
    const html = `<p class="mb-0">Permanently delete the student case for <strong>${escapeHtml(studentName || 'this case')}</strong>? This action cannot be undone.</p>`;
    if (typeof config?.confirmBox === 'function') {
      return config.confirmBox({
        title: 'Delete Student Case',
        icon: 'warning',
        html: true,
        message: html,
        confirmText: 'Delete',
        confirmClass: 'btn-danger'
      });
    }
    if (typeof global.showMessageModal === 'function') {
      return global.showMessageModal({
        title: 'Delete Student Case',
        icon: 'warning',
        html: true,
        message: html,
        buttons: [
          { text: 'Cancel', class: 'btn-secondary', value: false },
          { text: 'Delete', class: 'btn-danger', value: true }
        ]
      });
    }
    return Promise.resolve(global.confirm('Delete this student case?'));
  }

  function showBusy(title, message) {
    if (typeof config?.showLoading === 'function') {
      busyToken = config.showLoading({ title, note: message });
      return;
    }
    if (typeof global.showLoading === 'function') {
      busyToken = global.showLoading({ title: title || 'Student Case', note: message || 'Please wait...', operation: 'Student Case' });
    }
  }

  function hideBusy() {
    if (typeof config?.hideLoading === 'function') {
      if (busyToken) config.hideLoading(busyToken);
      else config.hideLoading({ force: true });
    } else if (typeof global.hideLoading === 'function') {
      if (busyToken) global.hideLoading(busyToken);
      else global.hideLoading({ force: true });
    }
    busyToken = null;
  }

  function getModalEl() {
    return document.getElementById('studentCaseModal');
  }

  function mountModalToBody() {
    const modalEl = getModalEl();
    if (!modalEl || modalEl.parentElement === document.body) return modalEl;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function syncStudentCaseModalStack() {
    const modalEl = getModalEl();
    if (!modalEl) return;
    let maxZ = 1050;
    document.querySelectorAll('.modal.show').forEach((openModal) => {
      if (openModal === modalEl) return;
      const z = Number.parseInt(window.getComputedStyle(openModal).zIndex, 10);
      if (Number.isFinite(z) && z > maxZ) maxZ = z;
    });
    const loadingEl = document.getElementById('globalLoadingModal');
    if (loadingEl?.classList.contains('is-visible')) {
      const loadingZ = Number.parseInt(window.getComputedStyle(loadingEl).zIndex, 10);
      if (Number.isFinite(loadingZ) && loadingZ > maxZ) maxZ = loadingZ;
    }
    const modalZ = Math.max(maxZ + 10, 1055);
    modalEl.style.setProperty('z-index', String(modalZ), 'important');
    const backdrops = document.querySelectorAll('.modal-backdrop.show');
    const backdrop = backdrops[backdrops.length - 1];
    if (backdrop) backdrop.style.setProperty('z-index', String(modalZ - 5), 'important');
  }

  function clearStudentCaseModalStack() {
    const modalEl = getModalEl();
    modalEl?.style.removeProperty('z-index');
    document.querySelectorAll('.modal-backdrop.show').forEach((backdrop) => {
      backdrop.style.removeProperty('z-index');
    });
  }

  function ensureModalInstance() {
    const modalEl = mountModalToBody();
    if (!modalEl || !global.bootstrap) return null;
    if (!modalInstance) modalInstance = new global.bootstrap.Modal(modalEl);
    return modalInstance;
  }

  function categoryRequiresStudent(category) {
    const key = String(category || 'learning').trim().toLowerCase();
    const optional = getPresetConfig().studentOptionalCategories;
    if (Array.isArray(optional)) return !optional.includes(key);
    return ['learning', 'engagement', 'behavior', 'support'].includes(key);
  }

  function presetList(category) {
    const key = String(category || 'learning').trim().toLowerCase();
    const presets = getPresetConfig().presets?.[key];
    return Array.isArray(presets) ? presets : [];
  }

  function getSelectedSeverity() {
    const checked = document.querySelector('input[name="studentCaseSeverity"]:checked');
    return checked?.value || 'info';
  }

  function setSelectedSeverity(value) {
    const token = String(value || 'info').trim().toLowerCase();
    const input = document.querySelector(`input[name="studentCaseSeverity"][value="${token}"]`);
    if (input) input.checked = true;
  }

  function isEditMode() {
    return Boolean(String(document.getElementById('studentCaseId')?.value || '').trim());
  }

  function isStudentStepVisible() {
    return !document.getElementById('studentCaseStepStudents')?.classList.contains('d-none');
  }

  function getRosterRows() {
    return (Array.isArray(roster) ? roster : []).filter((row) => String(row?.personId || '').trim());
  }

  function studentInitials(name = '') {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }

  function getSelectedPersonIds() {
    return [...selectedPersonIds].map((id) => String(id || '').trim()).filter(Boolean);
  }

  function syncResultSection() {
    const section = document.getElementById('studentCaseResultSection');
    const editable = document.getElementById('studentCaseResultEditable');
    const readOnly = document.getElementById('studentCaseResultReadOnly');
    const showSection = canResolve || canViewResultNote;
    section?.classList.toggle('d-none', !showSection);
    editable?.classList.toggle('d-none', !canResolve);
    readOnly?.classList.toggle('d-none', canResolve || !canViewResultNote);
  }

  function setResultFields(row = {}) {
    const noteInput = document.getElementById('studentCaseResultNote');
    const revealInput = document.getElementById('studentCaseRevealResultToCreator');
    const lockedInput = document.getElementById('studentCaseLocked');
    const readOnlyText = document.getElementById('studentCaseResultReadOnlyText');
    const note = String(row.resultNote || '').trim();
    if (noteInput) noteInput.value = note;
    if (revealInput) revealInput.checked = row.revealResultToCreator === true;
    if (lockedInput) lockedInput.checked = row.locked === true;
    if (readOnlyText) {
      const lockedLabel = row.locked === true ? ' Locked.' : '';
      readOnlyText.textContent = `${note || '-'}${lockedLabel}`;
    }
    syncResultSection();
  }

  function clearResultFields() {
    const noteInput = document.getElementById('studentCaseResultNote');
    const revealInput = document.getElementById('studentCaseRevealResultToCreator');
    const lockedInput = document.getElementById('studentCaseLocked');
    const readOnlyText = document.getElementById('studentCaseResultReadOnlyText');
    if (noteInput) noteInput.value = '';
    if (revealInput) revealInput.checked = false;
    if (lockedInput) lockedInput.checked = false;
    if (readOnlyText) readOnlyText.textContent = '';
    syncResultSection();
  }

  function collectResultPayload(payload = {}) {
    if (!canResolve) return payload;
    payload.resultNote = document.getElementById('studentCaseResultNote')?.value || '';
    payload.revealResultToCreator = document.getElementById('studentCaseRevealResultToCreator')?.checked === true;
    payload.locked = document.getElementById('studentCaseLocked')?.checked === true;
    return payload;
  }

  function collectDetailsValue() {
    return document.getElementById('studentCaseDetails')?.value || '';
  }

  function renderDetailOptions(category, selectedDetails = '') {
    const presetsWrap = document.getElementById('studentCaseDetailPresetsWrap');
    const presetsHost = document.getElementById('studentCaseDetailPresets');
    const detailsInput = document.getElementById('studentCaseDetails');
    const key = String(category || 'learning').trim().toLowerCase();
    const presets = presetList(key);
    const selected = String(selectedDetails || '').trim();
    if (detailsInput) detailsInput.value = selected;
    if (key === 'other' || !presets.length) {
      presetsWrap?.classList.add('d-none');
      if (presetsHost) presetsHost.innerHTML = '';
      return;
    }
    presetsWrap?.classList.remove('d-none');
    if (!presetsHost) return;
    const matchedPreset = presets.includes(selected);
    presetsHost.innerHTML = presets.map((label, index) => {
      const id = `studentCasePreset_${index}`;
      const checked = matchedPreset && label === selected;
      return `<div class="form-check student-case-preset-option"><input class="form-check-input student-case-preset-radio" type="radio" name="studentCasePreset" id="${id}" value="${escapeHtml(label)}"${checked ? ' checked' : ''}><label class="form-check-label" for="${id}">${escapeHtml(label)}</label></div>`;
    }).join('');
  }

  function renderStudentPicker(filterText = '') {
    const host = document.getElementById('studentCaseStudentPicker');
    if (!host) return;
    const query = String(filterText || '').trim().toLowerCase();
    const rows = getRosterRows().filter((row) => {
      if (!query) return true;
      return String(row.name || '').toLowerCase().includes(query) || String(row.personId || '').toLowerCase().includes(query);
    });
    if (!rows.length) {
      host.innerHTML = '<div class="text-muted small text-center py-3">No students match this search.</div>';
      return;
    }
    host.innerHTML = `<div class="student-case-student-grid">${rows.map((row) => {
      const personId = String(row.personId || '').trim();
      const displayName = String(row.name || personId).trim();
      const checked = selectedPersonIds.has(personId) ? ' checked' : '';
      return `<label class="student-case-student-card">
        <input type="checkbox" class="form-check-input student-case-student-checkbox" value="${escapeHtml(personId)}"${checked}${readOnly ? ' disabled' : ''}>
        <span class="student-case-student-card-body">
          <span class="student-case-student-initial" aria-hidden="true">${escapeHtml(studentInitials(displayName))}</span>
          <span class="student-case-student-name">${escapeHtml(displayName)}</span>
        </span>
      </label>`;
    }).join('')}</div>`;
  }

  function updateContextBanner(names = [], options = {}) {
    const list = (Array.isArray(names) ? names : []).map((name) => String(name || '').trim()).filter(Boolean);
    const sessionWide = options.sessionWide === true;
    let body = `Case for <strong>${escapeHtml(classTitle || 'Class')}</strong> on <strong>${escapeHtml(sessionLabel || 'Session')}</strong>.`;
    if (sessionWide) body += ' This will be saved as a <strong>session-wide</strong> case.';
    else if (list.length === 1) body += ` Student: <strong>${escapeHtml(list[0])}</strong>.`;
    else if (list.length > 1) body += ` Students: <strong>${list.length} selected</strong>.`;
    else body += ' Use <strong>Assign students</strong> to link specific learners, or save as session-wide when this case type allows it.';
    const host = document.getElementById('studentCaseContext');
    if (host) host.innerHTML = body;
  }

  function syncFooter(step = 'details') {
    const isEdit = isEditMode();
    const onStudents = step === 'students';
    const onDetails = !onStudents;
    const category = document.getElementById('studentCaseCategory')?.value || 'other';
    const studentOptional = !categoryRequiresStudent(category);
    const editable = !readOnly && canEditCase;
    document.getElementById('btnStudentCaseBack')?.classList.toggle('d-none', !onStudents || isEdit || !editable);
    document.getElementById('btnStudentCaseNext')?.classList.toggle('d-none', !onDetails || isEdit || !allowCreate || !editable);
    document.getElementById('btnSaveStudentCaseSessionWide')?.classList.toggle('d-none', !onDetails || isEdit || !studentOptional || !allowCreate || !editable);
    document.getElementById('btnResolveStudentCase')?.classList.toggle('d-none', !editable || !canResolve || !showResolveButton || (onDetails && !isEdit));
    document.getElementById('btnSaveStudentCase')?.classList.toggle('d-none', !editable || (onDetails && !isEdit && !allowCreate));
  }

  function setWizardStep(step) {
    const showStudents = step === 'students';
    document.getElementById('studentCaseStepStudents')?.classList.toggle('d-none', !showStudents);
    document.getElementById('studentCaseStepDetails')?.classList.toggle('d-none', showStudents);
    syncFooter(step);
    const modalTitle = document.getElementById('studentCaseModalTitle');
    if (modalTitle && !isEditMode()) {
      modalTitle.textContent = showStudents ? 'Assign Students' : 'Open Student Case';
    }
  }

  function applyReadOnlyState() {
    const disabled = readOnly;
    document.getElementById('studentCaseCategory')?.toggleAttribute('disabled', disabled);
    document.querySelectorAll('input[name="studentCaseSeverity"]').forEach((input) => input.toggleAttribute('disabled', disabled));
    document.getElementById('studentCaseDetails')?.toggleAttribute('disabled', disabled);
    document.getElementById('studentCaseResultNote')?.toggleAttribute('disabled', disabled || !canResolve);
    document.getElementById('studentCaseRevealResultToCreator')?.toggleAttribute('disabled', disabled || !canResolve);
    document.getElementById('studentCaseLocked')?.toggleAttribute('disabled', disabled || !canResolve);
    document.querySelectorAll('.student-case-preset-radio').forEach((input) => input.toggleAttribute('disabled', disabled));
    document.getElementById('studentCaseStudentSearch')?.toggleAttribute('disabled', disabled);
    document.getElementById('btnStudentCaseSelectAll')?.toggleAttribute('disabled', disabled);
    document.getElementById('btnStudentCaseClearAll')?.toggleAttribute('disabled', disabled);
    document.getElementById('studentCaseReadOnlyNotice')?.classList.toggle('d-none', !disabled);
    const manageLink = document.getElementById('studentCaseManageSessionLink');
    if (manageLink) {
      const showManageLink = disabled && manageSessionHref && config?.apiMode !== 'session';
      manageLink.classList.toggle('d-none', !showManageLink);
      if (manageSessionHref) manageLink.href = manageSessionHref;
    }
    syncFooter(isStudentStepVisible() ? 'students' : 'details');
  }

  function applyCapabilities(capabilities = {}) {
    canUpdate = capabilities.canUpdate === true || capabilities.canEdit === true;
    canEditCase = Object.prototype.hasOwnProperty.call(capabilities, 'canEditCase')
      ? capabilities.canEditCase === true
      : canUpdate;
    canResolve = capabilities.canResolve === true;
    canDelete = capabilities.canDelete === true;
    canViewResultNote = capabilities.canViewResultNote === true;
    allowCreate = capabilities.canCreate === true;
    readOnly = capabilities.readOnly === true
      || (!canEditCase && (capabilities.canRead === true || capabilities.canReadAll === true));
    syncResultSection();
  }

  function setResolveVisible(visible) {
    showResolveButton = visible !== false;
    syncResultSection();
    syncFooter(isStudentStepVisible() ? 'students' : 'details');
  }

  function resetModal() {
    document.getElementById('studentCaseId').value = '';
    document.getElementById('studentCasePersonId').value = '';
    document.getElementById('studentCaseClassId').value = classId || '';
    document.getElementById('studentCaseSessionId').value = sessionId || '';
    document.getElementById('studentCaseCategory').value = 'learning';
    setSelectedSeverity('info');
    document.getElementById('studentCaseDetails').value = '';
    clearResultFields();
    resolveMode = false;
    showResolveButton = true;
    document.getElementById('studentCaseStudentSearch').value = '';
    selectedPersonIds = new Set();
    renderDetailOptions('learning', '');
    setResolveVisible(true);
    renderStudentPicker('');
    setWizardStep('details');
    updateContextBanner();
    applyReadOnlyState();
  }

  function populateFromCaseRow(row = {}) {
    const pid = String(row.studentPersonId || '').trim();
    const name = String(row.studentName || pid || 'Student').trim();
    if (pid) selectedPersonIds.add(pid);
    classId = String(row.classId || classId || '').trim();
    sessionId = String(row.sessionId || sessionId || '').trim();
    classTitle = String(row.classTitle || classTitle || classId || 'Class').trim();
    const dateLabel = [row.sessionDate, row.sessionStartTime, row.sessionEndTime].filter(Boolean).join(' ');
    sessionLabel = String(dateLabel || row.sessionId || sessionLabel || 'Session').trim();
    document.getElementById('studentCaseClassId').value = classId;
    document.getElementById('studentCaseSessionId').value = sessionId;
    if (row.id) {
      document.getElementById('studentCaseId').value = row.id;
      document.getElementById('studentCasePersonId').value = pid;
      const editLabel = pid ? name : 'Session-wide';
      document.getElementById('studentCaseModalTitle').textContent = `Edit Case - ${editLabel}`;
      updateContextBanner(pid ? [name] : [], { sessionWide: !pid });
      const category = row.category || 'learning';
      document.getElementById('studentCaseCategory').value = category;
      setSelectedSeverity(row.severity || 'info');
      renderDetailOptions(category, row.details || row.summary || '');
      const status = String(row.status || '').trim().toLowerCase();
      setResolveVisible(!['resolved', 'cancelled'].includes(status));
      setResultFields(row);
      if (row.locked === true && ['resolved', 'cancelled'].includes(status) && !canResolve) {
        readOnly = true;
      }
      setWizardStep('details');
    } else {
      clearResultFields();
      document.getElementById('studentCaseModalTitle').textContent = 'Open Student Case';
      if (pid) updateContextBanner([name]);
      else updateContextBanner();
      setWizardStep('details');
    }
    applyReadOnlyState();
  }

  function buildSaveUrl(caseRowId) {
    if (config?.apiMode === 'list') {
      return caseRowId
        ? `/school/session-student-cases/${encodeURIComponent(caseRowId)}`
        : '';
    }
    const cid = classId || document.getElementById('studentCaseClassId')?.value || '';
    const sid = sessionId || document.getElementById('studentCaseSessionId')?.value || '';
    return caseRowId
      ? `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}/cases/${encodeURIComponent(caseRowId)}`
      : `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}/cases`;
  }

  function buildStatusUrl(caseRowId) {
    if (config?.apiMode === 'list') {
      return `/school/session-student-cases/${encodeURIComponent(caseRowId)}/status`;
    }
    const cid = classId || document.getElementById('studentCaseClassId')?.value || '';
    const sid = sessionId || document.getElementById('studentCaseSessionId')?.value || '';
    return `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}/cases/${encodeURIComponent(caseRowId)}/status`;
  }

  function buildDeleteUrl(caseRowId) {
    if (config?.apiMode === 'list') {
      return `/school/session-student-cases/${encodeURIComponent(caseRowId)}`;
    }
    const cid = classId || document.getElementById('studentCaseClassId')?.value || '';
    const sid = sessionId || document.getElementById('studentCaseSessionId')?.value || '';
    return `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}/cases/${encodeURIComponent(caseRowId)}`;
  }

  async function resolveRemote(caseId) {
    const token = String(caseId || '').trim();
    if (!token) return;
    showBusy('Resolving Case', 'Updating student case status...');
    try {
      const res = await fetch(buildStatusUrl(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ajax-request': 'true', Accept: 'application/json' },
        body: JSON.stringify(collectResultPayload({
          actionStateId: config?.actionStateId || '',
          status: 'resolved'
        }))
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Failed to resolve student case.');
      hideBusy();
      if (typeof config?.onSaved === 'function') config.onSaved(result.case || result);
      await showMessage('Case Resolved', result.message || 'Student case resolved.', 'success');
    } catch (error) {
      hideBusy();
      await showMessage('Resolve Failed', error.message, 'error');
      throw error;
    }
  }

  async function deleteRemote(caseId, options = {}) {
    const token = String(caseId || '').trim();
    if (!token) return;
    const studentName = String(options.studentName || '').trim();
    if (!(await confirmDelete(studentName || 'this case'))) return;
    showBusy('Deleting Case', 'Removing the student case...');
    try {
      const res = await fetch(buildDeleteUrl(token), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-ajax-request': 'true', Accept: 'application/json' },
        body: JSON.stringify({ actionStateId: config?.actionStateId || '' })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Failed to delete student case.');
      hideBusy();
      if (typeof config?.onSaved === 'function') config.onSaved(result.deleted || result);
      await showMessage('Case Deleted', result.message || 'Student case deleted.', 'success');
    } catch (error) {
      hideBusy();
      await showMessage('Delete Failed', error.message, 'error');
      throw error;
    }
  }

  function collectPayload() {
    const caseRowId = String(document.getElementById('studentCaseId').value || '').trim();
    const selectedIds = getSelectedPersonIds();
    const payload = collectResultPayload({
      actionStateId: config?.actionStateId || '',
      category: document.getElementById('studentCaseCategory').value,
      severity: getSelectedSeverity(),
      details: collectDetailsValue()
    });
    if (caseRowId) payload.studentPersonId = document.getElementById('studentCasePersonId').value;
    else if (selectedIds.length > 1) payload.studentPersonIds = selectedIds;
    else payload.studentPersonId = selectedIds[0] || '';
    return { caseRowId, payload, selectedIds };
  }

  async function saveCase(options = {}) {
    if (readOnly) return showMessage('Read Only', 'You do not have permission to edit this case.', 'warning');
    const shouldResolve = options.resolve === true;
    if (shouldResolve && !canResolve) return showMessage('Resolve Not Allowed', 'You do not have permission to resolve this case.', 'warning');
    const { caseRowId, payload, selectedIds } = collectPayload();
    if (!caseRowId && !allowCreate) return showMessage('Create Not Allowed', 'You do not have permission to create student cases.', 'warning');
    if (caseRowId && !canEditCase) return showMessage('Edit Not Allowed', 'You do not have permission to edit this case.', 'warning');
    if (shouldResolve) payload.status = 'resolved';
    if (!String(payload.details || '').trim()) {
      return showMessage('Issue Required', 'Select an issue detail before saving this case.', 'error');
    }
    const hasStudent = Boolean(caseRowId
      ? String(payload.studentPersonId || '').trim()
      : (Array.isArray(payload.studentPersonIds) ? payload.studentPersonIds.length : String(payload.studentPersonId || '').trim()));
    if (!caseRowId && categoryRequiresStudent(payload.category) && !hasStudent) {
      if (!isStudentStepVisible()) {
        showStudentStep(payload);
        return;
      }
      return showMessage('Student Required', 'Select at least one student for this case category.', 'error');
    }
    const url = buildSaveUrl(caseRowId);
    if (!url) return showMessage('Save Failed', 'Missing case context.', 'error');
    showBusy(shouldResolve ? 'Resolving Case' : (caseRowId ? 'Updating Case' : 'Saving Case'), 'Please wait...');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ajax-request': 'true', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Failed to save student case.');
      ensureModalInstance()?.hide();
      hideBusy();
      if (typeof config?.onSaved === 'function') config.onSaved(result.case || result);
      await showMessage(shouldResolve ? 'Case Resolved' : 'Case Saved', result.message || 'Student case saved.', 'success');
    } catch (error) {
      hideBusy();
      await showMessage('Save Failed', error.message, 'error');
      throw error;
    }
  }

  function showStudentStep(payload = {}) {
    const category = payload.category || document.getElementById('studentCaseCategory')?.value || 'other';
    const host = document.getElementById('studentCasePendingSummary');
    if (host) {
      const labels = getPresetConfig().labels || {};
      const categoryLabel = labels[category] || category.replace(/_/g, ' ');
      const severity = String(payload.severity || getSelectedSeverity() || 'info').trim().toUpperCase();
      const details = String(payload.details || collectDetailsValue() || '').trim();
      const preview = details.length > 180 ? `${details.slice(0, 177)}...` : details;
      host.innerHTML = `
        <div class="d-flex flex-wrap gap-2 mb-2">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${escapeHtml(categoryLabel)}</span>
          <span class="badge bg-light text-dark border">${escapeHtml(severity)}</span>
        </div>
        <div class="small text-muted mb-1">Issue details</div>
        <div>${escapeHtml(preview || '-')}</div>`;
    }
    const intro = document.getElementById('studentCaseStudentStepIntro');
    if (intro) {
      intro.textContent = categoryRequiresStudent(category)
        ? 'This case type requires at least one student. Select everyone the issue applies to, then save.'
        : 'You can assign specific students even for session-wide issues such as technology or lesson delivery. Leave everyone unselected to save as a session-wide case.';
    }
    renderStudentPicker(document.getElementById('studentCaseStudentSearch')?.value || '');
    setWizardStep('students');
    document.getElementById('studentCaseStudentSearch')?.focus();
  }

  function advanceWizard() {
    const payload = {
      category: document.getElementById('studentCaseCategory').value,
      severity: getSelectedSeverity(),
      details: collectDetailsValue()
    };
    if (!String(payload.details || '').trim()) {
      return showMessage('Issue Required', 'Enter issue details before assigning students.', 'error');
    }
    showStudentStep(payload);
  }

  async function openRemote(caseId, options = {}) {
    const token = String(caseId || '').trim();
    if (!token) return;
    resolveMode = options.resolveMode === true;
    showBusy('Loading Case', 'Fetching student case details...');
    try {
      const res = await fetch(`/school/session-student-cases/${encodeURIComponent(token)}/review-context`, {
        headers: { 'x-ajax-request': 'true', Accept: 'application/json' }
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Failed to load student case.');
      hideBusy();
      const ctx = result.context || {};
      roster = Array.isArray(ctx.roster) ? ctx.roster : [];
      classId = String(ctx.classId || '').trim();
      sessionId = String(ctx.sessionId || '').trim();
      classTitle = String(ctx.classTitle || classId || 'Class').trim();
      sessionLabel = String(ctx.sessionLabel || sessionId || 'Session').trim();
      manageSessionHref = config?.apiMode === 'session'
        ? ''
        : String(ctx.manageSessionHref || '').trim();
      applyCapabilities(ctx.capabilities || {});
      allowCreate = false;
      resetModal();
      populateFromCaseRow(ctx.case || {});
      if (resolveMode && canResolve) {
        setResolveVisible(true);
        syncFooter('details');
        document.getElementById('studentCaseResultNote')?.focus();
      }
      ensureModalInstance()?.show();
    } catch (error) {
      hideBusy();
      await showMessage('Load Failed', error.message, 'error');
    }
  }

  function open(options = {}) {
    resetModal();
    roster = Array.isArray(options.roster) ? options.roster : roster;
    if (options.classTitle) classTitle = options.classTitle;
    if (options.sessionLabel) sessionLabel = options.sessionLabel;
    if (options.classId) classId = options.classId;
    if (options.sessionId) sessionId = options.sessionId;
    const capabilities = options.capabilities || config?.capabilities || {};
    applyCapabilities(capabilities);
    if (options.readOnly === true) readOnly = true;
    if (options.readOnly === false) readOnly = !canUpdate;
    if (options.allowCreate === false) allowCreate = false;
    else if (options.allowCreate === true) allowCreate = capabilities.canCreate !== false;
    populateFromCaseRow(options.caseRow || { studentPersonId: options.personId, studentName: options.studentName });
    ensureModalInstance()?.show();
  }

  function wireModalLifecycle() {
    const modalEl = mountModalToBody();
    if (!modalEl || modalEl.dataset.lifecycleWired) return;
    modalEl.dataset.lifecycleWired = '1';
    modalEl.addEventListener('shown.bs.modal', () => {
      syncStudentCaseModalStack();
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
      clearStudentCaseModalStack();
    });
  }

  function wireEvents() {
    if (wired) return;
    wired = true;
    wireModalLifecycle();
    document.getElementById('studentCaseCategory')?.addEventListener('change', (event) => {
      renderDetailOptions(event.target.value, '');
      if (!isStudentStepVisible() && !isEditMode()) updateContextBanner();
      syncFooter(isStudentStepVisible() ? 'students' : 'details');
    });
    document.getElementById('studentCaseDetailPresets')?.addEventListener('change', (event) => {
      const radio = event.target.closest('.student-case-preset-radio');
      if (!radio) return;
      const detailsInput = document.getElementById('studentCaseDetails');
      if (detailsInput) detailsInput.value = radio.value;
    });
    document.getElementById('studentCaseStudentPicker')?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('.student-case-student-checkbox');
      if (!checkbox) return;
      const personId = String(checkbox.value || '').trim();
      if (!personId) return;
      if (checkbox.checked) selectedPersonIds.add(personId);
      else selectedPersonIds.delete(personId);
    });
    document.getElementById('studentCaseStudentSearch')?.addEventListener('input', (event) => {
      renderStudentPicker(event.target.value || '');
    });
    document.getElementById('btnStudentCaseSelectAll')?.addEventListener('click', () => {
      getRosterRows().forEach((row) => {
        const personId = String(row.personId || '').trim();
        if (personId) selectedPersonIds.add(personId);
      });
      renderStudentPicker(document.getElementById('studentCaseStudentSearch')?.value || '');
    });
    document.getElementById('btnStudentCaseClearAll')?.addEventListener('click', () => {
      selectedPersonIds = new Set();
      renderStudentPicker(document.getElementById('studentCaseStudentSearch')?.value || '');
    });
    document.getElementById('btnStudentCaseNext')?.addEventListener('click', () => advanceWizard());
    document.getElementById('btnStudentCaseBack')?.addEventListener('click', () => setWizardStep('details'));
    document.getElementById('btnSaveStudentCaseSessionWide')?.addEventListener('click', () => {
      saveCase().catch(() => {});
    });
    document.getElementById('btnSaveStudentCase')?.addEventListener('click', () => {
      saveCase().catch(() => {});
    });
    document.getElementById('btnResolveStudentCase')?.addEventListener('click', () => {
      saveCase({ resolve: true }).catch(() => {});
    });
  }

  function wireListRowActions(root = document) {
    const host = root && typeof root.addEventListener === 'function' ? root : document;
    host.addEventListener('click', (event) => {
      const openHereBtn = event.target.closest('.js-student-case-open-here');
      if (openHereBtn) {
        event.preventDefault();
        const caseId = String(openHereBtn.dataset.caseId || '').trim();
        if (caseId) openRemote(caseId);
        return;
      }

      const resolveBtn = event.target.closest('.js-student-case-resolve');
      if (resolveBtn) {
        event.preventDefault();
        const caseId = String(resolveBtn.dataset.caseId || '').trim();
        if (caseId) openRemote(caseId, { resolveMode: true });
        return;
      }

      const deleteBtn = event.target.closest('.js-student-case-delete');
      if (deleteBtn) {
        event.preventDefault();
        const caseId = String(deleteBtn.dataset.caseId || '').trim();
        if (!caseId) return;
        deleteRemote(caseId, {
          studentName: String(deleteBtn.dataset.studentName || '').trim()
        }).catch(() => {});
      }
    });
  }

  function init(nextConfig = {}) {
    config = { ...config, ...nextConfig };
    if (nextConfig.detailPresets) global.__studentCaseDetailPresets = nextConfig.detailPresets;
    roster = Array.isArray(nextConfig.roster) ? nextConfig.roster : roster;
    classTitle = String(nextConfig.classTitle || classTitle || '').trim();
    sessionLabel = String(nextConfig.sessionLabel || sessionLabel || '').trim();
    classId = String(nextConfig.classId || classId || '').trim();
    sessionId = String(nextConfig.sessionId || sessionId || '').trim();
    applyCapabilities(nextConfig.capabilities || {});
    if (nextConfig.allowCreate === false) allowCreate = false;
    else if (nextConfig.allowCreate === true) allowCreate = (nextConfig.capabilities?.canCreate !== false);
    if (nextConfig.readOnly === true) readOnly = true;
    wireEvents();
    ensureModalInstance();
  }

  global.SessionStudentCaseModal = {
    init,
    open,
    openRemote,
    resolveRemote,
    deleteRemote,
    reset: resetModal,
    wireListRowActions
  };
}(window));
