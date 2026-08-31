(function initScheduledTaskManagerPanel(global) {
  'use strict';

  const API_URL = '/scheduled-tasks/api/manager-window';
  const REFRESH_MS = 30000;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function initialsFromName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (_) {
      return iso;
    }
  }

  function statusMeta(status) {
    const token = String(status || '').toLowerCase();
    if (token === 'running') return { className: 'stm-status-running', icon: 'bi-play-circle-fill', label: 'Running' };
    if (token === 'pending') return { className: 'stm-status-pending', icon: 'bi-hourglass-split', label: 'Pending' };
    if (token === 'succeeded') return { className: 'stm-status-succeeded', icon: 'bi-check-circle-fill', label: 'Succeeded' };
    if (token === 'failed') return { className: 'stm-status-failed', icon: 'bi-x-circle-fill', label: 'Failed' };
    if (token === 'cancelled') return { className: 'stm-status-cancelled', icon: 'bi-slash-circle', label: 'Cancelled' };
    return { className: 'stm-status-scheduled', icon: 'bi-calendar2-event', label: 'Scheduled' };
  }

  function renderEmpty(message) {
    return `<div class="scheduled-task-manager-empty text-center text-muted py-5">
      <i class="bi bi-inbox fs-1 opacity-25 d-block mb-2"></i>
      <div class="fw-semibold">${escapeHtml(message)}</div>
    </div>`;
  }

  function renderUpcomingCard(item) {
    const meta = statusMeta(item.status);
    return `<article class="scheduled-task-manager-card" data-stm-scheduled-for="${escapeHtml(item.scheduledFor || '')}">
      <div class="scheduled-task-manager-card-accent ${meta.className}"></div>
      <div class="scheduled-task-manager-card-body">
        <div class="d-flex align-items-start gap-3">
          <div class="scheduled-task-manager-status-icon ${meta.className}">
            <i class="bi ${meta.icon}"></i>
          </div>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div class="min-w-0">
                <div class="fw-semibold text-dark text-truncate">${escapeHtml(item.label || item.taskKey)}</div>
                <div class="small text-muted font-monospace text-truncate">${escapeHtml(item.taskKey || '')}</div>
              </div>
              <span class="badge rounded-pill stm-countdown-badge">${escapeHtml(item.remainingLabel || 'Due now')}</span>
            </div>
            <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
              <span class="scheduled-task-manager-avatar">${escapeHtml(initialsFromName(item.organizedByDisplayName))}</span>
              <span class="small text-dark">${escapeHtml(item.organizedByDisplayName || 'System')}</span>
              <span class="badge bg-light text-secondary border">${escapeHtml(item.orgName || 'System')}</span>
            </div>
            <div class="small text-muted mt-2">Runs ${escapeHtml(formatDateTime(item.scheduledFor))}</div>
            <div class="progress scheduled-task-manager-progress mt-2" role="progressbar" aria-valuenow="${Number(item.progressPct || 0)}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-bar" style="width: ${Math.max(0, Math.min(100, Number(item.progressPct || 0)))}%"></div>
            </div>
          </div>
        </div>
      </div>
    </article>`;
  }

  function renderCompletedCard(item) {
    const meta = statusMeta(item.status);
    const result = item.status === 'failed'
      ? (item.errorMessage || item.resultSummary || 'Failed.')
      : (item.resultSummary || 'Completed.');
    return `<article class="scheduled-task-manager-card">
      <div class="scheduled-task-manager-card-accent ${meta.className}"></div>
      <div class="scheduled-task-manager-card-body">
        <div class="d-flex align-items-start gap-3">
          <div class="scheduled-task-manager-status-icon ${meta.className}">
            <i class="bi ${meta.icon}"></i>
          </div>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div class="min-w-0">
                <div class="fw-semibold text-dark text-truncate">${escapeHtml(item.label || item.taskKey)}</div>
                <div class="small text-muted font-monospace text-truncate">${escapeHtml(item.taskKey || '')}</div>
              </div>
              <span class="badge rounded-pill ${meta.className} border">${escapeHtml(meta.label)}</span>
            </div>
            <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
              <span class="scheduled-task-manager-avatar">${escapeHtml(initialsFromName(item.organizedByDisplayName))}</span>
              <span class="small text-dark">${escapeHtml(item.organizedByDisplayName || 'System')}</span>
              <span class="badge bg-light text-secondary border">${escapeHtml(item.orgName || 'System')}</span>
            </div>
            <div class="scheduled-task-manager-result mt-2 small">${escapeHtml(result)}</div>
            <div class="d-flex justify-content-between gap-2 mt-2 small text-muted flex-wrap">
              <span>Finished ${escapeHtml(formatDateTime(item.finishedAt))}</span>
              <span>${escapeHtml(item.durationLabel || '')}</span>
            </div>
          </div>
        </div>
      </div>
    </article>`;
  }

  function updateCountdowns(root, payload) {
    if (!root || !payload) return;
    const nowMs = Date.now();
    const windowMs = Math.max(1, Number(payload.windowHours || 24) * 60 * 60 * 1000);
    root.querySelectorAll('[data-stm-pane="upcoming"] [data-stm-scheduled-for]').forEach((card) => {
      const iso = card.getAttribute('data-stm-scheduled-for');
      const badge = card.querySelector('.stm-countdown-badge');
      const progress = card.querySelector('.progress-bar');
      const scheduledMs = new Date(iso || '').getTime();
      if (!badge || !Number.isFinite(scheduledMs)) return;
      const remainingMs = Math.max(0, scheduledMs - nowMs);
      badge.textContent = remainingMs <= 0 ? 'Due now' : formatRemainingLabel(remainingMs);
      if (progress) {
        const pct = Math.max(0, Math.min(100, Math.round(((windowMs - remainingMs) / windowMs) * 100)));
        progress.style.width = `${pct}%`;
        progress.parentElement?.setAttribute('aria-valuenow', String(pct));
      }
    });
  }

  function formatRemainingLabel(remainingMs) {
    const ms = Math.max(0, Number(remainingMs) || 0);
    if (ms <= 0) return 'Due now';
    const totalMinutes = Math.ceil(ms / 60000);
    if (totalMinutes < 60) return `in ${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? `in ${days}d ${remHours}h` : `in ${days}d`;
  }

  function getContentEl(root) {
    return root?.querySelector?.('[data-stm-content]') || null;
  }

  function getPane(root, paneName) {
    const contentEl = getContentEl(root);
    if (!contentEl) return null;
    return contentEl.querySelector(`[data-stm-pane="${paneName}"]`);
  }

  function setActiveTab(root, tabName) {
    const token = String(tabName || 'upcoming').trim() || 'upcoming';
    root.__stmActiveTab = token;
    root.querySelectorAll('[data-stm-tab]').forEach((button) => {
      const active = button.getAttribute('data-stm-tab') === token;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const contentEl = getContentEl(root);
    const panes = contentEl
      ? [...contentEl.querySelectorAll('[data-stm-pane]')]
      : [...root.querySelectorAll('[data-stm-pane]')];
    panes.forEach((pane) => {
      const active = pane.getAttribute('data-stm-pane') === token;
      pane.classList.toggle('stm-pane-active', active);
      pane.classList.remove('d-none');
      if (active) {
        pane.removeAttribute('hidden');
      } else {
        pane.setAttribute('hidden', '');
      }
    });
  }

  function renderPanel(root, payload) {
    const upcomingPane = getPane(root, 'upcoming');
    const completedPane = getPane(root, 'completed');
    const upcoming = Array.isArray(payload?.upcoming) ? payload.upcoming : [];
    const completed = Array.isArray(payload?.completed) ? payload.completed : [];

    if (upcomingPane) {
      upcomingPane.innerHTML = upcoming.length
        ? upcoming.map(renderUpcomingCard).join('')
        : renderEmpty('No scheduled tasks in the next 24 hours.');
    }
    if (completedPane) {
      completedPane.innerHTML = completed.length
        ? completed.map(renderCompletedCard).join('')
        : renderEmpty('No completed task runs in the last 24 hours.');
    }

    root.querySelectorAll('[data-stm-count]').forEach((badge) => {
      const key = badge.getAttribute('data-stm-count');
      if (key === 'upcoming') badge.textContent = String(upcoming.length);
      if (key === 'completed') badge.textContent = String(completed.length);
    });

    const generatedAtEl = document.querySelector('[data-stm-generated-at]');
    if (generatedAtEl && payload?.generatedAt) {
      generatedAtEl.textContent = `Updated ${formatDateTime(payload.generatedAt)}`;
    }

    const badgeEl = document.getElementById('scheduledTaskManagerHeaderBadge');
    if (badgeEl) {
      badgeEl.textContent = String(upcoming.length);
      badgeEl.classList.toggle('d-none', upcoming.length <= 0);
    }

    root.__stmPayload = payload;
    setActiveTab(root, root.__stmActiveTab || 'upcoming');
    updateCountdowns(root, payload);
  }

  async function fetchWindow(root) {
    const loadingEl = root.querySelector('[data-stm-loading]');
    const contentEl = root.querySelector('[data-stm-content]');
    const errorEl = root.querySelector('[data-stm-error]');
    if (loadingEl) loadingEl.classList.remove('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) errorEl.classList.add('d-none');

    try {
      const response = await fetch(API_URL, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error') {
        throw new Error(payload.message || 'Unable to load scheduled task manager.');
      }
      renderPanel(root, payload);
      if (contentEl) contentEl.classList.remove('d-none');
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message || 'Unable to load scheduled task manager.';
        errorEl.classList.remove('d-none');
      }
    } finally {
      if (loadingEl) loadingEl.classList.add('d-none');
    }
  }

  function bindPanel(root, options = {}) {
    if (!root || root.__stmBound) return root;
    root.__stmBound = true;

    root.querySelectorAll('[data-stm-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTab(root, button.getAttribute('data-stm-tab'));
      });
    });

    root.querySelector('[data-stm-refresh]')?.addEventListener('click', () => {
      fetchWindow(root);
    });

    if (root.__stmIntervalId) {
      clearInterval(root.__stmIntervalId);
    }
    root.__stmIntervalId = global.setInterval(() => {
      if (root.__stmPayload) updateCountdowns(root, root.__stmPayload);
    }, REFRESH_MS);

    root.__stmRefresh = () => fetchWindow(root);
    return root;
  }

  function init(root, options = {}) {
    if (!root) return null;
    bindPanel(root, options);
    fetchWindow(root);
    return root;
  }

  global.ScheduledTaskManagerPanel = {
    init,
    refresh(root) {
      if (root?.__stmRefresh) return root.__stmRefresh();
      return Promise.resolve();
    },
    renderPanel,
    updateCountdowns
  };
})(window);
