/**
 * Book TOC picker modal — select TOC entry IDs from a hierarchical table of contents.
 */
(function (global) {
  'use strict';

  let modalInstance = null;
  let currentCallback = null;
  let selectedIds = new Set();

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getModalEl() {
    return document.getElementById('bookTocPickerModal');
  }

  function ensureModal() {
    const el = getModalEl();
    if (!el || !global.bootstrap?.Modal) return null;
    if (!modalInstance) modalInstance = new global.bootstrap.Modal(el);
    return modalInstance;
  }

  function renderTree(tocEntries, mode) {
    const tree = document.getElementById('bookTocPickerTree');
    const empty = document.getElementById('bookTocPickerEmpty');
    if (!tree) return;
    const rows = Array.isArray(tocEntries) ? tocEntries : [];
    if (!rows.length) {
      tree.innerHTML = '';
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    if (mode === 'units') {
      const utils = global.BookCoveringTocUtils;
      if (!utils) {
        tree.innerHTML = '<div class="text-muted small">TOC picker utilities are not loaded.</div>';
        return;
      }
      const h1Selected = utils.normalizeTocEntryIdsToH1(rows, [...selectedIds]);
      selectedIds = new Set(h1Selected);
      tree.innerHTML = utils.buildSelectableTocTableHtml(rows, h1Selected, { escapeHtml });
      utils.bindSelectableTocTable(tree, rows, {
        onChange: (h1Ids) => {
          selectedIds = new Set(h1Ids);
        }
      });
    } else {
      tree.innerHTML = rows.map((entry) => {
        const id = String(entry?.id || '').trim();
        const level = Number(entry?.level || 1);
        const label = escapeHtml(entry?.label || id);
        const start = entry?.startPage;
        const end = entry?.endPage;
        const pageLabel = start
          ? (end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`)
          : '';
        const checked = selectedIds.has(id) ? 'checked' : '';
        return (
          '<div class="toc-picker-row">' +
          '<input type="checkbox" class="form-check-input mt-1 js-toc-pick" value="' + escapeHtml(id) + '" ' + checked + '>' +
          '<div class="toc-picker-label" style="--toc-level:' + Math.max(0, level - 1) + '">' +
          '<div class="fw-semibold">' + label + '</div>' +
          (pageLabel ? '<div class="toc-picker-pages">' + escapeHtml(pageLabel) + '</div>' : '') +
          '</div></div>'
        );
      }).join('');
    }

    tree.querySelectorAll('.js-toc-pick').forEach((input) => {
      input.addEventListener('change', () => {
        const val = String(input.value || '').trim();
        if (!val) return;
        if (input.checked) selectedIds.add(val);
        else selectedIds.delete(val);
      });
    });
  }

  function open(options = {}) {
    const modal = ensureModal();
    if (!modal) {
      alert('TOC picker is not available.');
      return;
    }
    const toc = Array.isArray(options.tableOfContents) ? options.tableOfContents : [];
    const mode = String(options.mode || 'units').toLowerCase();
    const subtitle = document.getElementById('bookTocPickerSubtitle');
    const title = document.getElementById('bookTocPickerModalLabel');
    if (subtitle) {
      subtitle.textContent = options.bookTitle
        ? String(options.bookTitle) + (mode === 'pages' ? ' — select page ranges' : ' — select units')
        : '';
    }
    if (title) {
      title.innerHTML = '<i class="bi bi-list-nested me-2"></i>' + (mode === 'pages' ? 'Pick pages from TOC' : 'Pick units from TOC');
    }
    const rawSelected = (Array.isArray(options.selectedIds) ? options.selectedIds : []).map((id) => String(id).trim()).filter(Boolean);
    selectedIds = new Set(rawSelected);
    if (mode === 'units' && global.BookCoveringTocUtils && toc.length) {
      selectedIds = new Set(global.BookCoveringTocUtils.normalizeTocEntryIdsToH1(toc, rawSelected));
    }
    currentCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    renderTree(toc, mode);
    modal.show();
  }

  function initConfirmButton() {
    const btn = document.getElementById('bookTocPickerConfirmBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const ids = [...selectedIds];
      if (currentCallback) currentCallback(ids);
      if (modalInstance) modalInstance.hide();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConfirmButton);
  } else {
    initConfirmButton();
  }

  global.BookTocPicker = { open };
})(window);
