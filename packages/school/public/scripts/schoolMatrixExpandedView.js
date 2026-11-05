(function initSchoolMatrixExpandedView(global) {
  'use strict';

  const MODAL_SIZE_CLASSES = ['modal-lg', 'modal-xl', 'modal-fullscreen', 'modal-dialog-centered'];
  const TITLE_LOAD_FIRST = 'Load the matrix first';
  const TITLE_EXPAND = 'Open expanded view';

  function setMatrixExpandEnabled(buttonId, enabled) {
    const btn = document.getElementById(String(buttonId || ''));
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled ? TITLE_EXPAND : TITLE_LOAD_FIRST;
    btn.setAttribute('aria-label', enabled ? TITLE_EXPAND : TITLE_LOAD_FIRST);
  }

  function findWrapper(hostEl, wrapperSelector) {
    if (!hostEl) return null;
    const selector = String(wrapperSelector || '.matrix-wrapper').trim() || '.matrix-wrapper';
    return hostEl.querySelector(selector);
  }

  const EXPAND_ACTIVE_CLASS = 'school-matrix-expand-active';
  const EXPAND_STYLE_KEYS = ['display', 'flexDirection', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'minHeight', 'minWidth', 'overflow', 'height', 'maxHeight', 'width', 'boxSizing', 'maxWidth'];

  function snapshotInlineStyles(el, prefix) {
    if (!el) return;
    EXPAND_STYLE_KEYS.forEach((key) => {
      el.dataset[`${prefix}${key}`] = el.style[key] || '';
    });
  }

  function restoreInlineStyles(el, prefix) {
    if (!el) return;
    EXPAND_STYLE_KEYS.forEach((key) => {
      const dataKey = `${prefix}${key}`;
      if (Object.prototype.hasOwnProperty.call(el.dataset, dataKey)) {
        el.style[key] = el.dataset[dataKey];
        delete el.dataset[dataKey];
      }
    });
  }

  function applyExpandLayoutStyles(config) {
    const modalHost = document.getElementById(String(config.modalHostId || ''));
    const modalContent = modalHost?.closest('.modal-content');
    const wrap = findWrapper(modalHost, config.wrapperSelector);
    if (!modalHost || !wrap) return;

    snapshotInlineStyles(modalContent, 'mxC');
    snapshotInlineStyles(modalHost, 'mxB');
    snapshotInlineStyles(wrap, 'mxW');

    if (modalContent) {
      modalContent.style.display = 'flex';
      modalContent.style.flexDirection = 'column';
      modalContent.style.height = '100%';
      modalContent.style.maxHeight = '100dvh';
    }
    modalHost.style.display = 'flex';
    modalHost.style.flexDirection = 'column';
    modalHost.style.flex = '1 1 auto';
    modalHost.style.minHeight = '0';
    modalHost.style.minWidth = '0';
    modalHost.style.overflow = 'hidden';

    wrap.style.flex = '1 1 0%';
    wrap.style.minHeight = '0';
    wrap.style.minWidth = '0';
    wrap.style.width = '100%';
    wrap.style.maxWidth = '100%';
    wrap.style.maxHeight = 'none';
    wrap.style.height = 'auto';
    wrap.style.overflow = 'auto';
    wrap.style.boxSizing = 'border-box';
  }

  function clearExpandLayoutStyles(config) {
    const inlineHost = document.getElementById(String(config.inlineHostId || ''));
    const modalHost = document.getElementById(String(config.modalHostId || ''));
    const selector = String(config.wrapperSelector || '.matrix-wrapper').trim() || '.matrix-wrapper';
    const wrap = (modalHost && modalHost.querySelector(selector))
      || (inlineHost && inlineHost.querySelector(selector));
    const modalContent = modalHost?.closest('.modal-content') || wrap?.closest('.modal-content');
    restoreInlineStyles(wrap, 'mxW');
    restoreInlineStyles(modalHost, 'mxB');
    restoreInlineStyles(modalContent, 'mxC');
  }

  function moveWrapperToModal(config) {
    const inlineHost = document.getElementById(String(config.inlineHostId || ''));
    const modalHost = document.getElementById(String(config.modalHostId || ''));
    const wrap = findWrapper(inlineHost, config.wrapperSelector);
    if (wrap && modalHost) {
      modalHost.appendChild(wrap);
      wrap.classList.add(EXPAND_ACTIVE_CLASS);
    }
  }

  function restoreWrapperInline(config) {
    clearExpandLayoutStyles(config);
    const inlineHost = document.getElementById(String(config.inlineHostId || ''));
    const modalHost = document.getElementById(String(config.modalHostId || ''));
    const selector = String(config.wrapperSelector || '.matrix-wrapper').trim() || '.matrix-wrapper';
    const wrap = (modalHost && modalHost.querySelector(selector))
      || (inlineHost && inlineHost.querySelector(selector));
    if (wrap) wrap.classList.remove(EXPAND_ACTIVE_CLASS);
    if (wrap && inlineHost) inlineHost.appendChild(wrap);
  }

  function updateModalFullscreen(modalDialogId) {
    const dialog = document.getElementById(String(modalDialogId || ''));
    if (!dialog) return;
    dialog.classList.remove(...MODAL_SIZE_CLASSES);
    dialog.classList.add('modal-fullscreen');
  }

  function bindMatrixExpandedView(config = {}) {
    const modalId = String(config.modalId || '');
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return null;

    if (config.portalModalToBody !== false && modalEl.parentElement !== document.body) {
      document.body.appendChild(modalEl);
    }

    modalEl.addEventListener('show.bs.modal', () => {
      updateModalFullscreen(config.modalDialogId);
      moveWrapperToModal(config);
      applyExpandLayoutStyles(config);
    });
    modalEl.addEventListener('shown.bs.modal', () => {
      applyExpandLayoutStyles(config);
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
      restoreWrapperInline(config);
    });

    return { modalEl };
  }

  global.SchoolMatrixExpandedView = {
    bindMatrixExpandedView,
    setMatrixExpandEnabled,
    moveWrapperToModal,
    restoreWrapperInline
  };
}(window));
