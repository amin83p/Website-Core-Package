(function () {
  const root = document.querySelector('[data-master-hub]');
  if (!root) return;

  let modules = [];
  try {
    modules = JSON.parse(root.getAttribute('data-modules') || '[]');
  } catch (_) {
    modules = [];
  }

  const state = {
    currentType: root.getAttribute('data-default-type') || (modules[0] && modules[0].type) || '',
    page: 1,
    loading: false
  };

  const els = {
    tabs: root.querySelectorAll('[data-hub-tab]'),
    counts: root.querySelectorAll('[data-hub-count]'),
    title: document.getElementById('schoolMasterHubTitle'),
    eyebrow: document.getElementById('schoolMasterHubEyebrow'),
    meta: document.getElementById('schoolMasterHubMeta'),
    list: document.getElementById('schoolMasterHubList'),
    status: document.getElementById('schoolMasterHubStatus'),
    search: document.getElementById('schoolMasterHubSearch'),
    limit: document.getElementById('schoolMasterHubLimit'),
    refreshCurrent: document.getElementById('schoolMasterHubRefreshCurrent'),
    openDirectory: document.getElementById('schoolMasterHubOpenDirectory'),
    collapseSidebar: document.getElementById('schoolMasterHubCollapseSidebar')
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findModule(type) {
    return modules.find((item) => item.type === type) || null;
  }

  function setStatus(message, tone) {
    if (!els.status) return;
    const text = String(message || '').trim();
    els.status.className = `alert alert-${tone || 'info'} ${text ? '' : 'd-none'}`;
    els.status.textContent = text;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    if (els.refreshCurrent) {
      els.refreshCurrent.disabled = isLoading;
      els.refreshCurrent.innerHTML = isLoading
        ? '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Loading'
        : '<i class="bi bi-arrow-clockwise me-1"></i> Refresh';
    }
    root.querySelectorAll('[data-hub-refresh]').forEach((btn) => {
      btn.classList.toggle('disabled', isLoading);
    });
  }

  function syncActiveTab() {
    els.tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-hub-tab') === state.currentType);
    });
    const module = findModule(state.currentType);
    if (els.openDirectory) {
      if (module && module.directoryUrl) {
        els.openDirectory.href = module.directoryUrl;
        els.openDirectory.classList.remove('disabled');
      } else {
        els.openDirectory.href = '#';
        els.openDirectory.classList.add('disabled');
      }
    }
  }

  function updateCount(type, total) {
    els.counts.forEach((badge) => {
      if (badge.getAttribute('data-hub-count') === type) {
        badge.textContent = Number.isFinite(Number(total)) ? String(total) : '-';
      }
    });
  }

  function renderEmpty(message) {
    if (!els.list) return;
    els.list.innerHTML = [
      '<div class="hub-empty">',
      '<div>',
      '<i class="bi bi-inboxes display-6 d-block mb-3"></i>',
      `<div class="fw-semibold">${escapeHtml(message || 'No records found.')}</div>`,
      '</div>',
      '</div>'
    ].join('');
  }

  function renderRows(rows) {
    if (!els.list) return;
    if (!Array.isArray(rows) || !rows.length) {
      renderEmpty('No active records match the current filters.');
      return;
    }

    const body = rows.map((row) => {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const actionItems = actions.map((action) => [
        `<a class="dropdown-item text-${escapeHtml(action.tone || 'secondary')}" href="${escapeHtml(action.href || '#')}" target="_blank" rel="noopener">`,
        `<i class="${escapeHtml(action.icon || 'bi bi-box-arrow-up-right')} me-2"></i>${escapeHtml(action.label || 'Open')}`,
        '</a>'
      ].join('')).join('');
      return [
        '<article class="hub-person-card">',
        '<div class="d-flex justify-content-between align-items-start gap-2">',
        '<div class="min-w-0">',
        `<div class="fw-semibold text-truncate">${escapeHtml(row.name || '-')}</div>`,
        `<div class="text-muted small font-monospace">${escapeHtml(row.id || '')}</div>`,
        '</div>',
        '<div class="dropdown flex-shrink-0">',
        '<button class="btn btn-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">',
        '<i class="bi bi-three-dots-vertical"></i>',
        '</button>',
        `<div class="dropdown-menu dropdown-menu-end hub-action-menu">${actionItems || '<span class="dropdown-item text-muted">No actions</span>'}</div>`,
        '</div>',
        '</div>',
        '<div class="mt-2 small text-muted">',
        `<div><i class="bi bi-person-badge me-1"></i>${escapeHtml(row.personId || '-')}</div>`,
        `<div><i class="bi bi-envelope me-1"></i>${escapeHtml(row.email || '-')}</div>`,
        `<div><i class="bi bi-telephone me-1"></i>${escapeHtml(row.phone || '-')}</div>`,
        '</div>',
        '<div class="d-flex justify-content-between align-items-center gap-2 mt-2">',
        `<span class="badge text-bg-light border">${escapeHtml(row.status || 'Active')}</span>`,
        `<span class="small text-muted text-end">${escapeHtml(row.detail || '-')}</span>`,
        '</div>',
        '</article>'
      ].join('');
    }).join('');

    els.list.innerHTML = [
      '<div class="hub-person-list">',
      body,
      '</div>'
    ].join('');
  }

  function updateHeader(result) {
    const module = result && result.module ? result.module : findModule(state.currentType);
    if (els.eyebrow) els.eyebrow.textContent = module ? module.sectionId : 'Directory';
    if (els.title) els.title.textContent = module ? module.label : 'School Master Hub';
    if (els.meta) {
      const refreshed = result && result.refreshedAt
        ? new Date(result.refreshedAt).toLocaleString()
        : 'not loaded yet';
      els.meta.textContent = `${result && result.total != null ? result.total : 0} active records. Last refreshed: ${refreshed}.`;
    }
  }

  async function loadCurrent(options) {
    if (!state.currentType || state.loading) return;
    const opts = options || {};
    if (opts.resetPage !== false) state.page = 1;
    const query = new URLSearchParams({
      type: state.currentType,
      page: String(state.page),
      limit: String((els.limit && els.limit.value) || '25'),
      q: String((els.search && els.search.value) || '')
    });

    setLoading(true);
    setStatus('Loading selected directory...', 'info');
    syncActiveTab();

    try {
      const response = await fetch(`/school/master-hub/api/list?${query.toString()}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load list.');
      }
      updateHeader(payload);
      updateCount(state.currentType, payload.total);
      renderRows(payload.rows || []);
      setStatus('', 'info');
    } catch (error) {
      renderEmpty(error.message || 'Unable to load list.');
      setStatus(error.message || 'Unable to load list.', 'danger');
    } finally {
      setLoading(false);
    }
  }

  let searchTimer = null;
  if (els.search) {
    els.search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadCurrent({ resetPage: true }), 280);
    });
  }

  if (els.limit) {
    els.limit.addEventListener('change', () => loadCurrent({ resetPage: true }));
  }

  if (els.refreshCurrent) {
    els.refreshCurrent.addEventListener('click', () => loadCurrent({ resetPage: false }));
  }

  if (els.collapseSidebar) {
    els.collapseSidebar.addEventListener('click', () => {
      root.classList.toggle('hub-sidebar-collapsed');
      const collapsed = root.classList.contains('hub-sidebar-collapsed');
      els.collapseSidebar.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      els.collapseSidebar.innerHTML = collapsed
        ? '<i class="bi bi-layout-sidebar-inset-reverse"></i>'
        : '<i class="bi bi-layout-sidebar-inset"></i>';
    });
  }

  root.querySelectorAll('[data-hub-tab]').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      if (event.target && event.target.closest('[data-hub-refresh]')) return;
      state.currentType = tab.getAttribute('data-hub-tab') || state.currentType;
      loadCurrent({ resetPage: true });
    });
  });

  root.querySelectorAll('[data-hub-refresh]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.currentType = btn.getAttribute('data-hub-refresh') || state.currentType;
      loadCurrent({ resetPage: false });
    });
  });

  if (modules.length) {
    syncActiveTab();
    loadCurrent({ resetPage: true });
  }
}());
