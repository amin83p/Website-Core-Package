(function initNotificationCenterRulesView(global) {
  const SAVE_URL_DEFAULT = '/school/notification-center/api/rules-view-mode';

  function normalizeMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'list' ? 'list' : 'tile';
  }

  function resolveCsrfHeaders() {
    const headers = global.NotificationCenterRunRule?.resolveCsrfHeaders
      ? global.NotificationCenterRunRule.resolveCsrfHeaders()
      : {
        Accept: 'application/json',
        'X-AJAX-Request': '1'
      };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
      headers['csrf-token'] = csrfToken;
    }
    headers.Accept = 'application/json';
    headers['Content-Type'] = 'application/json';
    headers['X-AJAX-Request'] = '1';
    return headers;
  }

  async function persistViewMode(saveUrl, mode) {
    const response = await fetch(saveUrl, {
      method: 'PUT',
      headers: resolveCsrfHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ viewMode: mode })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'success') {
      throw new Error(payload.message || 'Could not save view preference.');
    }
    return normalizeMode(payload.viewMode || mode);
  }

  function updateToggleButton(toggleBtn, mode) {
    if (!toggleBtn) return;
    const normalized = normalizeMode(mode);
    toggleBtn.dataset.ncViewMode = normalized;
    toggleBtn.setAttribute('aria-pressed', normalized === 'tile' ? 'true' : 'false');
    if (normalized === 'tile') {
      toggleBtn.innerHTML = '<i class="bi bi-list-ul me-1"></i> List view';
    } else {
      toggleBtn.innerHTML = '<i class="bi bi-grid-3x3-gap me-1"></i> Tile view';
    }
  }

  function applyViewMode(listPane, tilePane, toggleBtn, mode) {
    const normalized = normalizeMode(mode);
    const tileMode = normalized === 'tile';
    listPane?.classList.toggle('d-none', tileMode);
    tilePane?.classList.toggle('d-none', !tileMode);
    document.querySelector('.sections-page')?.classList.toggle('nc-rules-view--tile', tileMode);
    updateToggleButton(toggleBtn, normalized);
    syncTileVisibilityFromTable();
    return normalized;
  }

  function syncTileVisibilityFromTable() {
    const table = document.getElementById('first-table');
    const tilePane = document.getElementById('nc-rules-tile-pane');
    const listPane = document.getElementById('nc-rules-list-pane');
    if (!table || !tilePane || tilePane.classList.contains('d-none')) return;
    const listPaneHidden = Boolean(listPane?.classList.contains('d-none'));
    const hiddenIds = new Set();
    table.querySelectorAll('tbody tr[data-entity-row-id]').forEach((row) => {
      const id = String(row.getAttribute('data-entity-row-id') || '').trim();
      if (!id) return;
      const hidden = listPaneHidden
        ? false
        : (row.classList.contains('d-none')
          || window.getComputedStyle(row).display === 'none');
      if (hidden) hiddenIds.add(id);
    });
    const tiles = tilePane.querySelectorAll('.nc-rule-tile[data-nc-rule-id]');
    tiles.forEach((tile) => {
      const id = String(tile.getAttribute('data-nc-rule-id') || '').trim();
      tile.classList.toggle('d-none', hiddenIds.has(id));
    });
  }

  function bindSearchSync() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput || searchInput.dataset.ncRulesViewSyncBound === '1') return;
    searchInput.dataset.ncRulesViewSyncBound = '1';
    searchInput.addEventListener('input', () => {
      window.requestAnimationFrame(syncTileVisibilityFromTable);
    });
    const table = document.getElementById('first-table');
    if (table && typeof global.MutationObserver === 'function') {
      const observer = new global.MutationObserver(() => syncTileVisibilityFromTable());
      observer.observe(table.querySelector('tbody') || table, {
        attributes: true,
        subtree: true,
        attributeFilter: ['style', 'class']
      });
    }
  }

  function openTileContextMenu(tile, event) {
    event.preventDefault();
    event.stopPropagation();
    const toggle = tile.querySelector('.btn-row-actions-toggle');
    if (!toggle) return;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function bindTiles(tilePane) {
    if (!tilePane || tilePane.dataset.ncRulesTileBound === '1') return;
    tilePane.dataset.ncRulesTileBound = '1';

    tilePane.addEventListener('contextmenu', (event) => {
      const tile = event.target.closest('.nc-rule-tile');
      if (!tile || !tilePane.contains(tile)) return;
      openTileContextMenu(tile, event);
    });

    tilePane.addEventListener('click', async (event) => {
      if (event.target.closest('.row-actions-wrap, .row-actions-menu, a, button, form')) return;
      const tile = event.target.closest('.nc-rule-tile');
      if (!tile || !tilePane.contains(tile)) return;
      const canRun = String(tile.getAttribute('data-can-run-now') || '') === '1';
      const ruleId = String(tile.getAttribute('data-nc-rule-id') || '').trim();
      const ruleLabel = String(tile.getAttribute('data-rule-label') || '').trim() || 'this rule';
      if (!canRun) {
        if (typeof global.showMessageModal === 'function') {
          await global.showMessageModal({
            title: 'Rule actions',
            message: 'Right-click this tile for Edit and other actions.',
            icon: 'info',
            size: 'md'
          });
        }
        return;
      }
      if (!ruleId || typeof global.showMessageModal !== 'function') return;
      const choice = await global.showMessageModal({
        title: 'Run rule now',
        icon: 'question',
        message: `Run “${ruleLabel}” now? You will be taken to the results when evaluation finishes.`,
        size: 'md',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Run', class: 'btn-primary btn-md' }
        ]
      });
      if (choice !== 'Run') return;
      const runUrl = `/school/notification-center/rules/${encodeURIComponent(ruleId)}/run`;
      if (global.NotificationCenterRunRule?.runRuleAndRedirect) {
        await global.NotificationCenterRunRule.runRuleAndRedirect(runUrl);
      }
    });

    tilePane.querySelectorAll('.nc-rule-tile').forEach((tile) => {
      tile.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('.row-actions-wrap')) return;
        event.preventDefault();
        tile.click();
      });
    });
  }

  function init(options = {}) {
    const listPane = document.querySelector(options.listPaneSelector || '#nc-rules-list-pane');
    const tilePane = document.querySelector(options.tilePaneSelector || '#nc-rules-tile-pane');
    const toggleBtn = document.querySelector(options.toggleSelector || '#ncRulesViewToggle');
    const saveUrl = String(options.saveUrl || SAVE_URL_DEFAULT).trim() || SAVE_URL_DEFAULT;
    let currentMode = normalizeMode(options.initialViewMode || toggleBtn?.dataset.ncViewMode || 'tile');

    applyViewMode(listPane, tilePane, toggleBtn, currentMode);
    bindSearchSync();
    bindTiles(tilePane);

    toggleBtn?.addEventListener('click', async () => {
      const previousMode = currentMode;
      const nextMode = currentMode === 'tile' ? 'list' : 'tile';
      currentMode = applyViewMode(listPane, tilePane, toggleBtn, nextMode);
      try {
        currentMode = await persistViewMode(saveUrl, nextMode);
        applyViewMode(listPane, tilePane, toggleBtn, currentMode);
      } catch (error) {
        currentMode = applyViewMode(listPane, tilePane, toggleBtn, previousMode);
        if (typeof global.showMessageModal === 'function') {
          await global.showMessageModal({
            title: 'Could not save view',
            message: error?.message || 'Could not save view preference.',
            icon: 'error',
            size: 'md'
          });
        }
      }
    });
  }

  global.NotificationCenterRulesView = {
    init,
    syncTileVisibilityFromTable,
    normalizeMode
  };
})(window);
