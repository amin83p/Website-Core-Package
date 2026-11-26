(function initWordOfDayListClient(global) {
  'use strict';

  const ui = () => global.WordOfDayEntryDetailUi;
  const wf = () => global.WordOfDayWorkflow;
  const msg = () => global.SchoolMessageUi;

  let entryModal;
  let activeEntryId = '';

  async function showAlert(title, message, icon) {
    if (msg()?.showAlert) {
      await msg().showAlert(title, icon || 'error', message);
      return;
    }
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title,
        message,
        icon: icon || 'error',
        buttons: [{ text: 'OK', class: icon === 'success' ? 'btn-success' : 'btn-primary' }]
      });
      return;
    }
    global.alert(String(message || title));
  }

  function qs(id) {
    return document.getElementById(id);
  }

  function updateListRowStatus(entry) {
    if (!entry?.id) return;
    const row = document.querySelector(`#first-table tr[data-entry-id="${CSS.escape(String(entry.id))}"]`);
    if (!row) return;
    const status = String(entry.status || '').toLowerCase();
    const badge = row.querySelector('[data-wod-list-status]');
    if (badge) {
      badge.className = `badge ${ui()?.statusBadgeClass(status) || 'bg-secondary'}`;
      badge.textContent = status.replace(/_/g, ' ').toUpperCase();
    }
    const disp = row.querySelector('[data-wod-list-displays]');
    if (disp) disp.textContent = String(Number(entry.display?.displayCount || 0));
  }

  function removeListRow(entryId) {
    const row = document.querySelector(`#first-table tr[data-entry-id="${CSS.escape(String(entryId))}"]`);
    row?.remove();
    const tbody = document.querySelector('#first-table tbody');
    if (tbody && !tbody.querySelector('[data-entry-id]')) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No entries found.</td></tr>';
    }
  }

  async function refreshEntryInModal(entryId) {
    const res = await fetch(`/school/word-of-day/api/${encodeURIComponent(entryId)}/detail`, {
      headers: { Accept: 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to reload entry.');
    const entry = { ...data.entry, capabilities: data.capabilities };
    renderEntryModal(entry, data);
    updateListRowStatus(entry);
    return entry;
  }

  function renderEntryModal(entry, payload) {
    const body = qs('wodListEntryBody');
    const actions = qs('wodListEntryActions');
    const title = qs('wordOfDayEntryModalLabel');
    if (!body || !entry) return;
    const caps = payload?.capabilities || entry.capabilities || {};
    if (title) title.textContent = entry.word || 'Word of the Day';
    const subtitle = qs('wodListEntrySubtitle');
    if (subtitle) {
      const phonetics = ui()?.renderHeaderSubtitleHtml?.(entry) || '';
      subtitle.innerHTML = phonetics;
      subtitle.style.display = phonetics ? '' : 'none';
    }
    const headerStatus = qs('wodListEntryHeaderStatus');
    if (headerStatus && ui()?.renderHeaderStatusHtml) {
      headerStatus.innerHTML = ui().renderHeaderStatusHtml(entry);
    }
    body.innerHTML = ui()?.renderEntryDetailHtml(entry, payload, { layout: 'modal' }) || '';
    ui()?.bindEntryMediaInteractions?.(body);
    if (actions) {
      const editLink = ui()?.renderEditLink?.(entry, caps) || '';
      const workflowBtns = ui()?.renderActionButtons(caps, 'wod-list-entry-action', { size: 'md' }) || '';
      actions.innerHTML = `${editLink}${workflowBtns}`;
      actions.dataset.entryId = entry.id;
      actions.dataset.hasDisplay = caps.hasDisplayHistory ? '1' : '0';
      actions.dataset.canEdit = caps.canEdit ? '1' : '0';
    }
    const note = qs('wodListEntryWorkflowNote');
    if (note) note.value = '';
  }

  function bindEntryModalStacking() {
    const el = qs('wordOfDayEntryModal');
    if (!el || el.dataset.wodEntryStackBound === '1') return;
    el.dataset.wodEntryStackBound = '1';
    const stack = () => global.SchoolModalStack;
    el.addEventListener('show.bs.modal', () => {
      stack()?.mountModalToBody?.(el);
    });
    el.addEventListener('shown.bs.modal', () => {
      stack()?.raiseAboveOpenModals?.(el);
    });
    el.addEventListener('hidden.bs.modal', () => {
      global.SchoolModalStack?.clearRaise?.(el);
    });
  }

  let feedbackModal;

  async function openPublicFeedbackModal(entryId, wordLabel) {
    const id = String(entryId || '').trim();
    if (!id) return;
    const el = qs('wordOfDayPublicFeedbackModal');
    const body = qs('wodPublicFeedbackModalBody');
    const title = qs('wordOfDayPublicFeedbackModalLabel');
    if (!el || !global.bootstrap?.Modal || !body) return;
    if (title) title.textContent = wordLabel ? `Public feedback — ${wordLabel}` : 'Public feedback';
    body.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>';
    global.SchoolModalStack?.mountModalToBody?.(el);
    feedbackModal = global.bootstrap.Modal.getOrCreateInstance(el);
    feedbackModal.show();
    try {
      const res = await fetch(`/school/word-of-day/api/${encodeURIComponent(id)}/public-feedback`, {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        body.innerHTML = `<div class="alert alert-danger mb-0">${ui()?.escapeHtml(data.message || 'Load failed.')}</div>`;
        return;
      }
      body.innerHTML = ui()?.renderPublicFeedbackModalBody?.(data, data.word || wordLabel) || '';
    } catch (_) {
      body.innerHTML = '<div class="alert alert-danger mb-0">Load failed.</div>';
    }
  }

  async function openEntryModal(entryId) {
    const id = String(entryId || '').trim();
    if (!id) return;
    activeEntryId = id;
    const el = qs('wordOfDayEntryModal');
    if (!el || !global.bootstrap?.Modal) return;
    global.SchoolModalStack?.mountModalToBody?.(el);
    entryModal = global.bootstrap.Modal.getOrCreateInstance(el);
    const body = qs('wodListEntryBody');
    const actions = qs('wodListEntryActions');
    if (body) body.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>';
    if (actions) actions.innerHTML = '';
    const headerStatus = qs('wodListEntryHeaderStatus');
    if (headerStatus) headerStatus.innerHTML = '';
    const title = qs('wordOfDayEntryModalLabel');
    if (title) title.textContent = 'Word of the Day';
    const subtitle = qs('wodListEntrySubtitle');
    if (subtitle) {
      subtitle.textContent = '';
      subtitle.innerHTML = '';
      subtitle.style.display = 'none';
    }
    entryModal.show();
    try {
      const res = await fetch(`/school/word-of-day/api/${encodeURIComponent(id)}/detail`, {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body) body.innerHTML = `<div class="alert alert-danger mb-0">${ui()?.escapeHtml(data.message || 'Load failed.')}</div>`;
        return;
      }
      renderEntryModal({ ...data.entry, capabilities: data.capabilities }, data);
    } catch (err) {
      if (body) body.innerHTML = '<div class="alert alert-danger mb-0">Load failed.</div>';
    }
  }

  async function handleWorkflowAction(entryId, action, hasDisplayHistory) {
    const workflow = wf();
    if (!workflow?.postWorkflowAction) return;
    const ok = await workflow.confirmRiskyAction(action, hasDisplayHistory);
    if (!ok) return;
    const note = ui()?.readWorkflowNote('wodListEntryWorkflowNote') || '';
    const loadingNote = ui()?.workflowLoadingMessage?.(action) || 'Updating status…';
    const loadingToken = typeof global.showLoading === 'function'
      ? global.showLoading({ title: 'Word of the Day', note: loadingNote, operation: 'Update' })
      : null;
    try {
      const result = await workflow.postWorkflowAction(entryId, action, { note });
      if (!result.ok) {
        await showAlert('Action failed', result.message || 'Unable to complete that action.', 'error');
        return;
      }
      await showAlert('Success', result.message || 'Saved.', 'success');
      if (action === 'delete') {
        entryModal?.hide();
        removeListRow(entryId);
        if (global.WordOfDayReviewModal?.syncEntry) {
          const tr = document.querySelector(`#wodReviewResultsBody tr[data-entry-id="${CSS.escape(String(entryId))}"]`);
          tr?.remove();
        }
        return;
      }
      await refreshEntryInModal(entryId);
      if (global.WordOfDayReviewModal?.syncEntry) {
        await global.WordOfDayReviewModal.syncEntry(entryId);
      }
    } finally {
      if (loadingToken && typeof global.hideLoading === 'function') {
        global.hideLoading(loadingToken);
      }
    }
  }

  async function deleteFromMenu(entryId, wordLabel) {
    const workflow = wf();
    if (!workflow?.confirmRiskyAction) return;
    const ok = await workflow.confirmRiskyAction('delete', false);
    if (!ok) return;
    const note = ui()?.readWorkflowNote('wodListEntryWorkflowNote') || '';
    const result = await workflow.postWorkflowAction(entryId, 'delete', { note });
    if (!result.ok) {
      await showAlert('Delete failed', result.message || 'Unable to delete this entry.', 'error');
      return;
    }
    await showAlert('Deleted', result.message || 'Entry deleted.', 'success');
    removeListRow(entryId);
  }

  function bindEntryModalActions() {
    qs('wodListEntryActions')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-wod-action]');
      if (!btn) return;
      const container = qs('wodListEntryActions');
      const entryId = container?.dataset?.entryId || activeEntryId;
      const hasDisplay = container?.dataset?.hasDisplay === '1';
      void handleWorkflowAction(entryId, btn.getAttribute('data-wod-action'), hasDisplay);
    });
  }

  let listRowClickBound = false;

  function readListBootstrap() {
    const el = document.getElementById('wodListReviewBootstrap');
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (_) {
      return {};
    }
  }

  function initListClient() {
    bindEntryModalStacking();
    bindEntryModalActions();
    if (qs('first-table') && !listRowClickBound) {
      bindListRowEvents();
      listRowClickBound = true;
    }
    global.WordOfDayList = {
      openEntry: openEntryModal,
      openPublicFeedback: openPublicFeedbackModal,
      refreshEntry: refreshEntryInModal,
      getActiveEntryId: () => activeEntryId
    };
    const boot = readListBootstrap();
    const openEntryId = String(boot.openEntryId || '').trim();
    if (openEntryId) {
      void openEntryModal(openEntryId);
    }
  }

  function bindListRowEvents() {
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('#first-table, .row-actions-menu')) return;

      const openBtn = ev.target.closest('[data-wod-list-open]');
      if (openBtn) {
        ev.preventDefault();
        void openEntryModal(openBtn.getAttribute('data-entry-id'));
        return;
      }

      const feedbackBtn = ev.target.closest('[data-wod-list-feedback]');
      if (feedbackBtn) {
        ev.preventDefault();
        void openPublicFeedbackModal(
          feedbackBtn.getAttribute('data-entry-id'),
          feedbackBtn.getAttribute('data-word-label')
        );
        return;
      }

      const delBtn = ev.target.closest('[data-wod-list-delete]');
      if (delBtn) {
        ev.preventDefault();
        void deleteFromMenu(
          delBtn.getAttribute('data-entry-id'),
          delBtn.getAttribute('data-word-label')
        );
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initListClient);
}(typeof window !== 'undefined' ? window : globalThis));