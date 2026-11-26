(function initWordOfDayReviewModal(global) {
  'use strict';

  const state = {
    authorUserIds: [],
    authorLabels: [],
    entries: new Map(),
    detailEntryId: '',
    shortcutsBound: false
  };

  let reviewModal;

  function qs(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDay(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '—';
    return raw.length >= 10 ? raw.slice(0, 10) : raw;
  }

  function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 'bg-success';
    if (s === 'submitted') return 'bg-warning text-dark';
    if (s === 'rejected') return 'bg-danger';
    if (s === 'on_hold') return 'bg-info text-dark';
    if (s === 'archived') return 'bg-dark';
    if (s === 'reopened') return 'bg-primary';
    return 'bg-secondary';
  }

  function selectedStatuses() {
    return [...document.querySelectorAll('.wod-review-status-cb:checked')]
      .map((el) => String(el.value || '').trim())
      .filter(Boolean);
  }

  function setDefaultStatusFilters() {
    document.querySelectorAll('.wod-review-status-cb').forEach((el) => {
      el.checked = String(el.value || '') === 'submitted';
    });
  }

  function renderUserChips() {
    const box = qs('wodReviewUserChips');
    const clearBtn = qs('wodReviewClearUsersBtn');
    const hidden = qs('wodReviewAuthorUserIds');
    if (!box) return;
    box.className = 'wod-review-author-summary';
    if (!state.authorUserIds.length) {
      box.innerHTML = '<span class="small text-muted mb-0">All users</span>';
      clearBtn?.classList.add('d-none');
      if (hidden) hidden.value = '';
      return;
    }
    clearBtn?.classList.remove('d-none');
    if (hidden) hidden.value = state.authorUserIds.join(',');
    box.innerHTML = state.authorUserIds.map((id, idx) => {
      const label = escapeHtml(state.authorLabels[idx] || id);
      return `<span class="badge bg-white text-dark border px-2 py-1">${label}</span>`;
    }).join('');
  }

  function bindDateShortcuts() {
    if (state.shortcutsBound) return;
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (!shortcuts?.bindDateRangeShortcuts) return;
    shortcuts.bindDateRangeShortcuts({
      menuId: 'wodReviewDateRangeMenu',
      shortcutsButtonId: 'wodReviewDateShortcutsBtn',
      startInputId: 'wodReviewDateFrom',
      endInputId: 'wodReviewDateTo'
    });
    state.shortcutsBound = true;
  }

  function resetFilters() {
    qs('wodReviewDateFrom').value = '';
    qs('wodReviewDateTo').value = '';
    qs('wodReviewText').value = '';
    state.authorUserIds = [];
    state.authorLabels = [];
    renderUserChips();
    setDefaultStatusFilters();
    global.SchoolDateRangeShortcuts?.clearActiveMenuOption?.(qs('wodReviewDateRangeMenu'));
  }

  function collectSearchPayload() {
    return {
      dateFrom: String(qs('wodReviewDateFrom')?.value || '').trim(),
      dateTo: String(qs('wodReviewDateTo')?.value || '').trim(),
      authorUserIds: [...state.authorUserIds],
      statuses: selectedStatuses(),
      text: String(qs('wodReviewText')?.value || '').trim()
    };
  }

  function renderWorkflowActions(caps, options = {}) {
    const ui = global.WordOfDayEntryDetailUi;
    if (!ui?.renderActionButtons) return '';
    return ui.renderActionButtons(caps, 'wod-review-action', {
      size: options.compact ? 'sm' : 'md'
    });
  }

  function beginWorkflowLoading(action) {
    const ui = global.WordOfDayEntryDetailUi;
    const note = ui?.workflowLoadingMessage
      ? ui.workflowLoadingMessage(action)
      : 'Updating status…';
    if (typeof global.showLoading === 'function') {
      return global.showLoading({
        title: 'Word of the Day',
        note,
        operation: 'Review'
      });
    }
    return null;
  }

  function endWorkflowLoading(token) {
    if (token && typeof global.hideLoading === 'function') {
      global.hideLoading(token);
    }
  }

  function upsertRow(entry) {
    if (!entry?.id) return;
    state.entries.set(String(entry.id), entry);
    const tbody = qs('wodReviewResultsBody');
    if (!tbody) return;
    const id = String(entry.id);
    let tr = tbody.querySelector(`tr[data-entry-id="${CSS.escape(id)}"]`);
    const caps = entry.capabilities || {};
    const status = String(entry.status || '').toLowerCase();
    const rowHtml = `
      <td class="ps-3"><button type="button" class="btn btn-link p-0 fw-bold text-decoration-none wod-review-open" data-entry-id="${escapeHtml(id)}">${escapeHtml(entry.word || '—')}</button>
        <div class="small text-muted">${escapeHtml(entry.meaning || '').slice(0, 80)}</div></td>
      <td class="small">${escapeHtml(entry.authorName || entry.authorUserId || '—')}</td>
      <td><span class="badge ${statusBadgeClass(status)}">${escapeHtml(status.replace(/_/g, ' '))}</span></td>
      <td class="small text-muted">${escapeHtml(formatDay(entry.audit?.createDateTime))}</td>
      <td class="small text-muted">${escapeHtml(formatDay(entry.audit?.lastUpdateDateTime))}</td>
      <td class="text-end pe-3"><div class="wod-review-row-actions" role="group">${renderWorkflowActions(caps, { compact: true })}</div></td>`;

    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.entryId = id;
      tr.innerHTML = rowHtml;
      tbody.appendChild(tr);
    } else {
      tr.innerHTML = rowHtml;
    }
  }

  function renderResults(entries) {
    const tbody = qs('wodReviewResultsBody');
    const statusEl = qs('wodReviewResultsStatus');
    if (!tbody) return;
    state.entries.clear();
    tbody.innerHTML = '';
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No words match your filters.</td></tr>';
      statusEl?.classList.remove('d-none');
      if (statusEl) statusEl.textContent = '0 results';
      return;
    }
    entries.forEach((row) => upsertRow(row));
    statusEl?.classList.remove('d-none');
    if (statusEl) statusEl.textContent = `${entries.length} result(s)`;
  }

  async function runSearch() {
    const btn = qs('wodReviewSearchBtn');
    const tbody = qs('wodReviewResultsBody');
    if (btn) btn.disabled = true;
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Searching…</td></tr>';
    }
    try {
      const res = await fetch('/school/word-of-day/api/review-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        },
        body: JSON.stringify(collectSearchPayload())
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (global.WordOfDayWorkflow?.showAlert) {
          await global.WordOfDayWorkflow.showAlert('Search failed', data.message || 'Search failed.', 'error');
        } else if (global.SchoolMessageUi?.showAlert) {
          await global.SchoolMessageUi.showAlert('Search failed', 'error', data.message || 'Search failed.');
        } else {
          global.alert(data.message || 'Search failed.');
        }
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Search failed.</td></tr>';
        return;
      }
      renderResults(Array.isArray(data.entries) ? data.entries : []);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function handleWorkflowAction(entryId, action, entry) {
    const wf = global.WordOfDayWorkflow;
    if (!wf?.postWorkflowAction) return;
    const hasDisplay = Number(entry?.display?.displayCount || 0) > 0 || entry?.capabilities?.hasDisplayHistory;
    if (!await wf.confirmRiskyAction(action, hasDisplay)) return;
    const loadingToken = beginWorkflowLoading(action);
    try {
      const note = global.WordOfDayEntryDetailUi?.readWorkflowNote?.('wodListEntryWorkflowNote') || '';
      const result = await wf.postWorkflowAction(entryId, action, { note });
      if (!result.ok) {
        if (result.message && wf.showAlert) await wf.showAlert('Action failed', result.message, 'error');
        else if (result.message) global.alert(result.message);
        return;
      }
      if (action === 'delete') {
        state.entries.delete(String(entryId));
        const tr = qs('wodReviewResultsBody')?.querySelector(`tr[data-entry-id="${CSS.escape(String(entryId))}"]`);
        tr?.remove();
        global.bootstrap?.Modal.getInstance(qs('wordOfDayEntryModal'))?.hide();
        return;
      }
      await refreshEntryAfterAction(entryId, null);
      if (global.WordOfDayList?.refreshEntry) {
        await global.WordOfDayList.refreshEntry(entryId);
      }
    } finally {
      endWorkflowLoading(loadingToken);
    }
  }

  async function refreshEntryAfterAction(entryId, fallback) {
    const id = String(entryId || '').trim();
    if (!id) return;
    try {
      const res = await fetch(`/school/word-of-day/api/${encodeURIComponent(id)}/detail`, {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.entry) {
        const row = { ...data.entry, capabilities: data.capabilities };
        state.entries.set(String(row.id), row);
        upsertRow(row);
        return row;
      }
    } catch (_) { /* fallback below */ }
    if (fallback) upsertRow(fallback);
    return fallback || null;
  }

  function openDetail(entryId) {
    const id = String(entryId || '').trim();
    if (!id) return;
    state.detailEntryId = id;
    if (global.WordOfDayList?.openEntry) {
      void global.WordOfDayList.openEntry(id);
      return;
    }
    if (global.WordOfDayWorkflow?.showAlert) {
      void global.WordOfDayWorkflow.showAlert('Unavailable', 'Word detail is not available.', 'warning');
    }
  }

  function openReviewModal() {
    const el = qs('wordOfDayReviewModal');
    if (!el || !global.bootstrap?.Modal) return;
    if (!reviewModal) reviewModal = global.bootstrap.Modal.getOrCreateInstance(el);
    bindDateShortcuts();
    reviewModal.show();
  }

  function bindUserPicker() {
    qs('wodReviewPickUsersBtn')?.addEventListener('click', () => {
      const contexts = global.GenericPickerContexts || {};
      const activeOrgContext = typeof contexts.activeOrganizationScope === 'function'
        ? contexts.activeOrganizationScope({ label: 'Active Organization Scope' })
        : null;
      if (!global.GenericPicker || !global.GenericPickerPresets?.user) {
        if (global.WordOfDayWorkflow?.showAlert) {
          void global.WordOfDayWorkflow.showAlert('Unavailable', 'User picker is not available.', 'warning');
        } else {
          global.alert('User picker is not available.');
        }
        return;
      }
      global.GenericPicker.open(global.GenericPickerPresets.user({
        title: 'Select authors',
        icon: 'bi-people',
        multiselect: true,
        apiEndpoint: '/users',
        searchFields: 'id,username,email,name',
        placeholder: 'Search users…',
        context: activeOrgContext,
        onSelect: (items) => {
          const list = Array.isArray(items) ? items : (items ? [items] : []);
          list.forEach((item) => {
            const id = String(item?.id || item?.userId || '').trim();
            if (!id || state.authorUserIds.includes(id)) return;
            state.authorUserIds.push(id);
            const label = String(item?.name || item?.username || item?.email || id).trim();
            state.authorLabels.push(label);
          });
          renderUserChips();
        }
      }));
    });
    qs('wodReviewClearUsersBtn')?.addEventListener('click', () => {
      state.authorUserIds = [];
      state.authorLabels = [];
      renderUserChips();
    });
  }

  function bindEvents() {
    qs('btnWordOfDayReview')?.addEventListener('click', () => openReviewModal());
    qs('wodReviewSearchBtn')?.addEventListener('click', () => void runSearch());
    qs('wodReviewResetBtn')?.addEventListener('click', () => resetFilters());

    qs('wodReviewResultsBody')?.addEventListener('click', (ev) => {
      const openBtn = ev.target.closest('.wod-review-open');
      if (openBtn) {
        ev.preventDefault();
        openDetail(openBtn.getAttribute('data-entry-id'));
        return;
      }
      const actionBtn = ev.target.closest('.wod-review-action');
      if (actionBtn) {
        const row = actionBtn.closest('tr[data-entry-id]');
        const entryId = row?.getAttribute('data-entry-id');
        const entry = state.entries.get(String(entryId || ''));
        if (entryId) void handleWorkflowAction(entryId, actionBtn.getAttribute('data-wod-action'), entry);
      }
    });
  }

  function initFromBootstrap() {
    const el = qs('wodListReviewBootstrap');
    if (!el) return;
    let data = {};
    try {
      data = JSON.parse(el.textContent || '{}');
    } catch (_) { /* ignore */ }
    if (data.openReview) openReviewModal();
  }

  function boot() {
    if (!qs('wordOfDayReviewModal')) return;
    bindUserPicker();
    bindEvents();
    initFromBootstrap();
    global.WordOfDayReviewModal = {
      open: openReviewModal,
      search: runSearch,
      syncEntry: (entryId) => refreshEntryAfterAction(entryId, null)
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}(typeof window !== 'undefined' ? window : globalThis));