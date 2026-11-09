(function initNewsUnreadSideControl(global) {
  'use strict';

  const DEFAULT_ENDPOINT = '/news/api/unread';
  const DEFAULT_POLL_SECONDS = 120;

  let pollTimer = null;
  let lastSnapshot = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPublishLabel(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '';
    try {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (_) {
      return '';
    }
  }

  function readConfig() {
    const cfg = global.__NEWS_UNREAD_SIDE_CONTROL__;
    if (!cfg || typeof cfg !== 'object') return null;
    return {
      endpoint: String(cfg.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
      pollIntervalMs: Math.max(
        30000,
        (Number.parseInt(String(cfg.pollIntervalSeconds ?? DEFAULT_POLL_SECONDS), 10) || DEFAULT_POLL_SECONDS) * 1000
      ),
      csrfToken: String(cfg.csrfToken || '').trim()
    };
  }

  function renderSideControlContent(button) {
    if (!button) return;
    button.innerHTML = `
      <span class="news-unread-side-control__rings" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <i class="bi bi-newspaper news-unread-side-control__icon" aria-hidden="true"></i>
    `;
  }

  function headerSideControlsButtonHost() {
    return document.getElementById('headerSideControlsPanel')
      || document.querySelector('.header-side-controls');
  }

  function ensureSideControl() {
    const host = headerSideControlsButtonHost();
    if (!host) return null;
    let button = document.getElementById('newsUnreadSideControl');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'newsUnreadSideControl';
      button.className = 'header-settings-toggle header-side-control-btn news-unread-side-control';
      button.setAttribute('data-no-wait', 'true');
      button.setAttribute('aria-label', 'Unread news articles');
      button.title = 'News';
      renderSideControlContent(button);
    } else if (!button.querySelector('.news-unread-side-control__icon')) {
      renderSideControlContent(button);
    }

    const diagnosticsButton = document.getElementById('pageDiagnosticsSideControl');
    const autosaveButton = document.getElementById('schoolAutosaveSideControl');
    const anchor = autosaveButton || diagnosticsButton;
    if (anchor && anchor.parentElement === host) {
      if (button.nextElementSibling !== anchor) {
        anchor.before(button);
      }
    } else if (button.parentElement !== host) {
      host.appendChild(button);
    }

    if (typeof global.scheduleSyncHeaderSideControlsMobileMode === 'function') {
      global.scheduleSyncHeaderSideControlsMobileMode();
    }
    return button;
  }

  function updateSideControlUi(button, snapshot) {
    if (!button) return;
    const hasUnread = Boolean(snapshot?.hasUnread);
    const count = Number(snapshot?.count) || 0;
    button.classList.toggle('news-unread-side-control--broadcast', hasUnread);
    const label = hasUnread
      ? `${count} unread news article${count === 1 ? '' : 's'}`
      : 'You are caught up on news';
    button.title = hasUnread ? label : 'News — all caught up';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', hasUnread ? 'true' : 'false');
  }

  function ensureListModal() {
    let modal = document.getElementById('newsUnreadListModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'newsUnreadListModal';
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-md modal-dialog-scrollable news-unread-list-modal">
        <div class="modal-content border-0 shadow-lg news-unread-list-modal__content">
          <div class="modal-header news-unread-list-modal__header">
            <div class="d-flex align-items-start gap-3">
              <div class="news-unread-list-modal__header-icon" aria-hidden="true">
                <i class="bi bi-newspaper"></i>
              </div>
              <div class="min-w-0">
                <h5 class="modal-title fw-bold mb-1" id="newsUnreadListModalTitle">Unread news</h5>
                <p class="text-muted small mb-0" id="newsUnreadListModalSubtitle">Articles you have not opened yet.</p>
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body news-unread-list-modal__body" id="newsUnreadListModalBody"></div>
          <div class="modal-footer news-unread-list-modal__footer gap-2">
            <a href="/news" class="btn btn-primary btn-filled" data-no-wait="true" id="newsUnreadListModalAllNews">
              <i class="bi bi-grid me-1" aria-hidden="true"></i>Browse all news
            </a>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-no-wait="true">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function buildListHtml(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      return `
        <div class="news-unread-list-modal__empty">
          <div class="news-unread-list-modal__empty-icon" aria-hidden="true">
            <i class="bi bi-check2-circle"></i>
          </div>
          <p class="fw-semibold mb-1">You are caught up</p>
          <p class="text-muted small mb-0">Every article in the current notification window has been opened.</p>
        </div>`;
    }
    const list = rows.map((item) => {
      const title = escapeHtml(item?.title || 'Untitled');
      const url = escapeHtml(item?.url || '/news');
      const category = escapeHtml(item?.category || 'General');
      const dateLabel = escapeHtml(formatPublishLabel(item?.publishDate));
      const dateHtml = dateLabel
        ? `<span class="news-unread-list-modal__date"><i class="bi bi-calendar3" aria-hidden="true"></i>${dateLabel}</span>`
        : '';
      return `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="news-unread-list-modal__item" role="listitem">
          <span class="news-unread-list-modal__item-accent" aria-hidden="true"></span>
          <span class="min-w-0 flex-grow-1">
            <span class="news-unread-list-modal__chip">${category}</span>
            <span class="news-unread-list-modal__title">${title}</span>
            ${dateHtml}
          </span>
          <span class="news-unread-list-modal__open" aria-hidden="true" title="Open in new tab">
            <i class="bi bi-box-arrow-up-right"></i>
          </span>
        </a>`;
    }).join('');
    return `
      <p class="news-unread-list-modal__lede small text-muted mb-3">
        Tap an article to open it in a new tab. Your read status updates when the article loads.
      </p>
      <div class="news-unread-list-modal__list" role="list">${list}</div>`;
  }

  function openUnreadModal(snapshot) {
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const modalEl = ensureListModal();
    const titleEl = document.getElementById('newsUnreadListModalTitle');
    const subtitleEl = document.getElementById('newsUnreadListModalSubtitle');
    const bodyEl = document.getElementById('newsUnreadListModalBody');
    if (titleEl) {
      titleEl.textContent = items.length
        ? `${items.length} unread article${items.length === 1 ? '' : 's'}`
        : 'All caught up';
    }
    if (subtitleEl) {
      subtitleEl.textContent = items.length
        ? 'Open any story below — each link opens in a new tab.'
        : 'No unread articles in the configured date range and categories.';
    }
    if (bodyEl) {
      bodyEl.innerHTML = buildListHtml(items);
    }
    let bsModal = global.bootstrap?.Modal?.getInstance(modalEl);
    if (!bsModal) {
      bsModal = new global.bootstrap.Modal(modalEl, { backdrop: true, keyboard: true });
    }
    bsModal.show();
  }

  async function fetchUnread(config) {
    const headers = { Accept: 'application/json', 'x-ajax-request': 'true' };
    if (config.csrfToken) headers['x-csrf-token'] = config.csrfToken;
    const response = await fetch(config.endpoint, {
      method: 'GET',
      headers,
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.message || 'Unable to load unread news.');
    }
    if (payload.enabled === false) {
      return { enabled: false, hasUnread: false, count: 0, items: [] };
    }
    return {
      enabled: true,
      hasUnread: payload.hasUnread === true,
      count: Number(payload.count) || 0,
      items: Array.isArray(payload.items) ? payload.items : []
    };
  }

  function clearPollTimer() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function wireButton(button) {
    if (!button || button.__newsUnreadWired) return;
    button.__newsUnreadWired = true;
    button.addEventListener('click', () => {
      openUnreadModal(lastSnapshot || { items: [], hasUnread: false, count: 0 });
    });
  }

  async function refresh(config, button) {
    try {
      const snapshot = await fetchUnread(config);
      if (snapshot.enabled === false) {
        button?.remove();
        clearPollTimer();
        return;
      }
      lastSnapshot = snapshot;
      updateSideControlUi(button, snapshot);
    } catch (_) {
      button?.classList.remove('news-unread-side-control--broadcast');
    }
  }

  function init() {
    const config = readConfig();
    if (!config) return null;

    const button = ensureSideControl();
    if (!button) return null;

    wireButton(button);
    void refresh(config, button);
    clearPollTimer();
    pollTimer = setInterval(() => {
      void refresh(config, button);
    }, config.pollIntervalMs);

    return button;
  }

  global.NewsUnreadSideControl = {
    init,
    refreshSnapshot: () => {
      const config = readConfig();
      const button = document.getElementById('newsUnreadSideControl');
      if (config && button) return refresh(config, button);
      return Promise.resolve();
    }
  };

  function bootstrapInit() {
    try {
      init();
    } catch (_) {
      // Header may mount after DOMContentLoaded on some layouts.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapInit);
  } else {
    bootstrapInit();
  }
})(window);
