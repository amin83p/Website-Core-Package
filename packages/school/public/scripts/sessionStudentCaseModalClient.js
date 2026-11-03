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
  let canAssignOrShare = false;
  let pendingCollaborationAction = '';
  let resolveMode = false;
  let classTitle = '';
  let sessionLabel = '';
  let classId = '';
  let sessionId = '';
  let manageSessionHref = '';
  let busyToken = null;
  let wired = false;
  let collaborationModalInstance = null;
  let collaborationWorkflowActive = false;
  let preserveCollaborationWorkflow = false;
  let actionsModalInstance = null;
  let actionDetailModalInstance = null;
  let timelineEntries = [];
  let canContributeWorkAction = false;
  let canEditWorkAction = false;
  let canDeleteWorkAction = false;
  let actionDetailEntry = null;
  let pendingWorkActionNotify = { actionId: '', candidates: [] };
  let workActionNotifyModalInstance = null;
  let collaborationSnapshot = {
    assignedTo: null,
    collaborators: [],
    routingReviewers: []
  };

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

  function notifyHostCaseUpdated(caseRow, meta = {}) {
    if (typeof config?.onSaved !== 'function') return;
    config.onSaved(caseRow || {}, meta);
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

  function mountCollaborationModalToBody() {
    const modalEl = getCollaborationModalEl();
    if (!modalEl || modalEl.parentElement === document.body) return modalEl;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function syncStudentCaseModalStack() {
    const modalEl = getModalEl();
    if (!modalEl) return;
    const collabEl = getCollaborationModalEl();
    if (collabEl?.classList.contains('show')) {
      syncCollaborationModalStack();
      return;
    }
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

  function formatTimelineWhen(at) {
    const raw = String(at || '').trim();
    if (!raw) return '—';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function getAttachmentOpenUrl(attachment) {
    if (!attachment || typeof attachment !== 'object') return '';
    return String(attachment.url || attachment.storagePath || attachment.path || '').trim();
  }

  function renderTimelineInto(host, entries) {
    if (!host) return;
    const rows = Array.isArray(entries) ? entries : [];
    host.innerHTML = rows.map((entry) => {
      const kind = entry.kind === 'system' ? 'system' : (entry.private === true ? 'work-private' : 'work');
      const typeLabel = entry.kind === 'system'
        ? 'System'
        : (entry.private === true ? 'Private log' : 'Work log');
      const meta = `${escapeHtml(formatTimelineWhen(entry.at))} · ${escapeHtml(entry.actorName || 'Staff')}`;
      const summary = escapeHtml(entry.summary || entry.title || 'Activity');
      const privateBadge = entry.private === true
        ? '<span class="student-case-timeline-item__badge student-case-timeline-item__badge--private"><i class="bi bi-lock-fill"></i> Private</span>'
        : '';
      return `<button type="button" class="student-case-timeline-item student-case-timeline-item--${kind}" role="listitem" data-timeline-id="${escapeHtml(entry.id || '')}" data-timeline-kind="${kind}"><div class="student-case-timeline-item__head"><span class="student-case-timeline-item__type">${escapeHtml(typeLabel)}</span>${privateBadge}</div><div class="student-case-timeline-item__meta">${meta}</div><div class="student-case-timeline-item__summary">${summary}</div></button>`;
    }).join('');
  }

  function findTimelineEntry(entryId) {
    const key = String(entryId || '').trim();
    if (!key) return null;
    return (timelineEntries || []).find((row) => String(row.id || '') === key) || null;
  }

  function syncActivityButton() {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    const btn = document.getElementById('btnStudentCaseOpenActivity');
    btn?.classList.toggle('d-none', !caseId);
  }

  function renderActionsModalTimeline() {
    const host = document.getElementById('studentCaseActionsTimeline');
    const emptyEl = document.getElementById('studentCaseActionsTimelineEmpty');
    const compose = document.getElementById('studentCaseActionsCompose');
    const entries = timelineEntries || [];
    renderTimelineInto(host, entries);
    emptyEl?.classList.toggle('d-none', entries.length > 0);
    compose?.classList.toggle('d-none', !(canContributeWorkAction && !readOnly));
  }

  function setTimelineEntries(entries) {
    timelineEntries = Array.isArray(entries) ? entries : [];
    syncActivityButton();
    renderActionsModalTimeline();
  }

  function mountModalElementToBody(modalEl) {
    if (!modalEl || modalEl.parentElement === document.body) return modalEl;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function syncNestedStudentCaseModalStack(activeModalEl) {
    const caseEl = getModalEl();
    if (!activeModalEl || !activeModalEl.classList.contains('show')) return;
    let caseZ = 1055;
    if (caseEl?.classList.contains('show')) {
      const parsed = Number.parseInt(window.getComputedStyle(caseEl).zIndex, 10);
      if (Number.isFinite(parsed) && parsed > 0) caseZ = parsed;
    }
    const activeZ = caseZ + 20;
    activeModalEl.style.setProperty('z-index', String(activeZ), 'important');
    const backdrops = document.querySelectorAll('.modal-backdrop.show');
    backdrops.forEach((backdrop, index) => {
      if (backdrops.length <= 1) {
        backdrop.style.setProperty('z-index', String(caseZ - 5), 'important');
        return;
      }
      if (index === backdrops.length - 1) {
        backdrop.style.setProperty('z-index', String(activeZ - 5), 'important');
      } else {
        backdrop.style.setProperty('z-index', String(caseZ - 5), 'important');
      }
    });
  }

  function getActionsModalEl() {
    return document.getElementById('studentCaseActionsModal');
  }

  function getActionDetailModalEl() {
    return document.getElementById('studentCaseActionDetailModal');
  }

  function ensureActionsModalInstance() {
    const modalEl = mountModalElementToBody(getActionsModalEl());
    if (!modalEl || !global.bootstrap) return null;
    if (!actionsModalInstance) {
      actionsModalInstance = new global.bootstrap.Modal(modalEl);
      if (!modalEl.dataset.lifecycleWired) {
        modalEl.dataset.lifecycleWired = '1';
        modalEl.addEventListener('show.bs.modal', () => {
          mountModalElementToBody(modalEl);
          syncNestedStudentCaseModalStack(modalEl);
          renderActionsModalTimeline();
        });
        modalEl.addEventListener('shown.bs.modal', () => syncNestedStudentCaseModalStack(modalEl));
      }
    }
    return actionsModalInstance;
  }

  function ensureActionDetailModalInstance() {
    const modalEl = mountModalElementToBody(getActionDetailModalEl());
    if (!modalEl || !global.bootstrap) return null;
    if (!actionDetailModalInstance) {
      actionDetailModalInstance = new global.bootstrap.Modal(modalEl);
      if (!modalEl.dataset.lifecycleWired) {
        modalEl.dataset.lifecycleWired = '1';
        modalEl.addEventListener('show.bs.modal', () => {
          mountModalElementToBody(modalEl);
          syncNestedStudentCaseModalStack(modalEl);
        });
        modalEl.addEventListener('shown.bs.modal', () => syncNestedStudentCaseModalStack(modalEl));
      }
    }
    return actionDetailModalInstance;
  }

  function openActionDetailModal(entry) {
    if (!entry) return;
    actionDetailEntry = entry;
    const titleEl = document.getElementById('studentCaseActionDetailTitle');
    const metaEl = document.getElementById('studentCaseActionDetailMeta');
    const summaryEl = document.getElementById('studentCaseActionDetailSummary');
    const bodyEl = document.getElementById('studentCaseActionDetailBody');
    const attachWrap = document.getElementById('studentCaseActionDetailAttachmentWrap');
    const attachLink = document.getElementById('studentCaseActionDetailAttachmentLink');
    const privateBadge = document.getElementById('studentCaseActionDetailPrivateBadge');
    if (titleEl) {
      titleEl.textContent = entry.kind === 'system' ? 'System activity' : 'Work log entry';
    }
    if (metaEl) {
      metaEl.textContent = `${formatTimelineWhen(entry.at)} · ${entry.actorName || 'Staff'}`;
    }
    if (summaryEl) summaryEl.textContent = entry.summary || entry.title || '—';
    if (bodyEl) bodyEl.textContent = entry.body || entry.summary || '—';
    privateBadge?.classList.toggle('d-none', !(entry.private === true && entry.kind !== 'system'));
    const involvedWrap = document.getElementById('studentCaseActionDetailInvolvedWrap');
    const involvedEl = document.getElementById('studentCaseActionDetailInvolved');
    const involvedIds = Array.isArray(entry.involvedPersonIds) ? entry.involvedPersonIds : [];
    if (involvedWrap && involvedEl) {
      involvedWrap.classList.toggle('d-none', !involvedIds.length || entry.kind === 'system');
      involvedEl.textContent = involvedIds.join(', ');
    }
    const editBtn = document.getElementById('btnStudentCaseActionDetailEdit');
    const deleteBtn = document.getElementById('btnStudentCaseActionDetailDelete');
    const canEditEntry = entry.kind === 'work' && (entry.canEdit === true || canEditWorkAction);
    const canDeleteEntry = entry.kind === 'work' && (entry.canDelete === true || canDeleteWorkAction);
    editBtn?.classList.toggle('d-none', !canEditEntry || readOnly);
    deleteBtn?.classList.toggle('d-none', !canDeleteEntry || readOnly);
    const attachUrl = getAttachmentOpenUrl(entry.attachment);
    if (attachWrap && attachLink) {
      if (attachUrl) {
        attachWrap.classList.remove('d-none');
        attachLink.href = attachUrl;
        attachLink.textContent = String(entry.attachment?.originalName || entry.attachment?.name || 'Download attachment');
      } else {
        attachWrap.classList.add('d-none');
        attachLink.removeAttribute('href');
        attachLink.textContent = '';
      }
    }
    ensureActionDetailModalInstance()?.show();
  }

  function getWorkActionNotifyModalEl() {
    return document.getElementById('studentCaseWorkActionNotifyModal');
  }

  function ensureWorkActionNotifyModalInstance() {
    const modalEl = mountModalElementToBody(getWorkActionNotifyModalEl());
    if (!modalEl || !global.bootstrap) return null;
    if (!workActionNotifyModalInstance) {
      workActionNotifyModalInstance = new global.bootstrap.Modal(modalEl);
      if (!modalEl.dataset.lifecycleWired) {
        modalEl.dataset.lifecycleWired = '1';
        modalEl.addEventListener('show.bs.modal', () => {
          mountModalElementToBody(modalEl);
          syncNestedStudentCaseModalStack(modalEl);
        });
        modalEl.addEventListener('shown.bs.modal', () => syncNestedStudentCaseModalStack(modalEl));
      }
    }
    return workActionNotifyModalInstance;
  }

  function renderWorkActionNotifyList(candidates = []) {
    const host = document.getElementById('studentCaseWorkActionNotifyList');
    const emptyEl = document.getElementById('studentCaseWorkActionNotifyEmpty');
    const rows = Array.isArray(candidates) ? candidates : [];
    if (!host) return;
    host.innerHTML = rows.map((row) => {
      const pid = escapeHtml(row.personId || '');
      const name = escapeHtml(row.personName || row.personId || 'Person');
      const hint = escapeHtml(row.roleHint || '');
      return `<div class="form-check student-case-notify-row py-1"><input class="form-check-input student-case-notify-checkbox" type="checkbox" value="${pid}" id="studentCaseNotify_${pid}" checked><label class="form-check-label" for="studentCaseNotify_${pid}"><span class="fw-semibold">${name}</span>${hint ? `<span class="text-muted small ms-1">(${hint})</span>` : ''}</label></div>`;
    }).join('');
    host.classList.toggle('d-none', rows.length === 0);
    emptyEl?.classList.toggle('d-none', rows.length > 0);
    document.getElementById('btnStudentCaseWorkActionNotifySend')?.toggleAttribute('disabled', rows.length === 0);
  }

  function openWorkActionNotifyModal(actionId, candidates = []) {
    pendingWorkActionNotify = {
      actionId: String(actionId || '').trim(),
      candidates: Array.isArray(candidates) ? candidates : []
    };
    if (!pendingWorkActionNotify.actionId || !pendingWorkActionNotify.candidates.length) {
      return showMessage('Action Saved', 'Your work log entry was added to this case.', 'success');
    }
    renderWorkActionNotifyList(pendingWorkActionNotify.candidates);
    ensureWorkActionNotifyModalInstance()?.show();
    return Promise.resolve();
  }

  async function postWorkActionNotifications() {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    const actionId = pendingWorkActionNotify.actionId;
    if (!caseId || !actionId) return;
    const personIds = Array.from(document.querySelectorAll('.student-case-notify-checkbox:checked'))
      .map((input) => String(input.value || '').trim())
      .filter(Boolean);
    if (!personIds.length) {
      ensureWorkActionNotifyModalInstance()?.hide();
      await showMessage('Action Saved', 'Work log saved. No chat notifications were sent.', 'success');
      return;
    }
    showBusy('Sending Notifications', 'Delivering chat messages...');
    try {
      const res = await fetch(`/school/session-student-cases/api/${encodeURIComponent(caseId)}/work-actions/${encodeURIComponent(actionId)}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        },
        body: JSON.stringify({
          personIds,
          actionStateId: config?.actionStateId || ''
        })
      });
      const result = await res.json().catch(() => ({}));
      hideBusy();
      if (!res.ok || result.status !== 'success') {
        throw new Error(result.message || 'Failed to send notifications.');
      }
      if (Array.isArray(result.timeline)) setTimelineEntries(result.timeline);
      if (result.case) syncCollaborationSection(result.case);
      ensureWorkActionNotifyModalInstance()?.hide();
      await showMessage('Notifications Sent', result.message || 'Chat notifications were sent.', 'success');
    } catch (error) {
      hideBusy();
      await showMessage('Notify Failed', error.message, 'error');
    }
  }

  function syncActionComposeMode(entry = null) {
    const editIdEl = document.getElementById('studentCaseActionEditId');
    const saveBtn = document.getElementById('btnStudentCaseActionSave');
    const removeWrap = document.getElementById('studentCaseActionRemoveAttachmentWrap');
    const isEdit = Boolean(entry && entry.kind === 'work' && entry.id);
    if (editIdEl) editIdEl.value = isEdit ? String(entry.id) : '';
    if (saveBtn) {
      saveBtn.innerHTML = isEdit
        ? '<i class="bi bi-check2-circle me-1"></i>Save changes'
        : '<i class="bi bi-check2-circle me-1"></i>Save action';
    }
    removeWrap?.classList.toggle('d-none', !(isEdit && getAttachmentOpenUrl(entry.attachment)));
  }

  function beginEditWorkAction(entry) {
    if (!entry || entry.kind !== 'work') return;
    actionDetailModalInstance?.hide();
    document.getElementById('studentCaseActionBody').value = entry.body || entry.summary || '';
    document.getElementById('studentCaseActionPrivate').checked = entry.private === true;
    document.getElementById('studentCaseActionFile').value = '';
    document.getElementById('studentCaseActionRemoveAttachment').checked = false;
    syncActionComposeMode(entry);
    openActionsModal();
    document.getElementById('studentCaseActionBody')?.focus();
  }

  async function deleteWorkActionEntry(entry) {
    if (!entry || entry.kind !== 'work' || !entry.id) return;
    const confirmed = typeof global.showMessageModal === 'function'
      ? await global.showMessageModal({
        title: 'Delete work log',
        icon: 'warning',
        message: 'Permanently delete this work log entry?',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary', value: false },
          { text: 'Delete', class: 'btn-danger', value: true }
        ]
      })
      : global.confirm('Delete this work log entry?');
    if (confirmed !== true) return;
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId) return;
    showBusy('Deleting', 'Removing work log entry...');
    try {
      const res = await fetch(`/school/session-student-cases/api/${encodeURIComponent(caseId)}/work-actions/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
      });
      const result = await res.json().catch(() => ({}));
      hideBusy();
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Delete failed.');
      if (Array.isArray(result.timeline)) setTimelineEntries(result.timeline);
      actionDetailModalInstance?.hide();
      await showMessage('Deleted', result.message || 'Work log entry deleted.', 'success');
    } catch (error) {
      hideBusy();
      await showMessage('Delete Failed', error.message, 'error');
    }
  }

  function openActionsModal() {
    renderActionsModalTimeline();
    ensureActionsModalInstance()?.show();
  }

  function clearActionComposeForm() {
    const bodyEl = document.getElementById('studentCaseActionBody');
    const fileEl = document.getElementById('studentCaseActionFile');
    const privateEl = document.getElementById('studentCaseActionPrivate');
    const removeEl = document.getElementById('studentCaseActionRemoveAttachment');
    if (bodyEl) bodyEl.value = '';
    if (fileEl) fileEl.value = '';
    if (privateEl) privateEl.checked = false;
    if (removeEl) removeEl.checked = false;
    syncActionComposeMode(null);
  }

  async function saveWorkActionFromModal() {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId) return;
    const editId = String(document.getElementById('studentCaseActionEditId')?.value || '').trim();
    const body = String(document.getElementById('studentCaseActionBody')?.value || '').trim();
    if (!body) {
      await showMessage('Action Required', 'Describe what you did before saving.', 'warning');
      return;
    }
    const fileInput = document.getElementById('studentCaseActionFile');
    const file = fileInput?.files?.[0] || null;
    if (file && file.size > 2 * 1024 * 1024) {
      await showMessage('File Too Large', 'Each attachment must be 2 MB or smaller.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('body', body);
    if (document.getElementById('studentCaseActionPrivate')?.checked) {
      formData.append('private', 'true');
    }
    if (file) formData.append('file', file, file.name);
    if (document.getElementById('studentCaseActionRemoveAttachment')?.checked) {
      formData.append('removeAttachment', 'true');
    }
    if (config?.actionStateId) formData.append('actionStateId', config.actionStateId);
    const isEdit = Boolean(editId);
    showBusy(isEdit ? 'Updating Action' : 'Saving Action', isEdit ? 'Updating work log entry...' : 'Adding your work log entry...');
    try {
      const url = isEdit
        ? `/school/session-student-cases/api/${encodeURIComponent(caseId)}/work-actions/${encodeURIComponent(editId)}`
        : `/school/session-student-cases/api/${encodeURIComponent(caseId)}/work-actions`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'X-AJAX-Request': 'true' },
        body: formData
      });
      const result = await res.json().catch(() => ({}));
      hideBusy();
      if (!res.ok || result.status !== 'success') {
        throw new Error(result.message || 'Failed to save work log entry.');
      }
      if (Array.isArray(result.timeline)) {
        setTimelineEntries(result.timeline);
      }
      if (result.case) {
        syncCollaborationSection(result.case);
      }
      clearActionComposeForm();
      if (isEdit) {
        await showMessage('Action Updated', result.message || 'Work log entry updated.', 'success');
        return;
      }
      await openWorkActionNotifyModal(result.actionId, result.notifyCandidates || []);
    } catch (error) {
      hideBusy();
      await showMessage('Save Failed', error.message, 'error');
    }
  }

  function handleTimelineClick(event) {
    const btn = event.target.closest('[data-timeline-id]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = findTimelineEntry(btn.getAttribute('data-timeline-id'));
    if (entry) openActionDetailModal(entry);
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

  function buildPresetRadiosHtml(presets, selected) {
    const matchedPreset = presets.includes(String(selected || '').trim());
    return presets.map((label, index) => {
      const id = `studentCasePreset_${index}`;
      const checked = matchedPreset && label === selected;
      return `<div class="form-check student-case-preset-option"><input class="form-check-input student-case-preset-radio" type="radio" name="studentCasePreset" id="${id}" value="${escapeHtml(label)}"${checked ? ' checked' : ''}><label class="form-check-label" for="${id}">${escapeHtml(label)}</label></div>`;
    }).join('');
  }

  function setDisclosureToggleLabel(toggleEl, labelEl, expanded, { show = 'Show', hide = 'Hide' } = {}) {
    const text = expanded ? hide : show;
    if (labelEl) labelEl.textContent = text;
    else if (toggleEl) toggleEl.textContent = text;
  }

  function setDisclosureShell(disclosureEl, mode = 'collapsible') {
    if (!disclosureEl) return;
    disclosureEl.classList.remove('student-case-disclosure--always-open', 'student-case-disclosure--hidden');
    if (mode === 'always-open') disclosureEl.classList.add('student-case-disclosure--always-open');
    if (mode === 'hidden') disclosureEl.classList.add('student-case-disclosure--hidden');
  }

  function renderDetailOptions(category, selectedDetails = '') {
    const presetsWrap = document.getElementById('studentCaseDetailPresetsWrap');
    const presetsHost = document.getElementById('studentCaseDetailPresets');
    const presetsSelected = document.getElementById('studentCaseDetailPresetsSelected');
    const presetsToggle = document.getElementById('studentCaseDetailPresetsToggle');
    const presetsToggleLabel = document.getElementById('studentCaseDetailPresetsToggleLabel');
    const presetsDisclosure = document.getElementById('studentCasePresetsDisclosure');
    const noteDisclosure = document.getElementById('studentCaseNoteDisclosure');
    const detailsInput = document.getElementById('studentCaseDetails');
    const noteWrap = document.getElementById('studentCaseDetailsNoteWrap');
    const noteToggle = document.getElementById('studentCaseDetailsNoteToggle');
    const noteToggleLabel = document.getElementById('studentCaseDetailsNoteToggleLabel');
    const detailsHint = document.getElementById('studentCaseDetailsHint');
    const key = String(category || 'learning').trim().toLowerCase();
    const presets = presetList(key);
    const selected = String(selectedDetails || '').trim();
    const listReview = config?.apiMode === 'list' && isEditMode();
    if (detailsInput) detailsInput.value = selected;

    setDisclosureShell(presetsDisclosure, 'collapsible');
    setDisclosureShell(noteDisclosure, 'collapsible');
    noteWrap?.classList.remove('d-none');
    noteToggle?.classList.add('d-none');
    noteToggle?.setAttribute('aria-expanded', 'false');
    presetsToggle?.classList.add('d-none');
    presetsToggle?.setAttribute('aria-expanded', 'false');
    presetsSelected?.classList.add('d-none');
    if (noteWrap && !noteWrap.classList.contains('collapse')) noteWrap.classList.add('collapse');
    if (presetsWrap && !presetsWrap.classList.contains('collapse')) presetsWrap.classList.add('collapse');
    noteWrap?.classList.remove('show');
    presetsWrap?.classList.remove('show');
    detailsHint?.classList.remove('d-none');
    setDisclosureToggleLabel(noteToggle, noteToggleLabel, false, { show: 'Show full note', hide: 'Hide full note' });

    if (key === 'other' || !presets.length) {
      setDisclosureShell(presetsDisclosure, 'hidden');
      if (presetsHost) presetsHost.innerHTML = '';
      if (listReview) {
        if (!selected) setDisclosureShell(noteDisclosure, 'hidden');
        else {
          setDisclosureShell(noteDisclosure, 'always-open');
          noteWrap?.classList.add('show');
        }
      } else {
        setDisclosureShell(noteDisclosure, 'always-open');
        noteWrap?.classList.add('show');
      }
      return;
    }

    const matchedPreset = presets.includes(selected);
    if (presetsHost) presetsHost.innerHTML = buildPresetRadiosHtml(presets, selected);

    if (listReview) {
      presetsWrap?.classList.remove('show');
      presetsToggle?.classList.remove('d-none');
      setDisclosureToggleLabel(presetsToggle, presetsToggleLabel, false, {
        show: matchedPreset ? 'Change issue option' : 'Show issue options',
        hide: 'Hide issue options'
      });

      if (matchedPreset) {
        presetsSelected?.classList.remove('d-none');
        if (presetsSelected) {
          presetsSelected.innerHTML = `<i class="bi bi-check2-circle" aria-hidden="true"></i><span><strong>${escapeHtml(selected)}</strong></span>`;
        }
        noteWrap?.classList.remove('show');
        noteToggle?.classList.remove('d-none');
        setDisclosureShell(noteDisclosure, 'collapsible');
        detailsHint?.classList.add('d-none');
      } else {
        if (!selected) {
          setDisclosureShell(noteDisclosure, 'hidden');
        } else {
          setDisclosureShell(noteDisclosure, 'always-open');
          noteWrap?.classList.add('show');
        }
      }
      return;
    }

    setDisclosureShell(presetsDisclosure, 'always-open');
    setDisclosureShell(noteDisclosure, 'always-open');
    presetsWrap?.classList.add('show');
    noteWrap?.classList.add('show');
  }

  function rosterRowMatchesSearch(row, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return true;
    const haystack = String(row?.searchText || '').trim().toLowerCase();
    if (haystack) return haystack.includes(needle);
    return String(row.name || '').toLowerCase().includes(needle)
      || String(row.personId || '').toLowerCase().includes(needle)
      || String(row.studentRecordId || '').toLowerCase().includes(needle)
      || String(row.customStudentId || '').toLowerCase().includes(needle);
  }

  function renderStudentPicker(filterText = '') {
    const host = document.getElementById('studentCaseStudentPicker');
    if (!host) return;
    const query = String(filterText || '').trim();
    const rows = getRosterRows().filter((row) => rosterRowMatchesSearch(row, query));
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
    canAssignOrShare = capabilities.canAssignOrShare === true;
    canContributeWorkAction = capabilities.canContributeWorkAction === true;
    canEditWorkAction = capabilities.canEditWorkAction === true;
    canDeleteWorkAction = capabilities.canDeleteWorkAction === true;
    allowCreate = capabilities.canCreate === true;
    readOnly = capabilities.readOnly === true
      || (!canEditCase && (capabilities.canRead === true || capabilities.canReadAll === true));
    syncResultSection();
    syncCollaborationChrome();
    syncActivityButton();
  }

  function displayPersonLabel(entry) {
    if (!entry || typeof entry !== 'object') return '';
    return String(entry.personName || entry.personId || '').trim();
  }

  function formatCollabMeta(entry = {}) {
    const by = String(entry.assignedByName || entry.addedByName || '').trim();
    const at = String(entry.assignedAt || entry.addedAt || '').trim();
    if (!by && !at) return '';
    const parts = [];
    if (by) parts.push(`by ${by}`);
    if (at) parts.push(new Date(at).toLocaleString());
    return parts.join(' · ');
  }

  function setCollaborationSnapshot(caseRow = {}, routingReviewers = []) {
    collaborationSnapshot = {
      assignedTo: caseRow?.assignedTo && typeof caseRow.assignedTo === 'object' ? caseRow.assignedTo : null,
      collaborators: Array.isArray(caseRow?.collaborators) ? caseRow.collaborators : [],
      routingReviewers: Array.isArray(routingReviewers) ? routingReviewers : collaborationSnapshot.routingReviewers
    };
  }

  function syncCollaborationChrome(caseRow = null) {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (caseRow && typeof caseRow === 'object') {
      setCollaborationSnapshot(caseRow, collaborationSnapshot.routingReviewers);
    }
    const assignedTo = collaborationSnapshot.assignedTo;
    const collaborators = collaborationSnapshot.collaborators;
    const hasAssigned = Boolean(assignedTo?.personId);
    const hasCollaborators = collaborators.length > 0;

    const footerBtn = document.getElementById('btnStudentCaseOpenCollaboration');
    footerBtn?.classList.toggle('d-none', !caseId);

    const badgeHost = document.getElementById('studentCaseCollaborationHeaderBadges');
    if (badgeHost) {
      if (!caseId || (!hasAssigned && !hasCollaborators)) {
        badgeHost.classList.add('d-none');
        badgeHost.innerHTML = '';
      } else {
        badgeHost.classList.remove('d-none');
        const badges = [];
        if (hasAssigned) {
          badges.push('<button type="button" class="btn btn-sm student-case-collab-header-badge" data-open-collaboration="1" title="Assigned"><i class="bi bi-person-check"></i></button>');
        }
        if (hasCollaborators) {
          badges.push('<button type="button" class="btn btn-sm student-case-collab-header-badge" data-open-collaboration="1" title="Shared with collaborators"><i class="bi bi-people"></i></button>');
        }
        badgeHost.innerHTML = badges.join('');
      }
    }
  }

  function getCollaborationModalEl() {
    return document.getElementById('studentCaseCollaborationModal');
  }

  function syncCollaborationModalStack() {
    const collabEl = mountCollaborationModalToBody();
    const caseEl = getModalEl();
    if (!collabEl || !collabEl.classList.contains('show')) return;

    let caseZ = 1055;
    if (caseEl?.classList.contains('show')) {
      const parsed = Number.parseInt(window.getComputedStyle(caseEl).zIndex, 10);
      if (Number.isFinite(parsed) && parsed > 0) caseZ = parsed;
      else caseEl.style.setProperty('z-index', String(caseZ), 'important');
    }
    const collabZ = caseZ + 20;
    collabEl.style.setProperty('z-index', String(collabZ), 'important');
    if (caseEl?.classList.contains('show')) {
      caseEl.style.setProperty('z-index', String(caseZ), 'important');
    }

    const backdrops = document.querySelectorAll('.modal-backdrop.show');
    backdrops.forEach((backdrop, index) => {
      if (backdrops.length <= 1) {
        backdrop.style.setProperty('z-index', String(caseZ - 5), 'important');
        return;
      }
      if (index === backdrops.length - 1) {
        backdrop.style.setProperty('z-index', String(collabZ - 5), 'important');
      } else {
        backdrop.style.setProperty('z-index', String(caseZ - 5), 'important');
      }
    });
  }

  function ensureCollaborationModalInstance() {
    const modalEl = mountCollaborationModalToBody();
    if (!modalEl || !global.bootstrap) return null;
    if (!collaborationModalInstance) {
      collaborationModalInstance = new global.bootstrap.Modal(modalEl, { backdrop: true, focus: true });
      if (!modalEl.dataset.lifecycleWired) {
        modalEl.dataset.lifecycleWired = '1';
        modalEl.addEventListener('show.bs.modal', () => {
          mountCollaborationModalToBody();
          syncCollaborationModalStack();
        });
        modalEl.addEventListener('shown.bs.modal', () => {
          syncCollaborationModalStack();
        });
        modalEl.addEventListener('hidden.bs.modal', () => {
          modalEl.style.removeProperty('z-index');
          if (!preserveCollaborationWorkflow) collaborationWorkflowActive = false;
          syncStudentCaseModalStack();
          repairBootstrapModalStackForStudentCase();
        });
      }
    }
    return collaborationModalInstance;
  }

  function populateCollaborationModalContent() {
    const routingEl = document.getElementById('studentCaseCollabRoutingList');
    const assignedEl = document.getElementById('studentCaseCollabAssignedDetail');
    const collaboratorsEl = document.getElementById('studentCaseCollabCollaboratorsList');
    const actionsEl = document.getElementById('studentCaseCollabActions');
    const canManageCollab = canAssignOrShare && !readOnly;
    const reviewers = collaborationSnapshot.routingReviewers || [];
    if (routingEl) {
      routingEl.textContent = reviewers.length
        ? reviewers.map((row) => displayPersonLabel(row)).filter(Boolean).join(', ')
        : 'No category routing assignees for this case type.';
    }
    const assignedTo = collaborationSnapshot.assignedTo;
    if (assignedEl) {
      if (!assignedTo) {
        assignedEl.textContent = '—';
      } else {
        const meta = formatCollabMeta(assignedTo);
        const removeBtn = canManageCollab
          ? `<button type="button" class="btn btn-sm btn-outline-danger ms-2 student-case-collab-remove-btn" data-collab-remove="assign" title="Remove primary assignee"><i class="bi bi-x-lg"></i><span class="visually-hidden">Remove assignee</span></button>`
          : '';
        assignedEl.innerHTML = `<div class="student-case-collab-person-row d-flex align-items-start justify-content-between gap-2"><div>${meta
          ? `<strong>${escapeHtml(displayPersonLabel(assignedTo))}</strong><br><span class="text-muted">${escapeHtml(meta)}</span>`
          : `<strong>${escapeHtml(displayPersonLabel(assignedTo))}</strong>`}</div>${removeBtn}</div>`;
      }
    }
    if (collaboratorsEl) {
      const rows = collaborationSnapshot.collaborators || [];
      if (!rows.length) {
        collaboratorsEl.innerHTML = '';
      } else {
        collaboratorsEl.innerHTML = rows.map((entry) => {
          const meta = formatCollabMeta(entry);
          const personId = escapeHtml(entry.personId || '');
          const removeBtn = canManageCollab
            ? `<button type="button" class="btn btn-sm btn-outline-danger student-case-collab-remove-btn" data-collab-remove="collaborator" data-person-id="${personId}" title="Remove collaborator"><i class="bi bi-x-lg"></i><span class="visually-hidden">Remove</span></button>`
            : '';
          return `<li class="student-case-collab-person-row d-flex align-items-start justify-content-between gap-2 mb-2"><div><strong>${escapeHtml(displayPersonLabel(entry))}</strong>${meta ? `<br><span class="text-muted">${escapeHtml(meta)}</span>` : ''}</div>${removeBtn}</li>`;
        }).join('');
      }
    }
    actionsEl?.classList.toggle('d-none', !(canAssignOrShare && !readOnly));
  }

  function openCollaborationModal() {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId) return;
    collaborationWorkflowActive = true;
    showCollaborationFlash('');
    populateCollaborationModalContent();
    mountCollaborationModalToBody();
    ensureCollaborationModalInstance()?.show();
  }

  function shouldKeepCollaborationWorkflowOpen() {
    return collaborationWorkflowActive === true;
  }

  function repairBootstrapModalStackForStudentCase() {
    const caseEl = getModalEl();
    const collabEl = getCollaborationModalEl();
    const openModals = [];
    if (caseEl?.classList.contains('show')) openModals.push(caseEl);
    if (collabEl?.classList.contains('show')) openModals.push(collabEl);
    if (!openModals.length) return;

    document.body.classList.add('modal-open');
    if (!document.body.style.overflow) document.body.style.overflow = 'hidden';

    let backdrops = Array.from(document.querySelectorAll('.modal-backdrop'));
    if (backdrops.length < openModals.length) {
      const missing = openModals.length - backdrops.length;
      for (let i = 0; i < missing; i += 1) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop fade show';
        document.body.appendChild(backdrop);
      }
      backdrops = Array.from(document.querySelectorAll('.modal-backdrop'));
    } else if (backdrops.length > openModals.length) {
      for (let i = backdrops.length - 1; i >= openModals.length; i -= 1) {
        backdrops[i]?.remove();
      }
    }
    syncCollaborationModalStack();
  }

  function keepStudentCaseModalStackOpen() {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId) return;
    preserveCollaborationWorkflow = true;
    try {
      const caseEl = getModalEl();
      if (caseEl && !caseEl.classList.contains('show')) ensureModalInstance()?.show();
      if (shouldKeepCollaborationWorkflowOpen()) {
        const collabEl = getCollaborationModalEl();
        if (collabEl && !collabEl.classList.contains('show')) ensureCollaborationModalInstance()?.show();
      }
      repairBootstrapModalStackForStudentCase();
      syncStudentCaseModalStack();
    } finally {
      preserveCollaborationWorkflow = false;
    }
  }

  function showCollaborationFlash(message) {
    const host = document.getElementById('studentCaseCollabFlash');
    if (!host) return;
    const text = String(message || '').trim();
    if (!text) {
      host.classList.add('d-none');
      host.textContent = '';
      return;
    }
    host.textContent = text;
    host.classList.remove('d-none');
  }

  function displayNameForPickerItem(item = {}) {
    const preferred = String(item?.preferredName || item?.name?.preferred || '').trim();
    const first = String(item?.firstName || item?.name?.first || '').trim();
    const last = String(item?.lastName || item?.name?.last || '').trim();
    const composed = [first, last].filter(Boolean).join(' ').trim();
    return String(item?.displayName || item?.name || preferred || composed || item?.personId || item?.id || '').trim();
  }

  function confirmResendCollaborationChat(message, targetPersonId) {
    if (typeof global.showMessageModal === 'function') {
      return global.showMessageModal({
        title: 'Already has access',
        message: message || '',
        icon: 'warning',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary', value: false },
          { text: 'Send chat notification', class: 'btn-primary', value: true }
        ]
      }).then((choice) => {
        if (choice === 'Send chat notification' || choice === true) return postNotifyCollaboration(targetPersonId);
        return false;
      });
    }
    if (global.confirm(`${message}\n\nSend another chat notification?`)) {
      return postNotifyCollaboration(targetPersonId);
    }
    return Promise.resolve(false);
  }

  async function postNotifyCollaboration(targetPersonId) {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId || !targetPersonId) return false;
    showBusy('Sending Notification', 'Sending chat message...');
    try {
      const res = await fetch(`/school/session-student-cases/api/${encodeURIComponent(caseId)}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-ajax-request': 'true'
        },
        body: JSON.stringify({
          targetPersonId,
          actionStateId: config?.actionStateId || ''
        })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Notify failed.');
      hideBusy();
      await showMessage('Notification Sent', result.message || 'Chat notification sent.', 'success');
      return true;
    } catch (error) {
      hideBusy();
      await showMessage('Notify Failed', error.message, 'error');
      return false;
    }
  }

  async function postCollaborationAction(action, targetPersonId, options = {}) {
    const keepCollaborationOpen = shouldKeepCollaborationWorkflowOpen() || options.keepCollaborationOpen === true;
    if (keepCollaborationOpen) keepStudentCaseModalStackOpen();
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId || !targetPersonId) return;
    const endpoint = action === 'assign' ? 'assign' : 'share';
    showBusy(action === 'assign' ? 'Assigning Case' : 'Sharing Case', 'Updating assignment and notifying the recipient...');
    try {
      const res = await fetch(`/school/session-student-cases/api/${encodeURIComponent(caseId)}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-ajax-request': 'true'
        },
        body: JSON.stringify({
          targetPersonId,
          actionStateId: config?.actionStateId || ''
        })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Request failed.');
      hideBusy();
      if (result.blocked === true) {
        await confirmResendCollaborationChat(result.message, result.targetPersonId || targetPersonId);
        return;
      }
      if (result.case) {
        setCollaborationSnapshot(result.case, collaborationSnapshot.routingReviewers);
        populateFromCaseRow(result.case);
        syncCollaborationChrome();
        populateCollaborationModalContent();
      }
      if (keepCollaborationOpen) {
        keepStudentCaseModalStackOpen();
        showCollaborationFlash(result.message || 'Update complete.');
      } else {
        await showMessage(
          action === 'assign' ? 'Case Assigned' : 'Case Shared',
          result.message || 'Update complete.',
          'success'
        );
      }
      notifyHostCaseUpdated(result.case || {}, { collaborationOnly: keepCollaborationOpen });
    } catch (error) {
      hideBusy();
      await showMessage('Update Failed', error.message, 'error');
      if (keepCollaborationOpen) keepStudentCaseModalStackOpen();
    }
  }

  async function postCollaborationRemoval(kind, targetPersonId = '', options = {}) {
    const keepCollaborationOpen = shouldKeepCollaborationWorkflowOpen() || options.keepCollaborationOpen === true;
    if (keepCollaborationOpen) keepStudentCaseModalStackOpen();
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId) return;
    const isUnassign = kind === 'assign';
    if (!isUnassign && !targetPersonId) return;
    const url = isUnassign
      ? `/school/session-student-cases/api/${encodeURIComponent(caseId)}/unassign`
      : `/school/session-student-cases/api/${encodeURIComponent(caseId)}/collaborators/remove`;
    showBusy('Updating', isUnassign ? 'Removing primary assignee...' : 'Removing collaborator...');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-ajax-request': 'true'
        },
        body: JSON.stringify(isUnassign ? {
          actionStateId: config?.actionStateId || ''
        } : {
          targetPersonId,
          actionStateId: config?.actionStateId || ''
        })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Request failed.');
      hideBusy();
      if (result.case) {
        setCollaborationSnapshot(result.case, collaborationSnapshot.routingReviewers);
        populateFromCaseRow(result.case);
        syncCollaborationChrome();
        populateCollaborationModalContent();
      }
      if (keepCollaborationOpen) {
        keepStudentCaseModalStackOpen();
        showCollaborationFlash(result.message || 'Update complete.');
      } else {
        await showMessage(
          isUnassign ? 'Assignee Removed' : 'Collaborator Removed',
          result.message || 'Update complete.',
          'success'
        );
      }
      notifyHostCaseUpdated(result.case || {}, { collaborationOnly: keepCollaborationOpen });
    } catch (error) {
      hideBusy();
      await showMessage('Update Failed', error.message, 'error');
      if (keepCollaborationOpen) keepStudentCaseModalStackOpen();
    }
  }

  async function handleCollaborationRemoveClick(event) {
    const btn = event.target.closest('[data-collab-remove]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canAssignOrShare || readOnly) return;
    const keepCollaborationOpen = shouldKeepCollaborationWorkflowOpen();
    const kind = String(btn.getAttribute('data-collab-remove') || '').trim();
    const personId = String(btn.getAttribute('data-person-id') || '').trim();
    const message = kind === 'assign'
      ? 'Remove the primary assignee from this case? They will no longer be listed as the handler (category routing access is unchanged).'
      : 'Remove this collaborator from the case?';
    let confirmed = false;
    const confirmButtonText = 'Remove';
    if (typeof global.showMessageModal === 'function') {
      const choice = await global.showMessageModal({
        title: kind === 'assign' ? 'Remove assignee' : 'Remove collaborator',
        icon: 'warning',
        message,
        buttons: [
          { text: 'Cancel', class: 'btn-secondary', value: false },
          { text: confirmButtonText, class: 'btn-danger', value: true }
        ]
      });
      // showMessageModal resolves with button text, not btn.value (see masterScheduleViewer uiConfirm)
      confirmed = choice === confirmButtonText || choice === true;
    } else {
      confirmed = global.confirm(message);
    }
    if (!confirmed) return;
    if (keepCollaborationOpen) keepStudentCaseModalStackOpen();
    await postCollaborationRemoval(kind, personId, { keepCollaborationOpen });
  }

  function openCollaborationPersonPicker(action) {
    const caseId = String(document.getElementById('studentCaseId')?.value || '').trim();
    if (!caseId || typeof global.GenericPicker?.open !== 'function') {
      return showMessage('Unavailable', 'Person picker is not available on this page.', 'error');
    }
    const isAssign = action === 'assign';
    const pickerConfig = global.GenericPickerPresets?.person({
      title: isAssign ? 'Assign case to…' : 'Share case with…',
      apiEndpoint: `/school/session-student-cases/api/${encodeURIComponent(caseId)}/share-eligible-persons`,
      onSelect(item) {
        const personId = String(item?.personId || item?.id || '').trim();
        if (!personId) return;
        if (item?.isCategoryRoutingReviewer === true) {
          const name = displayNameForPickerItem(item);
          confirmResendCollaborationChat(
            `${name} is already a category reviewer for this case type. Send a chat reminder instead?`,
            personId
          ).catch(() => {});
          return;
        }
        postCollaborationAction(isAssign ? 'assign' : 'share', personId, {
          keepCollaborationOpen: shouldKeepCollaborationWorkflowOpen()
        }).catch(() => {});
      }
    });
    preserveCollaborationWorkflow = true;
    collaborationWorkflowActive = true;
    global.GenericPicker.open(pickerConfig);
    preserveCollaborationWorkflow = false;
    repairBootstrapModalStackForStudentCase();
  }

  function maybeOpenPendingCollaborationPicker() {
    const action = String(pendingCollaborationAction || '').trim();
    pendingCollaborationAction = '';
    if (!action) return;
    openCollaborationModal();
    if (canAssignOrShare && !readOnly) {
      openCollaborationPersonPicker(action);
    }
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
    collaborationSnapshot = { assignedTo: null, collaborators: [], routingReviewers: [] };
    syncCollaborationChrome();
    setTimelineEntries([]);
    canContributeWorkAction = false;
    canEditWorkAction = false;
    canDeleteWorkAction = false;
  }

  function syncCollaborationSection(row) {
    if (row && typeof row === 'object') setCollaborationSnapshot(row, collaborationSnapshot.routingReviewers);
    syncCollaborationChrome();
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
    syncCollaborationSection(row);
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
    pendingCollaborationAction = String(options.collaborationAction || '').trim();
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
      allowCreate = false;
      resolveMode = options.resolveMode === true;
      pendingCollaborationAction = String(options.collaborationAction || '').trim();
      resetModal();
      setCollaborationSnapshot(ctx.case || {}, ctx.routingReviewers || []);
      populateFromCaseRow(ctx.case || {});
      applyCapabilities(ctx.capabilities || {});
      setTimelineEntries(ctx.timeline || []);
      syncActivityButton();
      if (resolveMode && canResolve) {
        setResolveVisible(true);
        syncFooter('details');
        document.getElementById('studentCaseResultNote')?.focus();
      }
      ensureModalInstance()?.show();
      maybeOpenPendingCollaborationPicker();
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
      collaborationWorkflowActive = false;
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
      if (config?.apiMode === 'list' && isEditMode()) {
        renderDetailOptions(document.getElementById('studentCaseCategory')?.value || 'learning', radio.value);
      }
    });
    document.getElementById('studentCaseDetailPresetsWrap')?.addEventListener('shown.bs.collapse', () => {
      const toggle = document.getElementById('studentCaseDetailPresetsToggle');
      const label = document.getElementById('studentCaseDetailPresetsToggleLabel');
      toggle?.setAttribute('aria-expanded', 'true');
      const category = document.getElementById('studentCaseCategory')?.value || 'learning';
      const matched = presetList(category).includes(String(collectDetailsValue() || '').trim());
      setDisclosureToggleLabel(toggle, label, true, {
        show: matched ? 'Change issue option' : 'Show issue options',
        hide: 'Hide issue options'
      });
    });
    document.getElementById('studentCaseDetailPresetsWrap')?.addEventListener('hidden.bs.collapse', () => {
      const toggle = document.getElementById('studentCaseDetailPresetsToggle');
      const label = document.getElementById('studentCaseDetailPresetsToggleLabel');
      toggle?.setAttribute('aria-expanded', 'false');
      const matched = presetList(document.getElementById('studentCaseCategory')?.value || 'learning')
        .includes(String(collectDetailsValue() || '').trim());
      setDisclosureToggleLabel(toggle, label, false, {
        show: matched ? 'Change issue option' : 'Show issue options',
        hide: 'Hide issue options'
      });
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
    document.getElementById('btnStudentCaseOpenCollaboration')?.addEventListener('click', () => {
      openCollaborationModal();
    });
    document.getElementById('studentCaseCollaborationHeaderBadges')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-open-collaboration]')) {
        event.preventDefault();
        openCollaborationModal();
      }
    });
    document.getElementById('btnStudentCaseCollabAssign')?.addEventListener('click', () => {
      openCollaborationPersonPicker('assign');
    });
    document.getElementById('btnStudentCaseCollabShare')?.addEventListener('click', () => {
      openCollaborationPersonPicker('share');
    });
    document.getElementById('studentCaseCollaborationModal')?.addEventListener('click', (event) => {
      handleCollaborationRemoveClick(event).catch(() => {});
    });
    document.getElementById('btnStudentCaseOpenActivity')?.addEventListener('click', () => {
      openActionsModal();
    });
    document.getElementById('btnStudentCaseActionSave')?.addEventListener('click', () => {
      saveWorkActionFromModal().catch(() => {});
    });
    document.getElementById('btnStudentCaseActionClear')?.addEventListener('click', () => {
      clearActionComposeForm();
    });
    document.getElementById('btnStudentCaseWorkActionNotifySend')?.addEventListener('click', () => {
      postWorkActionNotifications().catch(() => {});
    });
    document.getElementById('btnStudentCaseNotifySelectAll')?.addEventListener('click', () => {
      document.querySelectorAll('.student-case-notify-checkbox').forEach((input) => { input.checked = true; });
    });
    document.getElementById('btnStudentCaseNotifyClearAll')?.addEventListener('click', () => {
      document.querySelectorAll('.student-case-notify-checkbox').forEach((input) => { input.checked = false; });
    });
    document.getElementById('btnStudentCaseActionDetailEdit')?.addEventListener('click', () => {
      if (actionDetailEntry) beginEditWorkAction(actionDetailEntry);
    });
    document.getElementById('btnStudentCaseActionDetailDelete')?.addEventListener('click', () => {
      if (actionDetailEntry) deleteWorkActionEntry(actionDetailEntry).catch(() => {});
    });
    document.getElementById('studentCaseActionsTimeline')?.addEventListener('click', handleTimelineClick);
    document.getElementById('studentCaseDetailsNoteWrap')?.addEventListener('show.bs.collapse', () => {
      const toggle = document.getElementById('studentCaseDetailsNoteToggle');
      const label = document.getElementById('studentCaseDetailsNoteToggleLabel');
      toggle?.setAttribute('aria-expanded', 'true');
      setDisclosureToggleLabel(toggle, label, true, { show: 'Show full note', hide: 'Hide full note' });
    });
    document.getElementById('studentCaseDetailsNoteWrap')?.addEventListener('hide.bs.collapse', () => {
      const toggle = document.getElementById('studentCaseDetailsNoteToggle');
      const label = document.getElementById('studentCaseDetailsNoteToggleLabel');
      toggle?.setAttribute('aria-expanded', 'false');
      setDisclosureToggleLabel(toggle, label, false, { show: 'Show full note', hide: 'Hide full note' });
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
        return;
      }

      const assignBtn = event.target.closest('.js-student-case-assign');
      if (assignBtn) {
        event.preventDefault();
        const caseId = String(assignBtn.dataset.caseId || '').trim();
        if (caseId) openRemote(caseId, { collaborationAction: 'assign' });
        return;
      }

      const shareBtn = event.target.closest('.js-student-case-share');
      if (shareBtn) {
        event.preventDefault();
        const caseId = String(shareBtn.dataset.caseId || '').trim();
        if (caseId) openRemote(caseId, { collaborationAction: 'share' });
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
