(function initSchoolBookPreviewModal(global) {
  'use strict';

  const API_BASE = '/school/library/books/api/preview';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getModalEl() {
    return document.getElementById('schoolBookPreviewModal');
  }

  function mountModalToBody(el) {
    if (!el || el.parentElement === document.body) return el;
    document.body.appendChild(el);
    return el;
  }

  function raiseModalAboveStack(el) {
    if (!el) return;
    mountModalToBody(el);
    let maxZ = 1050;
    document.querySelectorAll('.modal.show').forEach((openModal) => {
      if (openModal === el) return;
      const z = Number.parseInt(window.getComputedStyle(openModal).zIndex, 10);
      if (Number.isFinite(z) && z > maxZ) maxZ = z;
    });
    const modalZ = Math.max(maxZ + 10, 1060);
    el.style.setProperty('z-index', String(modalZ), 'important');
    const backdrops = document.querySelectorAll('.modal-backdrop.show');
    const backdrop = backdrops[backdrops.length - 1];
    if (backdrop) backdrop.style.setProperty('z-index', String(modalZ - 5), 'important');
  }

  function getBootstrapModal() {
    const el = getModalEl();
    if (!el || !global.bootstrap?.Modal) return null;
    mountModalToBody(el);
    return global.bootstrap.Modal.getOrCreateInstance(el);
  }

  function setVisible(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('d-none', !show);
  }

  function resetModal() {
    setVisible('schoolBookPreviewLoading', false);
    setVisible('schoolBookPreviewError', false);
    setVisible('schoolBookPreviewContent', false);
    setVisible('schoolBookPreviewTocEmpty', false);
    const err = document.getElementById('schoolBookPreviewError');
    if (err) err.textContent = '';
    const body = document.getElementById('schoolBookPreviewTocBody');
    if (body) body.innerHTML = '';
    const resources = document.getElementById('schoolBookPreviewResources');
    if (resources) {
      resources.innerHTML = '';
      resources.classList.add('d-none');
    }
    const tableWrap = document.querySelector('#schoolBookPreviewContent .table-responsive');
    if (tableWrap) tableWrap.classList.remove('d-none');
  }

  function formatPageCell(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? String(n) : '';
  }

  function formatPageRange(startPage, endPage) {
    const start = formatPageCell(startPage);
    const end = formatPageCell(endPage);
    if (start && end && end !== start) return start + '–' + end;
    if (start) return start;
    if (end) return end;
    return '—';
  }

  function renderTocRows(tableOfContents) {
    const rows = Array.isArray(tableOfContents) ? tableOfContents : [];
    if (!rows.length) {
      const tableWrap = document.querySelector('#schoolBookPreviewContent .table-responsive');
      if (tableWrap) tableWrap.classList.add('d-none');
      setVisible('schoolBookPreviewTocEmpty', true);
      return;
    }
    const body = document.getElementById('schoolBookPreviewTocBody');
    if (!body) return;
    body.innerHTML = rows.map((entry) => {
      const level = Math.min(6, Math.max(1, Number(entry.level) || 1));
      const label = escapeHtml(entry.label || '—');
      const pages = escapeHtml(formatPageRange(entry.startPage, entry.endPage));
      return (
        '<tr class="book-preview-toc-row book-preview-toc-row--level-' + level + '">' +
        '<td class="ps-3 book-preview-toc-heading-cell">' +
        '<span class="book-preview-toc-heading d-block">' + label + '</span>' +
        '</td>' +
        '<td class="text-end pe-3 book-preview-toc-heading-cell">' +
        '<span class="book-preview-toc-pages">' + pages + '</span>' +
        '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderResources(book) {
    const host = document.getElementById('schoolBookPreviewResources');
    if (!host) return;
    const pdfUrl = String(book?.digitalPdf?.url || '').trim();
    const pdfName = String(book?.digitalPdf?.fileName || 'book.pdf').trim() || 'book.pdf';
    const thirdPartyUrl = String(book?.thirdPartyDigitalUrl || '').trim();
    let html = '';
    if (pdfUrl) {
      html += '<a href="' + escapeHtml(pdfUrl) + '" class="btn btn-outline-primary btn-sm" download="' + escapeHtml(pdfName) + '" target="_blank" rel="noopener noreferrer">' +
        '<i class="bi bi-file-earmark-pdf me-1"></i>Download PDF</a>';
    }
    if (thirdPartyUrl) {
      html += '<a href="' + escapeHtml(thirdPartyUrl) + '" class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener noreferrer">' +
        '<i class="bi bi-box-arrow-up-right me-1"></i>Open online book</a>';
    }
    if (html) {
      host.innerHTML = html;
      host.classList.remove('d-none');
    } else {
      host.innerHTML = '';
      host.classList.add('d-none');
    }
  }

  function setModalTitle(fallbackTitle, book) {
    const titleEl = document.getElementById('schoolBookPreviewModalTitle');
    const subtitleEl = document.getElementById('schoolBookPreviewModalSubtitle');
    const title = String(book?.title || fallbackTitle || 'Book').trim() || 'Book';
    if (titleEl) {
      titleEl.innerHTML = '<i class="bi bi-list-nested me-2 text-primary"></i>' + escapeHtml(title);
    }
    if (subtitleEl) {
      const parts = [];
      if (book?.subtitle) parts.push(String(book.subtitle));
      if (book?.totalPages) parts.push(book.totalPages + ' pages');
      if (parts.length) {
        subtitleEl.textContent = parts.join(' · ');
        subtitleEl.classList.remove('d-none');
      } else {
        subtitleEl.textContent = '';
        subtitleEl.classList.add('d-none');
      }
    }
  }

  async function openPreview(bookId, fallbackTitle) {
    const id = String(bookId || '').trim();
    if (!id) return;
    const modal = getBootstrapModal();
    if (!modal) return;

    resetModal();
    setModalTitle(fallbackTitle, null);
    setVisible('schoolBookPreviewLoading', true);
    const modalEl = getModalEl();
    if (modalEl) {
      modalEl.addEventListener('shown.bs.modal', () => {
        raiseModalAboveStack(modalEl);
      }, { once: true });
    }
    modal.show();

    try {
      const res = await fetch(API_BASE + '/' + encodeURIComponent(id), {
        headers: { 'X-AJAX-Request': 'true' },
        credentials: 'same-origin'
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success' || !result.book) {
        throw new Error(result.message || 'Could not load book preview.');
      }
      setVisible('schoolBookPreviewLoading', false);
      setVisible('schoolBookPreviewContent', true);
      setModalTitle(fallbackTitle, result.book);
      renderResources(result.book);
      renderTocRows(result.book.tableOfContents);
    } catch (error) {
      setVisible('schoolBookPreviewLoading', false);
      const err = document.getElementById('schoolBookPreviewError');
      if (err) {
        err.textContent = error.message || 'Could not load book preview.';
        err.classList.remove('d-none');
      }
    }
  }

  function closeRowActionsMenu() {
    document.querySelectorAll('.row-actions-menu').forEach((menu) => menu.classList.add('d-none'));
  }

  function wire() {
    const modalEl = getModalEl();
    if (!modalEl) return;

    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.style.removeProperty('z-index');
      resetModal();
    });
    mountModalToBody(modalEl);

    document.addEventListener('click', (event) => {
      const btn = event.target.closest('.js-book-preview');
      if (!btn) return;
      event.preventDefault();
      closeRowActionsMenu();
      let fallbackTitle = btn.getAttribute('data-book-title') || '';
      try {
        fallbackTitle = JSON.parse(fallbackTitle);
      } catch (_) { /* use raw */ }
      openPreview(btn.dataset.bookId, fallbackTitle);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  global.SchoolBookPreviewModal = { openPreview };
})(window);
