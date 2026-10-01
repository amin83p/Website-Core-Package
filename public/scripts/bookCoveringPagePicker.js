/**
 * Modal to pick individual page numbers within selected TOC units (page_numbers coverage).
 */
(function (global) {
  'use strict';

  let modalInstance = null;
  let currentCallback = null;
  let hostEl = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureModal() {
    const el = document.getElementById('bookCoveringPagePickerModal');
    if (!el || !global.bootstrap?.Modal) return null;
    if (!modalInstance) modalInstance = new global.bootstrap.Modal(el);
    hostEl = document.getElementById('bookCoveringPagePickerHost');
    return modalInstance;
  }

  function open(options = {}) {
    const modal = ensureModal();
    if (!modal) {
      alert('Page picker is not available.');
      return;
    }
    const utils = global.BookCoveringTocUtils;
    if (!utils) {
      alert('Page picker utilities are not loaded.');
      return;
    }
    const toc = Array.isArray(options.tableOfContents) ? options.tableOfContents : [];
    const unitIds = Array.isArray(options.selectedUnitIds) ? options.selectedUnitIds : [];
    const initialPages = Array.isArray(options.selectedPageNumbers) ? options.selectedPageNumbers : [];
    const empty = document.getElementById('bookCoveringPagePickerEmpty');
    const subtitle = document.getElementById('bookCoveringPagePickerSubtitle');
    if (subtitle) {
      subtitle.textContent = options.bookTitle ? String(options.bookTitle) : '';
    }
    currentCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    if (!unitIds.length) {
      if (hostEl) hostEl.innerHTML = '';
      empty?.classList.remove('d-none');
      modal.show();
      return;
    }
    empty?.classList.add('d-none');
    if (hostEl) {
      hostEl.innerHTML = utils.buildPageToggleGroupsHtml(toc, unitIds, initialPages, {
        escapeHtml,
        readOnly: false
      });
      utils.bindPageToggleGroups(hostEl, (pages) => {
        hostEl.dataset.pendingPages = JSON.stringify(pages);
      });
      hostEl.dataset.pendingPages = JSON.stringify(initialPages);
    }
    modal.show();
  }

  function initConfirmButton() {
    const btn = document.getElementById('bookCoveringPagePickerConfirmBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const utils = global.BookCoveringTocUtils;
      let pages = [];
      if (hostEl && utils) {
        pages = utils.collectSelectedPageNumbers(hostEl);
      }
      if (currentCallback) currentCallback(pages);
      if (modalInstance) modalInstance.hide();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConfirmButton);
  } else {
    initConfirmButton();
  }

  global.BookCoveringPagePicker = { open };
})(window);
