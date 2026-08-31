(function initScheduledTaskManagerLoader(global) {
  'use strict';

  const PANEL_SCRIPT = '/scripts/scheduledTaskManagerPanel.js';
  let panelScriptPromise = null;
  let modalEl = null;
  let modalInstance = null;
  let panelRoot = null;

  function resolveAssetUrl(path) {
    const normalized = String(path || '').trim();
    if (!normalized) return '';
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  function loadScript(src) {
    const normalizedSrc = resolveAssetUrl(src);
    const existing = document.querySelector(`script[data-stm-src="${normalizedSrc}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return Promise.resolve();
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${normalizedSrc}`)), { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = normalizedSrc;
      script.async = true;
      script.dataset.stmSrc = normalizedSrc;
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${normalizedSrc}`));
      document.body.appendChild(script);
    });
  }

  function ensurePanelScript() {
    if (!panelScriptPromise) {
      panelScriptPromise = loadScript(PANEL_SCRIPT);
    }
    return panelScriptPromise;
  }

  function buildModalMarkup() {
    return `<div class="modal fade scheduled-task-manager-modal" id="scheduledTaskManagerModal" tabindex="-1" aria-labelledby="scheduledTaskManagerModalLabel" aria-hidden="true" data-bs-backdrop="false" data-bs-keyboard="true">
      <div class="modal-dialog scheduled-task-manager-dialog">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header border-0 pb-0 scheduled-task-manager-drag-handle">
            <div class="me-2 text-muted scheduled-task-manager-drag-grip" aria-hidden="true"><i class="bi bi-grip-horizontal"></i></div>
            <div class="me-auto min-w-0">
              <h5 class="modal-title fw-bold text-dark mb-0" id="scheduledTaskManagerModalLabel">
                <i class="bi bi-calendar2-check me-2"></i>Task Manager
              </h5>
              <div class="small text-muted">Next 24 hours and recent completions</div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body pt-3">
            <div class="scheduled-task-manager-panel" data-scheduled-task-manager-panel>
              <div class="scheduled-task-manager-toolbar d-flex align-items-center justify-content-between gap-2 mb-3">
                <ul class="nav nav-pills scheduled-task-manager-tabs" role="tablist">
                  <li class="nav-item" role="presentation">
                    <button class="nav-link active" type="button" data-stm-tab="upcoming" role="tab" aria-selected="true">
                      Upcoming <span class="badge rounded-pill bg-primary-subtle text-primary ms-1" data-stm-count="upcoming">0</span>
                    </button>
                  </li>
                  <li class="nav-item" role="presentation">
                    <button class="nav-link" type="button" data-stm-tab="completed" role="tab" aria-selected="false">
                      Completed <span class="badge rounded-pill bg-secondary-subtle text-secondary ms-1" data-stm-count="completed">0</span>
                    </button>
                  </li>
                </ul>
                <button type="button" class="btn btn-outline-secondary btn-sm" data-stm-refresh title="Refresh">
                  <i class="bi bi-arrow-clockwise"></i>
                </button>
              </div>
              <div class="scheduled-task-manager-loading text-center py-5" data-stm-loading>
                <div class="spinner-border text-primary" role="status"></div>
                <div class="mt-2 text-muted small">Loading scheduled tasks...</div>
              </div>
              <div class="alert alert-danger d-none" role="alert" data-stm-error></div>
              <div class="scheduled-task-manager-content d-none" data-stm-content>
                <div data-stm-pane="upcoming" class="scheduled-task-manager-pane stm-pane-active"></div>
                <div data-stm-pane="completed" class="scheduled-task-manager-pane" hidden></div>
              </div>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <a href="/scheduled-tasks/manager" class="btn btn-outline-primary btn-sm">Open full page</a>
            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function makeModalDraggable(modalElement) {
    if (!modalElement || modalElement.__stmDragBound) return;
    const dialog = modalElement.querySelector('.modal-dialog');
    const handle = modalElement.querySelector('.scheduled-task-manager-drag-handle');
    if (!dialog || !handle) return;
    modalElement.__stmDragBound = true;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function clamp(left, top) {
      const keepX = 80;
      const keepY = handle.offsetHeight || 56;
      const w = dialog.offsetWidth;
      const h = dialog.offsetHeight;
      const minLeft = -(w - keepX);
      const maxLeft = window.innerWidth - keepX;
      const minTop = -(h - keepY);
      const maxTop = window.innerHeight - keepY;
      return {
        left: Math.min(Math.max(left, minLeft), maxLeft),
        top: Math.min(Math.max(top, minTop), maxTop)
      };
    }

    function ensureFixedPosition() {
      const rect = dialog.getBoundingClientRect();
      dialog.style.position = 'fixed';
      dialog.style.margin = '0';
      dialog.style.transform = 'none';
      if (!dialog.style.left || !dialog.style.top) {
        dialog.style.left = `${Math.max(16, rect.left)}px`;
        dialog.style.top = `${Math.max(16, rect.top)}px`;
      }
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
    }

    modalElement.addEventListener('shown.bs.modal', ensureFixedPosition);

    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, a, input, select, textarea, .btn-close')) return;
      ensureFixedPosition();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = parseFloat(dialog.style.left || '0');
      startTop = parseFloat(dialog.style.top || '0');
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add('is-dragging');
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = clamp(
        startLeft + (event.clientX - startX),
        startTop + (event.clientY - startY)
      );
      dialog.style.left = `${next.left}px`;
      dialog.style.top = `${next.top}px`;
    });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      handle.releasePointerCapture?.(event.pointerId);
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildModalMarkup();
    modalEl = wrapper.firstElementChild;
    document.body.appendChild(modalEl);
    panelRoot = modalEl.querySelector('[data-scheduled-task-manager-panel]');
    makeModalDraggable(modalEl);
    if (global.bootstrap?.Modal) {
      modalInstance = global.bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: false, keyboard: true });
    }
    modalEl.addEventListener('show.bs.modal', async () => {
      await ensurePanelScript();
      if (panelRoot && global.ScheduledTaskManagerPanel && !panelRoot.__stmBound) {
        global.ScheduledTaskManagerPanel.init(panelRoot, { mode: 'modal' });
      } else if (panelRoot?.__stmRefresh) {
        panelRoot.__stmRefresh();
      }
    });
    return modalEl;
  }

  async function openModal() {
    await ensurePanelScript();
    const modal = ensureModal();
    if (panelRoot && global.ScheduledTaskManagerPanel) {
      global.ScheduledTaskManagerPanel.init(panelRoot, { mode: 'modal' });
    }
    if (modalInstance) {
      modalInstance.show();
      return;
    }
    modal.classList.add('show');
    modal.style.display = 'block';
    modal.removeAttribute('aria-hidden');
  }

  function init() {
    // Header inline script loads this bundle and calls ScheduledTaskManagerLoader.open().
  }

  global.ScheduledTaskManagerLoader = {
    open: openModal,
    init
  };
})(window);
